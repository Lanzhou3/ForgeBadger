import { describe, expect, it } from "vitest";

import {
  groupTaskPacketsByQueueStatus,
  taskPacketCanStart,
  taskPacketBlockedReasonKey,
  taskPacketSessionOptionLabel,
  taskPacketSelectableSessions,
} from "./project-manager-task-packet";
import type { ProjectManagerTaskPacket } from "@/lib/api";
import type { Session } from "@/lib/api";

function session(overrides: Partial<Session>): Session {
  return {
    id: "session-1",
    status: "running",
    name: "Session 1",
    projectId: "project-1",
    aiTool: "claude",
    ...overrides,
  };
}

describe("project-manager task packet helpers", () => {
  const packet: ProjectManagerTaskPacket = {
    id: "work-item-1:task-packet",
    projectId: "project-1",
    workItemId: "work-item-1",
    workItemStatus: "todo",
    queueStatus: "planned",
    title: "Fix launch",
    updatedAt: 1000,
    prompt: "Task: Fix launch",
    acceptanceCriteria: [],
    expectedVerification: [],
    evidenceRequirements: [],
    runtime: { adapter: "claude", templateId: "builtin-claude-code" },
    sessionLink: null,
    blockedReason: "no_linked_session",
  };

  it("allows starting only unlinked task packets", () => {
    expect(taskPacketCanStart(packet, false)).toBe(true);
    expect(taskPacketCanStart(packet, true)).toBe(false);
    expect(taskPacketCanStart({ ...packet, sessionLink: {
      sessionId: "session-1",
      status: "idle",
      aiTool: "claude",
      href: "/sessions/session-1",
    } }, false)).toBe(false);
  });

  it("maps blocked reasons to translation keys", () => {
    expect(taskPacketBlockedReasonKey("no_linked_session")).toBe(
      "projects.projectManagerTaskPacketBlockedNoSession"
    );
    expect(taskPacketBlockedReasonKey("linked_session_not_running")).toBe(
      "projects.projectManagerTaskPacketBlockedInactiveSession"
    );
    expect(taskPacketBlockedReasonKey(null)).toBe("projects.projectManagerTaskPacketReady");
  });

  it("keeps only sessions that can be linked from a task packet", () => {
    const sessions = [
      session({ id: "running", status: "running" }),
      session({ id: "detached", status: "detached" }),
      session({ id: "stopped", status: "stopped" }),
      session({ id: "missing-project", projectId: undefined }),
    ];

    expect(taskPacketSelectableSessions(sessions).map((candidate) => candidate.id)).toEqual([
      "running",
      "detached",
    ]);
  });

  it("formats session options with a stable status suffix", () => {
    expect(taskPacketSessionOptionLabel(session({
      id: "session-abc",
      name: "Fix dashboard",
      aiTool: "codex",
      status: "detached",
    }))).toBe("Fix dashboard / codex / detached");
  });

  it("groups task packets into every queue column without reordering packets", () => {
    const grouped = groupTaskPacketsByQueueStatus([
      { ...packet, workItemId: "work-1", queueStatus: "planned", title: "Plan" },
      { ...packet, workItemId: "work-2", queueStatus: "running", title: "Run" },
      { ...packet, workItemId: "work-3", queueStatus: "planned", title: "Plan later" },
      { ...packet, workItemId: "work-4", queueStatus: "waiting_for_review", title: "Review" },
    ]);

    expect(Object.keys(grouped)).toEqual([
      "planned",
      "running",
      "waiting_for_review",
      "blocked",
      "completed",
      "cancelled",
    ]);
    expect(grouped.planned.map((candidate) => candidate.workItemId)).toEqual(["work-1", "work-3"]);
    expect(grouped.running.map((candidate) => candidate.workItemId)).toEqual(["work-2"]);
    expect(grouped.blocked).toEqual([]);
  });
});
