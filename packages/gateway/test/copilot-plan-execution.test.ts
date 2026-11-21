import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { SessionRepository } from "../src/db/repositories/session-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { ProjectManagerRepository } from "../src/db/repositories/project-manager-repository.js";
import { CopilotRunLedger } from "../src/services/agent/run-ledger.js";
import { CopilotGoalStore } from "../src/services/agent/goal-store.js";
import { evaluateGoalContinuation, sweepStaleGoals } from "../src/services/agent/goal-driver.js";
import { confirmPlan, attachPlanProposals, planExecutionMaxSteps } from "../src/services/agent/plan-confirmation.js";
import { submitPlanInputSchema } from "../src/services/agent/tools/plan.js";
import { ForgeBadgerEventBus } from "../src/services/event-bus.js";
import { AgentError } from "../src/services/agent/types.js";
import { applyGoalTransition } from "../src/services/agent/goal-lifecycle.js";
import { createCopilotOrchestrator } from "../src/services/agent/orchestrator.js";
import { createAgentToolRegistry } from "../src/services/agent/tool-registry.js";
import type { TurnInput } from "../src/services/agent/run-ledger.js";

function fixture() {
  const db = new Database(":memory:");
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL("../src/db/migrations/", import.meta.url)) });
  const userId = new UserRepository(db).create("plan-exec@example.test", "hash").id;
  const ledger = new CopilotRunLedger(db, userId);
  const conversationId = ledger.log.createConversation().id;
  return { db, userId, ledger, conversationId };
}

const todo = (title: string, extra: object = {}) => ({ title, ...extra });

describe("plan TODO schema", () => {
  const base = { title: "T", summary: "S" };
  it("accepts the extended optional fields", () => {
    const result = submitPlanInputSchema.safeParse({ ...base, todos: [
      todo("a", { files: ["src/**/*.ts"], risk: "low", parallelizable: true, executor: "cli" }),
      todo("b", { dependsOn: [0] }),
    ] });
    assert.equal(result.success, true);
  });
  it("rejects forward, self and duplicate dependencies and unsafe paths", () => {
    for (const todos of [
      [todo("a", { dependsOn: [0] })],
      [todo("a", { dependsOn: [1] }), todo("b")],
      [todo("a"), todo("b", { dependsOn: [0, 0] })],
      [todo("a", { files: ["/etc/passwd"] })],
      [todo("a", { files: ["../x"] })],
      [todo("a", { files: ["a/../../x"] })],
      [todo("a", { risk: "extreme" })],
      [todo("a", { executor: "robot" })],
    ]) assert.equal(submitPlanInputSchema.safeParse({ ...base, todos }).success, false);
  });
});

function seedProposal(f: ReturnType<typeof fixture>, projectId: string | null, todos: object[], title: string) {
  const run = f.ledger.log.createRun(f.conversationId, {});
  f.db.prepare("UPDATE copilot_runs SET input_json=?, source='user' WHERE id=?")
    .run(JSON.stringify({ userId: f.userId, conversationId: f.conversationId, mode: "plan", userText: "p", ...(projectId ? { projectId } : {}) }), run.id);
  const content = JSON.stringify({ status: "plan_proposed", plan: { title, summary: "s", constraints: [], acceptanceCriteria: [], todos } });
  const stepId = randomUUID();
  const callId = randomUUID();
  f.db.prepare(`INSERT INTO copilot_run_steps(id,user_id,run_id,ordinal,kind,tool_name,tool_call_id,status,result_json)
    VALUES(?,?,?,1,'tool','submit_plan',?,'completed',?)`).run(stepId, f.userId, run.id, callId, content);
  const seq = (f.db.prepare("SELECT COALESCE(MAX(sequence),0)+1 AS n FROM copilot_messages WHERE conversation_id=?").get(f.conversationId) as { n: number }).n;
  f.db.prepare(`INSERT INTO copilot_messages(id,conversation_id,run_id,step_id,user_id,role,kind,content,tool_name,tool_call_id,sequence,created_at)
    VALUES(?,?,?,?,?,'tool','tool_result',?,'submit_plan',?,?,?)`).run(randomUUID(), f.conversationId, run.id, stepId, f.userId, content, callId, seq, Date.now());
  return stepId;
}

describe("plan confirmation", () => {
  it("saves valid TODOs whose detailed file list exceeds the board description limit", () => {
    const f = fixture();
    try {
      const projectId = new ProjectRepository(f.db, f.userId).create({ name: "P", path: "/tmp/plan-files", aiTool: "" }).id;
      f.ledger.log.setConversationProject(f.conversationId, projectId);
      const description = "D".repeat(2000);
      const files = Array.from({ length: 20 }, (_, index) => `src/${"a".repeat(245)}-${index}.ts`);
      const proposed = todo("Inspect files", { description, files, risk: "high", executor: "delegate" });
      assert.equal(submitPlanInputSchema.safeParse({ title: "Plan", summary: "S", todos: [proposed] }).success, true);
      const step = seedProposal(f, projectId, [proposed], "Plan");

      confirmPlan(f.db, f.userId, f.conversationId, step, { action: "save", todoIndexes: [0] }, () => "r");

      const [item] = new ProjectManagerRepository(f.db, f.userId).listWorkItems(projectId);
      assert.ok(item?.description?.startsWith(description));
      assert.ok(item.description.length <= 4000);
      assert.ok(item.description.includes(files[0]!));
      assert.match(item.description, /see confirmed plan/);
      assert.match(item.description, /Risk: high/);
    } finally { f.db.close(); }
  });

  it("remaps dependsOn to the selected order, drops unselected deps, and writes board dependencies", () => {
    const f = fixture();
    try {
      const projectId = new ProjectRepository(f.db, f.userId).create({ name: "P", path: "/tmp/plan-exec-p", aiTool: "" }).id;
      f.ledger.log.setConversationProject(f.conversationId, projectId);
      const step = seedProposal(f, projectId, [
        todo("A"), todo("B", { dependsOn: [0], files: ["src/b.ts"], risk: "high" }), todo("C", { dependsOn: [0, 1] }),
      ], "Plan");
      const turns: TurnInput[] = [];
      const receipt = confirmPlan(f.db, f.userId, f.conversationId, step, { action: "save", todoIndexes: [1, 2] }, t => { turns.push(t); return "run"; });
      assert.deepEqual(receipt, { action: "save", todoIndexes: [1, 2] });
      const pm = new ProjectManagerRepository(f.db, f.userId);
      const items = pm.listWorkItems(projectId);
      const byTitle = new Map(items.map(item => [item.title, item]));
      assert.match(byTitle.get("B")!.description ?? "", /Files: src\/b\.ts/);
      assert.match(byTitle.get("B")!.description ?? "", /Risk: high/);
      assert.match(byTitle.get("B")!.description ?? "", /unselected TODO 1/);
      const links = pm.listWorkItemLinks(projectId);
      assert.equal(links.length, 1);
      assert.equal(links[0]!.blockedWorkItemId, byTitle.get("C")!.id);
      assert.equal(links[0]!.blockerWorkItemId, byTitle.get("B")!.id);
    } finally { f.db.close(); }
  });

  it("execute with a project creates a single-run goal with a scaled step budget; without one it stays plain", () => {
    const f = fixture();
    try {
      const projectId = new ProjectRepository(f.db, f.userId).create({ name: "P", path: "/tmp/plan-exec-q", aiTool: "" }).id;
      f.ledger.log.setConversationProject(f.conversationId, projectId);
      f.ledger.log.writeConversationMode(f.conversationId, "plan");
      const step = seedProposal(f, projectId, [todo("A"), todo("B", { dependsOn: [0] })], "Plan");
      const turns: TurnInput[] = [];
      const receipt = confirmPlan(f.db, f.userId, f.conversationId, step, { action: "execute", todoIndexes: [0, 1] }, t => { turns.push(t); return "run-1"; });
      const store = new CopilotGoalStore(f.db, f.userId);
      const goal = store.getGoal(receipt.goalId!)!;
      assert.equal(goal.auto_continue, 0);
      assert.deepEqual(JSON.parse(goal.grants_json), []);
      assert.equal(store.listTasks(goal.id).length, 2);
      assert.equal(turns[0]!.goalId, goal.id);
      assert.equal(turns[0]!.maxSteps, 24);
      assert.equal(planExecutionMaxSteps(30), 64);
      // The goal run skips admission mode persistence, so confirmation itself leaves Plan Mode.
      assert.equal(f.ledger.log.getConversation(f.conversationId)!.mode, "execute");
    } finally { f.db.close(); }

    const g = fixture();
    try {
      const step = seedProposal(g, null, [todo("A")], "Plan");
      const turns: TurnInput[] = [];
      const receipt = confirmPlan(g.db, g.userId, g.conversationId, step, { action: "execute", todoIndexes: [0] }, t => { turns.push(t); return "r"; });
      assert.equal(receipt.goalId, undefined);
      assert.equal(turns[0]!.goalId, undefined);
      assert.equal(turns[0]!.maxSteps, 20);
    } finally { g.db.close(); }
  });

  it("marks older unconfirmed proposals superseded, links the chain, and rejects their confirmation with 409 semantics", () => {
    const f = fixture();
    try {
      const first = seedProposal(f, null, [todo("A")], "v1");
      const second = seedProposal(f, null, [todo("A2")], "v2");
      const messages = attachPlanProposals(f.db, f.userId, f.conversationId, f.ledger.log.listMessages(f.conversationId));
      const proposals = messages.map(m => (m as { planProposal?: Record<string, unknown> }).planProposal);
      assert.equal(proposals[0]!.supersededBy, second);
      assert.equal(proposals[0]!.previousStepId, undefined);
      assert.equal(proposals[1]!.previousStepId, first);
      assert.equal(proposals[1]!.supersededBy, undefined);
      assert.throws(() => confirmPlan(f.db, f.userId, f.conversationId, first, { action: "save", todoIndexes: [0] }, () => "r"),
        (error: unknown) => error instanceof AgentError && error.code === "COPILOT_PLAN_SUPERSEDED");
    } finally { f.db.close(); }
  });

  it("never supersedes a confirmed proposal and keeps its receipt idempotent", () => {
    const f = fixture();
    try {
      const first = seedProposal(f, null, [todo("A")], "v1");
      const input = { action: "execute" as const, todoIndexes: [0] };
      const receipt = confirmPlan(f.db, f.userId, f.conversationId, first, input, () => "run-x");
      seedProposal(f, null, [todo("B")], "v2");
      const messages = attachPlanProposals(f.db, f.userId, f.conversationId, f.ledger.log.listMessages(f.conversationId));
      const firstProposal = (messages[0] as { planProposal: Record<string, unknown> }).planProposal;
      assert.equal(firstProposal.supersededBy, undefined);
      assert.deepEqual(confirmPlan(f.db, f.userId, f.conversationId, first, input, () => "other"), receipt);
    } finally { f.db.close(); }
  });
});

describe("single-run goal driver", () => {
  function goalFixture() {
    const f = fixture();
    const store = new CopilotGoalStore(f.db, f.userId);
    const goal = store.createGoal({ conversationId: f.conversationId, title: "G", spec: "S", autoContinue: false });
    store.addTasks(goal.id, ["A", "B"]);
    const deps = { db: f.db, masterKey: "abcdef0123456789abcdef0123456789", eventBus: new ForgeBadgerEventBus() };
    const settledRun = () => {
      const run = f.ledger.log.createRun(f.conversationId, {});
      f.db.prepare("UPDATE copilot_runs SET status='completed', goal_id=? WHERE id=?").run(goal.id, run.id);
    };
    return { ...f, store, goal, deps, settledRun };
  }

  it("exposes autoContinue on the row and defaults other goals to 1", () => {
    const g = goalFixture();
    try {
      assert.equal(g.goal.auto_continue, 0);
      const normal = g.store.createGoal({ conversationId: g.conversationId, title: "N", spec: "S" });
      assert.equal(normal.auto_continue, 1);
    } finally { g.db.close(); }
  });

  it("pauses instead of enqueueing after the settled run, and the sweep stays idle", () => {
    const g = goalFixture();
    try {
      const enqueued: TurnInput[] = [];
      g.settledRun();
      const decision = evaluateGoalContinuation(g.deps, g.userId, g.goal.id, input => { enqueued.push(input); return "r"; });
      assert.equal(decision.action, "inactive");
      assert.equal(g.store.getGoal(g.goal.id)?.status, "paused");
      assert.ok(g.store.recentJournal(g.goal.id).some(entry => entry.note.includes("Single-run plan execution finished")));
      sweepStaleGoals(g.deps, (_user, input) => { enqueued.push(input); return "r"; });
      assert.equal(enqueued.length, 0);
    } finally { g.db.close(); }
  });

  it("runs exactly one more run on owner resume, then pauses again", () => {
    const g = goalFixture();
    try {
      const enqueued: TurnInput[] = [];
      const enqueue = (input: TurnInput) => { enqueued.push(input); return "r"; };
      g.settledRun();
      evaluateGoalContinuation(g.deps, g.userId, g.goal.id, enqueue);
      applyGoalTransition(g.store, g.store.getGoal(g.goal.id)!, "resume");
      const resumed = evaluateGoalContinuation(g.deps, g.userId, g.goal.id, enqueue);
      assert.equal(resumed.action, "enqueued");
      assert.equal(enqueued.length, 1);
      g.settledRun();
      evaluateGoalContinuation(g.deps, g.userId, g.goal.id, enqueue);
      assert.equal(enqueued.length, 1);
      assert.equal(g.store.getGoal(g.goal.id)?.status, "paused");
    } finally { g.db.close(); }
  });

  it("retries a resume after another run leaves the conversation", () => {
    const g = goalFixture();
    try {
      g.settledRun();
      evaluateGoalContinuation(g.deps, g.userId, g.goal.id);
      const busy = g.ledger.admit({ userId: g.userId, conversationId: g.conversationId, userText: "Unrelated turn" }, 16);
      applyGoalTransition(g.store, g.store.getGoal(g.goal.id)!, "resume");
      assert.equal(evaluateGoalContinuation(g.deps, g.userId, g.goal.id).action, "busy");
      g.ledger.cancel(busy);

      const enqueued: TurnInput[] = [];
      const enqueue = (_userId: string, input: TurnInput) => { enqueued.push(input); return "run"; };
      sweepStaleGoals(g.deps, enqueue);
      sweepStaleGoals(g.deps, enqueue);
      assert.equal(enqueued.length, 1);
      assert.equal(enqueued[0]?.goalId, g.goal.id);
      assert.equal(g.store.getGoal(g.goal.id)?.status, "paused");
    } finally { g.db.close(); }
  });

  it("honors slash resume after the command turn finishes", async () => {
    const g = goalFixture();
    try {
      g.settledRun();
      evaluateGoalContinuation(g.deps, g.userId, g.goal.id);
      const orchestrator = createCopilotOrchestrator({
        ...g.deps, toolRegistry: createAgentToolRegistry([]),
        llm: {
          async stream() { throw new Error("Slash command should run locally"); },
          async summarize() { return ""; },
          async generateTitle() { return ""; },
        },
      });
      await orchestrator.runTurn({ userId: g.userId, conversationId: g.conversationId, userText: "/goal resume" });

      const enqueued: TurnInput[] = [];
      sweepStaleGoals(g.deps, (_userId, input) => { enqueued.push(input); return "run"; });
      assert.equal(enqueued.length, 1);
      assert.equal(enqueued[0]?.goalId, g.goal.id);
    } finally { g.db.close(); }
  });

  it("delivers the full owner answer when a busy conversation defers admission", () => {
    const g = goalFixture();
    try {
      g.settledRun();
      g.store.setPendingQuestion(g.goal.id, "Which approach?");
      g.store.setStatus(g.goal.id, "blocked", "awaiting_user");
      const busy = g.ledger.admit({ userId: g.userId, conversationId: g.conversationId, userText: "Unrelated turn" }, 16);
      const answer = 'Choose the existing approach. ' + 'x'.repeat(1600);
      g.store.applyAnswer(g.goal.id, answer, null);
      assert.equal(evaluateGoalContinuation(g.deps, g.userId, g.goal.id, undefined, { userText: `[Goal 用户答复] ${answer}` }).action, "busy");
      for (let index = 0; index < 6; index++) g.store.appendJournal(g.goal.id, null, `Later note ${index}`);
      g.ledger.cancel(busy);

      const enqueued: TurnInput[] = [];
      sweepStaleGoals(g.deps, (_userId, input) => { enqueued.push(input); return "run"; });
      assert.equal(enqueued.length, 1);
      assert.equal(enqueued[0]?.userText, `[Goal 用户答复] ${answer}`);
      assert.equal(enqueued[0]?.goalContinuation, undefined);
    } finally { g.db.close(); }
  });

  it("completes a paused single-run goal after the owner settles every linked item on the board", () => {
    const f = fixture();
    try {
      const projectId = new ProjectRepository(f.db, f.userId).create({ name: "P", path: "/tmp/plan-board", aiTool: "" }).id;
      const store = new CopilotGoalStore(f.db, f.userId);
      const board = new ProjectManagerRepository(f.db, f.userId);
      const goal = store.createGoal({ conversationId: f.conversationId, projectId, title: "G", spec: "S", autoContinue: false });
      const item = board.createWorkItem(projectId, { title: "Accept on board" });
      const [task] = store.addTasks(goal.id, [{ description: item.title, workItemId: item.id }]);
      store.setStatus(goal.id, "paused");
      board.updateWorkItemStatus(projectId, item.id, { status: "in_progress" });
      board.updateWorkItemStatus(projectId, item.id, { status: "ready_for_review" });
      board.updateWorkItemStatus(projectId, item.id, { status: "done", manualCompletionReason: "Reviewed by owner" });
      const deps = { db: f.db, masterKey: "fixture", eventBus: new ForgeBadgerEventBus() };
      const enqueued: TurnInput[] = [];
      const enqueue = (_userId: string, input: TurnInput) => { enqueued.push(input); return "run"; };

      sweepStaleGoals(deps, enqueue);

      assert.equal(store.listTasks(goal.id).find(row => row.id === task?.id)?.status, "passes");
      assert.equal(store.getGoal(goal.id)?.status, "completed");
      assert.equal(enqueued.length, 0);
    } finally { f.db.close(); }
  });

  it("still completes when every task passes", () => {
    const g = goalFixture();
    try {
      for (const task of g.store.listTasks(g.goal.id)) g.store.updateTask(g.goal.id, task.id, "passes", "ok");
      g.settledRun();
      assert.equal(evaluateGoalContinuation(g.deps, g.userId, g.goal.id, () => "r").action, "completed");
    } finally { g.db.close(); }
  });

  it("waits (does not pause) while a dispatched CLI is still running", () => {
    const g = goalFixture();
    try {
      g.settledRun();
      g.db.prepare("UPDATE copilot_goal_tasks SET dispatch_status='running', dispatch_updated_at=? WHERE goal_id=? AND seq=1")
        .run(Date.now(), g.goal.id);
      const projectId = new ProjectRepository(g.db, g.userId).create({ name: "P", path: "/tmp/plan-exec-s", aiTool: "" }).id;
      const session = new SessionRepository(g.db, g.userId).create({
        projectId, name: "cli", aiTool: "claude", workingDir: "/tmp/plan-exec-s", credentialMode: "host_environment" });
      g.db.prepare("UPDATE sessions SET status='running' WHERE id=?").run(session.id);
      g.db.prepare("UPDATE copilot_goal_tasks SET dispatched_session_id=? WHERE goal_id=? AND seq=1").run(session.id, g.goal.id);
      const decision = evaluateGoalContinuation(g.deps, g.userId, g.goal.id, () => "r");
      assert.equal(decision.action, "busy");
      assert.equal(g.store.getGoal(g.goal.id)?.status, "active");
    } finally { g.db.close(); }
  });
});
