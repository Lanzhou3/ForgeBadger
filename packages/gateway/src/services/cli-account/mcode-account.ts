/**
 * MiniMax Code account source (read-only observation).
 *
 * Layout, verified against `@minimax-ai/code` 0.5.8:
 *
 * ```
 * <dataDir>/auth/<buildEnv>/<region>/<clientId>/
 *   auth.json        { schemaVersion, records: { "com.minimax.mcode.oauth.<env>.<region>": {
 *                        accessToken, refreshToken, tokenType, clientId,
 *                        scopes, audience, expiresAtMs, generation, loginEpoch } } }
 *   auth-state.json  { status, storeKind, clientId, scopes, audience,
 *                      buildEnv, region, generation, expiresAtMs }
 * ```
 *
 * The record key is discovered rather than assembled, so a new buildEnv/region
 * pairing keeps working without a code change.
 *
 * Quota endpoint, also taken from the shipped bundle
 * (`bxe.fetchTokenPlanQuota`):
 *
 * ```
 * GET {base}/v1/api/openplatform/coding_plan/remains
 * Authorization: Bearer <accessToken>
 * base: cn -> https://www.minimaxi.com, en -> https://platform.minimax.io
 * -> { base_resp: { status_code }, model_remains: [{ model_name,
 *      current_interval_*, end_time, current_weekly_*, weekly_end_time }] }
 * ```
 *
 * Two things are easy to get wrong here and are called out below:
 *
 * 1. The upstream field is `current_interval_remaining_percent` — a
 *    *remaining* ratio, not a used ratio. `CliQuotaEntry.usedPercent` is the
 *    used percentage, so the value is inverted rather than passed through.
 * 2. `current_interval_status === 3` means unlimited; the CLI hides the meter
 *    entirely in that case, so no percentage is reported.
 *
 * Policy: read-only. Tokens stay in memory for the duration of one probe and
 * are never written, logged, or returned over the API. Refresh is never
 * performed on the user's behalf — the session token is short-lived, so an
 * expired one surfaces as `token_expired` and the user re-runs `mcode login`.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { CliAccountOverview, CliLoginStatus, CliQuotaEntry, CliQuotaResult } from "./types.js";
import type { CliAccountProbeOptions } from "./claude-account.js";
import { globalConfigRoot } from "../cli-config-target.js";
import {
  asRecord,
  createPerUserProbeCache,
  fetchCliQuotaJson,
  parseLooseNumber,
  probeConfigRootOptions,
  readCliTokenFile,
  stringField
} from "./probe-runner.js";

const QUOTA_PATH = "/v1/api/openplatform/coding_plan/remains";

const QUOTA_BASES: Record<string, string> = {
  cn: "https://www.minimaxi.com",
  en: "https://platform.minimax.io"
};

/** Upstream `current_*_status` value that marks an unlimited plan. */
const UNLIMITED_STATUS = 3;

const loginCache = createPerUserProbeCache<CliLoginStatus>(2_000);

export function resetMcodeAccountProbeCache(): void {
  loginCache.clear();
}

interface McodeAuth {
  /** Directory holding auth.json / auth-state.json. */
  dir: string;
  region: string;
  buildEnv: string;
  clientId: string | undefined;
  /** Non-secret login metadata. */
  status: string | undefined;
  expiresAtMs: number | undefined;
  /** In-memory only; never persisted, logged, or returned. */
  accessToken: string | undefined;
}

export async function buildMcodeAccountOverview(
  userId: string,
  options: CliAccountProbeOptions = {}
): Promise<CliAccountOverview> {
  const login = await loginCache.probe(userId, () => observeMcodeLogin(options));
  const quota = await observeMcodeQuota(options);
  return { login, quota };
}

export async function observeMcodeLogin(options: CliAccountProbeOptions = {}): Promise<CliLoginStatus> {
  const base = { adapter: "mcode" as const };
  const auth = await readMcodeAuth(options);
  if (!auth || auth.status !== "authenticated") {
    return { ...base, state: "not_authenticated", method: "unknown" };
  }
  if (!auth.accessToken) {
    return { ...base, state: "not_authenticated", method: "unknown" };
  }
  if (auth.expiresAtMs !== undefined && auth.expiresAtMs <= Date.now()) {
    // The session token is short-lived. Never refresh it here; `mcode login`
    // is the only supported way to obtain a new one.
    return {
      ...base,
      state: "not_authenticated",
      method: "oauth",
      detailCode: "token_expired"
    };
  }
  return { ...base, state: "ready", method: "oauth", ...(auth.clientId ? { accountLabel: auth.clientId } : {}) };
}

export async function observeMcodeQuota(options: CliAccountProbeOptions = {}): Promise<CliQuotaResult> {
  const fetchedAt = new Date().toISOString();
  const auth = await readMcodeAuth(options);
  if (!auth?.accessToken) {
    return unsupportedQuota(fetchedAt, "no_native_login");
  }
  if (auth.expiresAtMs !== undefined && auth.expiresAtMs <= Date.now()) {
    return unsupportedQuota(fetchedAt, "token_expired");
  }
  const base = QUOTA_BASES[auth.region];
  if (!base) {
    // Unknown region means an unrecognised host; do not guess one.
    return unsupportedQuota(fetchedAt, "upstream_error");
  }

  const outcome = await fetchCliQuotaJson({
    url: `${base}${QUOTA_PATH}`,
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
 * Locates the credential directory under `<dataDir>/auth/<buildEnv>/<region>/<clientId>`
 * and merges the non-secret state file with the token record. Returns undefined
 * when nothing is installed or no record carries an access token.
 *
 * Region and buildEnv are read from the directory path (and cross-checked
 * against auth-state.json) rather than the `com.minimax.mcode.oauth.*` record
 * key, so the record key format can change without breaking quota routing.
 */
async function readMcodeAuth(options: CliAccountProbeOptions): Promise<McodeAuth | undefined> {
  const root = globalConfigRoot("mcode", probeConfigRootOptions(options));
  const authRoot = path.join(root, "auth");

  for (const dir of await listAuthDirs(authRoot)) {
    const credentialRead = await readCliTokenFile(path.join(dir, "auth.json"));
    if (!credentialRead.ok) continue;
    const records = asRecord(credentialRead.data.records);
    if (!records) continue;

    for (const [recordKey, value] of Object.entries(records)) {
      const record = asRecord(value);
      const accessToken = stringField(record?.accessToken);
      if (!accessToken) continue;

      const state = asRecord(await readJson(path.join(dir, "auth-state.json"))) ?? {};
      // <authRoot>/<buildEnv>/<region>/<clientId>
      const segments = path.relative(authRoot, dir).split(path.sep);
      const buildEnv = stringField(state.buildEnv) ?? (segments.length >= 3 ? segments[0] : undefined) ?? "";
      const region = stringField(state.region) ?? (segments.length >= 2 ? segments[1] : undefined) ?? "";
      const clientId = stringField(record?.clientId) ?? stringField(state.clientId) ?? regionFromRecordKey(recordKey);

      return {
        dir,
        region,
        buildEnv,
        clientId,
        status: stringField(state.status) ?? "authenticated",
        expiresAtMs: parseLooseNumber(state.expiresAtMs) ?? parseLooseNumber(record?.expiresAtMs),
        accessToken
      };
    }
  }
  return undefined;
}

/** `<dataDir>/auth/<buildEnv>/<region>/<clientId>` directories, best effort. */
async function listAuthDirs(authRoot: string): Promise<string[]> {
  const dirs: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 3) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const next = path.join(dir, entry.name);
      dirs.push(next);
      await walk(next, depth + 1);
    }
  };
  await walk(authRoot, 0);
  return dirs;
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function regionFromRecordKey(key: string): string | undefined {
  const parts = key.split(".");
  return parts.length >= 2 ? parts[parts.length - 1] : undefined;
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

  // base_resp.status_code !== 0 is the CLI's own success gate.
  const baseResp = asRecord(root.base_resp);
  const statusCode = parseLooseNumber(baseResp?.status_code);
  if (statusCode !== undefined && statusCode !== 0) {
    return unsupportedQuota(fetchedAt, "upstream_error");
  }

  const remains = Array.isArray(root.model_remains) ? root.model_remains : [];
  const first = asRecord(remains[0]);
  if (!first) return unsupportedQuota(fetchedAt, "upstream_error");

  const entries: CliQuotaEntry[] = [];
  const fiveHour = windowEntry(first, "interval", "Five-hour window");
  if (fiveHour) entries.push(fiveHour);
  const weekly = windowEntry(first, "weekly", "Weekly window");
  if (weekly) entries.push(weekly);

  if (entries.length === 0) return unsupportedQuota(fetchedAt, "upstream_error");
  return { supported: true, entries, fetchedAt };
}

/**
 * One quota window. `interval` reads the `current_interval_*` prefix and
 * `weekly` the `current_weekly_*` prefix; the reset field differs per window
 * (`end_time` vs `weekly_end_time`).
 */
function windowEntry(
  remain: Record<string, unknown>,
  window: "interval" | "weekly",
  label: string
): CliQuotaEntry | undefined {
  const prefix = window === "interval" ? "current_interval" : "current_weekly";
  const unlimited = parseLooseNumber(remain[`${prefix}_status`]) === UNLIMITED_STATUS;
  const remainingPercent = parseLooseNumber(remain[`${prefix}_remaining_percent`]);
  const total = parseLooseNumber(remain[`${prefix}_total_count`]);
  const used = parseLooseNumber(remain[`${prefix}_usage_count`]);

  // Upstream reports *remaining*; CliQuotaEntry reports *used*.
  let usedPercent: number | undefined;
  if (!unlimited) {
    if (remainingPercent !== undefined) {
      usedPercent = Math.round(Math.min(100, Math.max(0, 100 - remainingPercent)));
    } else if (total !== undefined && total > 0 && used !== undefined) {
      usedPercent = Math.min(100, (used / total) * 100);
    }
  }

  const resetField = window === "interval" ? "end_time" : "weekly_end_time";
  const resetAtMs = parseLooseNumber(remain[resetField]);
  const resetsAt = resetAtMs !== undefined && resetAtMs > 0 ? new Date(resetAtMs).toISOString() : undefined;

  // Unlimited plans report no percentage at all (the CLI hides the meter).
  if (usedPercent === undefined && !unlimited) return undefined;

  return {
    label,
    unit: "percent",
    ...(unlimited ? { usedPercent: 0 } : { ...(usedPercent !== undefined ? { usedPercent } : {}) }),
    ...(total !== undefined && total > 0 ? { limit: total } : {}),
    ...(resetsAt ? { resetsAt } : {})
  };
}
