import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { UserRepository } from "../src/db/repositories/user-repository.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { attachGoalDriver, evaluateGoalContinuation, type GoalDriver } from "../src/services/agent/goal-driver.js";
import { CopilotGoalStore } from "../src/services/agent/goal-store.js";
import { createCopilotOrchestrator } from "../src/services/agent/orchestrator.js";
import type { AgentLlmClient } from "../src/services/agent/orchestrator-types.js";
import { createAgentToolRegistry } from "../src/services/agent/tool-registry.js";
import { ForgeBadgerEventBus } from "../src/services/event-bus.js";

const masterKey = "abcdef0123456789abcdef0123456789";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");
  migrate(drizzle(db), { migrationsFolder });
  return db;
}

function textOnlyLlm(): AgentLlmClient {
  return {
    async stream() { return { message: "run output" }; },
    async summarize() { return ""; },
    async generateTitle() { return ""; }
  };
}

async function waitFor(predicate: () => boolean, description: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) assert.fail(`timed out waiting for: ${description}`);
    await delay(20);
  }
}

interface DriverFixture {
  db: Database.Database;
  userId: string;
  conversationId: string;
  goalId: string;
  store: CopilotGoalStore;
  orchestrator: ReturnType<typeof createCopilotOrchestrator>;
  driver: GoalDriver;
  runCount: () => number;
}

function driverFixture(): DriverFixture {
  const db = createTestDb();
  const user = new UserRepository(db).create("goal-driver@example.com", "hash");
  const log = new CopilotConversationLog(db, user.id);
  const conversation = log.createConversation();
  const eventBus = new ForgeBadgerEventBus();
  const store = new CopilotGoalStore(db, user.id);
  const orchestrator = createCopilotOrchestrator({
    db, masterKey,
    toolRegistry: createAgentToolRegistry([]),
    llm: textOnlyLlm(),
    eventBus,
    maxSteps: 4
  });
  const deps = { db, masterKey, eventBus };
  const driver = attachGoalDriver(deps, { minIntervalMs: 10, enqueue: (_userId, input) => orchestrator.enqueue(input) });
  return {
    db, userId: user.id, conversationId: conversation.id, store,
    goalId: store.createGoal({ conversationId: conversation.id, title: "Translate README", spec: "Translate the README" }).id,
    orchestrator, driver,
    runCount: () => log.listRuns(conversation.id).length
  };
}

function enqueueInitial(fixture: DriverFixture): string {
  return fixture.orchestrator.enqueue({
    userId: fixture.userId,
    conversationId: fixture.conversationId,
    goalId: fixture.goalId,
    userText: "start the goal",
    source: "user",
    clientRequestId: randomUUID()
  });
}

describe("GoalDriver continuation", () => {
  it("enqueues the next run after a terminal run and stops when the goal is cancelled", async () => {
    const fixture = driverFixture();
    try {
      fixture.store.addTasks(fixture.goalId, ["Task A"]);
      const firstRun = enqueueInitial(fixture);
      await fixture.orchestrator.executeRun(fixture.userId, firstRun);
      await waitFor(() => fixture.runCount() >= 2, "a continuation run to be enqueued");
      assert.equal(fixture.runCount() >= 2, true);
      fixture.store.setStatus(fixture.goalId, "cancelled");
      const frozen = fixture.runCount();
      await delay(150);
      assert.equal(fixture.runCount(), frozen);
    } finally { fixture.driver.stop(); fixture.db.close(); }
  });

  it("completes the goal when every task passes and records a closing journal entry", async () => {
    const fixture = driverFixture();
    try {
      const [a, b] = fixture.store.addTasks(fixture.goalId, ["Task A", "Task B"]);
      fixture.store.updateTask(fixture.goalId, a.id, "passes", "evidence A");
      fixture.store.updateTask(fixture.goalId, b.id, "passes", "evidence B");
      const firstRun = enqueueInitial(fixture);
      await fixture.orchestrator.executeRun(fixture.userId, firstRun);
      await waitFor(() => fixture.store.getGoal(fixture.goalId)?.status === "completed", "goal to complete");
      assert.equal(fixture.runCount(), 1);
      assert.ok(fixture.store.recentJournal(fixture.goalId).some(entry => entry.note.includes("All tasks passed")));
    } finally { fixture.driver.stop(); fixture.db.close(); }
  });

  it("blocks the goal after three settled runs without a task status change", async () => {
    const fixture = driverFixture();
    try {
      const firstRun = enqueueInitial(fixture);
      await fixture.orchestrator.executeRun(fixture.userId, firstRun);
      await waitFor(() => fixture.store.getGoal(fixture.goalId)?.status === "blocked", "goal to block on stagnation");
      assert.equal(fixture.store.getGoal(fixture.goalId)?.blocked_reason, "no_task_progress");
      await delay(150);
      assert.equal(fixture.runCount(), 3);
    } finally { fixture.driver.stop(); fixture.db.close(); }
  });

  it("does not continue a paused goal", async () => {
    const fixture = driverFixture();
    try {
      fixture.store.setStatus(fixture.goalId, "paused");
      const firstRun = enqueueInitial(fixture);
      await fixture.orchestrator.executeRun(fixture.userId, firstRun);
      await delay(150);
      assert.equal(fixture.runCount(), 1);
      assert.equal(fixture.store.getGoal(fixture.goalId)?.status, "paused");
    } finally { fixture.driver.stop(); fixture.db.close(); }
  });

  it("does not re-enter a busy conversation and never calls enqueue", () => {
    const fixture = driverFixture();
    try {
      fixture.db.prepare("INSERT INTO copilot_runs(id,user_id,conversation_id,status,runtime_version,input_json,created_at,updated_at) VALUES(?,?,?,'pending',1,'{}',?,?)")
        .run(randomUUID(), fixture.userId, fixture.conversationId, Date.now(), Date.now());
      let enqueueCalls = 0;
      const decision = evaluateGoalContinuation({ db: fixture.db, masterKey, eventBus: new ForgeBadgerEventBus() },
        fixture.userId, fixture.goalId, () => { enqueueCalls += 1; return "run-x"; });
      assert.equal(decision.action, "busy");
      assert.equal(enqueueCalls, 0);
    } finally { fixture.driver.stop(); fixture.db.close(); }
  });

  it("excludes delegate/research sub-runs from stagnation and prefers busy over blocking (P1-4)", () => {
    const fixture = driverFixture();
    try {
      const childRun = (status: string, inputJson: string) => fixture.db.prepare(`INSERT INTO copilot_runs
        (id,user_id,conversation_id,status,goal_id,runtime_version,input_json,created_at,updated_at)
        VALUES(?,?,? ,?,?,1,?, ?,?)`.replace("? ,", "?,").replace("?, ?", "?,?"))
        .run(randomUUID(), fixture.userId, fixture.conversationId, status, fixture.goalId, inputJson, Date.now(), Date.now());
      for (let index = 0; index < 3; index += 1)
        childRun("completed", JSON.stringify({ executionMode: "coding", parentRunId: "parent-1" }));
      const store = new CopilotGoalStore(fixture.db, fixture.userId);
      assert.equal(store.countRunsWithoutTaskChange(fixture.goalId), 0);
      // Busy check comes first: an active goal run blocks evaluation even
      // with stagnation-level settled parent runs.
      for (let index = 0; index < 3; index += 1)
        childRun("completed", "{}");
      assert.equal(store.countRunsWithoutTaskChange(fixture.goalId), 3);
      fixture.db.prepare(`INSERT INTO copilot_runs(id,user_id,conversation_id,status,goal_id,runtime_version,input_json,created_at,updated_at)
        VALUES(?,?,?,'running',?,1,'{}',?,?)`).run(randomUUID(), fixture.userId, fixture.conversationId, fixture.goalId, Date.now(), Date.now());
      const decision = evaluateGoalContinuation({ db: fixture.db, masterKey, eventBus: new ForgeBadgerEventBus() },
        fixture.userId, fixture.goalId, () => "run-x");
      assert.equal(decision.action, "busy");
      assert.equal(store.getGoal(fixture.goalId)?.status, "active");
    } finally { fixture.driver.stop(); fixture.db.close(); }
  });

  it("blocks on non-retryable run failures instead of retrying (P1-6)", () => {
    const fixture = driverFixture();
    try {
      fixture.db.prepare(`INSERT INTO copilot_runs(id,user_id,conversation_id,status,goal_id,stop_reason,runtime_version,input_json,created_at,updated_at)
        VALUES(?,?,?,'failed',?,'COPILOT_CONTEXT_TOO_LARGE',1,'{}',?,?)`)
        .run(randomUUID(), fixture.userId, fixture.conversationId, fixture.goalId, Date.now(), Date.now());
      const decision = evaluateGoalContinuation({ db: fixture.db, masterKey, eventBus: new ForgeBadgerEventBus() },
        fixture.userId, fixture.goalId, () => assert.fail("enqueue must not be called"));
      assert.equal(decision.action, "blocked");
      assert.equal(decision.reason, "unrecoverable_error:COPILOT_CONTEXT_TOO_LARGE");
      const store = new CopilotGoalStore(fixture.db, fixture.userId);
      assert.equal(store.getGoal(fixture.goalId)?.blocked_reason, "unrecoverable_error:COPILOT_CONTEXT_TOO_LARGE");
      assert.ok(store.recentJournal(fixture.goalId).some(entry => entry.note.includes("COPILOT_CONTEXT_TOO_LARGE")));
    } finally { fixture.driver.stop(); fixture.db.close(); }
  });

  it("cools down repeated same-cause failures exponentially (P2-16)", () => {
    const fixture = driverFixture();
    try {
      const insertFailure = () => fixture.db.prepare(`INSERT INTO copilot_runs(id,user_id,conversation_id,status,goal_id,stop_reason,runtime_version,input_json,created_at,updated_at)
        VALUES(?,?,?,'failed',?,'PROVIDER_UNAVAILABLE',1,'{}',?,?)`)
        .run(randomUUID(), fixture.userId, fixture.conversationId, fixture.goalId, Date.now(), Date.now());
      const deps = { db: fixture.db, masterKey, eventBus: new ForgeBadgerEventBus() };
      const store = new CopilotGoalStore(fixture.db, fixture.userId);
      // Task activity resets the stagnation counter between cooldown rounds.
      const [resetTask] = store.addTasks(fixture.goalId, ["Reset stagnation"]);
      let createdAt = Date.now();
      insertFailure();
      const first = evaluateGoalContinuation(deps, fixture.userId, fixture.goalId, () => "r1", { now: 1_000_000 });
      assert.equal(first.action, "enqueued"); // cooldown #1 arms but still retries
      insertFailure();
      const cooling = evaluateGoalContinuation(deps, fixture.userId, fixture.goalId, () => assert.fail("no enqueue during cooldown"), { now: 1_000_500 });
      assert.equal(cooling.action, "busy");
      assert.match(cooling.reason ?? "", /failure_cooldown:PROVIDER_UNAVAILABLE/);
      assert.ok(store.recentJournal(fixture.goalId).some(entry => entry.note.includes("failure cooldown #1")));
      const retried = evaluateGoalContinuation(deps, fixture.userId, fixture.goalId, () => "r2", { now: 1_000_500 + 15_001 });
      assert.equal(retried.action, "enqueued");
      store.updateTask(fixture.goalId, resetTask.id, "in_progress");
      insertFailure();
      const second = evaluateGoalContinuation(deps, fixture.userId, fixture.goalId, () => "r3", { now: 1_000_500 + 45_002 });
      assert.equal(second.action, "enqueued");
      assert.ok(store.recentJournal(fixture.goalId).some(entry => entry.note.includes("failure cooldown #2")));
      store.updateTask(fixture.goalId, resetTask.id, "failed");
      insertFailure();
      const cooling2 = evaluateGoalContinuation(deps, fixture.userId, fixture.goalId, () => assert.fail("still cooling"), { now: 1_000_500 + 45_003 });
      assert.equal(cooling2.action, "busy"); // 30s backoff after the second failure
    } finally { fixture.driver.stop(); fixture.db.close(); }
  });

  it("blocks instead of enqueueing when the goal run budget is already exhausted", () => {
    const fixture = driverFixture();
    try {
      fixture.store.setStatus(fixture.goalId, "blocked", "goal_budget_exhausted");
      const decision = evaluateGoalContinuation({ db: fixture.db, masterKey, eventBus: new ForgeBadgerEventBus() },
        fixture.userId, fixture.goalId, () => assert.fail("enqueue must not be called"));
      assert.equal(decision.action, "inactive");
    } finally { fixture.driver.stop(); fixture.db.close(); }
  });
});
