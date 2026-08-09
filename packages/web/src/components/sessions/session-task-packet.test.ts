import { describe, expect, it } from "vitest";

import {
  findSessionTaskPacket,
  sessionTaskPacketProjectManagerHref,
} from "./session-task-packet";
import type { ProjectManagerTaskPacket } from "@/lib/api";

function taskPacket(overrides: Partial<ProjectManagerTaskPacket>): ProjectManagerTaskPacket {
  return {
    id: "work-item-1:task-packet",
    projectId: "project-1",
    workItemId: "work-item-1",
    workItemStatus: "in_progress",
    queueStatus: "running",
    title: "Fix launch",
    updatedAt: 1000,
    prompt: "Task: Fix launch",
    acceptanceCriteria: ["launch works"],
    expectedVerification: ["pnpm test"],
    evidenceRequirements: ["test output"],
    runtime: { adapter: "claude", templateId: "builtin-claude-code" },
    sessionLink: {
      sessionId: "session-1",
      status: "idle",
      aiTool: "claude",
      href: "/sessions/session-1",
    },
    blockedReason: "linked_session_not_running",
    ...overrides,
  };
}

describe("session task packet helpers", () => {
  it("finds the task packet linked to the current session", () => {
    const linked = taskPacket({ workItemId: "linked", sessionLink: {
      sessionId: "session-current",
      status: "running",
      aiTool: "claude",
      href: "/sessions/session-current",
    } });
    const other = taskPacket({ workItemId: "other", sessionLink: {
      sessionId: "session-other",
      status: "running",
      aiTool: "claude",
      href: "/sessions/session-other",
    } });
    const unlinked = taskPacket({ workItemId: "unlinked", sessionLink: null });

    expect(findSessionTaskPacket([other, unlinked, linked], "session-current")).toBe(linked);
    expect(findSessionTaskPacket([other, unlinked], "session-current")).toBeNull();
  });

  it("builds a project-manager handoff href with encoded ids", () => {
    expect(sessionTaskPacketProjectManagerHref(taskPacket({
      projectId: "project/1",
      workItemId: "work/item 1",
    }))).toBe("/projects/project%2F1?tab=project-manager&workItemId=work%2Fitem+1");
  });
});
