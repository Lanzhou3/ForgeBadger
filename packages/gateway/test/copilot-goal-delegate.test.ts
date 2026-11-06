import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { UserRepository } from "../src/db/repositories/user-repository.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { CopilotGoalStore } from "../src/services/agent/goal-store.js";
import { goalSandboxDir } from "../src/services/agent/goal-sandbox.js";
import { evaluateGoalContinuation } from "../src/services/agent/goal-driver.js";
import { computeToolSurface } from "../src/services/agent/tool-surface.js";
import { createCopilotOrchestrator } from "../src/services/agent/orchestrator.js";
import type { AgentLlmClient, AgentLlmStreamEvent } from "../src/services/agent/orchestrator-types.js";
import { createAgentToolRegistry } from "../src/services/agent/tool-registry.js";
import { createPlatformTools } from "../src/services/agent/tools/index.js";
import { ForgeBadgerEventBus } from "../src/services/event-bus.js";

const masterKey = "abcdef0123456789abcdef0123456789";
const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fb-goal-delegate-state-"));
process.env.FORGEBADGER_STATE_DIR = stateRoot;

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");
  migrate(drizzle(db), { migrationsFolder });
  return db;
}

interface ScriptStep { tool?: { name: string; arguments: unknown }; text?: string }

async function waitForChild(db: Database.Database, userId: string, parentRunId: string): Promise<string | undefined> {
  const deadline = Date.now() + 3000;
  for (;;) {
    const row = db.prepare(`SELECT child_run_id FROM copilot_research_jobs WHERE user_id=? AND origin_run_id=?`)
      .get(userId, parentRunId) as { child_run_id: string } | undefined;
    if (row) return row.child_run_id;
    if (Date.now() > deadline) return undefined;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

/** Deterministic LLM: executes the script step by step (shared by parent and child runs). */
function scriptedLlm(steps: ScriptStep[]): AgentLlmClient {
  let index = 0;
  return {
    async stream(request) {
      const step = steps[Math.min(index, steps.length - 1)]!;
      index += 1;
      const emit = request.onEvent as (event: AgentLlmStreamEvent) => void;
      if (step.tool) {
        emit({ type: "tool_call", toolCall: { id: `call-${index}`, name: step.tool.name, arguments: JSON.stringify(step.tool.arguments) } });
        return { message: "" };
      }
      return { message: step.text ?? "" };
    },
    async summarize() { return ""; },
    async generateTitle() { return ""; }
  };
}

interface DelegateFixture {
  db: Database.Database;
  userId: string;
  conversationId: string;
  goalId: string;
  taskId: string;
  otherTaskId: string;
  projectDir: string;
  sandboxDir: string;
  orchestrator: ReturnType<typeof createCopilotOrchestrator>;
  log: CopilotConversationLog;
  driveParent(): Promise<string>;
}

interface DelegateIds { taskId: string; otherTaskId: string }

function delegateFixture(steps: ScriptStep[] | ((ids: DelegateIds) => ScriptStep[]), grants?: string[]): DelegateFixture {
  const db = createTestDb();
  const user = new UserRepository(db).create("goal-delegate@example.com", "hash");
  const log = new CopilotConversationLog(db, user.id);
  const conversation = log.createConversation();
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-goal-delegate-project-"));
  fs.writeFileSync(path.join(projectDir, "app.txt"), "original\n");
  const projectId = crypto.randomUUID();
  db.prepare("INSERT INTO projects(id,user_id,name,path,ai_tool,status) VALUES(?,?,?,?,?,?)")
    .run(projectId, user.id, "delegate-project", projectDir, "claude", "active");
  const store = new CopilotGoalStore(db, user.id);
  const goalId = store.createGoal({ conversationId: conversation.id, projectId, title: "Delegate goal", spec: "delegate the work", ...(grants ? { grants } : {}) }).id;
  const [task] = store.addTasks(goalId, [{ description: "Delegated task", verifyCommand: "true" }]);
  const [other] = store.addTasks(goalId, ["Other task"]);
  const script = typeof steps === "function" ? steps({ taskId: task.id, otherTaskId: other.id }) : steps;
  const orchestrator = createCopilotOrchestrator({
    db, masterKey,
    toolRegistry: createAgentToolRegistry(createPlatformTools()),
    llm: scriptedLlm(script),
    eventBus: new ForgeBadgerEventBus()
  });
  return {
    db, userId: user.id, conversationId: conversation.id, goalId, taskId: task.id, otherTaskId: other.id,
    projectDir, sandboxDir: goalSandboxDir(db, goalId), orchestrator, log,
    async driveParent() {
      return orchestrator.runTurn({
        userId: user.id, conversationId: conversation.id, userText: "delegate it",
        source: "user", clientRequestId: crypto.randomUUID(), goalId
      });
    }
  };
}

function checkStepResult(fixture: DelegateFixture, runId: string): string {
  const row = fixture.db.prepare("SELECT result_json FROM copilot_run_steps WHERE user_id=? AND run_id=? AND tool_name='goal_run_checks'")
    .get(fixture.userId, runId) as { result_json: string | null } | undefined;
  return row?.result_json ?? "";
}

describe("goal_delegate coding sub-run", () => {
  const dbs: Database.Database[] = [];
  function tracked(fixture: DelegateFixture) { dbs.push(fixture.db); return fixture; }

  after(() => { for (const db of dbs) if (db.open) db.close(); fs.rmSync(stateRoot, { recursive: true, force: true }); });

  it("runs a write-capable child inside the sandbox and returns the report to the parent", async () => {
    const fixture2 = tracked(delegateFixture((ids) => [
      { tool: { name: "goal_delegate", arguments: { taskId: ids.taskId, instructions: "Write delegated.txt with the fix" } } },
      { tool: { name: "goal_file_write", arguments: { path: "delegated.txt", content: "fixed by delegate\n" } } },
      { text: "delegate report: wrote delegated.txt" },
      { text: "parent acknowledged" }
    ]));
    const parentRunId = await fixture2.driveParent();

    const parent = fixture2.log.getRun(parentRunId)!;
    assert.equal(parent.status, "completed");
    // Result flows back into the parent's tool_result.
    const parentMessages = fixture2.log.listMessages(fixture2.conversationId);
    const toolResult = parentMessages.find(message => message.kind === "tool_result" && message.toolName === "goal_delegate");
    assert.ok(toolResult);
    assert.match(toolResult.content, /delegate report: wrote delegated\.txt/);

    // The child run: coding mode, goal-bound, linked for audit.
    const child = fixture2.db.prepare(`SELECT r.* FROM copilot_runs r JOIN copilot_research_jobs j ON j.child_run_id=r.id AND j.user_id=r.user_id
      WHERE r.user_id=? AND j.origin_run_id=?`).get(fixture2.userId, parentRunId) as Record<string, unknown> | undefined;
    assert.ok(child);
    const childInput = JSON.parse(child.input_json as string) as { executionMode?: string; parentRunId?: string; delegateTaskId?: string };
    assert.equal(childInput.executionMode, "coding");
    assert.equal(childInput.parentRunId, parentRunId);
    assert.equal(childInput.delegateTaskId, fixture2.taskId);
    assert.equal(child.goal_id, fixture2.goalId);
    assert.equal(child.max_steps, 24);
    assert.ok((child.max_duration_ms as number) <= 1_800_000);

    // The write landed in the sandbox only.
    assert.equal(fs.readFileSync(path.join(fixture2.sandboxDir, "delegated.txt"), "utf8"), "fixed by delegate\n");
    assert.equal(fs.existsSync(path.join(fixture2.projectDir, "delegated.txt")), false);
  });

  it("lets a delegate run goal_run_checks under the goal's sandbox_checks grant", async () => {
    const run = tracked(delegateFixture((ids) => [
      { tool: { name: "goal_delegate", arguments: { taskId: ids.taskId, instructions: "verify the task" } } },
      { tool: { name: "goal_run_checks", arguments: { command: "true", taskId: ids.taskId } } },
      { text: "delegate verified" },
      { text: "parent done" }
    ], ["sandbox_checks"]));
    const parentRunId = await run.driveParent();
    assert.equal(run.log.getRun(parentRunId)?.status, "completed");
    const childId = await waitForChild(run.db, run.userId, parentRunId);
    const child = run.log.getRun(childId!)!;
    assert.equal(child.status, "completed");
    assert.match(checkStepResult(run, child.id), /"exitCode":\s*0/);
    const journal = new CopilotGoalStore(run.db, run.userId).recentJournal(run.goalId);
    assert.ok(journal.some(entry => entry.note.includes("自动执行 goal_run_checks") && entry.note.includes("sandbox_checks")));
  });

  it("refuses goal_run_checks in a delegate without the grant instead of parking for approval", async () => {
    const run = tracked(delegateFixture((ids) => [
      { tool: { name: "goal_delegate", arguments: { taskId: ids.taskId, instructions: "verify the task" } } },
      { tool: { name: "goal_run_checks", arguments: { command: "touch should-not-exist.txt" } } },
      { text: "delegate gave up" },
      { text: "parent done" }
    ]));
    const parentRunId = await run.driveParent();
    assert.equal(run.log.getRun(parentRunId)?.status, "completed");
    const childId = await waitForChild(run.db, run.userId, parentRunId);
    const child = run.log.getRun(childId!)!;
    assert.equal(child.status, "completed");
    assert.equal(run.log.listPendingActions(child.id).length, 0);
    assert.match(checkStepResult(run, child.id), /sandbox_checks/);
    assert.equal(fs.existsSync(path.join(run.sandboxDir, "should-not-exist.txt")), false);
  });

  it("parks goal_run_checks for owner approval in an ungranted goal run", async () => {
    const run = tracked(delegateFixture([
      { tool: { name: "goal_run_checks", arguments: { command: "touch approved-only.txt" } } },
      { text: "checked" }
    ]));
    const runId = await run.driveParent();
    assert.equal(run.log.getRun(runId)?.status, "awaiting_approval");
    assert.equal(run.log.listPendingActions(runId).length, 1);
    assert.equal(fs.existsSync(path.join(run.sandboxDir, "approved-only.txt")), false);
    const action = run.log.listPendingActions(runId)[0]!;
    await run.orchestrator.resumeAfterApproval({ userId: run.userId, runId, actionId: action.id, approved: true });
    assert.equal(run.log.getRun(runId)?.status, "completed");
    assert.equal(fs.existsSync(path.join(run.sandboxDir, "approved-only.txt")), true);
  });

  it("applies the shell denylist to goal_run_checks even under the grant", async () => {
    const run = tracked(delegateFixture([
      { tool: { name: "goal_run_checks", arguments: { command: "rm -rf /" } } },
      { text: "checked" }
    ], ["sandbox_checks"]));
    const runId = await run.driveParent();
    assert.equal(run.log.getRun(runId)?.status, "completed");
    assert.match(checkStepResult(run, runId), /Denied by security policy/);
  });

  it("limits the coding tool surface to sandbox tools plus read-only platform tools", () => {
    const fixture = tracked(delegateFixture([{ text: "x" }]));
    const registry = createAgentToolRegistry(createPlatformTools());
    const surface = computeToolSurface({ executionMode: "coding" }, { registry, hasSessionManager: true });
    const visible = new Set(surface.visible.map(tool => tool.name));
    for (const allowed of ["goal_file_write", "goal_file_edit", "goal_file_read", "goal_run_checks", "goal_update_task", "goal_write_journal", "read_project_file", "list_project_files", "goal_delegate"])
      assert.ok(visible.has(allowed), `${allowed} must be visible in coding mode`);
    for (const forbidden of ["terminal_run", "start_session", "takeover_session", "write_memory", "create_project", "pm_create_work_item", "goal_add_tasks", "goal_ask_user", "goal_dispatch_task"])
      assert.equal(visible.has(forbidden), false, `${forbidden} must be hidden in coding mode`);
  });

  it("scopes goal_update_task to the delegated task id", async () => {
    const run = tracked(delegateFixture((ids) => [
      { tool: { name: "goal_delegate", arguments: { taskId: ids.taskId, instructions: "update the wrong task" } } },
      { tool: { name: "goal_update_task", arguments: { taskId: ids.otherTaskId, status: "in_progress" } } },
      { text: "delegate done" },
      { text: "parent done" }
    ]));
    const parentRunId = await run.driveParent();
    const child = run.db.prepare(`SELECT r.conversation_id FROM copilot_runs r JOIN copilot_research_jobs j ON j.child_run_id=r.id AND j.user_id=r.user_id
      WHERE r.user_id=? AND j.origin_run_id=?`).get(run.userId, parentRunId) as { conversation_id: string };
    const childToolResult = run.log.listMessages(child.conversation_id)
      .find(message => message.kind === "tool_result" && message.toolName === "goal_update_task");
    assert.match(childToolResult?.content ?? "", /may only update task/);
    // The delegated task itself is still updatable by the child.
    const scopedRun = tracked(delegateFixture((ids) => [
      { tool: { name: "goal_delegate", arguments: { taskId: ids.taskId, instructions: "update my task" } } },
      { tool: { name: "goal_update_task", arguments: { taskId: ids.taskId, status: "in_progress" } } },
      { text: "delegate done" },
      { text: "parent done" }
    ]));
    await scopedRun.driveParent();
    assert.equal(new CopilotGoalStore(scopedRun.db, scopedRun.userId).listTasks(scopedRun.goalId).find(task => task.id === scopedRun.taskId)?.status, "in_progress");
  });

  it("cancels the delegate child when the parent run is cancelled (P1-5)", async () => {
    const db = createTestDb();
    dbs.push(db);
    const user = new UserRepository(db).create("goal-delegate-orphan@example.com", "hash");
    const log = new CopilotConversationLog(db, user.id);
    const conversation = log.createConversation();
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-goal-orphan-project-"));
    const projectId = crypto.randomUUID();
    db.prepare("INSERT INTO projects(id,user_id,name,path,ai_tool,status) VALUES(?,?,?,?,?,?)")
      .run(projectId, user.id, "orphan-project", projectDir, "claude", "active");
    const store = new CopilotGoalStore(db, user.id);
    const goalId = store.createGoal({ conversationId: conversation.id, projectId, title: "Orphan goal", spec: "s" }).id;
    const [task] = store.addTasks(goalId, ["Orphan task"]);
    let releaseChild!: () => void;
    const childBlocked = new Promise<void>(resolve => { releaseChild = resolve; });
    let calls = 0;
    const blockingLlm: AgentLlmClient = {
      async stream(request) {
        calls += 1;
        const emit = request.onEvent as (event: import("../src/services/agent/orchestrator-types.js").AgentLlmStreamEvent) => void;
        if (calls === 1) {
          emit({ type: "tool_call", toolCall: { id: "d-1", name: "goal_delegate", arguments: JSON.stringify({ taskId: task.id, instructions: "long work" }) } });
          return { message: "" };
        }
        if (calls === 2) { await childBlocked; return { message: "child finished late" }; }
        return { message: "parent done" };
      },
      async summarize() { return ""; },
      async generateTitle() { return ""; }
    };
    const orchestrator = createCopilotOrchestrator({
      db, masterKey,
      toolRegistry: createAgentToolRegistry(createPlatformTools()),
      llm: blockingLlm,
      eventBus: new ForgeBadgerEventBus()
    });
    const parentRunId = orchestrator.enqueue({
      userId: user.id, conversationId: conversation.id, userText: "delegate",
      source: "user", clientRequestId: crypto.randomUUID(), goalId
    });
    const childId = await waitForChild(db, user.id, parentRunId);
    assert.ok(childId);
    // The active child (in its own conversation) makes the goal busy for the
    // sweep/continuation path as well.
    const busy = evaluateGoalContinuation({ db, masterKey, eventBus: new ForgeBadgerEventBus() }, user.id, goalId, () => "x");
    assert.equal(busy.action, "busy");
    // Owner cancels the parent mid-delegate: the child must not be orphaned.
    await orchestrator.cancelRun({ userId: user.id, runId: parentRunId });
    const deadline = Date.now() + 3000;
    let child = log.getRun(childId!) ?? db.prepare("SELECT status FROM copilot_runs WHERE user_id=? AND id=?").get(user.id, childId!) as { status: string };
    while (child.status !== "cancelled" && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 20));
      child = db.prepare("SELECT status FROM copilot_runs WHERE user_id=? AND id=?").get(user.id, childId!) as { status: string };
    }
    releaseChild();
    assert.equal(child.status, "cancelled");
  });

  it("forbids nesting a delegate inside a delegate (existing parent-chain rule)", async () => {
    const run = tracked(delegateFixture((ids) => [
      { tool: { name: "goal_delegate", arguments: { taskId: ids.taskId, instructions: "nest" } } },
      { tool: { name: "goal_delegate", arguments: { taskId: ids.otherTaskId, instructions: "nested delegate" } } },
      { text: "delegate done" },
      { text: "parent done" }
    ]));
    const parentRunId = await run.driveParent();
    const child = run.db.prepare(`SELECT r.conversation_id FROM copilot_runs r JOIN copilot_research_jobs j ON j.child_run_id=r.id AND j.user_id=r.user_id
      WHERE r.user_id=? AND j.origin_run_id=?`).get(run.userId, parentRunId) as { conversation_id: string };
    const nestedResult = run.log.listMessages(child.conversation_id)
      .find(message => message.kind === "tool_result" && message.toolName === "goal_delegate");
    assert.match(nestedResult?.content ?? "", /Nested or cross-project research is not allowed/);
    // A failed delegate does not block the goal: the parent still completed.
    assert.equal(run.log.getRun(parentRunId)?.status, "completed");
  });
});
