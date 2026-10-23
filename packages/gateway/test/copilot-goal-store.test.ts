import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { UserRepository } from "../src/db/repositories/user-repository.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { CopilotGoalStore } from "../src/services/agent/goal-store.js";
import { AgentError } from "../src/services/agent/types.js";
import { goalContextMessage } from "../src/services/agent/goal-context.js";

function fixture() {
  const db = new Database(":memory:");
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");
  migrate(drizzle(db), { migrationsFolder });
  const user = new UserRepository(db).create("goal-store@example.com", "hash");
  const conversation = new CopilotConversationLog(db, user.id).createConversation();
  const store = new CopilotGoalStore(db, user.id);
  return { db, user, conversation, store };
}

function createGoal(store: CopilotGoalStore, conversationId: string, title = "Translate README") {
  return store.createGoal({ conversationId, title, spec: "Translate the README into English" });
}

describe("CopilotGoalStore", () => {
  it("creates a goal and reads it back tenant scoped", () => {
    const { db, conversation, store } = fixture();
    try {
      const goal = createGoal(store, conversation.id);
      assert.equal(goal.status, "active");
      // Legacy budget columns stay populated with defaults; they are not enforced.
      assert.equal(goal.token_budget, 5_000_000);
      assert.equal(goal.max_duration_ms, 28_800_000);
      assert.equal(goal.max_runs, 50);
      assert.equal(goal.conversation_id, conversation.id);
      assert.equal(store.getGoal(goal.id)?.title, "Translate README");
      assert.equal(store.listGoals(conversation.id).length, 1);
      assert.equal(store.listGoals().length, 1);
    } finally { db.close(); }
  });

  it("rejects unknown conversations", () => {
    const { db, store } = fixture();
    try {
      assert.throws(() => store.createGoal({ conversationId: "missing", title: "t", spec: "s" }), (error) => error instanceof AgentError && error.code === "COPILOT_NOT_FOUND");
    } finally { db.close(); }
  });

  it("keeps task sequence numbers continuing across batches", () => {
    const { db, conversation, store } = fixture();
    try {
      const goal = createGoal(store, conversation.id);
      const first = store.addTasks(goal.id, ["Task A", "Task B"]);
      const second = store.addTasks(goal.id, ["Task C"]);
      assert.deepEqual(first.map(t => t.seq), [1, 2]);
      assert.deepEqual(second.map(t => t.seq), [3]);
      assert.deepEqual(store.listTasks(goal.id).map(t => [t.seq, t.status]), [[1, "pending"], [2, "pending"], [3, "pending"]]);
      assert.throws(() => store.addTasks(goal.id, []), (error) => error instanceof AgentError && error.code === "COPILOT_GOAL_INPUT_INVALID");
    } finally { db.close(); }
  });

  it("requires evidence when a task passes and scopes updates to the goal", () => {
    const { db, conversation, store } = fixture();
    try {
      const goal = createGoal(store, conversation.id);
      const [task] = store.addTasks(goal.id, ["Task A"]);
      assert.throws(() => store.updateTask(goal.id, task.id, "passes"), (error) => error instanceof AgentError && error.code === "COPILOT_GOAL_EVIDENCE_REQUIRED");
      const updated = store.updateTask(goal.id, task.id, "passes", "README.md now contains the English section");
      assert.equal(updated?.status, "passes");
      assert.equal(updated?.evidence, "README.md now contains the English section");
      assert.throws(() => store.updateTask(goal.id, "not-a-task", "in_progress"), (error) => error instanceof AgentError && error.code === "COPILOT_NOT_FOUND");
      const other = createGoal(store, conversation.id, "Other");
      assert.throws(() => store.updateTask(other.id, task.id, "failed"), (error) => error instanceof AgentError && error.code === "COPILOT_NOT_FOUND");
    } finally { db.close(); }
  });

  it("isolates goals, tasks and journal between tenants", () => {
    const { db, user, conversation, store } = fixture();
    try {
      const goal = createGoal(store, conversation.id);
      store.addTasks(goal.id, ["Task A"]);
      store.appendJournal(goal.id, null, "handover note");
      const other = new UserRepository(db).create("goal-store-other@example.com", "hash");
      const otherStore = new CopilotGoalStore(db, other.id);
      assert.equal(otherStore.getGoal(goal.id), undefined);
      assert.equal(otherStore.listGoals().length, 0);
      assert.equal(otherStore.listTasks(goal.id).length, 0);
      assert.equal(otherStore.recentJournal(goal.id).length, 0);
      assert.equal(otherStore.setStatus(goal.id, "paused"), undefined);
      assert.equal(store.getGoal(goal.id)?.status, "active");
      assert.equal(store.listGoals().length, 1);
    } finally { db.close(); }
  });

  it("records journal entries newest first and aggregates task progress in listGoals", () => {
    const { db, conversation, store } = fixture();
    try {
      const goal = createGoal(store, conversation.id);
      const [a, b] = store.addTasks(goal.id, ["Task A", "Task B"]);
      store.updateTask(goal.id, a.id, "passes", "done");
      store.appendJournal(goal.id, "run-1", "first note");
      store.appendJournal(goal.id, "run-2", "second note");
      const journal = store.recentJournal(goal.id);
      assert.deepEqual(journal.map(j => j.note), ["second note", "first note"]);
      const [listed] = store.listGoals(conversation.id);
      assert.equal(listed.task_total, 2);
      assert.equal(listed.task_passes, 1);
      assert.equal(store.listTasks(goal.id).find(t => t.id === b.id)?.status, "pending");
    } finally { db.close(); }
  });

  it("counts settled runs since the last task change for stagnation detection", () => {
    const { db, user, conversation, store } = fixture();
    try {
      const goal = createGoal(store, conversation.id);
      const ledgerRuns = (status: string) => db.prepare(
        "INSERT INTO copilot_runs(id,user_id,conversation_id,status,goal_id,runtime_version,input_json,created_at,updated_at) VALUES(?,?,?,?,?,1,'{}',?,?)")
        .run(crypto.randomUUID(), user.id, conversation.id, status, goal.id, Date.now(), Date.now());
      ledgerRuns("completed");
      ledgerRuns("completed");
      assert.equal(store.countRunsWithoutTaskChange(goal.id), 2);
      const [task] = store.addTasks(goal.id, ["Task A"]);
      store.updateTask(goal.id, task.id, "in_progress");
      assert.equal(store.countRunsWithoutTaskChange(goal.id), 0);
      db.prepare("INSERT INTO copilot_runs(id,user_id,conversation_id,status,goal_id,runtime_version,input_json,created_at,updated_at) VALUES(?,?,?,'failed',?,1,'{}',?,?)")
        .run(crypto.randomUUID(), user.id, conversation.id, goal.id, Date.now() + 10, Date.now() + 10);
      assert.equal(store.countRunsWithoutTaskChange(goal.id), 1);
    } finally { db.close(); }
  });

  it("cascades goal rows with the conversation", () => {
    const { db, user, conversation, store } = fixture();
    db.pragma("foreign_keys = ON");
    try {
      const goal = createGoal(store, conversation.id);
      db.prepare("INSERT INTO copilot_runs(id,user_id,conversation_id,status,goal_id,runtime_version,input_json,started_at,created_at,updated_at) VALUES(?,?,?,'completed',?,1,'{}',?,?,?)")
        .run(crypto.randomUUID(), user.id, conversation.id, goal.id, Date.now(), Date.now(), Date.now());
      // Physical conversation removal cascades goals, tasks and journal.
      db.prepare("DELETE FROM copilot_conversations WHERE id=?").run(conversation.id);
      assert.equal(store.getGoal(goal.id), undefined);
      assert.equal(store.listTasks(goal.id).length, 0);
      assert.equal(store.recentJournal(goal.id).length, 0);
    } finally { db.close(); }
  });

  it("bounds the injected goal context: clipped spec/evidence and a task cap (P1-6)", () => {
    const { db, user, conversation, store } = fixture();
    try {
      const longSpec = "s".repeat(10_000);
      const goal = store.createGoal({ conversationId: conversation.id, title: "Bounded", spec: longSpec });
      const descriptions = Array.from({ length: 40 }, (_, index) => `Task ${index}`);
      const tasks = store.addTasks(goal.id, descriptions);
      store.updateTask(goal.id, tasks[0]!.id, "passes", "e".repeat(5000));
      const message = goalContextMessage(db, user.id, goal.id)!;
      // The projection is a bounded JSON document, not the raw state.
      assert.ok(Buffer.byteLength(message) < 20_000, `projection too large: ${Buffer.byteLength(message)}`);
      assert.equal(message.includes("more chars"), true);
      assert.equal(message.includes("10 more tasks"), true);
      assert.equal(JSON.stringify(message).length < 25_000, true);
    } finally { db.close(); }
  });

  it("detects an active run in the goal conversation", () => {
    const { db, user, conversation, store } = fixture();
    try {
      const goal = createGoal(store, conversation.id);
      assert.equal(store.hasActiveRun(goal.conversation_id), false);
      db.prepare("INSERT INTO copilot_runs(id,user_id,conversation_id,status,runtime_version,input_json,created_at,updated_at) VALUES(?,?,?,'pending',1,'{}',?,?)")
        .run(crypto.randomUUID(), user.id, conversation.id, Date.now(), Date.now());
      assert.equal(store.hasActiveRun(goal.conversation_id), true);
    } finally { db.close(); }
  });
});
