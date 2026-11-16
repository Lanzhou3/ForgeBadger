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
import { ProjectManagerRepository } from "../src/db/repositories/project-manager-repository.js";
import { syncGoalFromBoard } from "../src/services/agent/goal-board.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { CopilotGoalStore, type GoalRow } from "../src/services/agent/goal-store.js";
import { ensureGoalWorkspace, GOAL_MANAGED_PATHS } from "../src/services/agent/goal-workspace.js";
import {
  boardIntegrationInFlight, cleanupIntegratedTaskWorkspaces, ensureTaskWorkspace, existingTaskWorkspace, integrateTaskWorkspace, listTaskWorkspaceChanges, listUnintegratedTasks,
  taskWorkspaceState, taskWorkspaceStatus
} from "../src/services/agent/goal-task-workspace.js";
import { goalContextMessage } from "../src/services/agent/goal-context.js";
import { goalCheckSandboxCapability, prepareCheckSandbox, stateRootOf } from "../src/services/agent/command-sandbox.js";
import { runSandboxCommand, sandboxCommandEnv } from "../src/services/agent/goal-sandbox.js";
import { createGoalSandboxTools } from "../src/services/agent/tools/goal-sandbox.js";
import { createGoalIntegrateTools } from "../src/services/agent/tools/goal-integrate.js";
import { createGoalTools } from "../src/services/agent/tools/goals.js";
import { CODING_READS, GOAL_TOOLS } from "../src/services/agent/tool-surface.js";
import { GOAL_GRANT_TOOLS } from "../src/services/agent/goal-grants.js";
import { defaultCopilotTeam, setCopilotTeamRoster } from "../src/services/agent/team-roster.js";
import { AgentError } from "../src/services/agent/types.js";
import type { AgentToolContext } from "../src/services/agent/tool-registry.js";

const stateRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fb-goal-task-state-")));
process.env.FORGEBADGER_STATE_DIR = stateRoot;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd, encoding: "utf8",
    env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Owner", GIT_AUTHOR_EMAIL: "owner@example.com",
      GIT_COMMITTER_NAME: "Owner", GIT_COMMITTER_EMAIL: "owner@example.com" }
  }).trim();
}

function createDb(): Database.Database {
  const db = new Database(":memory:");
  migrate(drizzle(db), { migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations") });
  return db;
}

interface Fixture {
  db: Database.Database; userId: string; projectDir: string; store: CopilotGoalStore; goalId: string;
  taskA: string; taskB: string; context: AgentToolContext; project: { id: string; path: string };
  goal(): GoalRow;
}

function fixture(options: { git: boolean } = { git: true }): Fixture {
  const db = createDb();
  const user = new UserRepository(db).create(`task-ws-${randomUUID()}@example.com`, "hash");
  const projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fb-goal-task-project-")));
  fs.writeFileSync(path.join(projectDir, "README.md"), "line1\nline2\nline3\n");
  fs.writeFileSync(path.join(projectDir, ".gitignore"), "node_modules\n");
  if (options.git) {
    git(projectDir, "init", "-q", "-b", "main");
    git(projectDir, "add", "-A");
    git(projectDir, "commit", "-q", "-m", "initial");
  }
  const projectId = randomUUID();
  db.prepare("INSERT INTO projects(id,user_id,name,path,ai_tool,status) VALUES(?,?,?,?,?,?)").run(projectId, user.id, "p", projectDir, "claude", "active");
  const conversation = new CopilotConversationLog(db, user.id).createConversation();
  const store = new CopilotGoalStore(db, user.id);
  const goalId = store.createGoal({ conversationId: conversation.id, projectId, title: "Team goal", spec: "s" }).id;
  const [a, b] = store.addTasks(goalId, [
    { description: "Task A", verifyCommand: "test -f feat-a.txt" }, { description: "Task B", verifyCommand: "test -f feat-b.txt" }]);
  const runId = randomUUID();
  db.prepare(`INSERT INTO copilot_runs(id,user_id,conversation_id,status,goal_id,runtime_version,input_json,created_at,updated_at)
    VALUES(?,?,?,'running',?,1,'{}',?,?)`).run(runId, user.id, conversation.id, goalId, Date.now(), Date.now());
  return {
    db, userId: user.id, projectDir, store, goalId, taskA: a!.id, taskB: b!.id, project: { id: projectId, path: projectDir },
    context: { db, userId: user.id, masterKey: "k", runId } as AgentToolContext, goal: () => store.getGoal(goalId)!
  };
}

const rejectsWith = (code: string) => (error: unknown) => error instanceof AgentError && error.code === code;
const tool = <T extends { name: string }>(tools: T[], name: string): T => tools.find(entry => entry.name === name)!;

/** Everything about the project repo a task flow must never change. */
function projectState(dir: string): { head: string; branch: string; status: string } {
  return { head: git(dir, "rev-parse", "HEAD"), branch: git(dir, "symbolic-ref", "--short", "HEAD"), status: git(dir, "status", "--porcelain=v1", "--untracked-files=all") };
}

function treeState(dir: string, files: string[]): Record<string, string | null> {
  const out: Record<string, string | null> = { HEAD: git(dir, "rev-parse", "HEAD"), status: git(dir, "status", "--porcelain=v1", "--untracked-files=all") };
  for (const file of files) out[file] = fs.existsSync(path.join(dir, file)) ? fs.readFileSync(path.join(dir, file), "utf8") : null;
  return out;
}

describe("goal task worktrees", () => {
  const dbs: Database.Database[] = [];
  function tracked(f: Fixture): Fixture { dbs.push(f.db); return f; }
  beforeEach(() => setCopilotTeamRoster(defaultCopilotTeam()));
  after(() => { setCopilotTeamRoster(defaultCopilotTeam()); for (const db of dbs) if (db.open) db.close(); fs.rmSync(stateRoot, { recursive: true, force: true }); });

  async function ready(f: Fixture) {
    const goalWs = await ensureGoalWorkspace(f.db, f.userId, f.goal(), f.project);
    return goalWs;
  }

  it("forks from the goal tip including uncommitted goal edits, excluding managed hook files", async () => {
    const f = tracked(fixture());
    const before = projectState(f.projectDir);
    const goalWs = await ready(f);
    fs.writeFileSync(path.join(goalWs.path, "lead.txt"), "lead work\n");
    fs.mkdirSync(path.join(goalWs.path, ".claude"));
    fs.writeFileSync(path.join(goalWs.path, ".claude", "settings.local.json"), "{}\n");
    const ws = await ensureTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
    assert.equal(ws.path, path.join(stateRoot, "goal-worktrees", `tasks-${f.goalId}`, f.taskA));
    assert.equal(ws.branch, `forgebadger/goal-task-${f.taskA}`);
    assert.equal(fs.readFileSync(path.join(ws.path, "lead.txt"), "utf8"), "lead work\n");
    assert.equal(fs.existsSync(path.join(ws.path, ".claude", "settings.local.json")), false);
    // The goal branch got the checkpoint commit; managed files stay uncommitted in the goal tree.
    assert.match(git(goalWs.path, "log", "-1", "--format=%s"), /checkpoint before task/);
    assert.equal(git(goalWs.path, "ls-tree", "-r", "--name-only", "HEAD").includes("settings.local.json"), false);
    assert.ok(fs.existsSync(path.join(goalWs.path, ".claude", "settings.local.json")));
    assert.equal(git(ws.path, "rev-parse", "HEAD"), git(goalWs.path, "rev-parse", "HEAD"));
    assert.equal(existingTaskWorkspace(f.db, f.goal(), f.taskA)?.path, ws.path);
    assert.equal(existingTaskWorkspace(f.db, f.goal(), f.taskB), undefined);
    assert.deepEqual(projectState(f.projectDir), before);
  });

  it("is single-flight and reuses an existing worktree", async () => {
    const f = tracked(fixture());
    await ready(f);
    const [one, two] = await Promise.all([ensureTaskWorkspace(f.db, f.userId, f.goal(), f.taskA), ensureTaskWorkspace(f.db, f.userId, f.goal(), f.taskA)]);
    assert.equal(one.path, two.path);
    fs.writeFileSync(path.join(one.path, "kept.txt"), "x");
    const again = await ensureTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
    assert.equal(again.path, one.path);
    assert.ok(fs.existsSync(path.join(again.path, "kept.txt")));
  });

  it("integrates two independently edited task worktrees into the goal branch", async () => {
    const f = tracked(fixture());
    const before = projectState(f.projectDir);
    const goalWs = await ready(f);
    const a = await ensureTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
    const b = await ensureTaskWorkspace(f.db, f.userId, f.goal(), f.taskB);
    fs.writeFileSync(path.join(a.path, "feat-a.txt"), "a\n");
    fs.writeFileSync(path.join(b.path, "feat-b.txt"), "b\n");
    assert.deepEqual((await listTaskWorkspaceChanges(f.db, f.goal(), f.taskA)).map(c => c.path), ["feat-a.txt"]);
    assert.equal((await taskWorkspaceStatus(f.db, f.goal(), f.taskA)).dirty, true);
    const first = await integrateTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
    const second = await integrateTaskWorkspace(f.db, f.userId, f.goal(), f.taskB);
    assert.deepEqual(first.changes, [{ status: "added", path: "feat-a.txt" }]);
    assert.deepEqual(second.changes, [{ status: "added", path: "feat-b.txt" }]);
    assert.equal(fs.readFileSync(path.join(goalWs.path, "feat-a.txt"), "utf8"), "a\n");
    assert.equal(fs.readFileSync(path.join(goalWs.path, "feat-b.txt"), "utf8"), "b\n");
    assert.equal(git(goalWs.path, "rev-parse", "HEAD"), second.commit);
    assert.equal(git(goalWs.path, "rev-list", "--parents", "-n", "1", "HEAD").split(" ").length, 3, "a --no-ff merge commit");
    assert.deepEqual(await taskWorkspaceStatus(f.db, f.goal(), f.taskA), { exists: true, dirty: false, integrated: true });
    assert.equal(git(goalWs.path, "status", "--porcelain=v1"), "");
    assert.deepEqual(projectState(f.projectDir), before, "the project branch and working tree are never touched");
  });

  it("is idempotent and fast-forwards the task branch to the merged tip", async () => {
    const f = tracked(fixture());
    const goalWs = await ready(f);
    const a = await ensureTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
    fs.writeFileSync(path.join(a.path, "feat-a.txt"), "a\n");
    const first = await integrateTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
    assert.equal(git(f.projectDir, "rev-parse", a.branch!), first.commit);
    assert.equal(git(a.path, "rev-parse", "HEAD"), first.commit);
    const again = await integrateTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
    assert.deepEqual(again, { commit: first.commit, changes: [] });
    assert.equal(git(goalWs.path, "rev-parse", "HEAD"), first.commit);
    // Rework starts from the integrated state and integrates again.
    fs.writeFileSync(path.join(a.path, "feat-a.txt"), "a2\n");
    const rework = await integrateTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
    assert.deepEqual(rework.changes, [{ status: "modified", path: "feat-a.txt" }]);
  });

  it("rolls everything back on a conflict and names the conflicting paths", async () => {
    const f = tracked(fixture());
    const before = projectState(f.projectDir);
    const goalWs = await ready(f);
    const a = await ensureTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
    const b = await ensureTaskWorkspace(f.db, f.userId, f.goal(), f.taskB);
    fs.writeFileSync(path.join(a.path, "README.md"), "line1\nA\nline3\n");
    fs.writeFileSync(path.join(b.path, "README.md"), "line1\nB\nline3\n");
    fs.writeFileSync(path.join(b.path, "extra-b.txt"), "untracked in b\n");
    await integrateTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
    fs.writeFileSync(path.join(goalWs.path, "lead.txt"), "uncommitted lead edit\n");
    const files = ["README.md", "extra-b.txt", "lead.txt"];
    const goalBefore = treeState(goalWs.path, files);
    const taskBefore = treeState(b.path, files);
    const branchBefore = git(f.projectDir, "for-each-ref", "--format=%(refname) %(objectname)", "refs/heads");
    await assert.rejects(integrateTaskWorkspace(f.db, f.userId, f.goal(), f.taskB), (error: unknown) =>
      rejectsWith("COPILOT_GOAL_TASK_CONFLICT")(error) && /README\.md/.test((error as Error).message) && /re-dispatch/.test((error as Error).message));
    assert.deepEqual(treeState(goalWs.path, files), goalBefore);
    assert.deepEqual(treeState(b.path, files), taskBefore);
    assert.equal(git(f.projectDir, "for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"), branchBefore);
    assert.equal(fs.existsSync(path.resolve(goalWs.path, git(goalWs.path, "rev-parse", "--git-path", "MERGE_HEAD"))), false, "no merge left in progress");
  });

  it("keeps a task integrable when the member committed managed hook files: they never reach the goal branch", async () => {
    const f = tracked(fixture());
    const goalWs = await ready(f);
    const a = await ensureTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
    fs.mkdirSync(path.join(a.path, ".claude"));
    fs.writeFileSync(path.join(a.path, ".claude", "settings.local.json"), "{}\n");
    fs.writeFileSync(path.join(a.path, "feat-a.txt"), "a\n");
    git(a.path, "add", "-A", "-f");
    git(a.path, "-c", "user.name=x", "-c", "user.email=x@example.com", "commit", "-q", "-m", "git add -A picked up the hook file");
    const result = await integrateTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
    assert.deepEqual(result.changes, [{ status: "added", path: "feat-a.txt" }]);
    assert.equal(git(goalWs.path, "ls-tree", "-r", "--name-only", "HEAD").includes("settings.local.json"), false);
    assert.equal(git(a.path, "ls-tree", "-r", "--name-only", "HEAD").includes("settings.local.json"), false);
    assert.ok(fs.existsSync(path.join(a.path, ".claude", "settings.local.json")), "the hook file stays on disk");
    assert.deepEqual(await taskWorkspaceStatus(f.db, f.goal(), f.taskA), { exists: true, dirty: false, integrated: true });
  });

  it("never commits or integrates managed paths that are only present in the task tree", async () => {
    const f = tracked(fixture());
    const goalWs = await ready(f);
    const a = await ensureTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
    fs.mkdirSync(path.join(a.path, ".claude"));
    fs.writeFileSync(path.join(a.path, ".claude", "settings.local.json"), "{}\n");
    fs.writeFileSync(path.join(a.path, "feat-a.txt"), "a\n");
    assert.deepEqual((await listTaskWorkspaceChanges(f.db, f.goal(), f.taskA)).map(c => c.path), ["feat-a.txt"]);
    await integrateTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
    assert.equal(fs.existsSync(path.join(goalWs.path, ".claude", "settings.local.json")), false);
    assert.deepEqual(await taskWorkspaceStatus(f.db, f.goal(), f.taskA), { exists: true, dirty: false, integrated: true });
    assert.ok(GOAL_MANAGED_PATHS.includes(".claude/settings.local.json"));
  });

  it("reports an unintegrated task as not integrated, and a task without a worktree as non-existent", async () => {
    const f = tracked(fixture());
    await ready(f);
    assert.deepEqual(await taskWorkspaceStatus(f.db, f.goal(), f.taskA), { exists: false, dirty: false, integrated: false });
    const a = await ensureTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
    assert.deepEqual(await taskWorkspaceStatus(f.db, f.goal(), f.taskA), { exists: true, dirty: false, integrated: true }, "a fresh fork has nothing to integrate");
    git(a.path, "-c", "user.name=x", "-c", "user.email=x@example.com", "commit", "-q", "--allow-empty", "-m", "work");
    assert.equal((await taskWorkspaceStatus(f.db, f.goal(), f.taskA)).integrated, false);
  });

  it("refuses copy-sandbox goals, foreign tasks and non-UUID task ids", async () => {
    const copy = tracked(fixture({ git: false }));
    await ensureGoalWorkspace(copy.db, copy.userId, copy.goal(), copy.project);
    assert.equal(copy.goal().workspace_kind, "copy");
    await assert.rejects(ensureTaskWorkspace(copy.db, copy.userId, copy.goal(), copy.taskA), rejectsWith("COPILOT_GOAL_TASK_WORKSPACE_UNAVAILABLE"));
    assert.equal(existingTaskWorkspace(copy.db, copy.goal(), copy.taskA), undefined);
    const f = tracked(fixture());
    await ready(f);
    await assert.rejects(ensureTaskWorkspace(f.db, f.userId, f.goal(), randomUUID()), rejectsWith("COPILOT_NOT_FOUND"));
    f.db.prepare("INSERT INTO copilot_goal_tasks(id,user_id,goal_id,seq,description,status,created_at,updated_at) VALUES(?,?,?,?,?,'pending',1,1)")
      .run("../evil", f.userId, f.goalId, 9, "bad id");
    await assert.rejects(ensureTaskWorkspace(f.db, f.userId, f.goal(), "../evil"), rejectsWith("COPILOT_GOAL_TASK_WORKSPACE_UNAVAILABLE"));
    assert.equal(existingTaskWorkspace(f.db, f.goal(), "../evil"), undefined);
    assert.equal(fs.existsSync(path.join(stateRoot, "goal-worktrees", `tasks-${f.goalId}`, "..", "evil")), false);
  });

  it("only resolves tasks of this goal (another goal's task id never maps to a path)", async () => {
    const f = tracked(fixture());
    await ready(f);
    const other = f.store.createGoal({ conversationId: (f.db.prepare("SELECT conversation_id AS c FROM copilot_goals WHERE id=?").get(f.goalId) as { c: string }).c,
      projectId: f.project.id, title: "other", spec: "s" });
    const [foreign] = f.store.addTasks(other.id, ["foreign"]);
    await ensureTaskWorkspace(f.db, f.userId, f.store.getGoal(f.goalId)!, f.taskA);
    assert.equal(existingTaskWorkspace(f.db, f.goal(), foreign!.id), undefined);
    await assert.rejects(ensureTaskWorkspace(f.db, f.userId, f.goal(), foreign!.id), rejectsWith("COPILOT_NOT_FOUND"));
  });

  it("goal context marks isolated worktrees and teaches the parallel flow", async () => {
    const f = tracked(fixture());
    setCopilotTeamRoster({ maxParallelWriters: 3, members: [{ id: "ada", name: "Ada", title: "", description: "", adapter: "claude", roles: ["writer"], enabled: true }] });
    await ready(f);
    await ensureTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
    const message = goalContextMessage(f.db, f.userId, f.goalId)!;
    const parsed = JSON.parse(message.slice(message.indexOf("{"))) as { tasks: Array<{ id: string; isolatedWorktree?: boolean }>; instructions: string };
    assert.equal(parsed.tasks.find(t => t.id === f.taskA)?.isolatedWorktree, true);
    assert.equal(parsed.tasks.find(t => t.id === f.taskB)?.isolatedWorktree, undefined);
    for (const phrase of ["parallel: true", "goal_integrate_task", "taskId", "without taskId"]) assert.ok(parsed.instructions.includes(phrase), phrase);
  });

  it("restores a deleted task directory from its kept branch and never lets the gate be bypassed", async () => {
    const f = tracked(fixture());
    const goalWs = await ready(f);
    const a = await ensureTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
    fs.writeFileSync(path.join(a.path, "feat-a.txt"), "a\n");
    git(a.path, "add", "-A");
    git(a.path, "-c", "user.name=x", "-c", "user.email=x@example.com", "commit", "-q", "-m", "member work");
    fs.rmSync(a.path, { recursive: true, force: true });
    assert.equal(existingTaskWorkspace(f.db, f.goal(), f.taskA), undefined, "the sync disk check stays disk-only");
    assert.equal(await taskWorkspaceState(f.db, f.goal(), f.taskA), "lost");
    const status = await taskWorkspaceStatus(f.db, f.goal(), f.taskA);
    assert.deepEqual(status, { exists: false, dirty: false, lost: true, integrated: false });
    // passes is refused while the committed work is not in the goal branch
    f.store.markTaskVerified(f.goalId, f.taskA, 0, "verify: ok");
    await assert.rejects(tool(createGoalTools(), "goal_update_task").execute({ taskId: f.taskA, status: "passes", evidence: "ok" }, f.context),
      rejectsWith("COPILOT_GOAL_TASK_NOT_INTEGRATED"));
    // run_checks with taskId restores the worktree instead of falling back to the goal tree
    const run = await tool(createGoalSandboxTools(), "goal_run_checks").execute({ command: "test -f feat-a.txt", taskId: f.taskA }, f.context) as { exitCode: number; workspace: string };
    assert.deepEqual([run.exitCode, run.workspace], [0, "task-worktree"]);
    assert.equal(fs.readFileSync(path.join(a.path, "feat-a.txt"), "utf8"), "a\n");
    assert.equal(fs.existsSync(path.join(goalWs.path, "feat-a.txt")), false);
    // lost again: integrate restores, merges, and then passes is allowed even with the directory gone
    fs.rmSync(a.path, { recursive: true, force: true });
    await integrateTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
    fs.rmSync(a.path, { recursive: true, force: true });
    assert.equal((await taskWorkspaceStatus(f.db, f.goal(), f.taskA)).integrated, true);
    await tool(createGoalTools(), "goal_update_task").execute({ taskId: f.taskA, status: "passes", evidence: "ok" }, f.context);
    // a lost worktree is re-created by ensure (re-dispatch) with the same committed work
    const again = await ensureTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
    assert.equal(fs.readFileSync(path.join(again.path, "feat-a.txt"), "utf8"), "a\n");
    // file_read with a taskId restores too and never reads the goal tree
    fs.rmSync(a.path, { recursive: true, force: true });
    const read = await tool(createGoalSandboxTools(), "goal_file_read").execute({ path: "feat-a.txt", taskId: f.taskA }, f.context) as { content: string };
    assert.match(read.content, /a/);
  });

  it("refuses to fork or integrate while a CLI writes in the shared goal tree", async () => {
    const f = tracked(fixture());
    const goalWs = await ready(f);
    const a = await ensureTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
    fs.writeFileSync(path.join(a.path, "feat-a.txt"), "a\n");
    const session = new SessionRepository(f.db, f.userId).create({ projectId: f.project.id, name: "shared writer", aiTool: "claude", workingDir: goalWs.path, credentialMode: "host_environment" });
    f.db.prepare("UPDATE sessions SET status='running' WHERE id=?").run(session.id);
    f.store.setTaskDispatched(f.goalId, f.taskB, session.id);
    fs.writeFileSync(path.join(goalWs.path, "half-done.txt"), "wip\n");
    const headBefore = git(goalWs.path, "rev-parse", "HEAD");
    const writing = (error: unknown) => rejectsWith("COPILOT_GOAL_INPUT_INVALID")(error) && /still writing in the shared goal tree/.test((error as Error).message);
    await assert.rejects(integrateTaskWorkspace(f.db, f.userId, f.goal(), f.taskA), writing);
    const [third] = f.store.addTasks(f.goalId, ["third"]);
    await assert.rejects(ensureTaskWorkspace(f.db, f.userId, f.goal(), third!.id), writing);
    assert.equal(git(goalWs.path, "rev-parse", "HEAD"), headBefore, "no checkpoint commit captured the half-done edit");
    assert.match(git(goalWs.path, "status", "--porcelain=v1"), /half-done\.txt/);
  });

  it("ties verification to the task tree: edits after verify or a re-dispatch need a fresh verify", async () => {
    const f = tracked(fixture());
    await ready(f);
    const a = await ensureTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
    fs.writeFileSync(path.join(a.path, "feat-a.txt"), "a\n");
    const integrate = tool(createGoalIntegrateTools(), "goal_integrate_task");
    const run = () => tool(createGoalSandboxTools(), "goal_run_checks").execute({ command: "test -f feat-a.txt", taskId: f.taskA }, f.context);
    await run();
    assert.match(f.store.listTasks(f.goalId).find(t => t.id === f.taskA)!.evidence ?? "", /verified-tree: [a-f0-9]{40}/);
    const notReady = rejectsWith("COPILOT_GOAL_TASK_NOT_READY");
    fs.writeFileSync(path.join(a.path, "feat-a.txt"), "edited after verification\n");
    await assert.rejects(integrate.execute({ taskId: f.taskA }, f.context), (error: unknown) => notReady(error) && /changed after its verification/.test((error as Error).message));
    await run();
    // identity is stable across the checkpoint it does not perform and ignores managed files
    fs.mkdirSync(path.join(a.path, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(a.path, ".claude", "settings.local.json"), "{}\n");
    await integrate.execute({ taskId: f.taskA }, f.context);
    // a dispatch (rework) clears the verify record
    f.store.setTaskDispatched(f.goalId, f.taskA, "some-session");
    const row = f.store.listTasks(f.goalId).find(t => t.id === f.taskA)!;
    assert.equal(row.verified_at, null);
    assert.equal(row.verify_exit_code, null);
    f.store.settleDispatch(f.taskA, "completed");
    fs.writeFileSync(path.join(a.path, "feat-a.txt"), "rework\n");
    await assert.rejects(integrate.execute({ taskId: f.taskA }, f.context), notReady, "old verify record no longer counts");
    await run();
    await integrate.execute({ taskId: f.taskA }, f.context);
  });

  it("restores staged and unstaged index state in both trees when an integration conflicts", async () => {
    const f = tracked(fixture());
    const goalWs = await ready(f);
    fs.writeFileSync(path.join(goalWs.path, "a.txt"), "base\n");
    const a = await ensureTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
    const b = await ensureTaskWorkspace(f.db, f.userId, f.goal(), f.taskB);
    fs.writeFileSync(path.join(a.path, "README.md"), "line1\nA\nline3\n");
    await integrateTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
    // b: staged edit then a further unstaged edit (MM), plus a staged new file
    fs.writeFileSync(path.join(b.path, "README.md"), "line1\nB\nline3\n");
    fs.writeFileSync(path.join(b.path, "a.txt"), "staged\n");
    git(b.path, "add", "README.md", "a.txt");
    fs.writeFileSync(path.join(b.path, "a.txt"), "staged then more\n");
    // goal tree: staged + unstaged too
    fs.writeFileSync(path.join(goalWs.path, "lead.txt"), "lead\n");
    git(goalWs.path, "add", "lead.txt");
    fs.writeFileSync(path.join(goalWs.path, "lead.txt"), "lead more\n");
    const snap = (dir: string) => ({ status: git(dir, "status", "--porcelain=v1", "-z", "--untracked-files=all"), cached: git(dir, "diff", "--cached"), head: git(dir, "rev-parse", "HEAD") });
    const [goalBefore, taskBefore] = [snap(goalWs.path), snap(b.path)];
    assert.match(taskBefore.status, /MM a\.txt|AM a\.txt/);
    await assert.rejects(integrateTaskWorkspace(f.db, f.userId, f.goal(), f.taskB), rejectsWith("COPILOT_GOAL_TASK_CONFLICT"));
    assert.deepEqual(snap(goalWs.path), goalBefore);
    assert.deepEqual(snap(b.path), taskBefore);
  });

  it("does not un-merge when the change listing after a successful merge fails", async () => {
    const f = tracked(fixture());
    const goalWs = await ready(f);
    const a = await ensureTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
    // > 2 MiB of name-status output exceeds the git output cap
    const dir = path.join(a.path, "bulk");
    fs.mkdirSync(dir);
    for (let i = 0; i < 11000; i += 1) fs.writeFileSync(path.join(dir, `${String(i).padStart(5, "0")}-${"x".repeat(200)}`), "");
    git(a.path, "add", "-A");
    git(a.path, "-c", "user.name=x", "-c", "user.email=x@example.com", "commit", "-q", "-m", "bulk");
    const before = git(goalWs.path, "rev-parse", "HEAD");
    const result = await integrateTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
    assert.notEqual(git(goalWs.path, "rev-parse", "HEAD"), before, "the merge stays");
    assert.equal(git(goalWs.path, "rev-parse", "HEAD"), result.commit);
    assert.deepEqual(result.changes, [], "the listing degrades instead of throwing");
    assert.equal(fs.existsSync(path.join(goalWs.path, "bulk", `00000-${"x".repeat(200)}`)), true);
  });

  it("recovers from a merge left in progress by a crash", async () => {
    const f = tracked(fixture());
    const goalWs = await ready(f);
    const a = await ensureTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
    const b = await ensureTaskWorkspace(f.db, f.userId, f.goal(), f.taskB);
    fs.writeFileSync(path.join(a.path, "README.md"), "line1\nA\nline3\n");
    fs.writeFileSync(path.join(b.path, "README.md"), "line1\nB\nline3\n");
    await integrateTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
    git(b.path, "add", "-A");
    git(b.path, "-c", "user.name=x", "-c", "user.email=x@example.com", "commit", "-q", "-m", "b");
    // plant the crashed state: a conflicting merge in progress in the goal tree
    assert.throws(() => git(goalWs.path, "-c", "user.name=x", "-c", "user.email=x@example.com", "merge", "--no-edit", b.branch!));
    const mergeHead = path.resolve(goalWs.path, git(goalWs.path, "rev-parse", "--git-path", "MERGE_HEAD"));
    assert.ok(fs.existsSync(mergeHead));
    const third = f.store.addTasks(f.goalId, [{ description: "third", verifyCommand: "true" }])[0]!;
    const ws = await ensureTaskWorkspace(f.db, f.userId, f.goal(), third.id);
    assert.ok(ws.path);
    assert.equal(fs.existsSync(mergeHead), false, "fork aborted the stale merge");
    assert.ok(f.store.recentJournal(f.goalId, 10).some(entry => entry.note.includes("Aborted an unfinished merge")));
    // and integrate recovers the same way
    assert.throws(() => git(goalWs.path, "-c", "user.name=x", "-c", "user.email=x@example.com", "merge", "--no-edit", b.branch!));
    assert.ok(fs.existsSync(mergeHead));
    fs.writeFileSync(path.join(ws.path, "third.txt"), "t\n");
    await integrateTaskWorkspace(f.db, f.userId, f.goal(), third.id);
    assert.equal(fs.existsSync(mergeHead), false);
    assert.equal(fs.readFileSync(path.join(goalWs.path, "third.txt"), "utf8"), "t\n");
  });

  it("waits briefly for a concurrent git operation and then explains the busy state", async () => {
    const f = tracked(fixture());
    const goalWs = await ready(f);
    const common = path.resolve(goalWs.path, git(goalWs.path, "rev-parse", "--git-common-dir"));
    const lock = path.join(common, "forgebadger-collaboration.lock");
    const hold = () => { fs.mkdirSync(lock); fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ path: lock, token: "t", ownerPid: process.pid, childPid: null, phase: "idle" })); };
    const release = () => { fs.rmSync(lock, { recursive: true, force: true }); };
    hold();
    setTimeout(release, 600);
    const ws = await ensureTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
    assert.ok(fs.existsSync(ws.path), "succeeded once the lock was released");
    hold();
    try {
      await assert.rejects(integrateTaskWorkspace(f.db, f.userId, f.goal(), f.taskA), /another git operation on this goal is in progress, try again/i);
    } finally { release(); }
  });

  describe("owner acceptance on the project board", () => {
    async function boardFixture() {
      const f = tracked(fixture());
      const goalWs = await ready(f);
      const tools = createGoalTools();
      const added = await tool(tools, "goal_add_tasks").execute({ descriptions: [{ description: "Board A", verifyCommand: "true" }, { description: "Board B", verifyCommand: "true" }] }, f.context) as
        { tasks: Array<{ id: string; work_item_id: string }> };
      const board = new ProjectManagerRepository(f.db, f.userId);
      const accept = (taskIndex: number) => { board.updateWorkItemStatus(f.project.id, added.tasks[taskIndex]!.work_item_id, { status: "in_progress" }); board.updateWorkItemStatus(f.project.id, added.tasks[taskIndex]!.work_item_id, { status: "done", manualCompletionReason: "Reviewed by owner" }); };
      const settled = (): Promise<void> => new Promise((resolve) => { syncGoalFromBoard(f.db, f.userId, f.goal(), resolve); setTimeout(resolve, 8000).unref(); });
      return { f, goalWs, added: added.tasks, accept, settled };
    }

    it("integrates the task worktree first and then passes the task", async () => {
      const { f, goalWs, added, accept, settled } = await boardFixture();
      const ws = await ensureTaskWorkspace(f.db, f.userId, f.goal(), added[0]!.id);
      fs.writeFileSync(path.join(ws.path, "board-a.txt"), "a\n");
      accept(0);
      // synchronous part leaves the task alone while the async integration runs
      await settled();
      assert.equal(f.store.listTasks(f.goalId).find(t => t.id === added[0]!.id)!.status, "passes");
      assert.equal(fs.readFileSync(path.join(goalWs.path, "board-a.txt"), "utf8"), "a\n");
      assert.deepEqual(await listUnintegratedTasks(f.db, f.goal()), []);
    });

    it("does not pass a task whose worktree conflicts, and journals why", async () => {
      const { f, goalWs, added, accept, settled } = await boardFixture();
      const a = await ensureTaskWorkspace(f.db, f.userId, f.goal(), added[0]!.id);
      const b = await ensureTaskWorkspace(f.db, f.userId, f.goal(), added[1]!.id);
      fs.writeFileSync(path.join(a.path, "README.md"), "line1\nA\nline3\n");
      fs.writeFileSync(path.join(b.path, "README.md"), "line1\nB\nline3\n");
      await integrateTaskWorkspace(f.db, f.userId, f.goal(), added[0]!.id);
      accept(1);
      const goalHead = git(goalWs.path, "rev-parse", "HEAD");
      syncGoalFromBoard(f.db, f.userId, f.goal());
      for (let i = 0; i < 80 && boardIntegrationInFlight(f.goalId); i += 1) await new Promise(done => setTimeout(done, 100));
      assert.notEqual(f.store.listTasks(f.goalId).find(t => t.id === added[1]!.id)!.status, "passes");
      assert.equal(git(goalWs.path, "rev-parse", "HEAD"), goalHead);
      assert.ok(f.store.recentJournal(f.goalId, 10).some(entry => entry.note.includes("could not be integrated") && entry.note.includes("README.md")));
      assert.deepEqual((await listUnintegratedTasks(f.db, f.goal())).map(t => t.taskId), [added[1]!.id]);
    });
  });

  describe("tools", () => {
    const checks = (name: string) => tool(createGoalSandboxTools(), name);
    const integrate = tool(createGoalIntegrateTools(), "goal_integrate_task");
    const update = tool(createGoalTools(), "goal_update_task");

    it("goal_run_checks with taskId runs in the task tree and refreshes the verify record; without it, in the goal tree", async () => {
      const f = tracked(fixture());
      const goalWs = await ready(f);
      const a = await ensureTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
      fs.writeFileSync(path.join(a.path, "feat-a.txt"), "a\n");
      const inTask = await checks("goal_run_checks").execute({ command: "test -f feat-a.txt", taskId: f.taskA }, f.context) as { exitCode: number; workspace: string; verified?: { taskId: string } };
      assert.equal(inTask.exitCode, 0);
      assert.equal(inTask.workspace, "task-worktree");
      assert.equal(inTask.verified?.taskId, f.taskA);
      assert.equal(f.store.listTasks(f.goalId).find(t => t.id === f.taskA)!.verify_exit_code, 0);
      const inGoal = await checks("goal_run_checks").execute({ command: "test -f feat-a.txt" }, f.context) as { exitCode: number; workspace: string };
      assert.equal(inGoal.exitCode, 1, "the goal tree does not have the file yet");
      assert.equal(inGoal.workspace, "goal");
      assert.equal(fs.existsSync(path.join(goalWs.path, "feat-a.txt")), false);
      // A task without a worktree falls back to the goal tree.
      const fallback = await checks("goal_run_checks").execute({ command: "test -f feat-b.txt", taskId: f.taskB }, f.context) as { exitCode: number; workspace: string };
      assert.equal(fallback.workspace, "goal");
      assert.equal(fallback.exitCode, 1);
    });

    it("goal_file_read with taskId reads the task tree and keeps the traversal and symlink guards", async () => {
      const f = tracked(fixture());
      await ready(f);
      const a = await ensureTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
      fs.writeFileSync(path.join(a.path, "feat-a.txt"), "member work\n");
      const read = checks("goal_file_read");
      const ok = await read.execute({ path: "feat-a.txt", taskId: f.taskA }, f.context) as { content: string };
      assert.match(ok.content, /member work/);
      await assert.rejects(read.execute({ path: "feat-a.txt" }, f.context), /ENOENT|no such file/i);
      await assert.rejects(read.execute({ path: "../../../etc/passwd", taskId: f.taskA }, f.context));
      await assert.rejects(read.execute({ path: "..%2f..%2fREADME.md", taskId: f.taskA }, f.context));
      const secret = path.join(os.tmpdir(), `fb-secret-${randomUUID()}`);
      fs.writeFileSync(secret, "secret");
      try {
        fs.symlinkSync(secret, path.join(a.path, "link.txt"));
        await assert.rejects(read.execute({ path: "link.txt", taskId: f.taskA }, f.context), /escapes|Symbolic/);
      } finally { fs.rmSync(secret, { force: true }); }
      await assert.rejects(read.execute({ path: "README.md", taskId: f.taskB }, f.context), rejectsWith("COPILOT_GOAL_INPUT_INVALID"));
    });

    it("goal_integrate_task: refused while running or unverified, then integrates; update_task passes needs integration", async () => {
      const f = tracked(fixture());
      const before = projectState(f.projectDir);
      const goalWs = await ready(f);
      const a = await ensureTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
      fs.writeFileSync(path.join(a.path, "feat-a.txt"), "a\n");
      const notReady = rejectsWith("COPILOT_GOAL_TASK_NOT_READY");
      await assert.rejects(integrate.execute({ taskId: f.taskA }, f.context), notReady, "no verify record");
      await checks("goal_run_checks").execute({ command: "test -f feat-a.txt", taskId: f.taskA }, f.context);
      f.db.prepare("UPDATE copilot_goal_tasks SET dispatched_session_id='s', dispatch_status='running', dispatch_updated_at=? WHERE id=?").run(Date.now(), f.taskA);
      await assert.rejects(integrate.execute({ taskId: f.taskA }, f.context), notReady, "dispatch running");
      f.db.prepare("UPDATE copilot_goal_tasks SET dispatch_status='completed' WHERE id=?").run(f.taskA);
      await assert.rejects(update.execute({ taskId: f.taskA, status: "passes", evidence: "ok" }, f.context), rejectsWith("COPILOT_GOAL_TASK_NOT_INTEGRATED"));
      const result = await integrate.execute({ taskId: f.taskA }, f.context) as { integrated: boolean; commit: string; changedFiles: string[]; conflicts: unknown[] };
      assert.equal(result.integrated, true);
      assert.deepEqual(result.changedFiles, ["added: feat-a.txt"]);
      assert.deepEqual(result.conflicts, []);
      assert.equal(git(goalWs.path, "rev-parse", "HEAD"), result.commit);
      assert.ok(f.store.recentJournal(f.goalId).some(entry => entry.note.includes("Integrated task")));
      await update.execute({ taskId: f.taskA, status: "passes", evidence: "ok" }, f.context);
      assert.equal(f.store.listTasks(f.goalId).find(t => t.id === f.taskA)!.status, "passes");
      // A task without a worktree behaves as before and cannot be integrated.
      await assert.rejects(integrate.execute({ taskId: f.taskB }, f.context), rejectsWith("COPILOT_GOAL_TASK_WORKSPACE_UNAVAILABLE"));
      await assert.rejects(integrate.execute({ taskId: randomUUID() }, f.context), rejectsWith("COPILOT_NOT_FOUND"));
      assert.deepEqual(projectState(f.projectDir), before);
    });

    it("pass gate: uncommitted task edits block passes, a task without a worktree is unaffected", async () => {
      const f = tracked(fixture());
      await ready(f);
      const a = await ensureTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
      f.store.markTaskVerified(f.goalId, f.taskA, 0, "verify: ok");
      f.store.markTaskVerified(f.goalId, f.taskB, 0, "verify: ok");
      fs.writeFileSync(path.join(a.path, "late.txt"), "late edit\n");
      await assert.rejects(update.execute({ taskId: f.taskA, status: "passes", evidence: "ok" }, f.context),
        (error: unknown) => rejectsWith("COPILOT_GOAL_TASK_NOT_INTEGRATED")(error) && /not committed/.test((error as Error).message));
      await update.execute({ taskId: f.taskB, status: "passes", evidence: "ok" }, f.context);
    });

    it("is a lead-only, approval-free tool outside every grant and the coding sub-run surface", () => {
      assert.equal(integrate.risk, "read");
      assert.equal(integrate.requiresApproval, false);
      assert.ok(GOAL_TOOLS.has("goal_integrate_task"));
      assert.equal(CODING_READS.has("goal_integrate_task"), false);
      for (const tools of Object.values(GOAL_GRANT_TOOLS)) assert.equal(tools.includes("goal_integrate_task"), false);
    });
  });

  describe("seatbelt state root", () => {
    it("derives the state root for goal, task and copy workspaces", () => {
      assert.equal(stateRootOf("/state/goal-worktrees/g1"), "/state");
      assert.equal(stateRootOf("/state/goal-worktrees/tasks-g1/t1"), "/state");
      assert.equal(stateRootOf("/state/goal-sandboxes/g1"), "/state");
    });

    const available = goalCheckSandboxCapability().available;
    it("isolates a linked task worktree: git read-only, state and sibling trees unreadable", { skip: available ? false : "macOS sandbox-exec is not available on this host" }, async () => {
      const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fb-task-seatbelt-")));
      try {
        const project = path.join(root, "project");
        const goalTree = path.join(root, "state", "goal-worktrees", "g1");
        const taskTree = path.join(root, "state", "goal-worktrees", "tasks-g1", "t1");
        fs.mkdirSync(project, { recursive: true });
        fs.mkdirSync(path.dirname(taskTree), { recursive: true });
        git(project, "init", "-q", "-b", "main");
        fs.writeFileSync(path.join(project, "a.txt"), "a\n");
        git(project, "add", "-A");
        git(project, "commit", "-qm", "init");
        git(project, "worktree", "add", "-q", "-b", "forgebadger/goal-g1", goalTree);
        git(goalTree, "worktree", "add", "-q", "-b", "forgebadger/goal-task-t1", taskTree);
        fs.writeFileSync(path.join(root, "state", "forgebadger.db"), "db\n");
        fs.writeFileSync(path.join(goalTree, "goal-only.txt"), "goal\n");
        const run = async (command: string) => {
          const plan = prepareCheckSandbox({ workspace: taskTree, projectRoot: project, command, env: sandboxCommandEnv() });
          try { return await runSandboxCommand(taskTree, command, undefined, undefined, plan); } finally { plan.cleanup(); }
        };
        const allowed = await run("echo x > new.txt && git status --short && git log --oneline -1");
        assert.equal(allowed.exitCode, 0, allowed.stderr);
        assert.equal((await run("git add new.txt && git -c user.email=t@e -c user.name=t commit -qm x")).exitCode === 0, false);
        assert.notEqual((await run(`cat ${JSON.stringify(path.join(root, "state", "forgebadger.db"))}`)).exitCode, 0);
        assert.notEqual((await run(`cat ${JSON.stringify(path.join(goalTree, "goal-only.txt"))}`)).exitCode, 0);
        assert.notEqual((await run(`echo x > ${JSON.stringify(path.join(goalTree, "evil.txt"))}`)).exitCode, 0);
        assert.ok(fs.existsSync(path.join(taskTree, "new.txt")));
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
  });

  it("cleans up only task worktrees whose work is fully in the goal branch", async () => {
    const f = tracked(fixture());
    const goalWs = await ready(f);
    const a = await ensureTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
    const b = await ensureTaskWorkspace(f.db, f.userId, f.goal(), f.taskB);
    fs.writeFileSync(path.join(a.path, "feat-a.txt"), "a\n");
    fs.writeFileSync(path.join(b.path, "feat-b.txt"), "b\n");
    await integrateTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
    // A hook file left in the integrated tree does not keep it alive.
    fs.mkdirSync(path.join(a.path, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(a.path, ".claude", "settings.local.json"), "{}\n");
    const before = projectState(f.projectDir);
    assert.deepEqual(await cleanupIntegratedTaskWorkspaces(f.db, {}, f.userId, f.goal()), { removed: [f.taskA], kept: [f.taskB] });
    assert.equal(fs.existsSync(a.path), false);
    assert.equal(git(goalWs.path, "branch", "--list", `forgebadger/goal-task-${f.taskA}`), "");
    assert.equal(await taskWorkspaceState(f.db, f.goal(), f.taskA), "none");
    assert.equal(fs.readFileSync(path.join(goalWs.path, "feat-a.txt"), "utf8"), "a\n", "the integrated work stays in the goal tree");
    assert.equal(fs.readFileSync(path.join(b.path, "feat-b.txt"), "utf8"), "b\n", "unintegrated work is untouched");
    assert.equal(await taskWorkspaceState(f.db, f.goal(), f.taskB), "present");
    assert.deepEqual(projectState(f.projectDir), before);
    // Idempotent; edits made after integration keep the tree.
    assert.deepEqual(await cleanupIntegratedTaskWorkspaces(f.db, {}, f.userId, f.goal()), { removed: [], kept: [f.taskB] });
    await integrateTaskWorkspace(f.db, f.userId, f.goal(), f.taskB);
    fs.writeFileSync(path.join(b.path, "late.txt"), "late\n");
    assert.deepEqual(await cleanupIntegratedTaskWorkspaces(f.db, {}, f.userId, f.goal()), { removed: [], kept: [f.taskB] });
    assert.equal(fs.existsSync(path.join(b.path, "late.txt")), true);
  });

  it("keeps a task worktree while a CLI session still runs in it and cannot be stopped", async () => {
    const f = tracked(fixture());
    await ready(f);
    const a = await ensureTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
    fs.writeFileSync(path.join(a.path, "feat-a.txt"), "a\n");
    await integrateTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
    const session = new SessionRepository(f.db, f.userId).create({ projectId: f.project.id, name: "w", aiTool: "claude", workingDir: a.path, credentialMode: "host_environment" });
    f.db.prepare("UPDATE sessions SET status='running', runtime_session_name='fb-x' WHERE id=?").run(session.id);
    f.store.setTaskDispatched(f.goalId, f.taskA, session.id);
    assert.deepEqual(await cleanupIntegratedTaskWorkspaces(f.db, {}, f.userId, f.goal()), { removed: [], kept: [f.taskA] }, "still running");
    f.store.settleDispatch(f.taskA, "completed");
    assert.deepEqual(await cleanupIntegratedTaskWorkspaces(f.db, {}, f.userId, f.goal()), { removed: [], kept: [f.taskA] }, "no session manager to stop it");
    assert.equal(fs.existsSync(a.path), true);
    const stopped: string[] = [];
    const sessionManager = { getSession: () => undefined, stopSession: async (id: string) => { stopped.push(id); } } as never;
    assert.deepEqual(await cleanupIntegratedTaskWorkspaces(f.db, { sessionManager }, f.userId, f.goal()), { removed: [f.taskA], kept: [] });
    assert.deepEqual(stopped, [session.id]);
    assert.equal(new SessionRepository(f.db, f.userId).getById(session.id)!.status, "exited");
  });
});
