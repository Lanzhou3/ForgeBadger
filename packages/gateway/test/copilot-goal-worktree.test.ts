import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
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
import { CopilotGoalStore, type GoalRow } from "../src/services/agent/goal-store.js";
import { ensureGoalSandbox, goalSandboxDir, writeSandboxFile, readSandboxFile } from "../src/services/agent/goal-sandbox.js";
import {
  diffGoalWorkspace, ensureGoalWorkspace, existingGoalWorkspace, mergeGoalWorkspace, type GoalWorkspace
} from "../src/services/agent/goal-workspace.js";
import { AgentError } from "../src/services/agent/types.js";

const stateRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fb-goal-worktree-state-")));
process.env.FORGEBADGER_STATE_DIR = stateRoot;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd, encoding: "utf8",
    env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Owner", GIT_AUTHOR_EMAIL: "owner@example.com",
      GIT_COMMITTER_NAME: "Owner", GIT_COMMITTER_EMAIL: "owner@example.com" }
  }).trim();
}

interface Fixture {
  db: Database.Database;
  userId: string;
  projectId: string;
  projectDir: string;
  goal(): GoalRow;
  project: { id: string; path: string };
  store: CopilotGoalStore;
}

function fixture(options: { git: boolean }): Fixture {
  const db = new Database(":memory:");
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");
  migrate(drizzle(db), { migrationsFolder });
  const user = new UserRepository(db).create(`goal-worktree-${randomUUID()}@example.com`, "hash");
  const projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fb-goal-worktree-project-")));
  fs.mkdirSync(path.join(projectDir, "src"));
  fs.writeFileSync(path.join(projectDir, "README.md"), "# Demo\nline2\n");
  fs.writeFileSync(path.join(projectDir, "src", "app.txt"), "original app\n");
  fs.writeFileSync(path.join(projectDir, ".gitignore"), "node_modules\n");
  if (options.git) {
    git(projectDir, "init", "-q", "-b", "main");
    git(projectDir, "add", "-A");
    git(projectDir, "commit", "-q", "-m", "initial");
  }
  const projectId = randomUUID();
  db.prepare("INSERT INTO projects(id,user_id,name,path,ai_tool,status) VALUES(?,?,?,?,?,?)")
    .run(projectId, user.id, "worktree-project", projectDir, "claude", "active");
  const conversation = new CopilotConversationLog(db, user.id).createConversation();
  const store = new CopilotGoalStore(db, user.id);
  const goalId = store.createGoal({ conversationId: conversation.id, projectId, title: "Worktree goal", spec: "edit" }).id;
  return { db, userId: user.id, projectId, projectDir, store, project: { id: projectId, path: projectDir }, goal: () => store.getGoal(goalId)! };
}

async function workspaceOf(f: Fixture): Promise<GoalWorkspace> {
  return ensureGoalWorkspace(f.db, f.userId, f.goal(), f.project);
}

function rejectsWith(code: string) {
  return (error: unknown) => error instanceof AgentError && error.code === code;
}

describe("goal workspace (git worktree)", () => {
  const dbs: Database.Database[] = [];
  function tracked(f: Fixture): Fixture { dbs.push(f.db); return f; }
  after(() => { for (const db of dbs) if (db.open) db.close(); fs.rmSync(stateRoot, { recursive: true, force: true }); });

  it("provisions a worktree on a goal branch for git projects and reuses it", async () => {
    const f = tracked(fixture({ git: true }));
    const workspace = await workspaceOf(f);
    assert.equal(workspace.kind, "worktree");
    assert.equal(workspace.branch, `forgebadger/goal-${f.goal().id}`);
    assert.equal(workspace.targetBranch, "main");
    assert.equal(workspace.baseCommit, git(f.projectDir, "rev-parse", "HEAD"));
    assert.equal(git(workspace.path, "rev-parse", "--abbrev-ref", "HEAD"), workspace.branch);
    assert.ok(!workspace.path.startsWith(f.projectDir), "worktree lives outside the project");
    // Persisted once; a second resolution (and concurrent ones) converge on it.
    const [again, concurrent] = await Promise.all([workspaceOf(f), workspaceOf(f)]);
    assert.deepEqual(again, workspace);
    assert.deepEqual(concurrent, workspace);
    assert.equal(f.goal().workspace_kind, "worktree");
  });

  it("keeps the copy sandbox for non-git projects and for legacy goals", async () => {
    const plain = tracked(fixture({ git: false }));
    const copy = await workspaceOf(plain);
    assert.equal(copy.kind, "copy");
    assert.equal(copy.path, goalSandboxDir(plain.db, plain.goal().id));

    const legacy = tracked(fixture({ git: true }));
    ensureGoalSandbox(legacy.projectDir, goalSandboxDir(legacy.db, legacy.goal().id));
    const resolved = await workspaceOf(legacy);
    assert.equal(resolved.kind, "copy", "an existing copy sandbox is never swapped for a worktree");
    assert.equal(legacy.goal().workspace_kind, "copy");
  });

  it("refuses workspaces for shared projects", async () => {
    const f = tracked(fixture({ git: true }));
    const member = new UserRepository(f.db).create(`member-${randomUUID()}@example.com`, "hash");
    f.db.prepare("INSERT INTO collaboration_members(project_id,user_id,member_id,role) VALUES(?,?,?,?)").run(f.projectId, f.userId, member.id, "developer");
    await assert.rejects(workspaceOf(f), rejectsWith("COPILOT_GOAL_SHARED_PROJECT"));
    assert.equal(existingGoalWorkspace(f.db, f.goal()), undefined);
  });

  it("diffs committed, working-tree and untracked edits but never CLI-managed hook files", async () => {
    const f = tracked(fixture({ git: true }));
    const workspace = await workspaceOf(f);
    fs.writeFileSync(path.join(workspace.path, "README.md"), "# Demo\nline2 changed\n");
    fs.rmSync(path.join(workspace.path, "src", "app.txt"));
    fs.writeFileSync(path.join(workspace.path, "added.txt"), "brand new\n");
    fs.mkdirSync(path.join(workspace.path, ".claude"));
    fs.writeFileSync(path.join(workspace.path, ".claude", "settings.local.json"), "{\"hooks\":{}}\n");
    const { files, truncated } = await diffGoalWorkspace(workspace, f.projectDir);
    assert.equal(truncated, false);
    const byPath = new Map(files.map(file => [file.path, file]));
    assert.deepEqual([...byPath.keys()].sort(), ["README.md", "added.txt", "src/app.txt"]);
    assert.equal(byPath.get("README.md")?.status, "modified");
    assert.match(byPath.get("README.md")?.diff ?? "", /\+line2 changed/);
    assert.equal(byPath.get("src/app.txt")?.status, "deleted");
    assert.equal(byPath.get("added.txt")?.status, "added");
    assert.match(byPath.get("added.txt")?.diff ?? "", /\+brand new/);
  });

  it("merges by committing on the goal branch and fast-forwarding the project", async () => {
    const f = tracked(fixture({ git: true }));
    const workspace = await workspaceOf(f);
    fs.writeFileSync(path.join(workspace.path, "README.md"), "# Demo\ngoal edit\n");
    fs.writeFileSync(path.join(workspace.path, "added.txt"), "brand new\n");
    fs.mkdirSync(path.join(workspace.path, ".claude"));
    fs.writeFileSync(path.join(workspace.path, ".claude", "settings.local.json"), "{}\n");
    // Unrelated owner work in progress survives the fast-forward.
    fs.writeFileSync(path.join(f.projectDir, "notes.txt"), "owner scratch\n");
    const result = await mergeGoalWorkspace(f.db, f.userId, f.goal(), workspace, f.project);
    assert.deepEqual(result.merged, ["README.md", "added.txt"]);
    assert.deepEqual(result.deleted, []);
    assert.ok(result.commit);
    assert.equal(git(f.projectDir, "rev-parse", "HEAD"), result.commit);
    assert.equal(git(f.projectDir, "log", "-1", "--format=%an"), "ForgeBadger Goal");
    assert.equal(fs.readFileSync(path.join(f.projectDir, "README.md"), "utf8"), "# Demo\ngoal edit\n");
    assert.equal(fs.readFileSync(path.join(f.projectDir, "notes.txt"), "utf8"), "owner scratch\n");
    assert.equal(fs.existsSync(path.join(f.projectDir, ".claude", "settings.local.json")), false, "hook files never reach the project");
    // The merge base advanced: nothing is pending and a re-merge is a no-op.
    const merged = f.goal();
    assert.equal(merged.workspace_base_commit, result.commit);
    const refreshed = existingGoalWorkspace(f.db, merged)!;
    assert.deepEqual((await diffGoalWorkspace(refreshed, f.projectDir)).files, []);
    assert.deepEqual(await mergeGoalWorkspace(f.db, f.userId, merged, refreshed, f.project), { merged: [], deleted: [], kept: [] });
  });

  it("merges a moved project branch into the goal branch before fast-forwarding", async () => {
    const f = tracked(fixture({ git: true }));
    const workspace = await workspaceOf(f);
    fs.writeFileSync(path.join(workspace.path, "README.md"), "# Demo\ngoal edit\n");
    fs.writeFileSync(path.join(f.projectDir, "src", "app.txt"), "owner commit\n");
    git(f.projectDir, "commit", "-q", "-am", "owner change");
    const ownerHead = git(f.projectDir, "rev-parse", "HEAD");
    const result = await mergeGoalWorkspace(f.db, f.userId, f.goal(), workspace, f.project);
    assert.deepEqual(result.merged, ["README.md"]);
    assert.equal(git(f.projectDir, "merge-base", "--is-ancestor", ownerHead, "HEAD"), "");
    assert.equal(fs.readFileSync(path.join(f.projectDir, "src", "app.txt"), "utf8"), "owner commit\n");
    assert.equal(fs.readFileSync(path.join(f.projectDir, "README.md"), "utf8"), "# Demo\ngoal edit\n");
  });

  it("refuses conflicting edits without touching either tree", async () => {
    const f = tracked(fixture({ git: true }));
    const workspace = await workspaceOf(f);
    fs.writeFileSync(path.join(workspace.path, "README.md"), "# Demo\ngoal edit\n");
    fs.writeFileSync(path.join(f.projectDir, "README.md"), "# Demo\nowner edit\n");
    git(f.projectDir, "commit", "-q", "-am", "owner change");
    const ownerHead = git(f.projectDir, "rev-parse", "HEAD");
    await assert.rejects(mergeGoalWorkspace(f.db, f.userId, f.goal(), workspace, f.project),
      (error: unknown) => rejectsWith("COPILOT_GOAL_MERGE_CONFLICT")(error) && /README\.md/.test((error as Error).message));
    assert.equal(git(f.projectDir, "rev-parse", "HEAD"), ownerHead);
    assert.equal(git(f.projectDir, "status", "--porcelain"), "");
    assert.equal(fs.existsSync(path.join(git(workspace.path, "rev-parse", "--git-dir"), "MERGE_HEAD")), false, "the aborted merge leaves no MERGE_HEAD");
  });

  it("refuses to overwrite uncommitted project edits and a switched project branch", async () => {
    const f = tracked(fixture({ git: true }));
    const workspace = await workspaceOf(f);
    fs.writeFileSync(path.join(workspace.path, "README.md"), "# Demo\ngoal edit\n");
    fs.writeFileSync(path.join(f.projectDir, "README.md"), "# Demo\nunsaved owner edit\n");
    await assert.rejects(mergeGoalWorkspace(f.db, f.userId, f.goal(), workspace, f.project),
      (error: unknown) => rejectsWith("COPILOT_GOAL_MERGE_CONFLICT")(error) && /uncommitted changes in: README\.md/.test((error as Error).message));
    assert.equal(fs.readFileSync(path.join(f.projectDir, "README.md"), "utf8"), "# Demo\nunsaved owner edit\n");

    git(f.projectDir, "checkout", "-q", "--", "README.md");
    git(f.projectDir, "checkout", "-q", "-b", "feature");
    await assert.rejects(mergeGoalWorkspace(f.db, f.userId, f.goal(), workspace, f.project),
      (error: unknown) => rejectsWith("COPILOT_GOAL_MERGE_CONFLICT")(error) && /switch back/.test((error as Error).message));
    assert.equal(git(f.projectDir, "rev-parse", "HEAD"), workspace.baseCommit);
  });

  it("adds no merge commit when the goal changed nothing and the project moved on", async () => {
    const f = tracked(fixture({ git: true }));
    const workspace = await workspaceOf(f);
    fs.writeFileSync(path.join(f.projectDir, "src", "app.txt"), "owner commit\n");
    git(f.projectDir, "commit", "-q", "-am", "owner change");
    const ownerHead = git(f.projectDir, "rev-parse", "HEAD");
    assert.deepEqual(await mergeGoalWorkspace(f.db, f.userId, f.goal(), workspace, f.project), { merged: [], deleted: [], kept: [] });
    assert.equal(git(f.projectDir, "rev-parse", "HEAD"), ownerHead);
    assert.equal(git(workspace.path, "rev-parse", "HEAD"), ownerHead, "the goal branch follows the advanced base");
    const refreshed = existingGoalWorkspace(f.db, f.goal())!;
    assert.equal(refreshed.baseCommit, ownerHead);
    assert.deepEqual((await diffGoalWorkspace(refreshed, f.projectDir)).files, []);
  });

  it("resets rewritten tracked hook files instead of failing the goal-branch merge", async () => {
    const f = tracked(fixture({ git: true }));
    fs.mkdirSync(path.join(f.projectDir, ".codex"));
    fs.writeFileSync(path.join(f.projectDir, ".codex", "hooks.json"), "{\"owner\":1}\n");
    git(f.projectDir, "add", "-A");
    git(f.projectDir, "commit", "-q", "-m", "tracked codex hooks");
    const workspace = await workspaceOf(f);
    // Hook materialization rewrote the tracked file in the worktree...
    fs.writeFileSync(path.join(workspace.path, ".codex", "hooks.json"), "{\"forgebadger\":1}\n");
    fs.writeFileSync(path.join(workspace.path, "README.md"), "# Demo\ngoal edit\n");
    // ...while the owner changed the same file upstream.
    fs.writeFileSync(path.join(f.projectDir, ".codex", "hooks.json"), "{\"owner\":2}\n");
    git(f.projectDir, "commit", "-q", "-am", "owner hooks change");
    const result = await mergeGoalWorkspace(f.db, f.userId, f.goal(), workspace, f.project);
    assert.deepEqual(result.merged, ["README.md"]);
    assert.equal(fs.readFileSync(path.join(f.projectDir, ".codex", "hooks.json"), "utf8"), "{\"owner\":2}\n");
  });

  it("keeps goal file tools away from git metadata and CLI configuration", async () => {
    const f = tracked(fixture({ git: true }));
    const workspace = await workspaceOf(f);
    assert.throws(() => writeSandboxFile(workspace.path, ".git", "gitdir: /tmp/elsewhere\n"), rejectsWith("COPILOT_GOAL_PATH_INVALID"));
    assert.throws(() => readSandboxFile(workspace.path, ".git"), rejectsWith("COPILOT_GOAL_PATH_INVALID"));
    for (const target of [".claude/settings.json", ".claude/settings.local.json", ".mcp.json", ".codex/hooks.json", ".opencode/plugins/x.js", "./.CLAUDE/settings.json",
      ".claude/hooks/pre.sh", "opencode.json", ".grok/config.toml", ".kimi/config.toml", ".pi/agent/settings.json"])
      assert.throws(() => writeSandboxFile(workspace.path, target, "{}"), rejectsWith("COPILOT_GOAL_PATH_INVALID"), target);
    assert.equal(writeSandboxFile(workspace.path, ".claude/skills/note.md", "ok\n").bytes, 3);
  });

  it("reports a removed worktree instead of silently recreating it", async () => {
    const f = tracked(fixture({ git: true }));
    const workspace = await workspaceOf(f);
    fs.rmSync(workspace.path, { recursive: true, force: true });
    await assert.rejects(workspaceOf(f), rejectsWith("COPILOT_GOAL_SANDBOX_MISSING"));
  });
});
