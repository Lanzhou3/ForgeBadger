export type DisplaySessionStatus = "running" | "stopped" | "error";

export function normalizeSessionStatus(status: string | null | undefined): DisplaySessionStatus {
  if (status === "running") return "running";
  if (status === "error") return "error";
  return "stopped";
}

export function sessionMatchesStatusFilter(
  status: string | null | undefined,
  filter: string
): boolean {
  if (filter === "all") return true;
  return normalizeSessionStatus(status) === filter;
}
