// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { LanguageProvider } from "@/hooks/use-language";
import type { CopilotGoal, CopilotGoalReviewAttempt, CopilotGoalTask, CopilotGoalTaskTeam, CopilotGoalTeam } from "@/lib/copilot-api";
import { GoalTaskFlow } from "./goal-task-flow";
import { bucketOf, currentStageIndex, deriveTaskFlow, memberActivity, unintegratedTasks } from "./goal-task-flow-model";
import { GoalTeamStrip } from "./goal-team-strip";

const goal: CopilotGoal = {
  id: "g1", conversationId: "c1", projectId: "p1", title: "Team goal", spec: "s", status: "active", blockedReason: null, grants: [],
  createdAt: 1, updatedAt: 1, completedAt: null,
};
const task = (over: Partial<CopilotGoalTask> = {}): CopilotGoalTask => ({
  id: "t1", goalId: "g1", seq: 1, description: "Add the parser", status: "pending", evidence: null, verifyCommand: "pnpm test",
  verifiedAt: null, verifyExitCode: null, dispatchedSessionId: null, dispatchStatus: null, createdAt: 1, updatedAt: 1, ...over,
});
const teamOf = (over: Partial<CopilotGoalTaskTeam> = {}): CopilotGoalTaskTeam => ({
  taskId: "t1", worker: { adapter: "claude", memberId: "ada", memberName: "Ada", sessionId: "s1" }, workspace: "own", integrated: false, review: null, ...over,
});
const attempt = (over: Partial<CopilotGoalReviewAttempt> = {}): CopilotGoalReviewAttempt => ({
  attempt: 1, status: "reported", reviewer: { id: "rex", name: "Rex", adapter: "codex" }, sessionId: "s2", startedAt: 100, settledAt: 200,
  verdict: "request_changes", summary: "One real bug.", droppedFindings: 1,
  findings: [{ file: "src/parser.ts", line: 12, severity: "high", message: "crashes on empty input" }], ...over,
});
const states = (flow: ReturnType<typeof deriveTaskFlow>) => flow.stages.map((stage) => `${stage.id}:${stage.state}`);

describe("deriveTaskFlow", () => {
  it("shows only the stages a task actually has", () => {
    expect(states(deriveTaskFlow(task({ verifyCommand: null })))).toEqual(["write:todo", "pass:todo"]);
    expect(states(deriveTaskFlow(task(), teamOf({ workspace: "shared", integrated: null })))).toEqual(["write:todo", "verify:todo", "pass:todo"]);
    expect(states(deriveTaskFlow(task(), teamOf({ review: { rounds: 0, roundsLeft: 2, attempts: [attempt({ status: "running", verdict: null, findings: [] })] } }))))
      .toEqual(["write:todo", "verify:todo", "review:active", "integrate:todo", "pass:todo"]);
  });

  it("names who acts next at every step of a parallel task", () => {
    const dispatched = { dispatchedSessionId: "s1" } as const;
    const walk: Array<[CopilotGoalTask, CopilotGoalTaskTeam | undefined, string, string, string | null]> = [
      [task(), undefined, "queued", "queued", null],
      [task({ status: "in_progress" }), undefined, "lead", "leadWorking", null],
      [task({ ...dispatched, dispatchStatus: "running" }), teamOf(), "member", "writing", "Ada"],
      [task({ ...dispatched, dispatchStatus: "failed" }), teamOf(), "lead", "cliFailed", null],
      [task({ ...dispatched, dispatchStatus: "completed" }), teamOf(), "lead", "awaitVerify", null],
      [task({ ...dispatched, dispatchStatus: "completed", verifiedAt: 5, verifyExitCode: 2 }), teamOf(), "lead", "verifyFailed", null],
      [task({ ...dispatched, dispatchStatus: "completed", verifiedAt: 5, verifyExitCode: 0 }), teamOf(), "lead", "awaitIntegrate", null],
      [task({ ...dispatched, dispatchStatus: "completed" }), teamOf({ review: { rounds: 0, roundsLeft: 2, attempts: [attempt({ status: "running", verdict: null, findings: [] })] } }), "reviewer", "reviewing", "Rex"],
      [task({ ...dispatched, dispatchStatus: "completed", dispatchUpdatedAt: 150 }), teamOf({ review: { rounds: 1, roundsLeft: 1, attempts: [attempt()] } }), "lead", "reviewWantsChanges", null],
      [task({ status: "passes", boardStatus: "ready_for_review" }), teamOf({ integrated: true }), "owner", "awaitAcceptance", null],
      [task({ status: "passes" }), teamOf({ integrated: true }), "done", "passed", null],
      [task({ status: "cancelled" }), teamOf(), "stopped", "cancelled", null],
    ];
    for (const [input, team, holder, headline, actor] of walk) {
      const flow = deriveTaskFlow(input, team);
      expect([flow.holder, flow.headline, flow.actor]).toEqual([holder, headline, actor]);
    }
  });

  it("treats review findings as handled once the writer was dispatched again", () => {
    const review = { rounds: 1, roundsLeft: 1, attempts: [attempt()] };
    const before = deriveTaskFlow(task({ dispatchedSessionId: "s1", dispatchStatus: "completed", dispatchUpdatedAt: 150 }), teamOf({ review }));
    const after = deriveTaskFlow(task({ dispatchedSessionId: "s1", dispatchStatus: "running", dispatchUpdatedAt: 300 }), teamOf({ review }));
    expect(before.stages.find((stage) => stage.id === "review")?.state).toBe("attention");
    expect(after.stages.find((stage) => stage.id === "review")?.state).toBe("done");
    expect(after.holder).toBe("member");
    expect(deriveTaskFlow(task(), teamOf({ review: { rounds: 1, roundsLeft: 1, attempts: [attempt({ verdict: "approve", findings: [] })] } }))
      .stages.find((stage) => stage.id === "review")?.state).toBe("done");
  });

  it("does not call an empty worktree integrated while the member is still writing", () => {
    const writing = deriveTaskFlow(task({ dispatchedSessionId: "s1", dispatchStatus: "running" }), teamOf({ integrated: true }));
    expect(writing.stages.find((stage) => stage.id === "integrate")?.state).toBe("todo");
    const finished = deriveTaskFlow(task({ dispatchedSessionId: "s1", dispatchStatus: "completed", verifiedAt: 1, verifyExitCode: 0 }), teamOf({ integrated: true }));
    expect(finished.stages.find((stage) => stage.id === "integrate")?.state).toBe("done");
  });

  it("points the track at the active stage, else the first unfinished one", () => {
    expect(currentStageIndex(deriveTaskFlow(task({ dispatchedSessionId: "s1", dispatchStatus: "completed" }), teamOf()).stages)).toBe(1);
    expect(currentStageIndex(deriveTaskFlow(task({ dispatchedSessionId: "s1", dispatchStatus: "running" }), teamOf()).stages)).toBe(0);
    expect(currentStageIndex(deriveTaskFlow(task({ status: "passes", verifiedAt: 1, verifyExitCode: 0 }), teamOf({ integrated: true })).stages)).toBe(-1);
    expect(bucketOf(deriveTaskFlow(task({ dispatchedSessionId: "s1", dispatchStatus: "running" }), teamOf()))).toBe("team");
  });

  it("lists own-worktree tasks that are not integrated and what members are doing", () => {
    const tasks = [task(), task({ id: "t2", seq: 2 }), task({ id: "t3", seq: 3, status: "cancelled" }), task({ id: "t4", seq: 4, dispatchedSessionId: "s4", dispatchStatus: "running" })];
    const team = [teamOf(), teamOf({ taskId: "t2", integrated: true }), teamOf({ taskId: "t3" }),
      teamOf({ taskId: "t4", workspace: "shared", integrated: null, review: { rounds: 0, roundsLeft: 2, attempts: [attempt({ status: "running" })] } })];
    expect(unintegratedTasks(tasks, team).map((entry) => entry.id)).toEqual(["t1"]);
    expect(unintegratedTasks(tasks, undefined)).toEqual([]);
    expect([...memberActivity(tasks, team)]).toEqual([["ada", { kind: "writing", taskSeq: 4 }], ["rex", { kind: "reviewing", taskSeq: 4 }]]);
  });
});

describe("GoalTaskFlow", () => {
  beforeEach(() => cleanup());
  const roster: CopilotGoalTeam = {
    maxParallelWriters: 3,
    members: [{ id: "ada", name: "Ada", title: "Implementer", adapter: "claude", roles: ["writer"] }, { id: "rex", name: "Rex", title: "Reviewer", adapter: "codex", roles: ["reviewer"] }],
    tasks: [
      teamOf({ review: { rounds: 1, roundsLeft: 1, attempts: [attempt()] } }),
      teamOf({ taskId: "t2", worker: null, workspace: "shared", integrated: null }),
    ],
  };
  const tasks = [
    task({ dispatchedSessionId: "s1", dispatchStatus: "completed", dispatchUpdatedAt: 150, verifiedAt: 5, verifyExitCode: 0 }),
    task({ id: "t2", seq: 2, description: "Write docs", verifyCommand: null, status: "passes", evidence: "docs built" }),
  ];
  const mount = (status: CopilotGoal["status"] = "active") => render(
    <LanguageProvider><GoalTeamStrip team={roster} tasks={tasks} /><GoalTaskFlow goal={{ ...goal, status }} tasks={tasks} team={roster} /></LanguageProvider>,
  );

  it("renders a track per task with the next actor, and opens the review findings on demand", () => {
    mount();
    const first = within(screen.getByTestId("goal-task-1"));
    expect(first.getByText("审查要求修改，等 Copilot 交回")).toBeTruthy();
    expect(first.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["编写: 完成", "验证: 完成", "审查: 待处理", "集成: 未开始", "通过: 未开始"]);
    expect(first.getAllByRole("listitem").filter((item) => item.getAttribute("aria-current") === "step").map((item) => item.textContent)).toEqual(["审查: 待处理"]);
    expect(first.getByText("独立工作区，尚未并入目标分支")).toBeTruthy();
    expect(first.queryByText("crashes on empty input")).toBeNull();
    fireEvent.click(first.getByRole("button", { name: /查看 1 条发现/ }));
    expect(first.getByText("crashes on empty input")).toBeTruthy();
    expect(first.getByText("src/parser.ts:12")).toBeTruthy();
    expect(first.getByText("要求修改")).toBeTruthy();
    expect(first.getByText("另有 1 条无法解析，已忽略。")).toBeTruthy();
    expect(first.getByText(/仅供参考，不代替验证命令。 还可以再审 1 轮/)).toBeTruthy();

    const second = within(screen.getByTestId("goal-task-2"));
    expect(second.getByText("已通过")).toBeTruthy();
    expect(second.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["编写: 完成", "通过: 完成"]);
    expect(second.getByText("docs built")).toBeTruthy();
  });

  it("summarises who holds the tasks and shows the team", () => {
    mount();
    const flow = within(screen.getByRole("region", { name: "任务走向" }));
    expect(flow.getByText("等 Copilot")).toBeTruthy();
    const strip = within(screen.getByRole("region", { name: "团队" }));
    expect(strip.getByText("Ada")).toBeTruthy();
    expect(strip.getAllByText("空闲").length).toBe(2);
    expect(strip.getByText("并行 0 / 3")).toBeTruthy();
  });

  it("animates only while the goal is running", () => {
    mount("active");
    expect(screen.getByRole("region", { name: "任务走向" }).className).toContain("fb-flow-live");
    cleanup();
    mount("paused");
    expect(screen.getByRole("region", { name: "任务走向" }).className).not.toContain("fb-flow-live");
  });
});
