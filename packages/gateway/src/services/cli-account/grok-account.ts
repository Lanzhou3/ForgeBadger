/**
 * Grok Build account source (read-only observation).
 *
 * Layout, verified against `grok` 1.0.50:
 *
 * ```
 * <grokHome>/auth.json   { "<oidcIssuer>::<installationId>": {
 *                            key, auth_mode, create_time, user_id, email,
 *                            first_name, principal_type, principal_id, team_id,
 *                            refresh_token, expires_at, oidc_issuer,
 *                            oidc_client_id } }
 * ```
 *
 * The record key is discovered rather than assembled, so a new issuer or
 * installation id keeps working without a code change. `key` is a short-lived
 * OIDC access token (the CLI persists a refreshed one after every mint, so an
 * active install almost always has a fresh file); `refresh_token` is never
 * used here.
 *
 * Quota endpoint, taken from the shipped binary
 * (`xai-grok-shell/src/extensions/billing.rs`):
 *
 * ```
 * GET https://cli-chat-proxy.grok.com/v1/billing?format=credits
 * Authorization: Bearer <accessToken>
 * -> { config: { creditUsagePercent, currentPeriod: { start, end },
 *        monthlyLimit, onDemandCap, onDemandUsed, prepaidBalance,
 *        isUnifiedBillingUser, billingPeriodStart, history: [...] },
 *      on_demand_enabled, subscription_tier }
 * ```
 *
 * Two things are easy to get wrong here and are called out below:
 *
 * 1. `creditUsagePercent` is already a *used* percentage (the CLI upsells
 *    SuperGrok when it approaches 100), matching `CliQuotaEntry.usedPercent`
 *    directly — unlike mcode, nothing is inverted.
 * 2. `monthlyLimit` / `onDemandCap` units are not documented (credits vs
 *    billing ticks), so only percentages and the period reset time are
 *    surfaced; raw amounts are deliberately not displayed.
 *
 * Policy: read-only. Tokens stay in memory for the duration of one probe and
 * are never written, logged, or returned over the API. Refresh is never
 * performed on the user's behalf — an expired token surfaces as
 * `token_expired` and any `grok` run (or `grok login`) mints a fresh one.
 */

import type { CliAccountOverview, CliLoginStatus, CliQuotaEntry, CliQuotaResult } from "./types.js";
import type { CliAccountProbeOptions } from "./claude-account.js";
import { globalConfigRoot } from "../cli-config-target.js";
import {
  asRecord,
  createPerUserProbeCache,
  fetchCliQuotaJson,
  probeConfigRootOptions,
  readCliTokenFile,
  stringField,
  toIsoTimestamp
} from "./probe-runner.js";
import path from "node:path";

const QUOTA_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";

const PLAN_LABELS: Record<string, string> = {
  supergrok: "SuperGrok",
  supergrok_lite: "SuperGrok Lite",
  supergrok_plus: "SuperGrok Plus",
  supergrok_heavy: "SuperGrok Heavy",
  x_basic: "X Basic",
  x_premium: "X Premium",
  x_premium_plus: "X Premium+"
};

const loginCache = createPerUserProbeCache<CliLoginStatus>(2_000);

export function resetGrokAccountProbeCache(): void {
  loginCache.clear();
}

interface GrokAuth {
  /** Non-secret login metadata. */
  email: string | undefined;
  firstName: string | undefined;
  userId: string | undefined;
  authMode: string | undefined;
  /** ISO timestamp; the CLI mints 6-hour tokens. */
  expiresAt: string | undefined;
  /** In-memory only; never persisted, logged, or returned. */
  accessToken: string | undefined;
}

export async function buildGrokAccountOverview(
  userId: string,
  options: CliAccountProbeOptions = {}
): Promise<CliAccountOverview> {
  const login = await loginCache.probe(userId, () => observeGrokLogin(options));
  const quota = await observeGrokQuota(options);
  return { login, quota };
}

export async function observeGrokLogin(options: CliAccountProbeOptions = {}): Promise<CliLoginStatus> {
  const base = { adapter: "grok" as const };
  const auth = await readGrokAuth(options);
  if (!auth?.accessToken) {
    return { ...base, state: "not_authenticated", method: "unknown" };
  }
  const method = grokLoginMethod(auth.authMode);
  if (isExpired(auth.expiresAt)) {
    // The access token lives ~6h and the CLI refreshes it on every run. Never
    // refresh it here; the user re-runs `grok` (or `grok login`).
    return { ...base, state: "not_authenticated", method, detailCode: "token_expired" };
  }
  const accountLabel = auth.email ?? auth.firstName ?? auth.userId;
  return { ...base, state: "ready", method, ...(accountLabel ? { accountLabel } : {}) };
}

export async function observeGrokQuota(options: CliAccountProbeOptions = {}): Promise<CliQuotaResult> {
  const fetchedAt = new Date().toISOString();
  const auth = await readGrokAuth(options);
  if (!auth?.accessToken) {
    return unsupportedQuota(fetchedAt, "no_native_login");
  }
  if (isExpired(auth.expiresAt)) {
    return unsupportedQuota(fetchedAt, "token_expired");
  }

  const outcome = await fetchCliQuotaJson({
    url: QUOTA_URL,
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
  });
  if (!outcome.ok) {
    return unsupportedQuota(
      fetchedAt,
      outcome.errorCode === "token_expired" ? "token_expired" : "upstream_error"
    );
  }
  return parseQuotaBody(outcome.body, fetchedAt);
}

/**
 * Locates the OIDC record under `<grokHome>/auth.json`. The top-level key is
 * `<oidcIssuer>::<installationId>` and is discovered, not assembled. Returns
 * undefined when nothing is installed or no record carries an access token.
 */
async function readGrokAuth(options: CliAccountProbeOptions): Promise<GrokAuth | undefined> {
  const root = globalConfigRoot("grok", probeConfigRootOptions(options));
  const credentialRead = await readCliTokenFile(path.join(root, "auth.json"));
  if (!credentialRead.ok) return undefined;

  for (const value of Object.values(credentialRead.data)) {
    const record = asRecord(value);
    const accessToken = stringField(record?.key);
    if (!accessToken) continue;
    return {
      email: stringField(record?.email),
      firstName: stringField(record?.first_name),
      userId: stringField(record?.user_id),
      authMode: stringField(record?.auth_mode),
      expiresAt: stringField(record?.expires_at),
      accessToken
    };
  }
  return undefined;
}

function grokLoginMethod(authMode: string | undefined): string {
  // auth_mode "oidc" is the auth.x.ai OAuth flow; anything else passes through.
  if (!authMode) return "unknown";
  return authMode === "oidc" ? "oauth" : authMode;
}

function isExpired(expiresAt: string | undefined): boolean {
  if (!expiresAt) return false;
  const expiresAtMs = Date.parse(expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();
}

function unsupportedQuota(
  fetchedAt: string,
  reason: CliQuotaResult["unsupportedReason"]
): CliQuotaResult {
  return { supported: false, entries: [], fetchedAt, ...(reason ? { unsupportedReason: reason } : {}) };
}

function parseQuotaBody(body: unknown, fetchedAt: string): CliQuotaResult {
  const root = asRecord(body);
  if (!root) return unsupportedQuota(fetchedAt, "upstream_error");
  // BillingConfigResponse wraps BillingConfig under `config`; tolerate both.
  const config = asRecord(root.config) ?? root;

  const entries: CliQuotaEntry[] = [];
  const creditUsagePercent = numberField(config, "creditUsagePercent");
  if (creditUsagePercent !== undefined) {
    const currentPeriod = asRecord(config.currentPeriod ?? config.current_period);
    const resetsAt = toIsoTimestamp(currentPeriod?.end);
    entries.push({
      label: "Billing period credits",
      unit: "percent",
      usedPercent: Math.round(Math.min(100, Math.max(0, creditUsagePercent))),
      ...(resetsAt ? { resetsAt } : {})
    });
  }

  const onDemandCap = numberField(config, "onDemandCap");
  const onDemandUsed = numberField(config, "onDemandUsed");
  if (onDemandCap !== undefined && onDemandCap > 0 && onDemandUsed !== undefined) {
    entries.push({
      label: "On-demand credits",
      unit: "percent",
      usedPercent: Math.round(Math.min(100, Math.max(0, (onDemandUsed / onDemandCap) * 100)))
    });
  }

  if (entries.length === 0) return unsupportedQuota(fetchedAt, "upstream_error");

  const tier = stringField(root.subscription_tier) ?? stringField(root.subscriptionTier);
  const planLabel = tier ? (PLAN_LABELS[tier] ?? tier) : undefined;
  return { supported: true, entries, fetchedAt, ...(planLabel ? { planLabel } : {}) };
}

/** camelCase first (the serde wire names), snake_case as a fallback. */
function numberField(record: Record<string, unknown>, camelName: string): number | undefined {
  const snakeName = camelName.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);
  for (const value of [record[camelName], record[snakeName]]) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}
