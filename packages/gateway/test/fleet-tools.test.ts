import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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
import { createAgentToolRegistry, type AgentToolContext } from "../src/services/agent/tool-registry.js";
import { computeToolSurface, FLEET_TOOLS } from "../src/services/agent/tool-surface.js";
import { createFleetTools } from "../src/services/agent/tools/fleet.js";
import { createGoalDelegateTools } from "../src/services/agent/tools/goal-delegate.js";
import { createGoalTools } from "../src/services/agent/tools/goals.js";
import { createGoalIntegrateTools } from "../src/services/agent/tools/goal-integrate.js";
import { createGoalReviewTools } from "../src/services/agent/tools/goal-review.js";
import { createCopilotOrchestrator } from "../src/services/agent/orchestrator.js";
import type { AgentLlmClient, AgentLlmStreamEvent } from "../src/services/agent/orchestrator-types.js";
import type { AgentTool } from "../src/services/agent/tool-registry.js";
import { z } from "zod";
import { ProjectManagerRepository } from "../src/db/repositories/project-manager-repository.js";
import { linkGoalTasksToBoard } from "../src/services/agent/goal-board.js";
import { createPlatformTools } from "../src/services/agent/tools/index.js";
import { defaultCopilotTeam, setCopilotTeamRoster, type TeamMember } from "../src/services/agent/team-roster.js";
import { AgentError } from "../src/services/agent/types.js";
import { ForgeBadgerEventBus } from "../src/services/event-bus.js";
import { fleetContextMessage } from "../src/services/fleet/fleet-context.js";
import { FleetStore } from "../src/services/fleet/fleet-store.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";

const stateRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fb-fleet-tools-state-")));
process.env.FORGEBADGER_STATE_DIR = stateRoot;
process.env.CLAUDE_CONFIG_DIR = path.join(stateRoot, "claude-config");
const adapterCommandRunner = async (command: string) => ({ exitCode: 0, stdout: `${command} 1.0.0`, stderr: "" });

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd, stdio: "ignore",
    env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "O", GIT_AUTHOR_EMAIL: "o@example.com",
      GIT_COMMITTER_NAME: "O", GIT_COMMITTER_EMAIL: "o@example.com" }
  });
}

const stagedInputs: string[] = [];
function terminalManager(): InMemorySessionManager {
  const ready = "some output\n› Ask Codex to do anything\n────────────\n❯ \n────────────\n";
  let pane = ready;
  return new InMemorySessionManager({
    async createSession() {}, async killSession() {}, async listSessions() { return []; }, async hasSession() { return true; },
    async capturePane() { return pane; }, async inspectPane() { return { content: pane, dead: false }; },
    async stageProgrammaticInput(_name: string, data: string) { stagedInputs.push(data); pane = `› ${data}\n────────────\n❯ ${data}\n────────────\n`; },
    async pressEnter() { pane = ready; }
  } as never, undefined, undefined, { sleep: async () => {} });
}

interface Fixture { db: Database.Database; userId: string; store: FleetStore; fleetId: string; conversationId: string; context: AgentToolContext }
const dbs: Database.Database[] = [];

function runRow(db: Database.Database, userId: string, conversationId: string, goalId: string | null): string {
  const id = randomUUID();
  db.prepare(`INSERT INTO copilot_runs(id,user_id,conversation_id,status,goal_id,runtime_version,input_json,created_at,updated_at) VALUES(?,?,?,'completed',?,1,'{}',?,?)`)
    .run(id, userId, conversationId, goalId, Date.now(), Date.now());
  return id;
}

function fixture(): Fixture {
  const db = new Database(":memory:");
  dbs.push(db);
  migrate(drizzle(db), { migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations") });
  const user = new UserRepository(db).create(`fleet-tools-${randomUUID()}@example.com`, "hash");
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fb-fleet-tools-project-")));
  fs.writeFileSync(path.join(dir, "README.md"), "x\n");
  git(dir, "init", "-q", "-b", "main"); git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "init");
  const projectId = randomUUID();
  db.prepare("INSERT INTO projects(id,user_id,name,path,ai_tool,status) VALUES(?,?,?,?,?,?)").run(projectId, user.id, "p", dir, "claude", "active");
  const store = new FleetStore(db, user.id);
  const fleet = store.createFleet({ projectId });
  const runId = runRow(db, user.id, fleet.conversation_id, fleet.id);
  return {
    db, userId: user.id, store, fleetId: fleet.id, conversationId: fleet.conversation_id,
    context: { db, userId: user.id, masterKey: "k", runId, sessionManager: terminalManager(), adapterCommandRunner, eventBus: new ForgeBadgerEventBus() } as AgentToolContext
  };
}

const tools = () => [...createFleetTools(), ...createGoalDelegateTools(), ...createGoalTools(), ...createGoalIntegrateTools(), ...createGoalReviewTools()];
const run = <T = Record<string, unknown>>(context: AgentToolContext, name: string, input: Record<string, unknown>) =>
  tools().find(entry => entry.name === name)!.execute(input, context) as Promise<T>;
const rejectsWith = (code: string) => (error: unknown) => error instanceof AgentError && error.code === code;

function member(id: string): TeamMember {
  return { id, name: id, title: "Engineer", description: "Careful", adapter: "claude", roles: ["writer"], enabled: true };
}

describe("fleet lead tools", () => {
  beforeEach(() => { setCopilotTeamRoster({ maxParallelWriters: 4, members: [member("claude-a"), member("claude-b"), member("claude-c")] }); stagedInputs.length = 0; });
  after(() => { setCopilotTeamRoster(defaultCopilotTeam()); for (const db of dbs) if (db.open) db.close(); fs.rmSync(stateRoot, { recursive: true, force: true }); });

  it("registers the five fleet tools as read-risk, approval-free and fleet-only in the catalog", () => {
    const registry = createAgentToolRegistry(createPlatformTools());
    const names = [...FLEET_TOOLS].sort();
    assert.deepEqual(names, ["fleet_cancel_timer", "fleet_hold_task", "fleet_read_note", "fleet_set_timer", "fleet_write_note"]);
    for (const name of names) {
      const tool = registry.tools.get(name);
      assert.ok(tool, name);
      assert.deepEqual([tool!.risk, tool!.requiresApproval], ["read", false]);
    }
    const visible = (input: { goalId?: string; fleet?: boolean }) => new Set(computeToolSurface({ source: "user", ...input }, { registry, hasSessionManager: true }).visible.map(t => t.name));
    for (const name of names) {
      assert.equal(visible({ goalId: randomUUID(), fleet: true }).has(name), true, name);
      assert.equal(visible({ goalId: randomUUID() }).has(name), false, name);
      assert.equal(visible({}).has(name), false, name);
    }
  });

  it("holds one task, journals it and notifies once per hold cycle", async () => {
    const f = fixture();
    const task = f.store.addTask(f.fleetId, { description: "Pick a DB", createdBy: "lead" });
    const result = await run<{ task: { id: string; hold: { question: string } } }>(f.context, "fleet_hold_task", { taskId: task.id, question: "Postgres or SQLite?" });
    assert.equal(result.task.hold.question, "Postgres or SQLite?");
    assert.equal(f.store.getTask(f.fleetId, task.id)!.hold_question, "Postgres or SQLite?");
    assert.equal(f.store.getFleet(f.fleetId)!.status, "active", "a hold never pauses the fleet");
    let notes = f.db.prepare("SELECT message FROM notifications WHERE user_id=? AND type='copilot_fleet'").all(f.userId) as Array<{ message: string }>;
    assert.equal(notes.length, 1);
    // The same question asked again later is a new hold cycle: the owner is told again.
    await new Promise(resolve => setTimeout(resolve, 5));
    await run(f.context, "fleet_hold_task", { taskId: task.id, question: "Postgres or SQLite?" });
    notes = f.db.prepare("SELECT message FROM notifications WHERE user_id=? AND type='copilot_fleet'").all(f.userId) as Array<{ message: string }>;
    assert.equal(notes.length, 2, "a repeated identical question notifies twice");
    assert.match(notes[0]!.message, /waits for your decision/);
    assert.ok(f.store.recentJournal(f.fleetId, 5, task.id).some(entry => entry.note.includes("held for the owner")));
    assert.match(fleetContextMessage(f.db, f.userId, f.fleetId)!, /"hold":\{"question":"Postgres or SQLite\?"/);
    await assert.rejects(run(f.context, "fleet_hold_task", { taskId: randomUUID(), question: "?" }), rejectsWith("COPILOT_NOT_FOUND"));
  });

  it("sets, lists and cancels timers and writes and reads notes", async () => {
    const f = fixture();
    const task = f.store.addTask(f.fleetId, { description: "T", createdBy: "lead" });
    const { timer } = await run<{ timer: { id: string; taskId: string; status: string; dueAt: string } }>(f.context, "fleet_set_timer", { minutes: 30, note: "check CI", taskId: task.id });
    assert.deepEqual([timer.taskId, timer.status], [task.id, "pending"]);
    assert.ok(Date.parse(timer.dueAt) > Date.now() + 29 * 60_000);
    assert.match(fleetContextMessage(f.db, f.userId, f.fleetId)!, /"note":"check CI"/);
    const cancelled = await run<{ timer: { status: string } }>(f.context, "fleet_cancel_timer", { timerId: timer.id });
    assert.equal(cancelled.timer.status, "cancelled");
    await assert.rejects(run(f.context, "fleet_set_timer", { minutes: 0, note: "x" }));
    await assert.rejects(run(f.context, "fleet_cancel_timer", { timerId: randomUUID() }), rejectsWith("COPILOT_NOT_FOUND"));

    await run(f.context, "fleet_write_note", { scope: "task", refId: task.id, body: "Did A; B left." });
    await run(f.context, "fleet_write_note", { scope: "fleet", body: "Project memo" });
    const read = await run<{ note: { body: string } | null }>(f.context, "fleet_read_note", { scope: "task", refId: task.id });
    assert.equal(read.note!.body, "Did A; B left.");
    assert.equal((await run<{ note: unknown }>(f.context, "fleet_read_note", { scope: "member", refId: "claude-a" })).note, null);
    await assert.rejects(run(f.context, "fleet_write_note", { scope: "fleet", refId: "x", body: "y" }), rejectsWith("FLEET_INPUT_INVALID"));
    await assert.rejects(run(f.context, "fleet_write_note", { scope: "task", refId: randomUUID(), body: "y" }), rejectsWith("COPILOT_NOT_FOUND"));
  });

  it("refuses every fleet tool outside the fleet's lead run", async () => {
    const f = fixture();
    const task = f.store.addTask(f.fleetId, { description: "T", createdBy: "lead" });
    const conversation = new CopilotConversationLog(f.db, f.userId).createConversation();
    const goal = new CopilotGoalStore(f.db, f.userId).createGoal({ conversationId: conversation.id, title: "G", spec: "S" });
    const contexts: AgentToolContext[] = [
      { ...f.context, runId: runRow(f.db, f.userId, conversation.id, goal.id) },            // goal run
      { ...f.context, runId: runRow(f.db, f.userId, conversation.id, null) },               // plain chat run
      { ...f.context, runId: runRow(f.db, f.userId, conversation.id, f.fleetId) },          // fleet scope on another conversation (delegate child)
      { ...f.context, runId: undefined }                                                     // no run
    ];
    const inputs: Array<[string, Record<string, unknown>]> = [
      ["fleet_hold_task", { taskId: task.id, question: "?" }], ["fleet_set_timer", { minutes: 5, note: "n" }], ["fleet_cancel_timer", { timerId: randomUUID() }],
      ["fleet_write_note", { scope: "fleet", body: "b" }], ["fleet_read_note", { scope: "fleet" }]
    ];
    for (const context of contexts) for (const [name, input] of inputs)
      await assert.rejects(run(context, name, input), rejectsWith("FLEET_CONTEXT_REQUIRED"), name);
    assert.equal(f.store.getTask(f.fleetId, task.id)!.hold_question, null);
  });

  it("refuses to dispatch a held task while another task of the fleet still dispatches", async () => {
    const f = fixture();
    const held = f.store.addTask(f.fleetId, { description: "Held", createdBy: "lead" });
    const free = f.store.addTask(f.fleetId, { description: "Free", createdBy: "lead" });
    await run(f.context, "fleet_hold_task", { taskId: held.id, question: "Which API?" });
    await assert.rejects(run(f.context, "goal_dispatch_task", { taskId: held.id, memberId: "claude-a", instructions: "go" }), rejectsWith("FLEET_TASK_HELD"));
    const dispatched = await run<{ sessionId: string }>(f.context, "goal_dispatch_task", { taskId: free.id, memberId: "claude-b", instructions: "go" });
    assert.ok(dispatched.sessionId);
    assert.equal(f.store.getTask(f.fleetId, free.id)!.dispatch_status, "running");
    assert.equal(f.store.getTask(f.fleetId, held.id)!.dispatched_session_id, null);
    f.store.clearHold(f.fleetId, held.id);
    f.store.settleDispatch(free.id, "completed");
    await run(f.context, "goal_dispatch_task", { taskId: held.id, memberId: "claude-a", instructions: "go" });
    assert.equal(f.store.getTask(f.fleetId, held.id)!.dispatch_status, "running");
  });

  it("refuses a parallel dispatch whose file scope overlaps a running one, and skips the check without a scope", async () => {
    const f = fixture();
    const api = f.store.addTask(f.fleetId, { description: "API", verifyCommand: "true", fileScope: ["src/api"], createdBy: "lead" });
    const nested = f.store.addTask(f.fleetId, { description: "API client", verifyCommand: "true", fileScope: ["src/api/client.ts"], createdBy: "lead" });
    const sibling = f.store.addTask(f.fleetId, { description: "API docs", verifyCommand: "true", fileScope: ["src/apidocs"], createdBy: "lead" });
    const unscoped = f.store.addTask(f.fleetId, { description: "Anything", verifyCommand: "true", createdBy: "lead" });
    await run(f.context, "goal_dispatch_task", { taskId: api.id, memberId: "claude-a", instructions: "go", parallel: true });
    assert.match(stagedInputs.at(-1)!, /File scope of this task: change only files under src\/api\./);
    await assert.rejects(run(f.context, "goal_dispatch_task", { taskId: nested.id, memberId: "claude-b", instructions: "go", parallel: true }),
      (error: unknown) => error instanceof AgentError && error.code === "COPILOT_GOAL_SCOPE_OVERLAP" && error.message.includes(api.id) && error.message.includes("src/api/client.ts"));
    assert.equal(f.store.getTask(f.fleetId, nested.id)!.dispatched_session_id, null);
    await run(f.context, "goal_dispatch_task", { taskId: sibling.id, memberId: "claude-b", instructions: "go", parallel: true });
    await run(f.context, "goal_dispatch_task", { taskId: unscoped.id, memberId: "claude-c", instructions: "go", parallel: true });
    assert.doesNotMatch(stagedInputs.at(-1)!, /File scope/);
    assert.deepEqual([api, sibling, unscoped].map(task => f.store.getTask(f.fleetId, task.id)!.dispatch_status), ["running", "running", "running"]);
  });

  it("freezes a held task (pass, delegate, dispatch, integrate, review refused) while other tasks keep moving; a cancelled task cannot be dispatched", async () => {
    const f = fixture();
    const held = f.store.addTask(f.fleetId, { description: "Held", createdBy: "lead" });
    const other = f.store.addTask(f.fleetId, { description: "Other", createdBy: "lead" });
    await run(f.context, "fleet_hold_task", { taskId: held.id, question: "Which API?" });
    const delegateContext = { ...f.context, runCodingDelegate: async () => ({ runId: "x", status: "completed", report: "" }) } as AgentToolContext;
    for (const [name, input, context] of [
      ["goal_update_task", { taskId: held.id, status: "passes", evidence: "decided myself" }, f.context],
      ["goal_update_task", { taskId: held.id, status: "in_progress" }, f.context],
      ["goal_delegate", { taskId: held.id, instructions: "go" }, delegateContext],
      ["goal_dispatch_task", { taskId: held.id, memberId: "claude-a", instructions: "go" }, f.context],
      ["goal_integrate_task", { taskId: held.id }, f.context],
      ["goal_review_task", { taskId: held.id }, f.context]
    ] as Array<[string, Record<string, unknown>, AgentToolContext]>)
      await assert.rejects(run(context, name, input), rejectsWith("FLEET_TASK_HELD"), name);
    const row = f.store.getTask(f.fleetId, held.id)!;
    assert.deepEqual([row.status, row.hold_question, row.dispatched_session_id], ["pending", "Which API?", null]);
    assert.equal(f.store.listFleets()[0]!.task_held, 1);
    const moved = await run<{ task: { status: string } }>(f.context, "goal_update_task", { taskId: other.id, status: "passes", evidence: "done" });
    assert.equal(moved.task.status, "passes");

    const cancelled = f.store.addTask(f.fleetId, { description: "Cancelled", createdBy: "owner" });
    f.store.cancelTask(f.fleetId, cancelled.id);
    await assert.rejects(run(f.context, "goal_dispatch_task", { taskId: cancelled.id, memberId: "claude-a", instructions: "go" }), rejectsWith("COPILOT_GOAL_TASK_CANCELLED"));
    await assert.rejects(run(delegateContext, "goal_delegate", { taskId: cancelled.id, instructions: "go" }), rejectsWith("COPILOT_GOAL_TASK_CANCELLED"));
    assert.equal(f.store.getTask(f.fleetId, cancelled.id)!.dispatch_status, null);
  });

  it("lets lead-created tasks carry details and a file scope in a fleet run, and keeps goal_add_tasks strict for goals", async () => {
    const f = fixture();
    const { tasks } = await run<{ tasks: Array<{ id: string; details: string; file_scope_json: string }> }>(f.context, "goal_add_tasks", { descriptions: [
      { description: "Scoped", verifyCommand: "true", details: "More detail", fileScope: ["src/x/", "./lib"] }] });
    assert.deepEqual([tasks[0]!.details, JSON.parse(tasks[0]!.file_scope_json)], ["More detail", ["src/x", "lib"]]);
    await assert.rejects(run(f.context, "goal_add_tasks", { descriptions: [{ description: "Bad", fileScope: ["../up"] }] }), rejectsWith("FLEET_INPUT_INVALID"));
    const conversation = new CopilotConversationLog(f.db, f.userId).createConversation();
    const goal = new CopilotGoalStore(f.db, f.userId).createGoal({ conversationId: conversation.id, title: "G", spec: "S" });
    const goalContext = { ...f.context, runId: runRow(f.db, f.userId, conversation.id, goal.id) } as AgentToolContext;
    await assert.rejects(run(goalContext, "goal_add_tasks", { descriptions: [{ description: "x", fileScope: ["src"] }] }), rejectsWith("COPILOT_GOAL_INPUT_INVALID"));
  });

  it("rejects another user's fleet as a run scope at admission, and fleet tools refuse it", async () => {
    const mine = fixture();
    const orchestrator = createCopilotOrchestrator({ db: mine.db, masterKey: "k", toolRegistry: createAgentToolRegistry(tools()),
      llm: { async stream() { return { message: "" }; }, async summarize() { return ""; }, async generateTitle() { return ""; } }, eventBus: new ForgeBadgerEventBus() });
    // Same database: the fleet id exists, it just belongs to another tenant.
    const otherUser = new UserRepository(mine.db).create(`intruder-${randomUUID()}@example.com`, "hash");
    const conversation = new CopilotConversationLog(mine.db, otherUser.id).createConversation();
    assert.throws(() => orchestrator.enqueue({ userId: otherUser.id, conversationId: conversation.id, goalId: mine.fleetId, userText: "x", source: "user", clientRequestId: randomUUID() }),
      rejectsWith("COPILOT_NOT_FOUND"));
    const intruderRun = runRow(mine.db, otherUser.id, conversation.id, mine.fleetId);
    await assert.rejects(run({ ...mine.context, userId: otherUser.id, runId: intruderRun } as AgentToolContext, "fleet_write_note", { scope: "fleet", body: "x" }),
      rejectsWith("FLEET_CONTEXT_REQUIRED"));
  });

  it("refuses mcp_* and owner-only tools at execution in a fleet run, and leaves other runs unchanged", async () => {
    const f = fixture();
    const calls: string[] = [];
    const fake = (name: string): AgentTool => ({ name, description: `fake ${name}`, risk: "read", requiresApproval: false, inputSchema: z.object({}).strict(),
      async execute() { calls.push(name); return { ok: true }; } });
    const registry = createAgentToolRegistry([...tools(), fake("mcp_fake_echo"), fake("takeover_session")]);
    const scripted = (toolName: string): AgentLlmClient => {
      let count = 0;
      return {
        async stream(request) {
          count += 1;
          if (count === 1) {
            (request.onEvent as (event: AgentLlmStreamEvent) => void)({ type: "tool_call", toolCall: { id: "call-1", name: toolName, arguments: "{}" } });
            return { message: "" };
          }
          return { message: "done" };
        },
        async summarize() { return ""; }, async generateTitle() { return ""; }
      };
    };
    const execute = async (toolName: string, conversationId: string, goalId?: string) => {
      const orchestrator = createCopilotOrchestrator({ db: f.db, masterKey: "k", toolRegistry: registry, llm: scripted(toolName), eventBus: new ForgeBadgerEventBus(),
        sessionManager: f.context.sessionManager as InMemorySessionManager });
      const runId = orchestrator.enqueue({ userId: f.userId, conversationId, ...(goalId ? { goalId } : {}), userText: "go", source: "user", clientRequestId: randomUUID() });
      await new Promise(resolve => setImmediate(resolve));
      await orchestrator.executeRun(f.userId, runId);
      return JSON.stringify(f.db.prepare("SELECT result_json FROM copilot_run_steps WHERE run_id=?").all(runId));
    };
    f.db.prepare("UPDATE copilot_runs SET status='completed'").run();
    for (const name of ["mcp_fake_echo", "takeover_session"]) {
      const steps = await execute(name, f.conversationId, f.fleetId);
      assert.match(steps, /Fleet flagship runs cannot execute owner-only or external tools/, name);
    }
    assert.deepEqual(calls, [], "no fleet run reached the tools");
    const plain = new CopilotConversationLog(f.db, f.userId).createConversation();
    await execute("mcp_fake_echo", plain.id);
    assert.deepEqual(calls, ["mcp_fake_echo"], "an owner chat run is unchanged");
  });

  it("keeps one live owner per work item across goals and fleets, and frees items of resolved tasks", () => {
    const f = fixture();
    const projectId = f.store.getFleet(f.fleetId)!.project_id;
    const pm = new ProjectManagerRepository(f.db, f.userId);
    const item = (title: string) => pm.createWorkItem(projectId, { title, acceptanceCriteria: ["done"] }).id;
    const conversation = new CopilotConversationLog(f.db, f.userId).createConversation();
    const goals = new CopilotGoalStore(f.db, f.userId);
    const goal = goals.createGoal({ conversationId: conversation.id, projectId, title: "G", spec: "S" });
    // Goal owns item A: the fleet may not adopt it while that goal task is live.
    const itemA = item("A");
    const [goalTask] = goals.addTasks(goal.id, [{ description: "goal side", workItemId: itemA }]);
    assert.throws(() => f.store.addTask(f.fleetId, { description: "fleet side", workItemId: itemA, createdBy: "owner" }),
      (error: unknown) => error instanceof AgentError && /open goal/.test(error.message));
    f.db.prepare("UPDATE copilot_goal_tasks SET status='cancelled' WHERE id=?").run(goalTask!.id);
    assert.equal(f.store.addTask(f.fleetId, { description: "fleet side", workItemId: itemA, createdBy: "owner" }).work_item_id, itemA);
    // Fleet owns item B: the goal may adopt it only once the fleet task is resolved.
    const itemB = item("B");
    const fleetTask = f.store.addTask(f.fleetId, { description: "fleet B", workItemId: itemB, createdBy: "owner" });
    assert.throws(() => linkGoalTasksToBoard(f.db, f.userId, goals.getGoal(goal.id)!, [{ workItemId: itemB }]), rejectsWith("COPILOT_GOAL_INPUT_INVALID"));
    f.store.updateTask(f.fleetId, fleetTask.id, "passes", "done");
    assert.equal(linkGoalTasksToBoard(f.db, f.userId, goals.getGoal(goal.id)!, [{ workItemId: itemB }])[0]!.workItemId, itemB);
  });
});
