import { lookup } from "node:dns/promises";

import { redactSensitiveErrorMessage } from "../lib/redaction.js";
import { validatePublicHttpsEndpointUrl, type CheckModelEndpointInput } from "./model-endpoint-health.js";

export interface ProviderBalanceEntry {
  label: string;
  remaining: number;
  unit: string;
  isAvailable?: boolean | undefined;
  /** Present when the provider reports a bounded quota window. */
  limit?: number | undefined;
  /** ISO timestamp when the quota window resets, when reported. */
  resetsAt?: string | undefined;
}

export interface FetchProviderBalanceResult {
  supported: boolean;
  detectedProvider?: string | undefined;
  balances: ProviderBalanceEntry[];
}

export interface FetchProviderBalanceInput {
  /** Tried in order (callers pass openaiBaseUrl first, then baseUrl). */
  baseUrls: string[];
  apiKey?: string | undefined;
  timeoutMs?: number | undefined;
  fetchImpl?: typeof fetch | undefined;
  resolveHost?: CheckModelEndpointInput["resolveHost"] | undefined;
}

interface KnownBalanceProvider {
  key: string;
  label: string;
  path: string;
  parse: (body: unknown) => ProviderBalanceEntry[];
}

const defaultTimeoutMs = 15_000;
const errorBodyMaxChars = 512;

const knownBalanceProviders: Array<{ hosts: string[]; provider: KnownBalanceProvider }> = [
  {
    hosts: ["api.deepseek.com"],
    provider: {
      key: "deepseek",
      label: "DeepSeek",
      path: "/user/balance",
      parse: (body) => {
        const root = asRecord(body);
        const infos = Array.isArray(root?.balance_infos) ? root.balance_infos : [];
        const isAvailable = typeof root?.is_available === "boolean" ? root.is_available : true;
        const entries: ProviderBalanceEntry[] = [];
        for (const info of infos) {
          const record = asRecord(info);
          if (!record) continue;
          const currency = typeof record.currency === "string" && record.currency ? record.currency : "CNY";
          const total = parseNumericField(record.total_balance);
          if (total === undefined) continue;
          entries.push({ label: currency, remaining: total, unit: currency, isAvailable });
        }
        return entries;
      },
    },
  },
  {
    hosts: ["api.stepfun.com"],
    provider: {
      key: "stepfun",
      label: "StepFun",
      path: "/v1/accounts",
      parse: (body) => {
        const balance = parseNumericField(asRecord(body)?.balance) ?? 0;
        return [{ label: "StepFun", remaining: balance, unit: "CNY" }];
      },
    },
  },
  {
    hosts: ["api.siliconflow.cn", "api.siliconflow.com"],
    provider: {
      key: "siliconflow",
      label: "SiliconFlow",
      path: "/v1/user/info",
      parse: (body) => {
        const data = asRecord(asRecord(body)?.data);
        const total = parseNumericField(data?.totalBalance) ?? 0;
        const currency = typeof data?.currency === "string" && data.currency ? data.currency : "CNY";
        return [{ label: "SiliconFlow", remaining: total, unit: currency }];
      },
    },
  },
  {
    hosts: ["openrouter.ai"],
    provider: {
      key: "openrouter",
      label: "OpenRouter",
      path: "/api/v1/credits",
      parse: (body) => {
        const data = asRecord(asRecord(body)?.data) ?? asRecord(body);
        const totalCredits = parseNumericField(data?.total_credits) ?? 0;
        const totalUsage = parseNumericField(data?.total_usage) ?? 0;
        const remaining = totalCredits - totalUsage;
        return [{ label: "OpenRouter", remaining, unit: "USD", isAvailable: remaining > 0 }];
      },
    },
  },
  {
    hosts: ["api.novita.ai"],
    provider: {
      key: "novita",
      label: "Novita AI",
      path: "/v3/user/balance",
      parse: (body) => {
        // Novita amounts are denominated in 0.0001 USD.
        const available = (parseNumericField(asRecord(body)?.availableBalance) ?? 0) / 10_000;
        return [{ label: "Novita AI", remaining: available, unit: "USD", isAvailable: available > 0 }];
      },
    },
  },
  {
    // Kimi For Coding subscription quota: GET /coding/v1/usages returns
    // `limits[].detail` (5-hour window) and `usage` (weekly window), with
    // string-encoded numbers.
    hosts: ["api.kimi.com"],
    provider: {
      key: "kimi",
      label: "Kimi For Coding",
      path: "/coding/v1/usages",
      parse: (body) => {
        const root = asRecord(body);
        const entries: ProviderBalanceEntry[] = [];
        const limits = Array.isArray(root?.limits) ? root.limits : [];
        for (const item of limits) {
          const detail = asRecord(asRecord(item)?.detail);
          if (!detail) continue;
          const remaining = parseNumericField(detail.remaining);
          if (remaining === undefined) continue;
          entries.push({
            label: "5h window",
            remaining,
            unit: "requests",
            ...(parseNumericField(detail.limit) !== undefined ? { limit: parseNumericField(detail.limit) } : {}),
            ...(typeof detail.resetTime === "string" ? { resetsAt: detail.resetTime } : {}),
          });
        }
        const usage = asRecord(root?.usage);
        if (usage) {
          const remaining = parseNumericField(usage.remaining);
          if (remaining !== undefined) {
            entries.push({
              label: "Weekly window",
              remaining,
              unit: "requests",
              ...(parseNumericField(usage.limit) !== undefined ? { limit: parseNumericField(usage.limit) } : {}),
              ...(typeof usage.resetTime === "string" ? { resetsAt: usage.resetTime } : {}),
            });
          }
        }
        return entries;
      },
    },
  },
  {
    // MiniMax coding plan: GET /v1/api/openplatform/coding_plan/remains
    // returns remaining percentages per model bucket; only `general` is the
    // coding plan. 200 OK can still carry a business error in `base_resp`.
    hosts: ["api.minimaxi.com", "api.minimax.io"],
    provider: {
      key: "minimax",
      label: "MiniMax Coding Plan",
      path: "/v1/api/openplatform/coding_plan/remains",
      parse: (body) => {
        const root = asRecord(body);
        const baseResp = asRecord(root?.base_resp);
        if (baseResp) {
          const statusCode = typeof baseResp.status_code === "number" ? baseResp.status_code : -1;
          if (statusCode !== 0) {
            const msg = typeof baseResp.status_msg === "string" ? baseResp.status_msg : "Unknown error";
            throw new Error(`Balance query failed (code ${statusCode}): ${msg}`);
          }
        }
        const remains = Array.isArray(root?.model_remains) ? root.model_remains : [];
        const general = remains.find((item) => asRecord(item)?.model_name === "general");
        const record = asRecord(general);
        if (!record) return [];
        const entries: ProviderBalanceEntry[] = [];
        const intervalPct = parseNumericField(record.current_interval_remaining_percent);
        if (intervalPct !== undefined) {
          entries.push({
            label: "5h window",
            remaining: intervalPct,
            unit: "%",
            ...(typeof record.end_time === "number" ? { resetsAt: new Date(record.end_time).toISOString() } : {}),
          });
        }
        // Weekly bucket only exists on plans with a weekly cap (status === 1).
        if (record.current_weekly_status === 1) {
          const weeklyPct = parseNumericField(record.current_weekly_remaining_percent);
          if (weeklyPct !== undefined) {
            entries.push({
              label: "Weekly window",
              remaining: weeklyPct,
              unit: "%",
              ...(typeof record.weekly_end_time === "number" ? { resetsAt: new Date(record.weekly_end_time).toISOString() } : {}),
            });
          }
        }
        return entries;
      },
    },
  },
];

export async function fetchProviderBalance(input: FetchProviderBalanceInput): Promise<FetchProviderBalanceResult> {
  const detected = detectBalanceProvider(input.baseUrls);
  if (!detected) {
    return { supported: false, balances: [] };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const resolveHost = input.resolveHost ?? lookup;
  const timeoutMs = input.timeoutMs ?? defaultTimeoutMs;
  const endpoint = `${detected.origin}${detected.provider.path}`;

  const validationError = await validatePublicHttpsEndpointUrl(endpoint, resolveHost);
  if (validationError) throw new Error(validationError);

  const headers = new Headers({ Accept: "application/json" });
  const apiKey = input.apiKey?.trim();
  if (apiKey) headers.set("Authorization", `Bearer ${apiKey}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: "GET",
      headers,
      redirect: "error",
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = redactSensitiveErrorMessage(truncate(await response.text().catch(() => "")));
      throw new Error(`Balance query failed (HTTP ${response.status}): ${body}`);
    }

    const payload = await response.json() as unknown;
    return {
      supported: true,
      detectedProvider: detected.provider.key,
      balances: detected.provider.parse(payload),
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Balance query timed out");
    }
    if (error instanceof Error && error.message.startsWith("Balance query failed")) throw error;
    const raw = error instanceof Error ? error.message : String(error);
    throw new Error(redactSensitiveErrorMessage(raw));
  } finally {
    clearTimeout(timeout);
  }
}

function detectBalanceProvider(
  baseUrls: string[]
): { origin: string; provider: KnownBalanceProvider } | undefined {
  for (const baseUrl of baseUrls) {
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      continue;
    }
    const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
    for (const { hosts, provider } of knownBalanceProviders) {
      if (hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
        return { origin: url.origin, provider };
      }
    }
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

/** Parse a JSON field as a number, tolerating string-encoded numbers. */
function parseNumericField(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function truncate(value: string): string {
  return value.length > errorBodyMaxChars ? `${value.slice(0, errorBodyMaxChars)}...` : value;
}
