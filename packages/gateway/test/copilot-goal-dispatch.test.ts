import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { z } from "zod";

import { execFileSync } from "node:child_process";

import { UserRepository } from "../src/db/repositories/user-repository.js";
import { SessionRepository } from "../src/db/repositories/session-repository.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { CopilotGoalStore } from "../src/services/agent/goal-store.js";
import { AgentError } from "../src/services/agent/types.js";
import { createGoalDelegateTools } from "../src/services/agent/tools/goal-delegate.js";
import { createCopilotOrchestrator } from "../src/services/agent/orchestrator.js";
import type { AgentLlmClient, AgentLlmStreamEvent } from "../src/services/agent/orchestrator-types.js";
import { createAgentToolRegistry } from "../src/services/agent/tool-registry.js";
import { ForgeBadgerEventBus, type ForgeBadgerEvent } from "../src/services/event-bus.js";
import type { AgentToolContext } from "../src/services/agent/tool-registry.js";
import { defaultCopilotTeam, setCopilotTeamRoster, type TeamMember } from "../src/services/agent/team-roster.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import { DISPATCH_REPORT_TIMEOUT_MS, evaluateGoalContinuation, settleGoalDispatchFromHook } from "../src/services/agent/goal-driver.js";
import { goalSandboxDir } from "../src/services/agent/goal-sandbox.js";

const masterKey = "abcdef0123456789abcdef0123456789";
// Session launch materializes Claude settings; keep them out of the real ~/.claude.
const stateRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fb-goal-dispatch-state-")));
process.env.FORGEBADGER_STATE_DIR = stateRoot;
process.env.CLAUDE_CONFIG_DIR = path.join(stateRoot, "claude-config");
const adapterCommandRunner = async (command: string) => ({ exitCode: 0, stdout: `${command} 1.0.0`, stderr: "" });

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "user.name=Owner", "-c", "user.email=owner@example.com", ...args],
    { cwd, env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } });
}

/** Claude-shaped fake terminal: composer ready, staged text echoed, Enter consumes it. */
const stagedInputs: string[] = [];

function claudeSessionManager(): InMemorySessionManager {
  const ready = "some output\n────────────\n❯ \n────────────\n";
  let pane = ready;
  return new InMemorySessionManager({
    async createSession() {}, async killSession() {}, async listSessions() { return []; }, async hasSession() { return true; },
    async capturePane() { return pane; }, async inspectPane() { return { content: pane, dead: false }; },
    async stageProgrammaticInput(_name: string, data: string) { stagedInputs.push(data); pane = `────────────\n❯ ${data}\n────────────\n`; },
    async pressEnter() { pane = ready; }
  } as never, undefined, undefined, { sleep: async () => {} });
}

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
  sessionManager: InMemorySessionManager;
  workspaceDir(): string;
}

function dispatchFixture(options: { git?: boolean } = {}): DispatchFixture {
  const db = createTestDb();
  const user = new UserRepository(db).create("goal-dispatch@example.com", "hash");
  const conversation = new CopilotConversationLog(db, user.id).createConversation();
  const projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fb-goal-dispatch-project-")));
  fs.writeFileSync(path.join(projectDir, "README.md"), "# Dispatch\n");
  if (options.git) {
    git(projectDir, "init", "-q", "-b", "main");
    git(projectDir, "add", "-A");
    git(projectDir, "commit", "-q", "-m", "initial");
  }
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
  const sessionManager = claudeSessionManager();
  return {
    db, userId: user.id, goalId, taskId: task.id, verifyTaskId: verifyTask.id,
    projectDir, tool, store,
    context: { db, userId: user.id, masterKey: "k", runId, sessionManager, adapterCommandRunner, eventBus: new ForgeBadgerEventBus() } as AgentToolContext,
    sessionManager,
    workspaceDir: () => store.getGoal(goalId)!.workspace_path!
  };
}

function writer(adapter: TeamMember["adapter"], over: Partial<TeamMember> = {}): TeamMember {
  return { id: `${adapter}-dev`, name: `${adapter} dev`, title: "Implementer", description: "Writes code", adapter, roles: ["writer"], enabled: true, ...over };
}
function roster(...members: TeamMember[]): void {
  setCopilotTeamRoster({ maxParallelWriters: 3, members });
}

describe("goal_dispatch_task", () => {
  const dbs: Database.Database[] = [];
  function tracked(fixture: DispatchFixture) { dbs.push(fixture.db); return fixture; }

  beforeEach(() => { setCopilotTeamRoster(defaultCopilotTeam()); stagedInputs.length = 0; });

  after(() => {
    setCopilotTeamRoster(defaultCopilotTeam());
    for (const db of dbs) if (db.open) db.close();
    fs.rmSync(stateRoot, { recursive: true, force: true });
  });

  const denied = (error: unknown) => error instanceof AgentError && error.code === "COPILOT_ADAPTER_AUTONOMY_DENIED";
  const invalid = (error: unknown) => error instanceof AgentError && error.code === "COPILOT_GOAL_INPUT_INVALID";

  it("refuses dispatch with an empty roster and ignores the retired env variable", async () => {
    process.env.FORGEBADGER_CLI_AUTONOMY_ADAPTERS = "claude";
    try {
      const fixture = tracked(dispatchFixture());
      await assert.rejects(
        fixture.tool.execute({ taskId: fixture.taskId, aiTool: "claude", instructions: "do it" }, fixture.context), denied);
    } finally { delete process.env.FORGEBADGER_CLI_AUTONOMY_ADAPTERS; }
  });

  it("refuses disabled, reviewer-only and other-adapter members", async () => {
    const fixture = tracked(dispatchFixture());
    const attempt = () => fixture.tool.execute({ taskId: fixture.taskId, aiTool: "claude", instructions: "do it" }, fixture.context);
    roster(writer("claude", { enabled: false }));
    await assert.rejects(attempt(), denied);
    roster(writer("claude", { roles: ["reviewer"] }));
    await assert.rejects(attempt(), denied);
    roster(writer("kimi"));
    await assert.rejects(attempt(), denied);
  });

  it("refuses adapters that cannot be driven programmatically even with a member", async () => {
    roster(writer("grok"));
    const fixture = tracked(dispatchFixture());
    await assert.rejects(
      fixture.tool.execute({ taskId: fixture.taskId, aiTool: "grok", instructions: "do it" }, fixture.context),
      (error: unknown) => denied(error) && /programmatically/.test((error as Error).message));
  });

  it("dispatches as a team member: session name, role preamble, journal and result", async () => {
    roster(writer("claude", { id: "ada", name: "Ada", title: "Backend lead", description: "Owns the parser." }));
    const fixture = tracked(dispatchFixture());
    const result = await fixture.tool.execute(
      { taskId: fixture.taskId, memberId: "ada", instructions: "implement the parser" }, fixture.context) as
      { sessionId: string; adapter: string; member?: { id: string; name: string } };
    assert.deepEqual(result.member, { id: "ada", name: "Ada" });
    assert.equal(result.adapter, "claude");
    const row = fixture.db.prepare("SELECT name FROM sessions WHERE id=?").get(result.sessionId) as { name: string };
    assert.ok(row.name.startsWith("Ada: "));
    const submitted = stagedInputs.join("");
    assert.ok(submitted.includes("You are Ada, Backend lead. Owns the parser."), submitted);
    assert.ok(fixture.store.recentJournal(fixture.goalId).some(entry => entry.note.includes("member Ada [ada]")));
    // aiTool alone resolves the first writer member for that CLI (the shared tree has one writer: settle the first).
    fixture.store.settleDispatch(fixture.taskId, "completed");
    const viaTool = await fixture.tool.execute(
      { taskId: fixture.verifyTaskId, aiTool: "claude", instructions: "x" }, fixture.context) as { member?: { id: string } };
    assert.equal(viaTool.member?.id, "ada");
  });

  it("validates memberId and aiTool consistency", async () => {
    roster(writer("claude", { id: "ada" }), writer("kimi", { id: "rev", roles: ["reviewer"] }));
    const fixture = tracked(dispatchFixture());
    const run = (input: Record<string, unknown>) => fixture.tool.execute({ taskId: fixture.taskId, instructions: "x", ...input }, fixture.context);
    await assert.rejects(run({ memberId: "nobody" }), invalid);
    await assert.rejects(run({ memberId: "rev" }), invalid);
    await assert.rejects(run({ memberId: "ada", aiTool: "kimi" }), invalid);
    await assert.rejects(run({}));
  });

  it("creates a session, dispatches with delivery confirmation and records the task link", async () => {
    roster(writer("claude"), writer("kimi"));
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
    assert.equal(task.dispatch_status, "running");
    const session = fixture.db.prepare("SELECT status, ai_tool, working_dir FROM sessions WHERE id=?").get(result.sessionId) as { status: string; ai_tool: string; working_dir: string };
    assert.equal(session.status, "running");
    assert.equal(session.ai_tool, "claude");
    // Non-git project: the CLI works in the same copy the sandbox tools use.
    assert.equal(session.working_dir, goalSandboxDir(fixture.db, fixture.goalId));
    assert.equal((result as { workspace?: string }).workspace, "copy");
  });

  it("runs the CLI inside the goal git worktree, with its lifecycle hook installed there", async () => {
    roster(writer("claude"));
    const fixture = tracked(dispatchFixture({ git: true }));
    const result = await fixture.tool.execute(
      { taskId: fixture.taskId, aiTool: "claude", instructions: "implement the parser" }, fixture.context) as { sessionId: string; workspace: string };
    assert.equal(result.workspace, "worktree");
    const worktree = fixture.workspaceDir();
    const session = fixture.db.prepare("SELECT working_dir FROM sessions WHERE id=?").get(result.sessionId) as { working_dir: string };
    assert.equal(session.working_dir, worktree);
    assert.notEqual(worktree, fixture.projectDir);
    assert.ok(fs.existsSync(path.join(worktree, ".claude", "settings.local.json")), "the shared launch path materialized the CLI hook");
    assert.equal(fs.existsSync(path.join(fixture.projectDir, ".claude", "settings.local.json")), false, "the real project is untouched");
  });

  it("reuses the task's running goal session and never an owner-interactive one", async () => {
    roster(writer("claude"));
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
    // A shared tree has one writer: the other task waits until the first turn settles.
    fixture.store.settleDispatch(fixture.taskId, "completed");
    const other = await fixture.tool.execute(
      { taskId: fixture.verifyTaskId, aiTool: "claude", instructions: "other task" }, fixture.context) as { sessionId: string; sessionCreated: boolean };
    assert.equal(first.sessionCreated, true);
    assert.equal(second.sessionCreated, false);
    assert.equal(second.sessionId, first.sessionId);
    assert.equal(other.sessionCreated, true);
    assert.notEqual(other.sessionId, first.sessionId);
    const ownerSession = fixture.db.prepare("SELECT id FROM sessions WHERE user_id=? AND name='owner session'").get(fixture.userId) as { id: string };
    for (const id of [first.sessionId, other.sessionId]) assert.notEqual(id, ownerSession.id);
  });

  it("settles the dispatch from the CLI turn-end hook and holds the goal while the CLI works", async () => {
    roster(writer("claude"));
    const fixture = tracked(dispatchFixture());
    fixture.db.prepare("UPDATE copilot_runs SET status='completed', completed_at=? WHERE user_id=? AND goal_id=?").run(Date.now(), fixture.userId, fixture.goalId);
    const { sessionId } = await fixture.tool.execute(
      { taskId: fixture.taskId, aiTool: "claude", instructions: "work" }, fixture.context) as { sessionId: string };
    const enqueued: string[] = [];
    const deps = { db: fixture.db, masterKey, eventBus: new ForgeBadgerEventBus() } as never;
    const enqueue = (input: { goalId?: string }) => { enqueued.push(input.goalId!); return randomUUID(); };
    assert.deepEqual(evaluateGoalContinuation(deps, fixture.userId, fixture.goalId, enqueue as never), { action: "busy", reason: "awaiting_cli" });
    assert.deepEqual(enqueued, []);

    const event = (patch: Record<string, unknown>) => ({
      type: "session_notification", userId: fixture.userId, sessionId, projectId: "p", sessionName: "s",
      hookEventName: "Stop", notificationType: "task_completed", message: "done", adapter: "claude", ...patch
    }) as unknown as ForgeBadgerEvent;
    // Child-agent turns and other users' sessions never settle the task.
    assert.deepEqual(settleGoalDispatchFromHook(fixture.db, event({ nativeSubagent: true })), []);
    assert.deepEqual(settleGoalDispatchFromHook(fixture.db, event({ userId: randomUUID() })), []);
    assert.deepEqual(settleGoalDispatchFromHook(fixture.db, event({})), [{ userId: fixture.userId, goalId: fixture.goalId }]);
    assert.deepEqual(settleGoalDispatchFromHook(fixture.db, event({})), [], "duplicate reports are no-ops");
    const task = fixture.store.listTasks(fixture.goalId).find(entry => entry.id === fixture.taskId)!;
    assert.equal(task.dispatch_status, "completed");
    assert.equal(task.status, "pending", "a finished CLI turn is not acceptance");
    assert.ok(fixture.store.recentJournal(fixture.goalId).some(entry => entry.note.includes("reported task_completed") && entry.note.includes("not verification")));
    assert.equal(evaluateGoalContinuation(deps, fixture.userId, fixture.goalId, enqueue as never).action, "enqueued");
  });

  it("releases the goal when a submit fails and when a running CLI never reports", async () => {
    roster(writer("claude"));
    const fixture = tracked(dispatchFixture());
    fixture.db.prepare("UPDATE copilot_runs SET status='completed', completed_at=? WHERE user_id=? AND goal_id=?").run(Date.now(), fixture.userId, fixture.goalId);
    const submit = fixture.sessionManager.submitProgrammaticTask.bind(fixture.sessionManager);
    fixture.sessionManager.submitProgrammaticTask = async () => { throw new Error("PROGRAMMATIC_INPUT_NOT_READY"); };
    await assert.rejects(fixture.tool.execute({ taskId: fixture.taskId, aiTool: "claude", instructions: "work" }, fixture.context));
    assert.equal(fixture.store.listTasks(fixture.goalId).find(entry => entry.id === fixture.taskId)!.dispatch_status, "failed");

    fixture.sessionManager.submitProgrammaticTask = submit;
    await fixture.tool.execute({ taskId: fixture.verifyTaskId, aiTool: "claude", instructions: "work" }, fixture.context);
    const deps = { db: fixture.db, masterKey, eventBus: new ForgeBadgerEventBus() } as never;
    const enqueue = (() => randomUUID()) as never;
    assert.equal(evaluateGoalContinuation(deps, fixture.userId, fixture.goalId, enqueue).reason, "awaiting_cli");
    const later = Date.now() + DISPATCH_REPORT_TIMEOUT_MS + 1;
    assert.equal(evaluateGoalContinuation(deps, fixture.userId, fixture.goalId, enqueue, { now: later }).action, "enqueued");
    assert.equal(fixture.store.listTasks(fixture.goalId).find(entry => entry.id === fixture.verifyTaskId)!.dispatch_status, "ended");
    assert.ok(fixture.store.recentJournal(fixture.goalId).some(entry => entry.note.includes("no turn-end report")));
  });

  it("stops waiting when the dispatched session ends without a report", async () => {
    roster(writer("claude"));
    const fixture = tracked(dispatchFixture());
    fixture.db.prepare("UPDATE copilot_runs SET status='completed', completed_at=? WHERE user_id=? AND goal_id=?").run(Date.now(), fixture.userId, fixture.goalId);
    const { sessionId } = await fixture.tool.execute(
      { taskId: fixture.taskId, aiTool: "claude", instructions: "work" }, fixture.context) as { sessionId: string };
    fixture.db.prepare("UPDATE sessions SET status='stopped' WHERE id=?").run(sessionId);
    const deps = { db: fixture.db, masterKey, eventBus: new ForgeBadgerEventBus() } as never;
    const decision = evaluateGoalContinuation(deps, fixture.userId, fixture.goalId, (() => randomUUID()) as never);
    assert.equal(decision.action, "enqueued");
    assert.equal(fixture.store.listTasks(fixture.goalId).find(entry => entry.id === fixture.taskId)!.dispatch_status, "ended");
    assert.ok(fixture.store.recentJournal(fixture.goalId).some(entry => entry.note.includes("ended without reporting")));
  });

  describe("parallel task worktrees", () => {
    const limit = (error: unknown) => error instanceof AgentError && error.code === "COPILOT_GOAL_PARALLEL_LIMIT";
    const unavailable = (error: unknown) => error instanceof AgentError && error.code === "COPILOT_GOAL_TASK_WORKSPACE_UNAVAILABLE";

    function verifiedTasks(fixture: DispatchFixture, count: number): string[] {
      return fixture.store.addTasks(fixture.goalId, Array.from({ length: count }, (_, index) => ({ description: `Parallel ${index}`, verifyCommand: `test -f p${index}.txt` })))
        .map(task => task.id);
    }
    const dispatch = (fixture: DispatchFixture, input: Record<string, unknown>) =>
      fixture.tool.execute({ aiTool: "claude", instructions: "work", ...input }, fixture.context) as Promise<{ sessionId: string; workspace: string; sessionCreated: boolean }>;
    const workingDir = (fixture: DispatchFixture, sessionId: string) =>
      (fixture.db.prepare("SELECT working_dir FROM sessions WHERE id=?").get(sessionId) as { working_dir: string }).working_dir;
    const projectHead = (fixture: DispatchFixture) => execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.projectDir, encoding: "utf8" }).trim();
    const projectStatus = (fixture: DispatchFixture) => execFileSync("git", ["status", "--porcelain=v1"], { cwd: fixture.projectDir, encoding: "utf8" });

    it("runs the CLI in the task worktree with a parallel-aware workspace note", async () => {
      roster(writer("claude"));
      const fixture = tracked(dispatchFixture({ git: true }));
      const headBefore = projectHead(fixture);
      const result = await dispatch(fixture, { taskId: fixture.verifyTaskId, parallel: true });
      assert.equal(result.workspace, "task-worktree");
      const dir = workingDir(fixture, result.sessionId);
      assert.equal(dir, path.join(stateRoot, "goal-worktrees", `tasks-${fixture.goalId}`, fixture.verifyTaskId));
      assert.notEqual(dir, fixture.workspaceDir());
      const submitted = stagedInputs.join("");
      assert.ok(submitted.includes(`forgebadger/goal-task-${fixture.verifyTaskId}`), submitted);
      assert.ok(submitted.includes("Other team members work in parallel in their own worktrees"), submitted);
      assert.ok(fixture.store.recentJournal(fixture.goalId).some(entry => entry.note.includes("task worktree on forgebadger/goal-task-")));
      assert.equal(projectHead(fixture), headBefore);
      assert.equal(projectStatus(fixture).includes("README"), false);
    });

    it("refuses parallel without a verify_command and on copy-sandbox goals", async () => {
      roster(writer("claude"));
      const fixture = tracked(dispatchFixture({ git: true }));
      await assert.rejects(dispatch(fixture, { taskId: fixture.taskId, parallel: true }), (error: unknown) => invalid(error) && /verify_command/.test((error as Error).message));
      const copy = tracked(dispatchFixture());
      await assert.rejects(dispatch(copy, { taskId: copy.verifyTaskId, parallel: true }), unavailable);
    });

    it("enforces maxParallelWriters for all dispatches of a goal", async () => {
      setCopilotTeamRoster({ maxParallelWriters: 2, members: [writer("claude")] });
      const fixture = tracked(dispatchFixture({ git: true }));
      const [a, b, c] = verifiedTasks(fixture, 3) as [string, string, string];
      await dispatch(fixture, { taskId: a, parallel: true });
      await dispatch(fixture, { taskId: b, parallel: true });
      await assert.rejects(dispatch(fixture, { taskId: c, parallel: true }), limit);
      await assert.rejects(dispatch(fixture, { taskId: fixture.taskId }), limit, "shared dispatches count too");
      // Re-dispatching a running task does not count against itself.
      assert.equal((await dispatch(fixture, { taskId: a })).workspace, "task-worktree");
      fixture.store.settleDispatch(b, "completed");
      assert.equal((await dispatch(fixture, { taskId: c, parallel: true })).workspace, "task-worktree");
    });

    it("allows exactly one shared-tree writer, while parallel dispatch stays possible", async () => {
      setCopilotTeamRoster({ maxParallelWriters: 3, members: [writer("claude")] });
      const fixture = tracked(dispatchFixture({ git: true }));
      const [a, b] = verifiedTasks(fixture, 2) as [string, string];
      const shared = await dispatch(fixture, { taskId: a });
      assert.equal(shared.workspace, "worktree");
      assert.equal(workingDir(fixture, shared.sessionId), fixture.workspaceDir());
      await assert.rejects(dispatch(fixture, { taskId: b }),
        (error: unknown) => invalid(error) && /parallel: true/.test((error as Error).message) && (error as Error).message.includes(a));
      // A parallel fork would checkpoint the shared-tree CLI's half-done edits onto the goal branch: refused while it runs.
      await assert.rejects(dispatch(fixture, { taskId: b, parallel: true }), (error: unknown) => invalid(error) && /half-done/.test((error as Error).message));
      // Re-dispatching the shared writer itself stays allowed; moving it into a worktree mid-turn does not.
      assert.equal((await dispatch(fixture, { taskId: a })).sessionCreated, false);
      await assert.rejects(dispatch(fixture, { taskId: a, parallel: true }), (error: unknown) => invalid(error) && /shared goal tree/.test((error as Error).message));
      fixture.store.settleDispatch(a, "completed");
      assert.equal((await dispatch(fixture, { taskId: b, parallel: true })).workspace, "task-worktree");
    });

    it("always dispatches a task that owns a worktree there, and reuses its session", async () => {
      roster(writer("claude"));
      const fixture = tracked(dispatchFixture({ git: true }));
      const first = await dispatch(fixture, { taskId: fixture.verifyTaskId, parallel: true });
      fixture.store.settleDispatch(fixture.verifyTaskId, "completed");
      const second = await dispatch(fixture, { taskId: fixture.verifyTaskId });
      assert.equal(second.workspace, "task-worktree");
      assert.equal(second.sessionId, first.sessionId);
      assert.equal(second.sessionCreated, false);
    });

    it("settle report lists the task tree's files, not the goal tree's", async () => {
      roster(writer("claude"));
      const fixture = tracked(dispatchFixture({ git: true }));
      const result = await dispatch(fixture, { taskId: fixture.verifyTaskId, parallel: true });
      const dir = workingDir(fixture, result.sessionId);
      fs.writeFileSync(path.join(dir, "task-only.ts"), "export {};\n");
      fs.writeFileSync(path.join(fixture.workspaceDir(), "goal-only.ts"), "export {};\n");
      settleGoalDispatchFromHook(fixture.db, {
        type: "session_notification", userId: fixture.userId, sessionId: result.sessionId, hookEventName: "Stop",
        notificationType: "task_completed", message: "done", adapter: "claude"
      } as unknown as ForgeBadgerEvent);
      const note = fixture.store.recentJournal(fixture.goalId).map(entry => entry.note).find(text => text.includes("reported task_completed"))!;
      assert.ok(note.includes("task worktree changed files (1): task-only.ts"), note);
      assert.ok(!note.includes("goal-only.ts"), note);
    });
  });

  it("dispatch does not satisfy the verify gate", async () => {
    roster(writer("claude"));
    const fixture = tracked(dispatchFixture());
    await fixture.tool.execute(
      { taskId: fixture.verifyTaskId, aiTool: "claude", instructions: "run the checks" }, fixture.context);
    assert.throws(() => fixture.store.updateTask(fixture.goalId, fixture.verifyTaskId, "passes"),
      (error: unknown) => error instanceof AgentError && error.code === "COPILOT_GOAL_VERIFY_REQUIRED");
  });

  it("routes through the approval gate: no grant waits, pm_dispatch grant auto-executes", async () => {
    roster(writer("claude"));
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
      sessionManager: withGrant.sessionManager, adapterCommandRunner
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
