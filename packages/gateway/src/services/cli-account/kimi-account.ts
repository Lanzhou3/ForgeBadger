import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { parse as parseToml } from "smol-toml";

import type { CliAccountOverview, CliLoginStatus, CliQuotaEntry, CliQuotaResult } from "./types.js";
import type { CliAccountProbeOptions } from "./claude-account.js";
import { globalConfigRoot } from "../cli-config-target.js";
import {
  createPerUserProbeCache,
  fetchCliQuotaJson,
  parseLooseNumber,
  probeConfigRootOptions,
  readCliTokenFile,
  stringField,
  toIsoTimestamp,
  asRecord
} from "./probe-runner.js";

// Community-verified endpoint; OAuth tokens and subscription API keys are
// both accepted. Values are string-encoded; the parser tolerates both
// generations (`usage` weekly window vs `limits[]` 5h window vs totalQuota).
const kimiUsageUrl = "https://api.kimi.com/coding/v1/usages";

interface KimiCredentialFile {
  name: string;
  accessToken: string;
  /** Unix seconds; undefined when the file does not carry one. */
  expiresAt: number | undefined;
}

const loginCache = createPerUserProbeCache<CliLoginStatus>(2_000);

export function resetKimiAccountProbeCache(): void {
  loginCache.clear();
}

export async function buildKimiAccountOverview(
  userId: string,
  options: CliAccountProbeOptions = {}
): Promise<CliAccountOverview> {
  const login = await loginCache.probe(userId, () => observeKimiLogin(options));
  const quota = await observeKimiQuota(options);
  return { login, quota };
}

/**
 * Kimi Code has no status subcommand: native OAuth lives in
 * credentials/<name>.json (both the `kimi-code.json` and `managed:kimi-code.json`
 * generations; the mcp/ subdirectory is excluded), API-key mode in
 * config.toml providers.
 */
export async function observeKimiLogin(options: CliAccountProbeOptions = {}): Promise<CliLoginStatus> {
  const base = { adapter: "kimi" as const };
  const credentials = await listKimiCredentials(options);
  const withTokens = credentials.filter((credential) => Boolean(credential.accessToken));
  const now = Date.now();
  const usable = withTokens.filter((credential) =>
    credential.expiresAt === undefined || credential.expiresAt * 1000 > now
  );
  if (usable.length > 0) {
    return { ...base, state: "ready", method: "oauth" };
  }
  if (withTokens.length > 0) {
    // Credential files exist but every access token is past expires_at.
    // Never refresh on the user's behalf — `kimi login` re-binds the device.
    return { ...base, state: "not_authenticated", method: "oauth", detailCode: "token_expired" };
  }
  const providers = await readKimiProviders(options);
  if (providers.some((provider) => Boolean(provider.apiKey))) {
    return { ...base, state: "ready", method: "api_key" };
  }
  return { ...base, state: "not_authenticated", method: "unknown" };
}

export async function observeKimiQuota(options: CliAccountProbeOptions = {}): Promise<CliQuotaResult> {
  const fetchedAt = new Date().toISOString();
  const credentials = await listKimiCredentials(options);
  const now = Date.now();
  const oauthToken = credentials.find(
    (credential) =>
      Boolean(credential.accessToken) &&
      (credential.expiresAt === undefined || credential.expiresAt * 1000 > now)
  )?.accessToken;

  let bearer: string | undefined = oauthToken;
  if (!bearer) {
    const providers = await readKimiProviders(options);
    const codingProvider = providers.find((provider) => provider.apiKey && isKimiCodingBaseUrl(provider.baseUrl));
    bearer = codingProvider?.apiKey;
    if (!bearer) {
      if (providers.some((provider) => Boolean(provider.apiKey))) {
        return unsupportedQuota(fetchedAt, "api_key_mode");
      }
      return unsupportedQuota(fetchedAt, "no_native_login");
    }
  }

  const outcome = await fetchCliQuotaJson({
    url: kimiUsageUrl,
    headers: { Authorization: `Bearer ${bearer}` },
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

async function listKimiCredentials(options: CliAccountProbeOptions): Promise<KimiCredentialFile[]> {
  const root = globalConfigRoot("kimi", probeConfigRootOptions(options));
  const credentialsDir = path.join(root, "credentials");
  let entries;
  try {
    entries = await readdir(credentialsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = entries.filter(
    (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json") && !entry.name.startsWith("mcp")
  );
  const credentials: KimiCredentialFile[] = [];
  for (const entry of files) {
    const read = await readCliTokenFile(path.join(credentialsDir, entry.name));
    if (!read.ok) continue;
    const accessToken = stringField(read.data.access_token);
    if (!accessToken) continue;
    credentials.push({
      name: entry.name,
      accessToken,
      expiresAt: parseLooseNumber(read.data.expires_at)
    });
  }
  return credentials;
}

interface KimiProviderConfig {
  id: string;
  baseUrl: string;
  apiKey: string | undefined;
  hasOauthTable: boolean;
}

async function readKimiProviders(options: CliAccountProbeOptions): Promise<KimiProviderConfig[]> {
  const root = globalConfigRoot("kimi", probeConfigRootOptions(options));
  let raw: string;
  try {
    raw = await readFile(path.join(root, "config.toml"), "utf8");
  } catch {
    return [];
  }
  let doc: unknown;
  try {
    doc = parseToml(raw);
  } catch {
    return [];
  }
  const providers = asRecord(asRecord(doc)?.providers);
  if (!providers) return [];
  return Object.entries(providers).map(([id, value]) => {
    const entry = asRecord(value) ?? {};
    return {
      id,
      baseUrl: stringField(entry.base_url) ?? "",
      apiKey: stringField(entry.api_key),
      hasOauthTable: asRecord(entry.oauth) !== undefined
    };
  });
}

function isKimiCodingBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.hostname.toLowerCase() === "api.kimi.com" && url.pathname.startsWith("/coding");
  } catch {
    return false;
  }
}

function unsupportedQuota(fetchedAt: string, reason: CliQuotaResult["unsupportedReason"]): CliQuotaResult {
  return { supported: false, entries: [], fetchedAt, ...(reason ? { unsupportedReason: reason } : {}) };
}

function parseUsageBody(body: unknown, fetchedAt: string): CliQuotaResult {
  const root = asRecord(body);
  if (!root) return unsupportedQuota(fetchedAt, "upstream_error");
  const entries: CliQuotaEntry[] = [];

  // 5h window: limits[] items carry a `detail` record.
  const limits = Array.isArray(root.limits) ? root.limits : [];
  for (const item of limits) {
    const record = asRecord(item);
    const detail = asRecord(record?.detail) ?? record;
    if (!detail) continue;
    const remaining = parseLooseNumber(detail.remaining);
    const limit = parseLooseNumber(detail.limit);
    const usedPercent = percentFromRatio(parseLooseNumber(detail.ratio), limit, remaining);
    if (remaining === undefined && usedPercent === undefined) continue;
    const label =
      (record ? stringField(record.name) ?? stringField(record.type) : undefined) ?? "5h window";
    const resetsAt = toIsoTimestamp(detail.resetTime) ?? toIsoTimestamp(detail.reset_time);
    entries.push({
      label,
      unit: "count",
      ...(remaining !== undefined ? { remaining } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(usedPercent !== undefined ? { usedPercent } : {}),
      ...(resetsAt ? { resetsAt } : {})
    });
  }

  // Weekly window: flat `usage` record.
  const usage = asRecord(root.usage);
  if (usage) {
    const remaining = parseLooseNumber(usage.remaining);
    const limit = parseLooseNumber(usage.limit);
    const usedPercent = percentFromRatio(parseLooseNumber(usage.ratio), limit, remaining);
    if (remaining !== undefined || usedPercent !== undefined) {
      const resetsAt = toIsoTimestamp(usage.resetTime) ?? toIsoTimestamp(usage.reset_time);
      entries.push({
        label: "Weekly window",
        unit: "count",
        ...(remaining !== undefined ? { remaining } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(usedPercent !== undefined ? { usedPercent } : {}),
        ...(resetsAt ? { resetsAt } : {})
      });
    }
  }

  // Oldest shape: totalQuota { total, used }.
  if (entries.length === 0) {
    const totalQuota = asRecord(root.totalQuota);
    const total = totalQuota ? parseLooseNumber(totalQuota.total) : undefined;
    const used = totalQuota ? parseLooseNumber(totalQuota.used) : undefined;
    if (total !== undefined && used !== undefined) {
      entries.push({
        label: "Total quota",
        unit: "count",
        remaining: total - used,
        limit: total,
        usedPercent: total > 0 ? (used / total) * 100 : 0
      });
    }
  }

  if (entries.length === 0) return unsupportedQuota(fetchedAt, "upstream_error");

  const user = asRecord(root.user);
  const membership = asRecord(user?.membership);
  const planLabel = membership ? stringField(membership.level) : undefined;
  return { supported: true, entries, fetchedAt, ...(planLabel ? { planLabel } : {}) };
}

function percentFromRatio(ratio: number | undefined, limit: number | undefined, remaining: number | undefined): number | undefined {
  if (ratio !== undefined) return ratio <= 1 ? ratio * 100 : ratio;
  if (limit !== undefined && limit > 0 && remaining !== undefined) {
    return ((limit - remaining) / limit) * 100;
  }
  return undefined;
}
