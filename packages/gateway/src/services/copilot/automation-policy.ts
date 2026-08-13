import { Cron } from "croner";

import type { AutomationDefinition, AutomationSchedule } from "./automation-types.js";

export type AutomationAuthorityMode = "observe" | "operate";

export interface AutomationPolicyDecision {
  requiresApproval: boolean;
  reasons: string[];
  effectiveTools: string[];
}

export function evaluateAutomationAction(input: {
  mode: AutomationAuthorityMode;
  callerTools: string[];
  proposed: AutomationDefinition;
  current?: AutomationDefinition;
  expectedRevision?: number;
  currentRevision?: number;
}): AutomationPolicyDecision {
  if (
    input.expectedRevision !== undefined
    && input.currentRevision !== undefined
    && input.expectedRevision !== input.currentRevision
  ) {
    throw new Error("AUTOMATION_REVISION_CONFLICT");
  }

  const caller = new Set(normalizeTools(input.callerTools));
  const requested = normalizeTools(input.proposed.toolAuthority);
  if (requested.some((tool) => !caller.has(tool))) throw new Error("AUTOMATION_TOOL_AUTHORITY_EXCEEDED");

  const reasons: string[] = [];
  if (input.mode === "observe") reasons.push("observe_mode");
  if (input.proposed.scope.type === "workspace") reasons.push("workspace_scope");
  if (input.current) collectExpansionReasons(input.current, input.proposed, reasons);
  return { requiresApproval: reasons.length > 0, reasons: [...new Set(reasons)], effectiveTools: requested };
}

function collectExpansionReasons(
  current: AutomationDefinition,
  proposed: AutomationDefinition,
  reasons: string[]
): void {
  if (scopeExpanded(current, proposed)) reasons.push("scope_expanded");
  if (deliveryKey(current) !== deliveryKey(proposed)) reasons.push("recipient_changed");
  if (scheduleFrequencyMs(proposed.schedule) < scheduleFrequencyMs(current.schedule)) {
    reasons.push("frequency_increased");
  }
  const currentTools = new Set(normalizeTools(current.toolAuthority));
  if (normalizeTools(proposed.toolAuthority).some((tool) => !currentTools.has(tool))) {
    reasons.push("tool_authority_expanded");
  }
}

function normalizeTools(tools: string[]): string[] {
  return [...new Set(tools.map((tool) => tool.trim()).filter(Boolean))].sort();
}

function scopeExpanded(current: AutomationDefinition, proposed: AutomationDefinition): boolean {
  if (current.scope.type === "project" && proposed.scope.type === "workspace") return true;
  if (current.scope.type !== "project" || proposed.scope.type !== "project") return false;
  const currentIds = new Set(current.scope.projectIds);
  return proposed.scope.projectIds.some((projectId) => !currentIds.has(projectId));
}

function deliveryKey(definition: AutomationDefinition): string {
  const plan = definition.delivery;
  return [plan.channel, plan.accountId, plan.chatId, plan.threadId ?? ""].join(":");
}

function scheduleFrequencyMs(schedule: AutomationSchedule): number {
  if (schedule.kind === "at") return Number.POSITIVE_INFINITY;
  if (schedule.kind === "every") return schedule.intervalMs;
  try {
    const reference = new Date("2026-01-01T00:00:00.000Z");
    const runs = new Cron(schedule.expression, { timezone: schedule.timezone, paused: true }).nextRuns(2, reference);
    return runs.length === 2 ? runs[1]!.getTime() - runs[0]!.getTime() : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
