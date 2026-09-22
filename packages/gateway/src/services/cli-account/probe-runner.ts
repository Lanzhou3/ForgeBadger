import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";

import { buildSanitizedEnv } from "../session-server/env-policy.js";

/**
 * Generic probe infrastructure for the cli-account subsystem, generalized
 * from the former codex-native-auth-status probe: per-user caching with
 * in-flight dedupe and a global concurrency cap, an injectable execFile
 * runner, a read-only token-file reader, and a tolerant HTTPS JSON fetcher
 * for the unofficial quota endpoints.
 */

export interface CliProbeRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CliProbeRunner = (
  command: string,
  args: string[],
  signal: AbortSignal,
  options: { env: NodeJS.ProcessEnv }
) => Promise<CliProbeRunResult>;

export function buildCliProbeEnv(): NodeJS.ProcessEnv {
  return buildSanitizedEnv(process.env);
}

export function runCliProbe(
  command: string,
  args: string[],
  signal: AbortSignal,
  options: { env: NodeJS.ProcessEnv }
): Promise<CliProbeRunResult> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { signal, timeout: 2_000, maxBuffer: 16 * 1024, env: options.env }, (error, stdout, stderr) => {
      if (error && typeof (error as { code?: unknown }).code !== "number") {
        reject(error);
        return;
      }
      resolve({
        exitCode: typeof (error as { code?: unknown } | null)?.code === "number" ? (error as unknown as { code: number }).code : 0,
        stdout,
        stderr
      });
    });
  });
}

export function isMissingBinaryError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

export class CliProbeLimitError extends Error {
  readonly code = "CLI_PROBE_BUSY";
}

const maxGlobalActiveProbes = 4;

/**
 * Per-probe-kind cache: 2s TTL per user, singleflight per user, and a global
 * concurrency cap so a burst of users cannot spawn unbounded CLI subprocesses.
 */
export function createPerUserProbeCache<T>(ttlMs: number) {
  const cache = new Map<string, { expiresAt: number; value: T }>();
  const flights = new Map<string, Promise<T>>();
  let active = 0;

  return {
    async probe(userId: string, run: () => Promise<T>): Promise<T> {
      const cached = cache.get(userId);
      if (cached && cached.expiresAt > Date.now()) return cached.value;
      const existing = flights.get(userId);
      if (existing) return existing;
      if (active >= maxGlobalActiveProbes) throw new CliProbeLimitError("CLI account probe is busy");
      active += 1;
      const flight = run().then((value) => {
        cache.set(userId, { expiresAt: Date.now() + ttlMs, value });
        return value;
      }).finally(() => {
        active -= 1;
        flights.delete(userId);
      });
      flights.set(userId, flight);
      return flight;
    },
    clear(): void {
      cache.clear();
      flights.clear();
      active = 0;
    }
  };
}

const maxTokenFileBytes = 64 * 1024;

export type CliTokenFileRead =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false };

/**
 * Read-only token material reader. Tokens are password-equivalent: the file
 * is read into memory only, never persisted, logged, or returned by any API.
 * Enforces the 64KB cap and a POSIX 0600 permission check (Windows ACLs do
 * not expose POSIX mode bits, so the check is skipped there).
 */
export async function readCliTokenFile(filePath: string): Promise<CliTokenFileRead> {
  try {
    const info = await stat(filePath);
    if (!info.isFile() || info.size > maxTokenFileBytes) return { ok: false };
    if (process.platform !== "win32" && (info.mode & 0o077) !== 0) return { ok: false };
    const raw = await readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ok: false };
    return { ok: true, data: parsed as Record<string, unknown> };
  } catch {
    return { ok: false };
  }
}

export type CliQuotaFetchOutcome =
  | { ok: true; body: unknown }
  | { ok: false; errorCode: "token_expired" | "upstream_error" | "timeout" | "invalid_response" };

const defaultQuotaTimeoutMs = 10_000;

export interface CliQuotaFetchRequest {
  url: string;
  /** May carry secrets (Bearer token, account id) — never logged or echoed. */
  headers: Record<string, string>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Tolerant HTTPS JSON fetcher for the unofficial quota endpoints. Never
 * throws: failures degrade to a classified error code. 401/403 means the
 * access token died (we never refresh OAuth tokens ourselves — the user must
 * re-login); 429/5xx and network issues are upstream errors.
 */
export async function fetchCliQuotaJson(request: CliQuotaFetchRequest): Promise<CliQuotaFetchOutcome> {
  const fetchImpl = request.fetchImpl ?? fetch;
  const timeoutMs = request.timeoutMs ?? defaultQuotaTimeoutMs;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(request.url, {
      method: "GET",
      headers: { Accept: "application/json", ...request.headers },
      redirect: "error",
      signal: controller.signal
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return { ok: false, errorCode: "token_expired" };
      return { ok: false, errorCode: "upstream_error" };
    }
    const body: unknown = await response.json().catch(() => undefined);
    if (body === undefined) return { ok: false, errorCode: "invalid_response" };
    return { ok: true, body };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return { ok: false, errorCode: "timeout" };
    return { ok: false, errorCode: "upstream_error" };
  } finally {
    clearTimeout(timeout);
  }
}

/** Tolerantly extract `exp` (seconds) from a JWT payload; undefined when absent/malformed. */
export function parseJwtExpiresAt(token: string): number | undefined {
  const parts = token.split(".");
  if (parts.length < 2) return undefined;
  const payload = parts[1];
  if (!payload) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
    const exp = asRecord(decoded)?.exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp : undefined;
  } catch {
    return undefined;
  }
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Parse a JSON field as a number, tolerating string-encoded numbers. */
export function parseLooseNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** Normalize epoch seconds / epoch ms / ISO strings into an ISO timestamp. */
export function toIsoTimestamp(value: unknown): string | undefined {
  if (typeof value === "string" && value) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 1e12 ? value : value * 1000;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return undefined;
}

export function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/** exactOptionalPropertyTypes-safe forwarding of probe overrides to globalConfigRoot. */
export function probeConfigRootOptions(options: {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}): { env?: NodeJS.ProcessEnv; homeDir?: string } {
  return {
    ...(options.env !== undefined ? { env: options.env } : {}),
    ...(options.homeDir !== undefined ? { homeDir: options.homeDir } : {})
  };
}
