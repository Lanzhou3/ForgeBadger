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
import { InMemorySessionManager } from "../src/services/session-manager.js";
import { DISPATCH_REPORT_TIMEOUT_MS, evaluateGoalContinuation, settleGoalDispatchFromHook } from "../src/services/agent/goal-driver.js";
import { defaultCopilotTeam, setCopilotTeamRoster } from "../src/services/agent/team-roster.js";
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
function claudeSessionManager(): InMemorySessionManager {
  const ready = "some output\n────────────\n❯ \n────────────\n";
  let pane = ready;
  return new InMemorySessionManager({
    async createSession() {}, async killSession() {}, async listSessions() { return []; }, async hasSession() { return true; },
    async capturePane() { return pane; }, async inspectPane() { return { content: pane, dead: false }; },
    async stageProgrammaticInput(_name: string, data: string) { pane = `────────────\n❯ ${data}\n────────────\n`; },
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


describe("goal dispatch settle report", () => {
  const dbs: Database.Database[] = [];
  function tracked(fixture: DispatchFixture) { dbs.push(fixture.db); return fixture; }
  after(() => {
    setCopilotTeamRoster(defaultCopilotTeam());
    for (const db of dbs) if (db.open) db.close();
    fs.rmSync(stateRoot, { recursive: true, force: true });
  });

  async function dispatched(options: { git?: boolean } = {}) {
    setCopilotTeamRoster({ maxParallelWriters: 3, members: [{ id: "claude-writer", name: "Claude", title: "", description: "",
      adapter: "claude", roles: ["writer"], enabled: true }] });
    const fixture = tracked(dispatchFixture(options));
    const { sessionId } = await fixture.tool.execute(
      { taskId: fixture.taskId, aiTool: "claude", instructions: "work" }, fixture.context) as { sessionId: string };
    return { fixture, sessionId };
  }
  const hook = (fixture: DispatchFixture, sessionId: string, patch: Record<string, unknown> = {}) => ({
    type: "session_notification", userId: fixture.userId, sessionId, hookEventName: "Stop",
    notificationType: "task_completed", message: "done", adapter: "claude", ...patch
  }) as unknown as ForgeBadgerEvent;
  const summary = (text: string) => ({ version: 1, runtimeEpoch: "e", identityQuality: "exact_turn", state: "done", observedAt: 1,
    progress: [], verification: [], result: { text, source: "native_final_message" } });
  const lastNote = (fixture: DispatchFixture) => fixture.store.recentJournal(fixture.goalId).map(entry => entry.note)
    .find(note => note.includes("reported task_completed"))!;

  it("includes the CLI final message and changed files in the journal note", async () => {
    const { fixture, sessionId } = await dispatched({ git: true });
    const wt = fixture.workspaceDir();
    fs.writeFileSync(path.join(wt, "README.md"), "# changed\n");
    fs.writeFileSync(path.join(wt, "new-file.ts"), "export {};\n");
    const out = settleGoalDispatchFromHook(fixture.db, hook(fixture, sessionId, { cliSummary: summary("Implemented the parser.") }));
    assert.equal(out.length, 1);
    const note = lastNote(fixture);
    assert.ok(note.includes("not verification"));
    assert.ok(note.includes('CLI report (unverified, from the CLI): "Implemented the parser."'));
    assert.ok(note.includes("README.md") && note.includes("new-file.ts"));
    assert.match(note, /changed files \(\d+\)/);
    assert.ok(note.length <= 1500);
  });

  it("leaves ForgeBadger-managed CLI hook files out of the changed files", async () => {
    const { fixture, sessionId } = await dispatched({ git: true });
    const wt = fixture.workspaceDir();
    fs.mkdirSync(path.join(wt, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(wt, ".claude", "settings.local.json"), "{}\n");
    fs.writeFileSync(path.join(wt, "work.ts"), "export {};\n");
    settleGoalDispatchFromHook(fixture.db, hook(fixture, sessionId));
    const note = lastNote(fixture);
    assert.ok(note.includes("work.ts"));
    assert.ok(!note.includes("settings.local.json"));
  });

  it("says so when the adapter reports no final message", async () => {
    const { fixture, sessionId } = await dispatched({ git: true });
    settleGoalDispatchFromHook(fixture.db, hook(fixture, sessionId));
    assert.ok(lastNote(fixture).includes("no final message reported by this adapter"));
  });

  it("degrades without throwing when the workspace is missing or git fails", async () => {
    const { fixture, sessionId } = await dispatched({ git: true });
    fs.rmSync(fixture.workspaceDir(), { recursive: true, force: true });
    const out = settleGoalDispatchFromHook(fixture.db, hook(fixture, sessionId, { cliSummary: summary("ok") }));
    assert.equal(out.length, 1);
    assert.equal(fixture.store.listTasks(fixture.goalId).find(t => t.id === fixture.taskId)!.dispatch_status, "completed");
    assert.ok(lastNote(fixture).includes("changed files: unavailable"));
  });

  it("skips the file list for copy workspaces", async () => {
    const { fixture, sessionId } = await dispatched();
    settleGoalDispatchFromHook(fixture.db, hook(fixture, sessionId));
    assert.ok(lastNote(fixture).includes("changed files: not available for copy workspaces"));
  });

  it("caps the file list at 30 paths and reports the remainder", async () => {
    const { fixture, sessionId } = await dispatched({ git: true });
    const wt = fixture.workspaceDir();
    for (let i = 0; i < 45; i += 1) fs.writeFileSync(path.join(wt, `f${String(i).padStart(2, "0")}.ts`), "x");
    settleGoalDispatchFromHook(fixture.db, hook(fixture, sessionId));
    const note = lastNote(fixture);
    assert.match(note, /changed files \(\d+\)/);
    assert.match(note, /… \d+ more/);
    assert.ok(note.length <= 1500);
  });

  it("reports the task worktree's changed files for a parallel task, not the goal tree's", async () => {
    setCopilotTeamRoster({ maxParallelWriters: 3, members: [{ id: "claude-writer", name: "Claude", title: "", description: "",
      adapter: "claude", roles: ["writer"], enabled: true }] });
    const fixture = tracked(dispatchFixture({ git: true }));
    const { sessionId } = await fixture.tool.execute(
      { taskId: fixture.verifyTaskId, aiTool: "claude", instructions: "work", parallel: true }, fixture.context) as { sessionId: string };
    const taskDir = (fixture.db.prepare("SELECT working_dir FROM sessions WHERE id=?").get(sessionId) as { working_dir: string }).working_dir;
    assert.notEqual(taskDir, fixture.workspaceDir());
    fs.writeFileSync(path.join(taskDir, "member.ts"), "export {};\n");
    fs.writeFileSync(path.join(fixture.workspaceDir(), "lead.ts"), "export {};\n");
    settleGoalDispatchFromHook(fixture.db, hook(fixture, sessionId, { cliSummary: summary("Done in my worktree.") }));
    const note = lastNote(fixture);
    assert.ok(note.includes("member.ts"), note);
    assert.ok(!note.includes("lead.ts"), note);
    assert.ok(note.includes("Done in my worktree."));
  });

  it("nativeSubagent events do not settle or write a report", async () => {
    const { fixture, sessionId } = await dispatched({ git: true });
    assert.deepEqual(settleGoalDispatchFromHook(fixture.db, hook(fixture, sessionId, { nativeSubagent: true, cliSummary: summary("sub") })), []);
    assert.equal(fixture.store.listTasks(fixture.goalId).find(t => t.id === fixture.taskId)!.dispatch_status, "running");
    assert.equal(fixture.store.recentJournal(fixture.goalId).some(e => e.note.includes("CLI report")), false);
  });
});
