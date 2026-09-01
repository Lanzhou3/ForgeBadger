import { describe, expect, it } from "vitest";

import {
  auditSessionHandoffExportInput,
  buildSessionHandoffMarkdown,
  sessionHandoffMarkdownFilename,
} from "./session-handoff-export";
import type { ProjectManagerTaskPacket, Session } from "@/lib/api";

const session: Session = {
  id: "session-1",
  name: "Task: Review launch",
  projectId: "project-1",
  projectName: "ForgeBadger",
  status: "stopped",
  aiTool: "claude",
};

const taskPacket: ProjectManagerTaskPacket = {
  id: "work-item-1:task-packet",
  projectId: "project-1",
  workItemId: "work-item-1",
  workItemStatus: "ready_for_review",
  queueStatus: "waiting_for_review",
  title: "Review launch",
  updatedAt: 1000,
  prompt: "Task: Review launch\nAcceptance criteria:\n- launch path works",
  acceptanceCriteria: ["launch path works"],
  expectedVerification: ["pnpm --dir packages/web typecheck"],
  evidenceRequirements: ["record test command output"],
  runtime: { adapter: "claude", templateId: "builtin-claude-code" },
  sessionLink: {
    sessionId: "session-1",
    status: "stopped",
    aiTool: "claude",
    href: "/sessions/session-1",
  },
  blockedReason: "linked_session_not_running",
};

describe("session handoff export helpers", () => {
  it("builds a bounded markdown handoff packet", () => {
    const input = {
      generatedAt: "2026-06-14T00:00:00.000Z",
      openReviewItems: "Confirm reviewer sign-off",
      operatorNotes: "Implemented the review checklist and kept terminal history in tmux.",
      session,
      taskPacket,
      verificationNotes: "Ran pnpm --dir packages/web typecheck.",
    };

    expect(auditSessionHandoffExportInput(input)).toEqual([]);
    expect(buildSessionHandoffMarkdown(input)).toContain("# Session Handoff: Review launch");
    expect(buildSessionHandoffMarkdown(input)).toContain("- Session: session-1");
    expect(buildSessionHandoffMarkdown(input)).toContain("- Runtime: claude / builtin-claude-code");
    expect(buildSessionHandoffMarkdown(input)).toContain("## Operator Notes");
    expect(buildSessionHandoffMarkdown(input)).toContain("Implemented the review checklist");
    expect(buildSessionHandoffMarkdown(input)).toContain("## Safety Boundary");
    expect(buildSessionHandoffMarkdown(input)).toContain("Terminal scrollback remains in tmux");
  });

  it("rejects secrets, placeholders, and raw terminal dumps before export", () => {
    const issues = auditSessionHandoffExportInput({
      generatedAt: "2026-06-14T00:00:00.000Z",
      openReviewItems: "TODO",
      operatorNotes: "$ pnpm test\nsecret sk-test123456",
      session,
      taskPacket,
      verificationNotes: "FORGEBADGER_ATTACH_TOKEN=abc123\nOPENFORGE_ATTACH_TOKEN=legacy123",
    });

    expect(issues).toEqual([
      "secret_like_value",
      "placeholder_text",
      "raw_terminal_dump",
    ]);
  });

  it("creates a stable safe filename for a downloaded handoff", () => {
    expect(sessionHandoffMarkdownFilename({
      generatedAt: "2026-06-14T00:00:00.000Z",
      taskPacket,
    })).toBe("forgebadger-session-handoff-review-launch-2026-06-14T00-00-00-000Z.md");
  });

  it("audits task packet content and uses a fence longer than embedded backticks", () => {
    const unsafeTaskPacket = {
      ...taskPacket,
      prompt: "Inspect this block ```text\ntoken=unsafe-secret\n``` safely",
    };
    const input = {
      generatedAt: "2026-06-14T00:00:00.000Z",
      openReviewItems: "None recorded",
      operatorNotes: "Reviewed the bounded task packet.",
      session,
      taskPacket: unsafeTaskPacket,
      verificationNotes: "Confirmed local-only export behavior.",
    };

    expect(auditSessionHandoffExportInput(input)).toContain("secret_like_value");
    expect(buildSessionHandoffMarkdown(input)).toContain("````text\nInspect this block ```text");
  });
});
