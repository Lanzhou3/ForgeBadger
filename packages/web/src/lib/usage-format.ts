export function formatDurationMs(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return "0m";
  }
  const totalMinutes = Math.floor(durationMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes}m`;
  }
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

export function formatEstimatedUsd(value: number): string {
  const amount = Number.isFinite(value) && value > 0 ? value : 0;
  return `$${amount.toFixed(2)} est.`;
}

/** Actual cost with billing-like precision: two decimals at $1+, four
 * significant digits below $1 (0.123456 -> "$0.1235"). */
export function formatCostUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0.00";
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${parseFloat(value.toPrecision(4))}`;
}

/** Compact token count: 1200 -> "1.2k", 2500000 -> "2.5M". */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value < 1000) return String(Math.round(value));
  if (value < 1_000_000) return `${trim(value / 1000)}k`;
  if (value < 1_000_000_000) return `${trim(value / 1_000_000)}M`;
  return `${trim(value / 1_000_000_000)}B`;
}

function trim(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}
