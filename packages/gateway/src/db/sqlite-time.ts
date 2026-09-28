/**
 * Drizzle's SQLite `mode: "timestamp"` columns persist Unix seconds. Keep raw
 * SQL writers on the same unit and tolerate legacy millisecond values at read
 * boundaries while the compatibility migration is rolling out.
 */
const millisecondTimestampThreshold = 100_000_000_000;

export function sqliteTimestampSeconds(now = new Date()): number {
  return Math.floor(now.getTime() / 1_000);
}

export function dateFromSqliteTimestamp(value: number | string | null): Date | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value >= millisecondTimestampThreshold ? value : value * 1_000;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  if (typeof value !== "string" || value.length === 0) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
