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
import { SessionRepository } from "../src/db/repositories/session-repository.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { createCopilotOrchestrator } from "../src/services/agent/orchestrator.js";
import type { AgentLlmClient, AgentLlmStreamEvent } from "../src/services/agent/orchestrator-types.js";
import { createAgentToolRegistry, type AgentToolContext } from "../src/services/agent/tool-registry.js";
import { computeToolSurface, FLEET_TOOLS, GOAL_TOOLS } from "../src/services/agent/tool-surface.js";
import { goalGrantForTool } from "../src/services/agent/goal-grants.js";
import { evaluateGoalContinuation, settleGoalDispatchFromHook } from "../src/services/agent/goal-driver.js";
import { REVIEW_REPORT_FILE, settleGoalReviewFromHook } from "../src/services/agent/goal-review.js";
import { goalTeamView } from "../src/services/agent/goal-team-view.js";
import { createGoalTools } from "../src/services/agent/tools/goals.js";
import { createGoalDelegateTools } from "../src/services/agent/tools/goal-delegate.js";
import { createGoalSandboxTools } from "../src/services/agent/tools/goal-sandbox.js";
import { createGoalIntegrateTools } from "../src/services/agent/tools/goal-integrate.js";
import { createGoalReviewTools } from "../src/services/agent/tools/goal-review.js";
import { defaultCopilotTeam, setCopilotTeamRoster, type TeamMember } from "../src/services/agent/team-roster.js";
import { AgentError } from "../src/services/agent/types.js";
import { FleetStore } from "../src/services/fleet/fleet-store.js";
import { fleetContextMessage, scopeContextMessage } from "../src/services/fleet/fleet-context.js";
import { ForgeBadgerEventBus, type ForgeBadgerEvent } from "../src/services/event-bus.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";

const masterKey = "abcdef0123456789abcdef0123456789";
const stateRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fb-fleet-exec-state-")));
process.env.FORGEBADGER_STATE_DIR = stateRoot;
process.env.CLAUDE_CONFIG_DIR = path.join(stateRoot, "claude-config");
const adapterCommandRunner = async (command: string) => ({ exitCode: 0, stdout: `${command} 1.0.0`, stderr: "" });

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd, encoding: "utf8",
    env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Owner", GIT_AUTHOR_EMAIL: "owner@example.com",
      GIT_COMMITTER_NAME: "Owner", GIT_COMMITTER_EMAIL: "owner@example.com" }
  }).trim();
}

/**
 * Fake terminal whose ready frame satisfies both the Claude and the Codex
 * composer parsers (writers are Claude, the reviewer is Codex); staged text is
 * echoed into both composers and Enter consumes it.
 */
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

interface Fixture {
  db: Database.Database; userId: string; projectDir: string; projectId: string; store: FleetStore; fleetId: string; conversationId: string;
  runId: string; context: AgentToolContext; sessionManager: InMemorySessionManager;
}

function fixture(grants: string[] = []): Fixture {
  const db = new Database(":memory:");
  migrate(drizzle(db), { migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations") });
  const user = new UserRepository(db).create(`fleet-exec-${randomUUID()}@example.com`, "hash");
  const projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fb-fleet-exec-project-")));
  fs.writeFileSync(path.join(projectDir, "README.md"), "line1\nline2\n");
  git(projectDir, "init", "-q", "-b", "main"); git(projectDir, "add", "-A"); git(projectDir, "commit", "-q", "-m", "initial");
  const projectId = randomUUID();
  db.prepare("INSERT INTO projects(id,user_id,name,path,ai_tool,status) VALUES(?,?,?,?,?,?)").run(projectId, user.id, "fleet-project", projectDir, "claude", "active");
  const store = new FleetStore(db, user.id);
  const fleet = store.createFleet({ projectId, grants });
  const runId = randomUUID();
  db.prepare(`INSERT INTO copilot_runs(id,user_id,conversation_id,status,goal_id,runtime_version,input_json,created_at,updated_at)
    VALUES(?,?,?,'completed',?,1,'{}',?,?)`).run(runId, user.id, fleet.conversation_id, fleet.id, Date.now(), Date.now());
  const sessionManager = terminalManager();
  return {
    db, userId: user.id, projectDir, projectId, store, fleetId: fleet.id, conversationId: fleet.conversation_id, runId, sessionManager,
    context: { db, userId: user.id, masterKey: "k", runId, sessionManager, adapterCommandRunner, eventBus: new ForgeBadgerEventBus() } as AgentToolContext
  };
}

function member(id: string, adapter: TeamMember["adapter"], roles: TeamMember["roles"]): TeamMember {
  return { id, name: id, title: "Engineer", description: "Careful", adapter, roles, enabled: true };
}
function roster(): void {
  setCopilotTeamRoster({ maxParallelWriters: 3, members: [member("claude-a", "claude", ["writer"]), member("claude-b", "claude", ["writer"]), member("codex-rev", "codex", ["reviewer"])] });
}

const allTools = () => [...createGoalTools(), ...createGoalDelegateTools(), ...createGoalSandboxTools(), ...createGoalIntegrateTools(), ...createGoalReviewTools()];
const tool = (name: string) => allTools().find(entry => entry.name === name)!;
const run = <T>(f: Fixture, name: string, input: Record<string, unknown>) => tool(name).execute(input, f.context) as Promise<T>;
const rejectsWith = (code: string) => (error: unknown) => error instanceof AgentError && error.code === code;
const sessionDir = (f: Fixture, sessionId: string) => new SessionRepository(f.db, f.userId).getById(sessionId)!.workingDir;
const projectState = (dir: string) => ({ head: git(dir, "rev-parse", "HEAD"), branch: git(dir, "symbolic-ref", "--short", "HEAD"), status: git(dir, "status", "--porcelain=v1", "--untracked-files=all") });
const hookEvent = (f: Fixture, sessionId: string) => ({
  type: "session_notification", userId: f.userId, sessionId, projectId: f.projectId, sessionName: "s",
  hookEventName: "Stop", notificationType: "task_completed", message: "done", adapter: "claude"
}) as unknown as ForgeBadgerEvent;

async function until(check: () => boolean): Promise<void> {
  for (let index = 0; index < 200 && !check(); index += 1) await new Promise(done => setTimeout(done, 25));
  assert.ok(check(), "condition not reached in time");
}

/** LLM that calls one tool once, then answers; records every request it saw. */
function scriptedLlm(toolName: string, args: Record<string, unknown>, seen: Array<{ tools: string[]; messages: string }>): AgentLlmClient {
  let calls = 0;
  return {
    async stream(request) {
      calls += 1;
      seen.push({ tools: request.tools.map(entry => entry.name), messages: JSON.stringify(request.messages) });
      if (calls === 1) {
        (request.onEvent as (event: AgentLlmStreamEvent) => void)({ type: "tool_call", toolCall: { id: "call-1", name: toolName, arguments: JSON.stringify(args) } });
        return { message: "" };
      }
      return { message: "done" };
    },
    async summarize() { return ""; },
    async generateTitle() { return ""; }
  };
}

describe("goal execution machinery on a fleet scope", () => {
  const dbs: Database.Database[] = [];
  function tracked(f: Fixture): Fixture { dbs.push(f.db); return f; }
  beforeEach(() => { roster(); stagedInputs.length = 0; });
  after(() => { setCopilotTeamRoster(defaultCopilotTeam()); for (const db of dbs) if (db.open) db.close(); fs.rmSync(stateRoot, { recursive: true, force: true }); });

  it("adds, dispatches, verifies, reviews, integrates and passes tasks without touching the project", async () => {
    const f = tracked(fixture());
    const before = projectState(f.projectDir);

    // goal_add_tasks: board tasks only, no project board work items.
    const { tasks } = await run<{ tasks: Array<{ id: string; goal_id: string; created_by: string }> }>(f, "goal_add_tasks", { descriptions: [
      { description: "Feature A", verifyCommand: "test -f feat-a.txt" }, "Shared notes"] });
    assert.equal(tasks.length, 2);
    assert.deepEqual(tasks.map(task => [task.goal_id, task.created_by]), [[f.fleetId, "lead"], [f.fleetId, "lead"]]);
    assert.equal((f.db.prepare("SELECT count(*) AS count FROM project_manager_work_items WHERE user_id=?").get(f.userId) as { count: number }).count, 0);
    assert.equal((f.db.prepare("SELECT count(*) AS count FROM copilot_goal_tasks").get() as { count: number }).count, 0);
    const [taskA, shared] = tasks.map(task => task.id) as [string, string];

    // Shared-tree dispatch: the fleet worktree on forgebadger/fleet-<id>, member recorded.
    const first = await run<{ sessionId: string; workspace: string; member: { id: string } }>(f, "goal_dispatch_task", { taskId: shared, memberId: "claude-a", instructions: "write notes" });
    const fleetTree = path.join(stateRoot, "goal-worktrees", f.fleetId);
    assert.deepEqual([first.workspace, first.member.id, sessionDir(f, first.sessionId)], ["worktree", "claude-a", fleetTree]);
    assert.equal(git(fleetTree, "symbolic-ref", "--short", "HEAD"), `forgebadger/fleet-${f.fleetId}`);
    const fleetRow = f.store.getFleet(f.fleetId)!;
    assert.deepEqual([fleetRow.workspace_kind, fleetRow.workspace_branch, fleetRow.workspace_target_branch], ["worktree", `forgebadger/fleet-${f.fleetId}`, "main"]);
    assert.equal(f.store.getTask(f.fleetId, shared)!.member_id, "claude-a");
    assert.equal(f.store.getTask(f.fleetId, shared)!.dispatch_status, "running");
    // The goal driver's hook path does not settle fleet tasks (the fleet inbox will).
    assert.deepEqual(settleGoalDispatchFromHook(f.db, hookEvent(f, first.sessionId)), []);
    assert.equal(f.store.getTask(f.fleetId, shared)!.dispatch_status, "running");
    f.store.settleDispatch(shared, "completed");

    // Parallel dispatch into a task worktree.
    const second = await run<{ sessionId: string; workspace: string }>(f, "goal_dispatch_task", { taskId: taskA, memberId: "claude-b", instructions: "build A", parallel: true });
    const taskTree = path.join(stateRoot, "goal-worktrees", `tasks-${f.fleetId}`, taskA);
    assert.deepEqual([second.workspace, sessionDir(f, second.sessionId)], ["task-worktree", taskTree]);
    assert.equal(git(taskTree, "symbolic-ref", "--short", "HEAD"), `forgebadger/goal-task-${taskA}`);
    assert.ok(stagedInputs.at(-1)!.includes("isolated git worktree dedicated to this task"));
    assert.equal(f.store.getTask(f.fleetId, taskA)!.member_id, "claude-b");
    fs.writeFileSync(path.join(taskTree, "feat-a.txt"), "A\n");
    f.store.settleDispatch(taskA, "completed");

    // Verify where the work is.
    const checked = await run<{ exitCode: number; workspace: string; verified?: { taskId: string } }>(f, "goal_run_checks", { command: "test -f feat-a.txt", taskId: taskA });
    assert.deepEqual([checked.exitCode, checked.workspace, checked.verified?.taskId], [0, "task-worktree", taskA]);
    assert.match(f.store.getTask(f.fleetId, taskA)!.evidence!, /verified-tree: [a-f0-9]{40}/);

    // Cross-CLI review by the codex reviewer, collected from its report.
    const review = await run<{ sessionId: string; reviewer: { id: string }; writerAdapter: string; scope: string }>(f, "goal_review_task", { taskId: taskA });
    assert.deepEqual([review.reviewer.id, review.writerAdapter, review.scope], ["codex-rev", "claude", "task"]);
    const checkout = sessionDir(f, review.sessionId);
    assert.equal(checkout, path.join(stateRoot, "goal-worktrees", `reviews-${f.fleetId}`, `${taskA}-r1`));
    fs.writeFileSync(path.join(checkout, REVIEW_REPORT_FILE), JSON.stringify({ verdict: "approve", summary: "Fine.", findings: [] }));
    const deps = { sessionManager: f.sessionManager };
    assert.deepEqual(settleGoalReviewFromHook(f.db, hookEvent(f, review.sessionId), deps), [{ userId: f.userId, goalId: f.fleetId }]);
    const collected = await run<{ rounds: number; attempts: Array<{ verdict?: string }> }>(f, "goal_get_review", { taskId: taskA });
    assert.deepEqual([collected.rounds, collected.attempts[0]!.verdict], [1, "approve"]);
    assert.ok(f.store.recentJournal(f.fleetId, 20).some(entry => entry.note.startsWith(`Review of task '${taskA}'`)));
    await until(() => !fs.existsSync(checkout));

    // Integrate into the fleet branch, then pass.
    const integrated = await run<{ integrated: boolean; changedFileCount: number }>(f, "goal_integrate_task", { taskId: taskA });
    assert.deepEqual([integrated.integrated, integrated.changedFileCount], [true, 1]);
    assert.equal(git(fleetTree, "show", `forgebadger/fleet-${f.fleetId}:feat-a.txt`), "A");
    const passed = await run<{ task: { status: string } }>(f, "goal_update_task", { taskId: taskA, status: "passes", evidence: "verified and integrated" });
    assert.equal(passed.task.status, "passes");

    // Owner-facing team view prefers the stored member.
    const view = await goalTeamView(f.db, f.userId, f.store.getGoal(f.fleetId)!);
    const byTask = new Map(view.tasks.map(entry => [entry.taskId, entry]));
    assert.deepEqual([byTask.get(taskA)!.worker?.memberId, byTask.get(taskA)!.workspace, byTask.get(taskA)!.integrated, byTask.get(taskA)!.review?.rounds],
      ["claude-b", "own", true, 1]);
    assert.equal(byTask.get(shared)!.worker?.memberId, "claude-a");

    // The fleet context reflects the board.
    const message = fleetContextMessage(f.db, f.userId, f.fleetId)!;
    assert.equal(scopeContextMessage(f.db, f.userId, f.fleetId), message);
    assert.match(message, /^Fleet lead run/);
    for (const part of [`"id":"${taskA}"`, '"status":"passes"', '"memberId":"claude-b"', '"isolatedWorktree":true', '"verdict":"approve"', "do not wait"])
      assert.ok(message.includes(part), part);

    // Goal continuation never runs on a fleet scope.
    let enqueued = 0;
    const decision = evaluateGoalContinuation({ db: f.db, masterKey, eventBus: new ForgeBadgerEventBus(), sessionManager: f.sessionManager } as never,
      f.userId, f.fleetId, () => { enqueued += 1; return randomUUID(); });
    assert.deepEqual([decision.action, enqueued], ["inactive", 0]);

    // The project repository never moved.
    assert.deepEqual(projectState(f.projectDir), before);
  });

  it("hides goal_ask_user in fleet runs and keeps the goal tools", () => {
    const registry = createAgentToolRegistry(allTools());
    const visible = (input: { goalId?: string; fleet?: boolean }) =>
      new Set(computeToolSurface({ source: "user", ...input }, { registry, hasSessionManager: true }).visible.map(entry => entry.name));
    const fleetRun = visible({ goalId: randomUUID(), fleet: true });
    const goalRun = visible({ goalId: randomUUID() });
    assert.equal(fleetRun.has("goal_ask_user"), false);
    assert.equal(goalRun.has("goal_ask_user"), true);
    for (const name of GOAL_TOOLS) if (name !== "goal_ask_user") assert.ok(fleetRun.has(name), name);
    assert.ok(FLEET_TOOLS instanceof Set);
    // goal_ask_user refuses a fleet scope even if called directly.
    const f = tracked(fixture());
    return assert.rejects(run(f, "goal_ask_user", { question: "?" }), rejectsWith("COPILOT_GOAL_STATE"));
  });

  it("admits fleet runs only on the fleet conversation, injects the fleet context, and honours fleet grants", async () => {
    const f = tracked(fixture(["pm_dispatch"]));
    const task = f.store.addTask(f.fleetId, { description: "Granted task", createdBy: "owner" });
    assert.equal(goalGrantForTool(f.db, f.userId, f.fleetId, "goal_dispatch_task"), "pm_dispatch");
    const seen: Array<{ tools: string[]; messages: string }> = [];
    const orchestrator = createCopilotOrchestrator({
      db: f.db, masterKey, toolRegistry: createAgentToolRegistry(allTools()),
      llm: scriptedLlm("goal_dispatch_task", { taskId: task.id, memberId: "claude-a", instructions: "go" }, seen),
      eventBus: new ForgeBadgerEventBus(), sessionManager: f.sessionManager, adapterCommandRunner
    });
    const other = new CopilotConversationLog(f.db, f.userId).createConversation();
    assert.throws(() => orchestrator.enqueue({ userId: f.userId, conversationId: other.id, userText: "x", source: "user", clientRequestId: randomUUID(), goalId: f.fleetId }),
      rejectsWith("COPILOT_NOT_FOUND"));
    const runId = orchestrator.enqueue({ userId: f.userId, conversationId: f.conversationId, userText: "event batch", source: "user", clientRequestId: randomUUID(), goalId: f.fleetId });
    await new Promise(resolve => setImmediate(resolve));
    await orchestrator.executeRun(f.userId, runId);
    assert.equal(new CopilotConversationLog(f.db, f.userId).getRun(runId)?.status, "completed");
    assert.ok(seen[0]!.tools.includes("goal_dispatch_task"));
    assert.equal(seen[0]!.tools.includes("goal_ask_user"), false, "the orchestrator computes the fleet flag itself");
    assert.ok(seen[0]!.messages.includes("Fleet lead run"));
    const row = f.store.getTask(f.fleetId, task.id)!;
    assert.deepEqual([row.dispatch_status, row.member_id], ["running", "claude-a"]);
    assert.ok(f.store.recentJournal(f.fleetId, 20).some(entry => entry.note.includes("自动执行 goal_dispatch_task") && entry.note.includes("pm_dispatch")));
  });

  it("keeps per-call approval without a fleet grant and while the fleet is paused", async () => {
    const f = tracked(fixture());
    const task = f.store.addTask(f.fleetId, { description: "Ungranted task", createdBy: "owner" });
    const orchestrator = createCopilotOrchestrator({
      db: f.db, masterKey, toolRegistry: createAgentToolRegistry(allTools()),
      llm: scriptedLlm("goal_dispatch_task", { taskId: task.id, memberId: "claude-a", instructions: "go" }, []),
      eventBus: new ForgeBadgerEventBus(), sessionManager: f.sessionManager, adapterCommandRunner
    });
    const runId = orchestrator.enqueue({ userId: f.userId, conversationId: f.conversationId, userText: "event batch", source: "user", clientRequestId: randomUUID(), goalId: f.fleetId });
    await new Promise(resolve => setImmediate(resolve));
    await orchestrator.executeRun(f.userId, runId);
    assert.equal(new CopilotConversationLog(f.db, f.userId).getRun(runId)?.status, "awaiting_approval");
    assert.equal(f.store.getTask(f.fleetId, task.id)!.dispatched_session_id, null);

    f.store.updateFleet(f.fleetId, { grants: ["pm_dispatch"] });
    f.store.setStatus(f.fleetId, "paused", "owner");
    assert.equal(goalGrantForTool(f.db, f.userId, f.fleetId, "goal_dispatch_task"), null, "a paused fleet grants nothing");
    // Settle the parked run so the conversation can take a new one.
    f.db.prepare("UPDATE copilot_runs SET status='stopped' WHERE id=?").run(runId);
    const pausedRun = orchestrator.enqueue({ userId: f.userId, conversationId: f.conversationId, userText: "late event", source: "user", clientRequestId: randomUUID(), goalId: f.fleetId });
    await new Promise(resolve => setImmediate(resolve));
    await orchestrator.executeRun(f.userId, pausedRun);
    const stopped = new CopilotConversationLog(f.db, f.userId).getRun(pausedRun) as { status: string; stopReason?: string };
    assert.deepEqual([stopped.status, stopped.stopReason], ["stopped", "goal_paused"], "a paused fleet stops its lead run like a paused goal");
  });
});
