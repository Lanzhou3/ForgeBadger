import { execFile } from "node:child_process";
import { buildSanitizedMultiplexerEnv } from "./terminal-multiplexer-runtime.js";

export type CodexNativeAuthState = "ready" | "not_authenticated" | "cli_missing" | "unknown";
export type CodexNativeAuthMethod = "chatgpt" | "api" | "unknown";

export interface CodexNativeAuthStatus {
  state: CodexNativeAuthState;
  method: CodexNativeAuthMethod;
}

export type CodexStatusRunner = (
  command: string,
  args: string[],
  signal: AbortSignal,
  options: { env: NodeJS.ProcessEnv }
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

const statusCache = new Map<string, { expiresAt: number; value: CodexNativeAuthStatus }>();
const statusFlights = new Map<string, Promise<CodexNativeAuthStatus>>();
let globalActive = 0;
const maxGlobalActive = 4;
const cacheTtlMs = 2_000;

export class CodexNativeAuthStatusLimitError extends Error {
  readonly code = "CODEX_NATIVE_STATUS_BUSY";
}

export async function observeCodexNativeAuthStatusForUser(
  userId: string,
  options: Parameters<typeof observeCodexNativeAuthStatus>[0] = {}
): Promise<CodexNativeAuthStatus> {
  const cached = statusCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const existing = statusFlights.get(userId);
  if (existing) return existing;
  if (globalActive >= maxGlobalActive) throw new CodexNativeAuthStatusLimitError("Codex native status is busy");
  globalActive += 1;
  const flight = observeCodexNativeAuthStatus(options).then((value) => {
    statusCache.set(userId, { expiresAt: Date.now() + cacheTtlMs, value });
    return value;
  }).finally(() => {
    globalActive -= 1;
    statusFlights.delete(userId);
  });
  statusFlights.set(userId, flight);
  return flight;
}

export function resetCodexNativeAuthStatusCache(): void {
  statusCache.clear();
  statusFlights.clear();
  globalActive = 0;
}

export async function observeCodexNativeAuthStatus(options: {
  run?: CodexStatusRunner;
  timeoutMs?: number;
} = {}): Promise<CodexNativeAuthStatus> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 2_000);
  timeout.unref?.();
  try {
    const result = await (options.run ?? runCodexStatus)(
      "codex", ["login", "status"], controller.signal,
      { env: buildSanitizedMultiplexerEnv(process.env) }
    );
    const output = `${result.stdout}\n${result.stderr}`;
    if (/not\s+(?:logged|signed)\s+in|unauthenticated/iu.test(output)) {
      return { state: "not_authenticated", method: "unknown" };
    }
    if (result.exitCode !== 0) return { state: "unknown", method: "unknown" };
    return { state: "ready", method: normalizeMethod(output) };
  } catch (error) {
    if (isMissingBinary(error)) return { state: "cli_missing", method: "unknown" };
    return { state: "unknown", method: "unknown" };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeMethod(output: string): CodexNativeAuthMethod {
  if (/chatgpt/iu.test(output)) return "chatgpt";
  if (/api[\s_-]*key/iu.test(output)) return "api";
  return "unknown";
}

function runCodexStatus(
  command: string,
  args: string[],
  signal: AbortSignal,
  options: { env: NodeJS.ProcessEnv }
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
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

function isMissingBinary(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
