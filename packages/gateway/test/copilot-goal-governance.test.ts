import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { UserRepository } from "../src/db/repositories/user-repository.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { CopilotGoalStore } from "../src/services/agent/goal-store.js";
import { RunGovernance } from "../src/services/agent/run-governance.js";
import { AgentError } from "../src/services/agent/types.js";

function createFixture(budgets?: { tokenBudget?: number; maxDurationMs?: number; maxRuns?: number }) {
  const db = new Database(":memory:");
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");
  migrate(drizzle(db), { migrationsFolder });
  const user = new UserRepository(db).create("goal-governance@example.com", "hash");
  const conversation = new CopilotConversationLog(db, user.id).createConversation();
  const store = new CopilotGoalStore(db, user.id);
  const goal = store.createGoal({ conversationId: conversation.id, title: "Governed goal", spec: "spec", ...(budgets ? { budgets } : {}) });
  const runUuid = randomUUID();
  db.prepare(`INSERT INTO copilot_runs(id,user_id,conversation_id,status,goal_id,runtime_version,input_json,created_at,updated_at)
    VALUES(?,?,?,'completed',?,1,'{}',?,?)`)
    .run(runUuid, user.id, conversation.id, goal.id, Date.now(), Date.now());
  return { db, userId: user.id, conversationId: conversation.id, goalId: goal.id, store, runId: runUuid };
}

function chargeTokens(db: Database.Database, userId: string, runId: string, tokens: number): void {
  db.prepare("INSERT INTO copilot_model_calls(id,user_id,run_id,kind,charged_tokens,created_at) VALUES(?,?,?,'model',?,?)")
    .run(randomUUID(), userId, runId, tokens, Date.now());
}

function expectGoalBudgetExhausted(db: Database.Database, userId: string, runId: string): void {
  assert.throws(() => new RunGovernance(db, userId, runId).check(),
    (error) => error instanceof AgentError && error.code === "COPILOT_GOAL_BUDGET_EXHAUSTED");
}

describe("RunGovernance goal-level budgets", () => {
  it("throws COPILOT_GOAL_BUDGET_EXHAUSTED when the goal token budget is spent", () => {
    const fixture = createFixture({ tokenBudget: 1000 });
    try {
      chargeTokens(fixture.db, fixture.userId, fixture.runId, 1200);
      expectGoalBudgetExhausted(fixture.db, fixture.userId, fixture.runId);
    } finally { fixture.db.close(); }
  });

  it("throws when the goal lifetime exceeds maxDurationMs", () => {
    const fixture = createFixture({ maxDurationMs: 60_000 });
    try {
      const past = Date.now() - 120_000;
      fixture.db.prepare("UPDATE copilot_runs SET started_at=?, created_at=? WHERE id=?").run(past, past, fixture.runId);
      fixture.db.prepare("UPDATE copilot_goals SET created_at=? WHERE id=?").run(past, fixture.goalId);
      expectGoalBudgetExhausted(fixture.db, fixture.userId, fixture.runId);
    } finally { fixture.db.close(); }
  });

  it("throws when the goal run count reaches maxRuns", () => {
    const fixture = createFixture({ maxRuns: 2 });
    try {
      for (let index = 0; index < 2; index += 1)
        fixture.db.prepare(`INSERT INTO copilot_runs(id,user_id,conversation_id,status,goal_id,runtime_version,input_json,created_at,updated_at)
          VALUES(?,?,?,'completed',?,1,'{}',?,?)`)
          .run(randomUUID(), fixture.userId, fixture.conversationId, fixture.goalId, Date.now(), Date.now());
      expectGoalBudgetExhausted(fixture.db, fixture.userId, fixture.runId);
    } finally { fixture.db.close(); }
  });

  it("passes goal runs inside budget and leaves non-goal runs untouched", () => {
    const fixture = createFixture({ tokenBudget: 1000 });
    try {
      chargeTokens(fixture.db, fixture.userId, fixture.runId, 500);
      new RunGovernance(fixture.db, fixture.userId, fixture.runId).check();
      const plainRun = randomUUID();
      fixture.db.prepare(`INSERT INTO copilot_runs(id,user_id,conversation_id,status,runtime_version,input_json,created_at,updated_at)
        VALUES(?,?,?,'running',1,'{}',?,?)`)
        .run(plainRun, fixture.userId, fixture.conversationId, Date.now(), Date.now());
      new RunGovernance(fixture.db, fixture.userId, plainRun).check();
    } finally { fixture.db.close(); }
  });

  it("keeps per-run budgets unchanged for goal runs", () => {
    const fixture = createFixture({ tokenBudget: 5_000_000 });
    try {
      // One huge reservation trips the per-run token budget first: the
      // per-run ceiling is still enforced independently of goal ceilings.
      assert.throws(() => new RunGovernance(fixture.db, fixture.userId, fixture.runId).check(600_000),
        (error) => error instanceof AgentError && error.code === "COPILOT_TOKEN_BUDGET");
    } finally { fixture.db.close(); }
  });
});
