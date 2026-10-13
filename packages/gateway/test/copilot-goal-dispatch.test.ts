import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { z } from "zod";

import { UserRepository } from "../src/db/repositories/user-repository.js";
import { SessionRepository } from "../src/db/repositories/session-repository.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { CopilotGoalStore } from "../src/services/agent/goal-store.js";
import { AgentError } from "../src/services/agent/types.js";
import { createGoalDelegateTools } from "../src/services/agent/tools/goal-delegate.js";
import { createCopilotOrchestrator } from "../src/services/agent/orchestrator.js";
import type { AgentLlmClient, AgentLlmStreamEvent } from "../src/services/agent/orchestrator-types.js";
import { createAgentToolRegistry } from "../src/services/agent/tool-registry.js";
import { ForgeBadgerEventBus } from "../src/services/event-bus.js";
import type { AgentToolContext } from "../src/services/agent/tool-registry.js";

const masterKey = "abcdef0123456789abcdef0123456789";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");
  migrate(drizzle(db), { migrationsFolder });
  return db;
}

interface DispatchFixture {
  db: Database.Database;
  userId: string;
  goalId: string;
  taskId: string;
  verifyTaskId: string;
  projectDir: string;
  tool: { execute(input: unknown, context: AgentToolContext): Promise<unknown> };
  context: AgentToolContext;
  store: CopilotGoalStore;
  sessionManager: Record<string, unknown>;
}

function dispatchFixture(): DispatchFixture {
  const db = createTestDb();
  const user = new UserRepository(db).create("goal-dispatch@example.com", "hash");
  const conversation = new CopilotConversationLog(db, user.id).createConversation();
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-goal-dispatch-project-"));
  const projectId = randomUUID();
  db.prepare("INSERT INTO projects(id,user_id,name,path,ai_tool,status) VALUES(?,?,?,?,?,?)")
    .run(projectId, user.id, "dispatch-project", projectDir, "claude", "active");
  const store = new CopilotGoalStore(db, user.id);
  const goalId = store.createGoal({ conversationId: conversation.id, projectId, title: "Dispatch goal", spec: "s" }).id;
  const [task] = store.addTasks(goalId, ["Dispatch task"]);
  const [verifyTask] = store.addTasks(goalId, [{ description: "Verified dispatch task", verifyCommand: "make check" }]);
  const runId = randomUUID();
  db.prepare(`INSERT INTO copilot_runs(id,user_id,conversation_id,status,goal_id,runtime_version,input_json,created_at,updated_at)
    VALUES(?,?,?,'running',?,1,'{}',?,?)`).run(runId, user.id, conversation.id, goalId, Date.now(), Date.now());
  const tool = createGoalDelegateTools().find(entry => entry.name === "goal_dispatch_task")!;
  // Minimal fake for the programmatic-terminal-submit confirmation loop:
  // the staged pane carries the needle in the claude composer line; the
  // capture shows the composer empty afterwards (needle consumed by Enter).
  const sessionManager: Record<string, unknown> = {
    async createSession(input: { sessionId: string }) {
      return { runtimeSessionName: `rt-${input.sessionId}`, attachToken: randomUUID() };
    },
    async submitProgrammaticTask(_sessionId: string, options: { adapter: string; message: string }) {
      const needle = options.message.slice(0, 12);
      return { adapter: options.adapter, stagedPane: `❯ ${options.message}\n`, needle };
    },
    async captureHistory() {
      return "some output\n────────────\n❯ \n";
    }
  };
  return {
    db, userId: user.id, goalId, taskId: task.id, verifyTaskId: verifyTask.id,
    projectDir, tool, store,
    context: { db, userId: user.id, masterKey: "k", runId, sessionManager } as AgentToolContext,
    sessionManager
  };
}

describe("goal_dispatch_task", () => {
  const dbs: Database.Database[] = [];
  function tracked(fixture: DispatchFixture) { dbs.push(fixture.db); return fixture; }

  after(() => {
    delete process.env.FORGEBADGER_CLI_AUTONOMY_ADAPTERS;
    for (const db of dbs) if (db.open) db.close();
  });

  it("refuses adapters outside FORGEBADGER_CLI_AUTONOMY_ADAPTERS", async () => {
    process.env.FORGEBADGER_CLI_AUTONOMY_ADAPTERS = "kimi";
    const fixture = tracked(dispatchFixture());
    await assert.rejects(
      fixture.tool.execute({ taskId: fixture.taskId, aiTool: "claude", instructions: "do it" }, fixture.context),
      (error: unknown) => error instanceof AgentError && error.code === "COPILOT_ADAPTER_AUTONOMY_DENIED");
  });

  it("creates a session, dispatches with delivery confirmation and records the task link", async () => {
    process.env.FORGEBADGER_CLI_AUTONOMY_ADAPTERS = "claude,kimi";
    const fixture = tracked(dispatchFixture());
    const result = await fixture.tool.execute(
      { taskId: fixture.taskId, aiTool: "claude", instructions: "implement the parser" }, fixture.context) as
      { dispatched: boolean; sessionId: string; delivery: string; sessionCreated: boolean; adapter: string };
    assert.equal(result.dispatched, true);
    assert.equal(result.delivery, "consumed");
    assert.equal(result.sessionCreated, true);
    assert.equal(result.adapter, "claude");
    const task = fixture.store.listTasks(fixture.goalId).find(entry => entry.id === fixture.taskId)!;
    assert.equal(task.dispatched_session_id, result.sessionId);
    assert.ok(fixture.store.recentJournal(fixture.goalId).some(entry => entry.note.includes("Dispatched task")));
    const session = fixture.db.prepare("SELECT status, ai_tool FROM sessions WHERE id=?").get(result.sessionId) as { status: string; ai_tool: string };
    assert.equal(session.status, "running");
    assert.equal(session.ai_tool, "claude");
  });

  it("creates a dedicated session per dispatch (never an owner-interactive one)", async () => {
    process.env.FORGEBADGER_CLI_AUTONOMY_ADAPTERS = "claude";
    const fixture = tracked(dispatchFixture());
    // An owner-interactive running session already exists for the project.
    new SessionRepository(fixture.db, fixture.userId).create({
      projectId: (fixture.db.prepare("SELECT project_id FROM copilot_goals WHERE id=?").get(fixture.goalId) as { project_id: string }).project_id,
      name: "owner session", aiTool: "claude", workingDir: fixture.projectDir, credentialMode: "host_environment"
    });
    const first = await fixture.tool.execute(
      { taskId: fixture.taskId, aiTool: "claude", instructions: "first" }, fixture.context) as { sessionId: string; sessionCreated: boolean };
    const second = await fixture.tool.execute(
      { taskId: fixture.taskId, aiTool: "claude", instructions: "second" }, fixture.context) as { sessionId: string; sessionCreated: boolean };
    assert.equal(first.sessionCreated, true);
    assert.equal(second.sessionCreated, true);
    assert.notEqual(second.sessionId, first.sessionId);
    const ownerSession = fixture.db.prepare("SELECT id FROM sessions WHERE user_id=? AND name='owner session'").get(fixture.userId) as { id: string };
    assert.notEqual(first.sessionId, ownerSession.id);
    assert.notEqual(second.sessionId, ownerSession.id);
  });

  it("dispatch does not satisfy the verify gate", async () => {
    process.env.FORGEBADGER_CLI_AUTONOMY_ADAPTERS = "claude";
    const fixture = tracked(dispatchFixture());
    await fixture.tool.execute(
      { taskId: fixture.verifyTaskId, aiTool: "claude", instructions: "run the checks" }, fixture.context);
    assert.throws(() => fixture.store.updateTask(fixture.goalId, fixture.verifyTaskId, "passes"),
      (error: unknown) => error instanceof AgentError && error.code === "COPILOT_GOAL_VERIFY_REQUIRED");
  });

  it("routes through the approval gate: no grant waits, pm_dispatch grant auto-executes", async () => {
    process.env.FORGEBADGER_CLI_AUTONOMY_ADAPTERS = "claude";
    // Without grant: the run parks at awaiting_approval before executing.
    const without = tracked(dispatchFixture());
    without.db.prepare("UPDATE copilot_runs SET status='completed', completed_at=? WHERE user_id=? AND goal_id=?")
      .run(Date.now(), without.userId, without.goalId);
    const registry = createAgentToolRegistry(createGoalDelegateTools());
    const llm = (toolArgs: string): AgentLlmClient => {
      let calls = 0;
      return {
        async stream(request) {
          calls += 1;
          const emit = request.onEvent as (event: AgentLlmStreamEvent) => void;
          if (calls === 1) {
            emit({ type: "tool_call", toolCall: { id: "d-1", name: "goal_dispatch_task", arguments: toolArgs } });
            return { message: "" };
          }
          return { message: "done" };
        },
        async summarize() { return ""; },
        async generateTitle() { return ""; }
      };
    };
    const orchestratorWithout = createCopilotOrchestrator({
      db: without.db, masterKey, toolRegistry: registry,
      llm: llm(JSON.stringify({ taskId: without.taskId, aiTool: "claude", instructions: "go" })),
      eventBus: new ForgeBadgerEventBus()
    });
    const runIdWithout = await orchestratorWithout.enqueue({
      userId: without.userId, conversationId: (without.db.prepare("SELECT conversation_id FROM copilot_goals WHERE id=?").get(without.goalId) as { conversation_id: string }).conversation_id,
      userText: "dispatch", source: "user", clientRequestId: randomUUID(), goalId: without.goalId
    });
    await new Promise(resolve => setImmediate(resolve));
    await orchestratorWithout.executeRun(without.userId, runIdWithout);
    assert.equal(new CopilotConversationLog(without.db, without.userId).getRun(runIdWithout)?.status, "awaiting_approval");
    assert.equal(without.store.listTasks(without.goalId).find(entry => entry.id === without.taskId)?.dispatched_session_id, null);

    // With the pm_dispatch grant: auto-approved and executed end to end.
    const withGrant = tracked(dispatchFixture());
    withGrant.db.prepare("UPDATE copilot_runs SET status='completed', completed_at=? WHERE user_id=? AND goal_id=?")
      .run(Date.now(), withGrant.userId, withGrant.goalId);
    withGrant.db.prepare("UPDATE copilot_goals SET grants_json=? WHERE id=?").run(JSON.stringify(["pm_dispatch"]), withGrant.goalId);
    const orchestratorWith = createCopilotOrchestrator({
      db: withGrant.db, masterKey, toolRegistry: registry,
      llm: llm(JSON.stringify({ taskId: withGrant.taskId, aiTool: "claude", instructions: "go" })),
      eventBus: new ForgeBadgerEventBus(),
      sessionManager: withGrant.sessionManager as never
    });
    const conversationId = (withGrant.db.prepare("SELECT conversation_id FROM copilot_goals WHERE id=?").get(withGrant.goalId) as { conversation_id: string }).conversation_id;
    const runIdWith = await orchestratorWith.enqueue({
      userId: withGrant.userId, conversationId, userText: "dispatch", source: "user", clientRequestId: randomUUID(), goalId: withGrant.goalId
    });
    await new Promise(resolve => setImmediate(resolve));
    await orchestratorWith.executeRun(withGrant.userId, runIdWith);
    assert.equal(new CopilotConversationLog(withGrant.db, withGrant.userId).getRun(runIdWith)?.status, "completed");
    assert.ok(withGrant.store.listTasks(withGrant.goalId).find(entry => entry.id === withGrant.taskId)?.dispatched_session_id);
    assert.ok(withGrant.store.recentJournal(withGrant.goalId).some(entry => entry.note.includes("自动执行 goal_dispatch_task")));
  });

  it("is registered as an operate-risk, approval-gated tool", () => {
    const tool = createGoalDelegateTools().find(entry => entry.name === "goal_dispatch_task")!;
    assert.equal(tool.risk, "operate");
    assert.equal(tool.requiresApproval, true);
    assert.equal(tool.inputSchema instanceof z.ZodType, true);
  });
});
