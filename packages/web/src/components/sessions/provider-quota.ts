import type { CliQuotaEntry, ProviderBalanceEntry } from "@/lib/api";

/**
 * Used share (0-100) of a quota window, or null for unbounded balances.
 * Mirrors `balanceEntryUsedPercent` on the models page: percent-denominated
 * entries (e.g. MiniMax report remaining %) are inverted; bounded windows
 * (e.g. Kimi request limits) use 1 - remaining/limit; plain currency
 * balances have no bound and get no progress bar.
 */
export function quotaUsagePercent(
  entry: Pick<ProviderBalanceEntry, "remaining" | "limit" | "unit">
): number | null {
  if (entry.unit === "%") return clampPercent(100 - entry.remaining);
  if (entry.limit === undefined || entry.limit <= 0) return null;
  return clampPercent((1 - entry.remaining / entry.limit) * 100);
}

/** Remaining share (0-100) of a provider balance window, or null when unbounded. */
export function quotaRemainingPercent(
  entry: Pick<ProviderBalanceEntry, "remaining" | "limit" | "unit">
): number | null {
  if (entry.unit === "%") return clampPercent(entry.remaining);
  if (entry.limit === undefined || entry.limit <= 0) return null;
  return clampPercent((entry.remaining / entry.limit) * 100);
}

/** Remaining share (0-100) of a CLI native quota window, or null when unbounded. */
export function cliQuotaRemainingPercent(
  entry: Pick<CliQuotaEntry, "usedPercent" | "remaining" | "limit">
): number | null {
  if (entry.usedPercent !== undefined) return clampPercent(100 - entry.usedPercent);
  if (entry.limit !== undefined && entry.limit > 0 && entry.remaining !== undefined) {
    return clampPercent((entry.remaining / entry.limit) * 100);
  }
  return null;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function quotaBarToneClass(percent: number): string {
  if (percent >= 80) return "bg-gradient-to-r from-red-600 to-red-400";
  if (percent >= 50) return "bg-gradient-to-r from-amber-600 to-amber-400";
  return "bg-gradient-to-r from-emerald-600 to-emerald-400";
}

export function quotaTextToneClass(percent: number): string {
  if (percent >= 80) return "text-red-400";
  if (percent >= 50) return "text-amber-400";
  return "text-emerald-400";
}

/** Semantic bar tone based on remaining quota percentage (low = critical). */
export function remainingBarToneClass(remainingPercent: number): string {
  if (remainingPercent <= 20) return "bg-destructive";
  if (remainingPercent <= 50) return "bg-warning";
  return "bg-success";
}

/** Semantic text tone based on remaining quota percentage (low = critical). */
export function remainingTextToneClass(remainingPercent: number): string {
  if (remainingPercent <= 20) return "text-destructive";
  if (remainingPercent <= 50) return "text-warning";
  return "text-success";
}

/** Compact pill tone based on remaining quota percentage. */
export function remainingPillToneClass(remainingPercent: number): string {
  if (remainingPercent <= 20) return "border-destructive/40 bg-destructive/10 text-destructive";
  if (remainingPercent <= 50) return "border-warning/40 bg-warning/10 text-warning";
  return "border-border/70 bg-card/75 text-foreground";
}

/** Compact amount display: integers stay plain, fractions keep up to 2 decimals. */
export function formatQuotaAmount(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
