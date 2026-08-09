import type { ProjectManagerTaskPacket, ProjectManagerTaskPacketQueueStatus, Session } from "@/lib/api";
import type { TranslationKey } from "@/lib/i18n";

type TaskPacketBlockedReason = ProjectManagerTaskPacket["blockedReason"];
type TaskPacketQueueGroups = Record<ProjectManagerTaskPacketQueueStatus, ProjectManagerTaskPacket[]>;

export const TASK_PACKET_QUEUE_STATUSES: ProjectManagerTaskPacketQueueStatus[] = [
  "planned",
  "running",
  "waiting_for_review",
  "blocked",
  "completed",
  "cancelled",
];

export function taskPacketCanStart(
  taskPacket: ProjectManagerTaskPacket | null | undefined,
  isStarting: boolean
): boolean {
  return Boolean(taskPacket && !taskPacket.sessionLink && !isStarting);
}

export function taskPacketBlockedReasonKey(reason: TaskPacketBlockedReason): TranslationKey {
  if (reason === "no_linked_session") {
    return "projects.projectManagerTaskPacketBlockedNoSession";
  }
  if (reason === "linked_session_not_running") {
    return "projects.projectManagerTaskPacketBlockedInactiveSession";
  }
  return "projects.projectManagerTaskPacketReady";
}

export function taskPacketSelectableSessions(sessions: readonly Session[]): Session[] {
  return sessions.filter((session) => session.projectId && isTaskPacketSessionActive(session.status));
}

export function taskPacketSessionOptionLabel(session: Session): string {
  return [
    session.name?.trim() || session.id,
    session.aiTool?.trim() || "unknown",
    session.status,
  ].join(" / ");
}

export function groupTaskPacketsByQueueStatus(
  taskPackets: readonly ProjectManagerTaskPacket[]
): TaskPacketQueueGroups {
  const groups = createEmptyTaskPacketQueueGroups();
  for (const taskPacket of taskPackets) {
    groups[taskPacket.queueStatus].push(taskPacket);
  }
  return groups;
}

function createEmptyTaskPacketQueueGroups(): TaskPacketQueueGroups {
  return {
    planned: [],
    running: [],
    waiting_for_review: [],
    blocked: [],
    completed: [],
    cancelled: [],
  };
}

function isTaskPacketSessionActive(status: string): boolean {
  return status === "running" || status === "detached";
}
