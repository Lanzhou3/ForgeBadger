import type { CopilotGoalReviewAttempt, CopilotGoalTaskTeam } from "@/lib/copilot-api";
import type { FleetDetail, FleetTask } from "@/lib/fleet-api";

export const fleetTask = (over: Partial<FleetTask> = {}): FleetTask => ({
  id: "t1", goalId: "f1", seq: 1, description: "Add the parser", status: "pending", evidence: null, verifyCommand: "pnpm test",
  verifiedAt: null, verifyExitCode: null, dispatchedSessionId: null, dispatchStatus: null, dispatchUpdatedAt: null, createdAt: 1, updatedAt: 1,
  details: null, memberId: null, fileScope: [], hold: null, note: null, createdBy: "lead", ...over,
});

export const taskTeam = (over: Partial<CopilotGoalTaskTeam> = {}): CopilotGoalTaskTeam => ({
  taskId: "t1", worker: { adapter: "claude", memberId: "ada", memberName: "Ada", sessionId: "s1" }, workspace: "own", integrated: false, review: null, ...over,
});

export const reviewAttempt = (over: Partial<CopilotGoalReviewAttempt> = {}): CopilotGoalReviewAttempt => ({
  attempt: 1, status: "reported", reviewer: { id: "rex", name: "Rex", adapter: "codex" }, sessionId: "s2", startedAt: 100, settledAt: 200,
  verdict: "request_changes", summary: "One real bug.", droppedFindings: 0,
  findings: [{ file: "src/parser.ts", line: 12, severity: "high", message: "crashes on empty input" }], ...over,
});

export const detailOf = (over: Partial<FleetDetail> = {}): FleetDetail => ({
  fleet: { id: "f1", projectId: "p1", projectName: "orders", title: "Orders fleet", instructions: "Keep tests green.", status: "active", pausedReason: null, grants: [],
    workspace: { kind: "worktree", branch: "forgebadger/fleet-f1", baseCommit: "abc", targetBranch: "main" }, createdAt: 1, updatedAt: 1 },
  tasks: [], journal: [], timers: [], pendingEvents: 0, leadActive: false, ...over,
});
