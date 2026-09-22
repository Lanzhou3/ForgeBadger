import path from "node:path";

import type { CliAccountOverview, CliLoginStatus, CliQuotaEntry, CliQuotaResult } from "./types.js";
import type { CliAccountProbeOptions } from "./claude-account.js";
import { globalConfigRoot } from "../cli-config-target.js";
import {
  buildCliProbeEnv,
  createPerUserProbeCache,
  fetchCliQuotaJson,
  isMissingBinaryError,
  parseJwtExpiresAt,
  parseLooseNumber,
  probeConfigRootOptions,
  readCliTokenFile,
  runCliProbe,
  stringField,
  toIsoTimestamp,
  asRecord
} from "./probe-runner.js";

// Internal endpoint (confirmed by the official CLI's own calls). Tolerant
// parser; format drift degrades instead of failing.
const codexUsageUrl = "https://chatgpt.com/backend-api/wham/usage";

const loginCache = createPerUserProbeCache<CliLoginStatus>(2_000);

export function resetCodexAccountProbeCache(): void {
  loginCache.clear();
}

export async function buildCodexAccountOverview(
  userId: string,
  options: CliAccountProbeOptions = {}
): Promise<CliAccountOverview> {
  const login = await loginCache.probe(userId, () => observeCodexLogin(options));
  const quota = await observeCodexQuota(options);
  return { login, quota };
}

/**
 * Migrated from the former codex-native-auth-status service: `codex login
 * status` speaks on stderr and exits 0/1; the not-logged-in copy is matched
 * case-insensitively before the exit code is consulted.
 */
export async function observeCodexLogin(options: CliAccountProbeOptions = {}): Promise<CliLoginStatus> {
  const base = { adapter: "codex" as const };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 2_000);
  timeout.unref?.();
  try {
    const result = await (options.run ?? runCliProbe)(
      "codex", ["login", "status"], controller.signal,
      { env: buildCliProbeEnv() }
    );
    const output = `${result.stdout}\n${result.stderr}`;
    if (/not\s+(?:logged|signed)\s+in|unauthenticated/iu.test(output)) {
      return { ...base, state: "not_authenticated", method: "unknown" };
    }
    if (result.exitCode !== 0) return { ...base, state: "unknown", method: "unknown" };
    return { ...base, state: "ready", method: normalizeMethod(output) };
  } catch (error) {
    if (isMissingBinaryError(error)) return { ...base, state: "cli_missing", method: "unknown" };
    return { ...base, state: "unknown", method: "unknown" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function observeCodexQuota(options: CliAccountProbeOptions = {}): Promise<CliQuotaResult> {
  const fetchedAt = new Date().toISOString();
  const root = globalConfigRoot("codex", probeConfigRootOptions(options));
  const auth = await readCliTokenFile(path.join(root, "auth.json"));
  const tokens = auth.ok ? asRecord(auth.data.tokens) : undefined;
  const accessToken = tokens ? stringField(tokens.access_token) : undefined;
  const accountId = tokens ? stringField(tokens.account_id) : undefined;

  if (!accessToken) {
    if (auth.ok && stringField(auth.data.OPENAI_API_KEY)) {
      return unsupportedQuota(fetchedAt, "api_key_mode");
    }
    return unsupportedQuota(fetchedAt, "no_native_login");
  }

  // The JWT `exp` is the only expiry source (auth.json has no expires field).
  // Never refresh OAuth tokens ourselves — an expired token means the user
  // must re-run `codex login`.
  const expiresAt = parseJwtExpiresAt(accessToken);
  if (expiresAt !== undefined && expiresAt * 1000 <= Date.now()) {
    return unsupportedQuota(fetchedAt, "token_expired");
  }

  const outcome = await fetchCliQuotaJson({
    url: codexUsageUrl,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(accountId ? { "ChatGPT-Account-Id": accountId } : {})
    },
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
  });
  if (!outcome.ok) {
    return unsupportedQuota(
      fetchedAt,
      outcome.errorCode === "token_expired" ? "token_expired" : "upstream_error"
    );
  }
  return parseUsageBody(outcome.body, fetchedAt);
}

function normalizeMethod(output: string): string {
  if (/chatgpt/iu.test(output)) return "chatgpt";
  if (/api[\s_-]*key/iu.test(output)) return "api";
  return "unknown";
}

function unsupportedQuota(fetchedAt: string, reason: CliQuotaResult["unsupportedReason"]): CliQuotaResult {
  return { supported: false, entries: [], fetchedAt, ...(reason ? { unsupportedReason: reason } : {}) };
}

function parseUsageBody(body: unknown, fetchedAt: string): CliQuotaResult {
  const root = asRecord(body);
  if (!root) return unsupportedQuota(fetchedAt, "upstream_error");
  const rateLimit = asRecord(root.rate_limit);
  const entries: CliQuotaEntry[] = [];

  for (const key of ["primary_window", "secondary_window"] as const) {
    const window = asRecord(rateLimit?.[key]);
    if (!window) continue;
    const usedPercent = parseLooseNumber(window.used_percent);
    if (usedPercent === undefined) continue;
    const windowSeconds = parseLooseNumber(window.limit_window_seconds);
    const label = windowSeconds !== undefined ? windowLabel(windowSeconds) : "window";
    const resetsAt = toIsoTimestamp(window.reset_at);
    entries.push({
      label,
      unit: "percent",
      usedPercent,
      ...(resetsAt ? { resetsAt } : {})
    });
  }

  const planLabel = stringField(root.plan_type) ?? stringField(root.planType);

  // credits is either a bare percentage or an object carrying used_percent;
  // rate_limit_reset_credits timestamps the next credits reset.
  const credits = asRecord(root.credits);
  const creditsPercent = credits
    ? parseLooseNumber(credits.used_percent)
    : parseLooseNumber(root.credits);
  const creditsReset = toIsoTimestamp(root.rate_limit_reset_credits);
  if (creditsPercent !== undefined || creditsReset) {
    entries.push({
      label: "Credits",
      unit: "percent",
      ...(creditsPercent !== undefined ? { usedPercent: creditsPercent } : {}),
      ...(creditsReset ? { resetsAt: creditsReset } : {})
    });
  }

  return {
    supported: true,
    entries,
    fetchedAt,
    ...(planLabel ? { planLabel } : {})
  };
}

function windowLabel(windowSeconds: number): string {
  const minutes = Math.round(windowSeconds / 60);
  if (minutes > 0 && minutes % 60 === 0) return `${minutes / 60}h window`;
  return `${minutes}m window`;
}
