import type { TranslationKey } from "./i18n";

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
  tool_result: "Tool result",
};

const eventLabelKeys: Record<string, TranslationKey> = {
  assistant_message: "copilot.event.assistantMessage",
  run_failed: "copilot.event.runFailed",
  tool_call_requested: "copilot.event.toolRequested",
  tool_result: "copilot.event.toolResult",
};

const pendingActionLabels: Record<string, string> = {
  "openforge.propose_setting_update": "Setting update",
  "openforge.propose_memory_write": "Memory write",
  "openforge.propose_session_create": "Session create",
  "openforge.propose_diagnostics_export": "Diagnostics export",
  "openforge.propose_troubleshooting_steps": "Troubleshooting steps",
};

const pendingActionLabelKeys: Record<string, TranslationKey> = {
  "openforge.propose_setting_update": "copilot.pendingAction.settingUpdate",
  "openforge.propose_memory_write": "copilot.pendingAction.memoryWrite",
  "openforge.propose_session_create": "copilot.pendingAction.sessionCreate",
  "openforge.propose_diagnostics_export": "copilot.pendingAction.diagnosticsExport",
  "openforge.propose_troubleshooting_steps": "copilot.pendingAction.troubleshootingSteps",
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

export function getCopilotEventLabelKey(type: string): TranslationKey | null {
  return eventLabelKeys[type] ?? null;
}

export function getCopilotPendingActionLabel(type: string): string {
  return pendingActionLabels[type] ?? humanizeToken(type);
}

export function getCopilotPendingActionLabelKey(type: string): TranslationKey | null {
  return pendingActionLabelKeys[type] ?? null;
}

export function resolveCopilotRunSelection(input: ResolveCopilotRunSelectionInput): string | null {
  const runIds = new Set(input.runs.map((run) => run.id));
  if (input.selectedRunId && runIds.has(input.selectedRunId)) return input.selectedRunId;
  if (input.activeRunId) return input.activeRunId;
  return input.runs[0]?.id ?? null;
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
