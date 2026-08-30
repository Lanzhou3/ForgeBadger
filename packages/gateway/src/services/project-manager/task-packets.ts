/**
 * Task-packet domain service — shared by the project-manager HTTP routes and
 * the Copilot PM tools so packet construction, session linking, and the
 * start flow have exactly one implementation.
 *
 * The packet is the unit of dispatch for autonomous software engineering:
 * prompt + acceptance criteria + expected verification + evidence
 * requirements, bound to a linked CLI session.
 */
import { createHash } from "node:crypto";

import {
  type ProjectManagerWorkItem,
  type ProjectManagerWorkItemStatus
} from "../../db/repositories/project-manager-repository.js";
import { type Project } from "../../db/repositories/project-repository.js";
import { SessionRepository, type Session } from "../../db/repositories/session-repository.js";
import type { Database } from "../../db/types.js";

export interface ProjectManagerTaskPacket {
  id: string;
  projectId: string;
  workItemId: string;
  workItemStatus: ProjectManagerWorkItemStatus;
  queueStatus: ProjectManagerTaskPacketQueueStatus;
  title: string;
  updatedAt: number;
  prompt: string;
  acceptanceCriteria: string[];
  expectedVerification: string[];
  evidenceRequirements: string[];
  runtime: {
    adapter: string | null;
    templateId: string | null;
  };
  sessionLink: {
    sessionId: string;
    status: string;
    aiTool: string;
    href: string;
  } | null;
  blockedReason: "no_linked_session" | "linked_session_not_running" | null;
}

export type ProjectManagerTaskPacketQueueStatus =
  | "planned"
  | "running"
  | "waiting_for_review"
  | "blocked"
  | "completed"
  | "cancelled";

export function buildTaskPacket(input: {
  project: Project;
  workItem: ProjectManagerWorkItem;
  session?: Session | null;
}): ProjectManagerTaskPacket {  const taskPacketDetails = readTaskPacketDetails(input.workItem.details);
  const promptFrame = readStringValue(taskPacketDetails.promptFrame);
  const expectedVerification = readStringArray(taskPacketDetails.expectedVerification);
  const evidenceRequirements = readStringArray(taskPacketDetails.evidenceRequirements);
  const session = input.session ?? null;
  return {
    id: `${input.workItem.id}:task-packet`,
    projectId: input.project.id,
    workItemId: input.workItem.id,
    workItemStatus: input.workItem.status,
    queueStatus: queueStatusForWorkItem(input.workItem.status),
    title: input.workItem.title,
    updatedAt: input.workItem.updatedAt,
    prompt: buildTaskPacketPrompt({
      project: input.project,
      workItem: input.workItem,
      runtimeAdapter: session?.aiTool || input.project.aiTool || null,
      promptFrame,
      expectedVerification,
      evidenceRequirements
    }),
    acceptanceCriteria: input.workItem.acceptanceCriteria,
    expectedVerification,
    evidenceRequirements,
    runtime: {
      adapter: session?.aiTool || input.project.aiTool || null,
      templateId: input.project.templateId ?? null
    },
    sessionLink: session ? {
      sessionId: session.id,
      status: session.status,
      aiTool: session.aiTool,
      href: `/sessions/${encodeURIComponent(session.id)}`
    } : null,
    blockedReason: session ? (isActiveSessionStatus(session.status) ? null : "linked_session_not_running") : "no_linked_session"
  };
}


export function queueStatusForWorkItem(status: ProjectManagerWorkItemStatus): ProjectManagerTaskPacketQueueStatus {
  if (status === "todo") return "planned";
  if (status === "in_progress") return "running";
  if (status === "ready_for_review") return "waiting_for_review";
  if (status === "blocked") return "blocked";
  if (status === "done") return "completed";
  return "cancelled";
}

export function buildTaskPacketPrompt(input: {
  project: Project;
  workItem: ProjectManagerWorkItem;
  runtimeAdapter: string | null;
  promptFrame: string | undefined;
  expectedVerification: string[];
  evidenceRequirements: string[];
}): string {
  const lines = [
    `Task: ${input.workItem.title}`,
    `Project: ${input.project.name}`
  ];
  if (input.runtimeAdapter) {
    lines.push(`Runtime CLI: ${input.runtimeAdapter}`);
  }
  if (input.workItem.description) {
    lines.push("", "Context:", input.workItem.description);
  }
  if (input.promptFrame) {
    lines.push("", "Starter pack prompt frame:", input.promptFrame);
  }
  appendList(lines, "Acceptance criteria:", input.workItem.acceptanceCriteria);
  appendList(lines, "Expected verification:", input.expectedVerification);
  appendList(lines, "Evidence requirements:", input.evidenceRequirements);
  return lines.join("\n");
}

function appendList(lines: string[], heading: string, values: string[]): void {
  if (values.length === 0) return;
  lines.push("", heading);
  for (const value of values) {
    lines.push(`- ${value}`);
  }
}

export function resolveTaskPacketSession(
  db: Database,
  userId: string,
  projectId: string,
  workItem: ProjectManagerWorkItem
): Session | null {
  const taskPacketDetails = readTaskPacketDetails(workItem.details);
  if (typeof taskPacketDetails.sessionId !== "string" || taskPacketDetails.sessionId.trim().length === 0) {
    return null;
  }
  const session = new SessionRepository(db, userId).getById(taskPacketDetails.sessionId.trim());
  return session?.projectId === projectId ? session : null;
}

export function withTaskPacketSessionLink(
  details: Record<string, unknown>,
  session: Session,
  project: Project,
  context: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...details,
    taskPacket: {
      ...readTaskPacketDetails(details),
      sessionId: session.id,
      sessionStatus: session.status,
      adapter: session.aiTool,
      templateId: project.templateId ?? null,
      linkedAt: new Date().toISOString(),
      ...context
    }
  };
}

export function createTaskPacketSessionName(title: string): string {
  const normalized = title.trim() || "Task";
  return `Task: ${normalized}`.slice(0, 256);
}

export function createTaskPacketContext(workItem: ProjectManagerWorkItem, project: Project): Record<string, unknown> {
  const packet = buildTaskPacket({ project, workItem });
  return {
    contextStatus: "ready_for_operator",
    contextRef: `/api/v1/projects/${encodeURIComponent(project.id)}/project-manager/work-items/${encodeURIComponent(workItem.id)}/task-packet`,
    promptDigest: createHash("sha256").update(packet.prompt).digest("hex"),
    acceptanceCriteriaCount: packet.acceptanceCriteria.length,
    expectedVerificationCount: packet.expectedVerification.length,
    evidenceRequirementCount: packet.evidenceRequirements.length
  };
}

export function toTaskPacketSessionDto(session: Session) {
  return {
    id: session.id,
    name: session.name,
    projectId: session.projectId,
    status: session.status,
    aiTool: session.aiTool,
    modelId: session.modelId,
    credentialMode: session.credentialMode,
    apiKeyId: session.apiKeyId
  };
}

export function readTaskPacketDetails(details: Record<string, unknown>): Record<string, unknown> {
  const raw = details.taskPacket;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
}

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= 512)
    .slice(0, 20);
}

export function readStringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 512 ? normalized : undefined;
}

export function isActiveSessionStatus(status: string): boolean {
  return status === "running" || status === "detached";
}
