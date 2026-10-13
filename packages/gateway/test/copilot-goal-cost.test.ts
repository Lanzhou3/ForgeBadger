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

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");
  migrate(drizzle(db), { migrationsFolder });
  return db;
}

function fixture() {
  const db = createTestDb();
  const user = new UserRepository(db).create("goal-cost@example.com", "hash");
  const conversation = new CopilotConversationLog(db, user.id).createConversation();
  const store = new CopilotGoalStore(db, user.id);
  const goal = store.createGoal({ conversationId: conversation.id, title: "Cost goal", spec: "s" });
  const runId = randomUUID();
  db.prepare(`INSERT INTO copilot_runs(id,user_id,conversation_id,status,goal_id,runtime_version,input_json,created_at,updated_at)
    VALUES(?,?,?,'completed',?,1,'{}',?,?)`).run(runId, user.id, conversation.id, goal.id, Date.now(), Date.now());
  const insertCall = (charged: number, costNanoUsd: number | null, usageJson: string | null) =>
    db.prepare(`INSERT INTO copilot_model_calls(id,user_id,run_id,kind,charged_tokens,usage_json,cost_nanousd,created_at,completed_at)
      VALUES(?,?,?,'model',?,?,?,?,?)`)
      .run(randomUUID(), user.id, runId, charged, usageJson, costNanoUsd, Date.now(), Date.now());
  return { db, userId: user.id, goalId: goal.id, insertCall };
}

describe("goal usage costUsd aggregation", () => {
  it("sums priced model calls into costUsd", () => {
    const { db, userId, goalId, insertCall } = fixture();
    try {
      insertCall(1000, 1_500_000_000, JSON.stringify({ inputTokens: 600, outputTokens: 400 })); // $1.50
      insertCall(500, 250_000_000, JSON.stringify({ inputTokens: 300, outputTokens: 200 }));   // $0.25
      const usage = new CopilotGoalStore(db, userId).usage(goalId);
      assert.equal(usage.chargedTokens, 1500);
      assert.equal(usage.costUsd, 1.75);
    } finally { db.close(); }
  });

  it("returns null when any call lacks pricing", () => {
    const { db, userId, goalId, insertCall } = fixture();
    try {
      insertCall(1000, 1_500_000_000, JSON.stringify({ inputTokens: 600, outputTokens: 400 }));
      insertCall(500, null, null); // reservation/estimate without provider usage or rates
      const usage = new CopilotGoalStore(db, userId).usage(goalId);
      assert.equal(usage.chargedTokens, 1500);
      assert.equal(usage.costUsd, null);
    } finally { db.close(); }
  });

  it("aggregates to zero for goals with no model calls at all", () => {
    const { db, userId, goalId } = fixture();
    try {
      const usage = new CopilotGoalStore(db, userId).usage(goalId);
      assert.equal(usage.chargedTokens, 0);
      assert.equal(usage.costUsd, 0);
    } finally { db.close(); }
  });

  it("exposes costUsd through the goal detail usage shape together with token totals", () => {
    const { db, userId, goalId, insertCall } = fixture();
    try {
      insertCall(2000, 3_000_000_000, JSON.stringify({ inputTokens: 1200, outputTokens: 800 }));
      const usage = new CopilotGoalStore(db, userId).usage(goalId);
      assert.deepEqual(Object.keys(usage).sort(), ["chargedTokens", "costUsd", "elapsedMs", "runCount", "startedAt"]);
      assert.equal(usage.costUsd, 3);
      assert.equal(usage.runCount, 1);
    } finally { db.close(); }
  });
});
