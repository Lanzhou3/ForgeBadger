"use client";

import {
  formatQuotaAmount,
  quotaBarToneClass,
  quotaTextToneClass,
} from "@/components/sessions/provider-quota";
import {
  type CliAccountAdapter,
  type CliQuotaEntry,
  type CliQuotaResult,
  type CliQuotaUnsupportedReason,
} from "@/lib/api";
import type { TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type Translate = (key: TranslationKey) => string;

/** Per-CLI native login commands; the UI only ever points at the CLI's own flow. */
export const LOGIN_HINT_KEYS: Record<CliAccountAdapter, TranslationKey> = {
  claude: "models.cliAccountLoginHintClaude",
  codex: "models.cliAccountLoginHintCodex",
  kimi: "models.cliAccountLoginHintKimi",
};

export const QUOTA_REASON_KEYS: Record<CliQuotaUnsupportedReason, TranslationKey> = {
  keychain: "models.cliAccountQuotaKeychain",
  no_native_login: "models.cliAccountQuotaNoNativeLogin",
  api_key_mode: "models.cliAccountQuotaApiKeyMode",
  token_expired: "models.cliAccountQuotaTokenExpired",
  upstream_error: "models.cliAccountQuotaUpstreamError",
};

/**
 * Maps the gateway's machine method values to display labels; unknown product
 * names (e.g. claude's own `authMethod` string) pass through verbatim.
 */
export function loginMethodLabel(method: string | undefined, t: Translate): string | undefined {
  if (!method || method === "unknown") return undefined;
  switch (method) {
    case "chatgpt":
      return "ChatGPT";
    case "oauth":
      return t("models.authTypeOauth");
    case "api":
    case "api_key":
      return t("models.authTypeApiKey");
    default:
      return method;
  }
}

/**
 * Plan label + one row per quota window for a native CLI login (claude/codex/
 * kimi). Unsupported quotas render the per-reason hint instead. Shared by the
 * Model Center status cards and the session page quota panel.
 */
export function CliQuotaSummary({ quota, t }: { quota: CliQuotaResult | undefined; t: Translate }) {
  if (!quota) return null;
  if (quota.supported && quota.entries.length > 0) {
    return (
      <div className="space-y-1.5">
        {quota.planLabel ? (
          <div className="truncate text-[10px] font-medium text-muted-foreground">{quota.planLabel}</div>
        ) : null}
        {quota.entries.map((entry) => (
          <CliQuotaRow key={`${entry.label}-${entry.resetsAt ?? ""}`} entry={entry} t={t} />
        ))}
      </div>
    );
  }
  if (!quota.supported && quota.unsupportedReason) {
    return <p className="text-xs text-muted-foreground">{t(QUOTA_REASON_KEYS[quota.unsupportedReason])}</p>;
  }
  return null;
}

function CliQuotaRow({ entry, t }: { entry: CliQuotaEntry; t: Translate }) {
  const percent = cliQuotaUsedPercent(entry);
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-[11px] text-muted-foreground">{entry.label}</span>
        {percent !== null ? (
          <span
            className={cn("shrink-0 text-[11px] font-semibold tabular-nums", quotaTextToneClass(percent))}
            title={`${t("models.cliAccountQuotaUsed")} ${percent}%`}
          >
            {percent}
            <span className="text-[10px] font-normal">%</span>
          </span>
        ) : entry.remaining !== undefined ? (
          <span className="shrink-0 font-mono text-[11px] tabular-nums">
            {formatQuotaAmount(entry.remaining)}
            {entry.limit !== undefined ? ` / ${formatQuotaAmount(entry.limit)}` : ""}
          </span>
        ) : null}
      </div>
      {percent !== null ? (
        <div
          className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted/60"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${entry.label} ${t("models.cliAccountQuotaUsed")} ${percent}%`}
          title={`${t("models.cliAccountQuotaUsed")} ${percent}%`}
        >
          <div
            className={cn("h-full rounded-full transition-[width] duration-700 ease-out", quotaBarToneClass(percent))}
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : null}
      {entry.limit !== undefined || entry.resetsAt ? (
        <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground/70 tabular-nums">
          {entry.limit !== undefined && entry.remaining !== undefined ? (
            <span className="font-mono">
              {formatQuotaAmount(entry.remaining)} / {formatQuotaAmount(entry.limit)}
            </span>
          ) : (
            <span />
          )}
          {entry.resetsAt ? (
            <span className="shrink-0">
              {t("models.cliAccountQuotaResets")} {formatQuotaResetTime(entry.resetsAt)}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Used share (0-100) of a CLI quota window. `usedPercent` is already
 * endpoint-reported usage (unlike provider balances, where "%" means
 * remaining), so it wins; bounded count/currency windows fall back to
 * 1 - remaining/limit.
 */
function cliQuotaUsedPercent(entry: CliQuotaEntry): number | null {
  if (entry.usedPercent !== undefined) return clampPercent(entry.usedPercent);
  if (entry.limit !== undefined && entry.limit > 0 && entry.remaining !== undefined) {
    return clampPercent((1 - entry.remaining / entry.limit) * 100);
  }
  return null;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Short reset-time rendering, e.g. "Jul 26, 14:30"; falls back to the raw value. */
function formatQuotaResetTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
