import path from "node:path";
import { readFile, stat } from "node:fs/promises";

import type { CliAccountOverview, CliLoginStatus, CliQuotaEntry, CliQuotaResult } from "./types.js";
import { globalConfigRoot } from "../cli-config-target.js";
import {
  claudeKeychainAccount,
  claudeKeychainServiceName,
  readMacosKeychainSecret,
  type ClaudeKeychainReader
} from "./claude-keychain.js";
import {
  buildCliProbeEnv,
  createPerUserProbeCache,
  fetchCliQuotaJson,
  isMissingBinaryError,
  parseLooseNumber,
  probeConfigRootOptions,
  readCliTokenFile,
  runCliProbe,
  stringField,
  toIsoTimestamp,
  asRecord,
  type CliProbeRunner
} from "./probe-runner.js";

export interface CliAccountProbeOptions {
  run?: CliProbeRunner;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  /** Login probe timeout; defaults to 2s. */
  timeoutMs?: number;
  /** macOS Keychain reader override (tests); defaults to security(1). */
  readKeychain?: ClaudeKeychainReader;
  /** Platform override (tests); defaults to process.platform. */
  platform?: NodeJS.Platform;
}

// Unofficial endpoint (reverse-engineered; community-verified). The parser
// below is format-tolerant and degrades to `unknown`-style results rather
// than failing when the shape drifts.
const claudeUsageUrl = "https://api.anthropic.com/api/oauth/usage";

const loginCache = createPerUserProbeCache<CliLoginStatus>(2_000);

export function resetClaudeAccountProbeCache(): void {
  loginCache.clear();
}

export async function buildClaudeAccountOverview(
  userId: string,
  options: CliAccountProbeOptions = {}
): Promise<CliAccountOverview> {
  const login = await loginCache.probe(userId, () => observeClaudeLogin(options));
  const quota = await observeClaudeQuota(options);
  return { login, quota };
}

export async function observeClaudeLogin(options: CliAccountProbeOptions = {}): Promise<CliLoginStatus> {
  const base = { adapter: "claude" as const };
  // A routed endpoint (Gateway loopback or third-party compatible relay)
  // makes the native-login question moot: `claude auth status` reports the
  // route's ANTHROPIC_AUTH_TOKEN as an oauth login (exit 0, loggedIn:true),
  // which the badge must not surface as a first-party login.
  if (await isRoutedToCustomEndpoint(options)) {
    return { ...base, state: "custom_endpoint" };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 2_000);
  timeout.unref?.();
  try {
    const result = await (options.run ?? runCliProbe)(
      "claude", ["auth", "status"], controller.signal,
      { env: buildCliProbeEnv() }
    );
    const parsed = parseJsonRecord(result.stdout);
    const method = stringField(parsed?.authMethod) ?? "claude.ai";
    const accountLabel = stringField(parsed?.email);
    // Exit code wins per the CLI contract (0 = logged in, 1 = not logged in).
    // Known false positive (issue #84394): with a third-party gateway config
    // the payload can say loggedIn:false on exit 0 — pass the raw value
    // through in detailCode so the UI never concludes strongly.
    if (result.exitCode === 0) {
      const mismatch = parsed?.loggedIn === false ? { detailCode: "loggedIn:false" } : {};
      return { ...base, state: "ready", method, ...accountLabelField(accountLabel), ...mismatch };
    }
    if (result.exitCode === 1) {
      return { ...base, state: "not_authenticated", method: stringField(parsed?.authMethod) ?? "unknown" };
    }
    return { ...base, state: "unknown", method: "unknown" };
  } catch (error) {
    if (isMissingBinaryError(error)) return { ...base, state: "cli_missing", method: "unknown" };
    return { ...base, state: "unknown", method: "unknown" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function observeClaudeQuota(options: CliAccountProbeOptions = {}): Promise<CliQuotaResult> {
  const fetchedAt = new Date().toISOString();
  const lookup = await resolveClaudeQuotaToken(options);
  if (!lookup.ok) return unsupportedQuota(fetchedAt, lookup.reason);
  const outcome = await fetchCliQuotaJson({
    url: claudeUsageUrl,
    headers: {
      Authorization: `Bearer ${lookup.token}`,
      "anthropic-beta": "oauth-2025-04-20"
    },
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
  });
  if (!outcome.ok) {
    // `claude setup-token` tokens carry only the user:inference scope; the
    // usage endpoint answers 403 for them, which is not an expiry.
    if (lookup.source === "setup_token" && outcome.httpStatus === 403) {
      return unsupportedQuota(fetchedAt, "setup_token_scope");
    }
    return unsupportedQuota(
      fetchedAt,
      outcome.errorCode === "token_expired" ? "token_expired" : "upstream_error"
    );
  }
  const entries = parseUsageBody(outcome.body);
  const planLabel = stringField(asRecord(outcome.body)?.planType) ?? stringField(asRecord(outcome.body)?.plan_type);
  return { supported: true, entries, fetchedAt, ...(planLabel ? { planLabel } : {}) };
}

type ClaudeQuotaTokenLookup =
  | { ok: true; token: string; source: "setup_token" | "stored_login" }
  | { ok: false; reason: "keychain" | "no_native_login" };

/**
 * Resolve the OAuth token the CLI itself would use, in Claude Code's order:
 * CLAUDE_CODE_OAUTH_TOKEN (settings.json `env` overrides the process env),
 * then the stored login (`.credentials.json`, or the Keychain on macOS).
 * Token values stay in memory and are only sent to the usage endpoint.
 */
async function resolveClaudeQuotaToken(options: CliAccountProbeOptions): Promise<ClaudeQuotaTokenLookup> {
  const env = options.env ?? process.env;
  const root = globalConfigRoot("claude", probeConfigRootOptions(options));
  const settings = await readConfigDocBounded(path.join(root, "settings.json"));
  const setupToken =
    stringField(asRecord(settings?.env)?.CLAUDE_CODE_OAUTH_TOKEN) ?? stringField(env.CLAUDE_CODE_OAUTH_TOKEN);
  if (setupToken) return { ok: true, token: setupToken, source: "setup_token" };

  const credentials = await readCliTokenFile(path.join(root, ".credentials.json"));
  const fileToken = credentials.ok ? oauthAccessToken(credentials.data) : undefined;
  if (fileToken) return { ok: true, token: fileToken, source: "stored_login" };

  if ((options.platform ?? process.platform) !== "darwin") return { ok: false, reason: "no_native_login" };
  const read = await (options.readKeychain ?? readMacosKeychainSecret)(
    claudeKeychainServiceName(env),
    claudeKeychainAccount(env)
  );
  if (read.status === "error") return { ok: false, reason: "keychain" };
  const keychainToken = read.status === "found" ? oauthAccessToken(parseKeychainJsonRecord(read.secret)) : undefined;
  if (keychainToken) return { ok: true, token: keychainToken, source: "stored_login" };
  return { ok: false, reason: "no_native_login" };
}

function oauthAccessToken(data: Record<string, unknown> | undefined): string | undefined {
  return stringField(asRecord(data?.claudeAiOauth)?.accessToken);
}

function parseKeychainJsonRecord(raw: string): Record<string, unknown> | undefined {
  const direct = parseJsonRecord(raw);
  if (direct) return direct;
  const candidate = raw.trim();
  // macOS 26 may render non-ASCII Keychain payloads as an even-length hex string.
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(candidate)) return undefined;
  return parseJsonRecord(Buffer.from(candidate, "hex").toString("utf8"));
}

/** Claude global settings can carry plugins/marketplace metadata; cap the read. */
const maxClaudeSettingsBytes = 256 * 1024;

/** True when the effective global config points Claude at a non-Anthropic endpoint. */
async function isRoutedToCustomEndpoint(options: CliAccountProbeOptions): Promise<boolean> {
  const root = globalConfigRoot("claude", probeConfigRootOptions(options));
  const doc = await readConfigDocBounded(path.join(root, "settings.json"));
  const baseUrl = stringField(asRecord(doc?.env)?.ANTHROPIC_BASE_URL);
  if (!baseUrl) return false;
  return !isAnthropicFirstPartyBaseUrl(baseUrl);
}

/**
 * In-memory-only, size-capped JSON config reader. The env block may hold
 * credentials — the value is never logged, persisted, or returned by an API.
 */
async function readConfigDocBounded(filePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const info = await stat(filePath);
    if (!info.isFile() || info.size > maxClaudeSettingsBytes) return undefined;
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    return asRecord(parsed);
  } catch {
    return undefined;
  }
}

function isAnthropicFirstPartyBaseUrl(baseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === "api.anthropic.com" || host.endsWith(".anthropic.com");
}

function parseJsonRecord(raw: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

function accountLabelField(accountLabel: string | undefined): { accountLabel?: string } {
  return accountLabel ? { accountLabel } : {};
}

function unsupportedQuota(fetchedAt: string, reason: CliQuotaResult["unsupportedReason"]): CliQuotaResult {
  return { supported: false, entries: [], fetchedAt, ...(reason ? { unsupportedReason: reason } : {}) };
}

function parseUsageBody(body: unknown): CliQuotaEntry[] {
  const root = asRecord(body);
  if (!root) return [];
  const entries: CliQuotaEntry[] = [];

  // Legacy flat format: five_hour / seven_day / seven_day_sonnet / seven_day_opus.
  const flatLabels: Record<string, string> = {
    five_hour: "5h window",
    seven_day: "Weekly window",
    seven_day_sonnet: "Weekly (Sonnet)",
    seven_day_opus: "Weekly (Opus)"
  };
  for (const [key, label] of Object.entries(flatLabels)) {
    const window = asRecord(root[key]);
    const usedPercent = window ? parseLooseNumber(window.utilization) : undefined;
    if (usedPercent === undefined) continue;
    const resetsAt = window ? toIsoTimestamp(window.resets_at) : undefined;
    entries.push({
      label,
      unit: "percent",
      usedPercent,
      ...(resetsAt ? { resetsAt } : {})
    });
  }
  if (entries.length > 0) return entries;

  // Newer format: limits[] array. Unknown item shapes are skipped.
  const limits = Array.isArray(root.limits) ? root.limits : [];
  for (const item of limits) {
    const record = asRecord(item);
    if (!record) continue;
    const usedPercent =
      parseLooseNumber(record.utilization) ??
      parseLooseNumber(record.used_percent) ??
      parseLooseNumber(record.usedPercent) ??
      parseLooseNumber(record.percent);
    if (usedPercent === undefined) continue;
    const rawLabel =
      stringField(record.type) ?? stringField(record.id) ?? stringField(record.name) ?? "window";
    const resetsAt = toIsoTimestamp(record.resets_at) ?? toIsoTimestamp(record.reset_at);
    entries.push({
      label: labelForLimitType(rawLabel),
      unit: "percent",
      usedPercent,
      ...(resetsAt ? { resetsAt } : {})
    });
  }
  return entries;
}

function labelForLimitType(rawType: string): string {
  const normalized = rawType.toLowerCase();
  if (normalized.includes("five") || normalized.includes("5h") || normalized.includes("5_hour")) return "5h window";
  if (normalized.includes("sonnet")) return "Weekly (Sonnet)";
  if (normalized.includes("opus")) return "Weekly (Opus)";
  if (normalized.includes("seven") || normalized.includes("7d") || normalized.includes("week")) return "Weekly window";
  return rawType;
}
