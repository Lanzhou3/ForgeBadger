export type CopilotStatusTone = "success" | "danger" | "warning" | "info" | "muted";

const statusTones: Record<string, CopilotStatusTone> = {
  completed: "success",
  failed: "danger",
  cancelled: "muted",
  waiting_for_approval: "warning",
  running: "info",
  queued: "muted",
};

const eventLabels: Record<string, string> = {
  assistant_message: "Assistant message",
  run_failed: "Run failed",
  tool_call_requested: "Tool requested",
};

const pendingActionLabels: Record<string, string> = {
  "openforge.propose_setting_update": "Setting update",
  "openforge.propose_memory_write": "Memory write",
};

export interface ResolveCopilotRunSelectionInput {
  selectedRunId?: string | null;
  activeRunId?: string | null;
  runs: Array<{ id: string }>;
}

export function getCopilotStatusTone(status: string): CopilotStatusTone {
  return statusTones[status] ?? "muted";
}

export function getCopilotEventLabel(type: string): string {
  return eventLabels[type] ?? humanizeToken(type);
}

export function getCopilotPendingActionLabel(type: string): string {
  return pendingActionLabels[type] ?? humanizeToken(type);
}

export function resolveCopilotRunSelection(input: ResolveCopilotRunSelectionInput): string | null {
  return input.selectedRunId ?? input.activeRunId ?? input.runs[0]?.id ?? null;
}

export function isCopilotRunLive(status: string): boolean {
  return status === "queued" || status === "running" || status === "waiting_for_approval";
}

function humanizeToken(value: string): string {
  const normalized = value
    .replace(/^openforge\./u, "openforge_")
    .replace(/[._-]+/gu, " ")
    .trim()
    .toLowerCase();
  if (!normalized) return "Unknown";
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}
