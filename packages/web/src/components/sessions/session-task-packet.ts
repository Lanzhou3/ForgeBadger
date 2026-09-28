import type { ProjectManagerTaskPacket } from "@/lib/api";

export function findSessionTaskPacket(
  taskPackets: readonly ProjectManagerTaskPacket[],
  sessionId: string
): ProjectManagerTaskPacket | null {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) return null;
  return taskPackets.find((taskPacket) =>
    taskPacket.sessionLink?.sessionId === normalizedSessionId
  ) ?? null;
}

export function sessionTaskPacketProjectManagerHref(taskPacket: ProjectManagerTaskPacket): string {
  const searchParams = new URLSearchParams({
    tab: "project-manager",
    workItemId: taskPacket.workItemId,
  });
  return `/projects/${encodeURIComponent(taskPacket.projectId)}?${searchParams.toString()}`;
}
