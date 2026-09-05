import type { ProviderBalanceEntry } from "@/lib/api";

/** Used share of a bounded quota window, or null for unbounded balances. */
export function quotaUsagePercent(
  entry: Pick<ProviderBalanceEntry, "remaining" | "limit">
): number | null {
  if (entry.limit === undefined || entry.limit <= 0) return null;
  const used = entry.limit - entry.remaining;
  return Math.min(100, Math.max(0, Math.round((used / entry.limit) * 100)));
}

export function quotaBarToneClass(percent: number): string {
  if (percent >= 90) return "bg-red-500";
  if (percent >= 70) return "bg-amber-500";
  return "bg-emerald-500";
}

/** Compact amount display: integers stay plain, fractions keep up to 2 decimals. */
export function formatQuotaAmount(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
