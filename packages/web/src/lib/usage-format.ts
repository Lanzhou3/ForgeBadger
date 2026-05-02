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
