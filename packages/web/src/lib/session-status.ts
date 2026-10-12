export type DisplaySessionStatus = "running" | "stopped" | "error" | "lost";

/** Localized relative label ("3 minutes ago") for a client-side timestamp. */
export function formatRelativeTime(timestamp: number, now: number, language: string): string {
  const diffSeconds = Math.round((timestamp - now) / 1000);
  const abs = Math.abs(diffSeconds);
  const formatter = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  if (abs < 60) {
    return formatter.format(diffSeconds, "second");
  }
  if (abs < 3600) {
    return formatter.format(Math.round(diffSeconds / 60), "minute");
  }
  if (abs < 86400) {
    return formatter.format(Math.round(diffSeconds / 3600), "hour");
  }
  if (abs < 2592000) {
    return formatter.format(Math.round(diffSeconds / 86400), "day");
  }
  if (abs < 31536000) {
    return formatter.format(Math.round(diffSeconds / 2592000), "month");
  }
  return formatter.format(Math.round(diffSeconds / 31536000), "year");
}

export function normalizeSessionStatus(status: string | null | undefined): DisplaySessionStatus {
  if (status === "running") return "running";
  if (status === "error") return "error";
  // "lost" marks sessions whose runtime vanished (e.g. a session-server daemon
  // death or OS restart); it is a failure state, not a deliberate stop, and
  // must stay distinguishable from "stopped" in the display layer.
  if (status === "lost") return "lost";
  return "stopped";
}

export function sessionMatchesStatusFilter(
  status: string | null | undefined,
  filter: string
): boolean {
  if (filter === "all") return true;
  return normalizeSessionStatus(status) === filter;
}
