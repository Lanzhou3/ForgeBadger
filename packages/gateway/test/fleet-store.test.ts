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
import { ProjectManagerRepository } from "../src/db/repositories/project-manager-repository.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { CopilotGoalStore } from "../src/services/agent/goal-store.js";
import { AgentError } from "../src/services/agent/types.js";
import { isFleetStore, scopeKind, workStore } from "../src/services/agent/work-store.js";
import { FleetStore, normalizeFileScope, parseFileScope } from "../src/services/fleet/fleet-store.js";

const stateRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fb-fleet-store-state-")));
process.env.FORGEBADGER_STATE_DIR = stateRoot;

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "-c", "user.name=Owner", "-c", "user.email=owner@example.com", ...args],
    { cwd, env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } });
}

function createDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(drizzle(db), { migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations") });
  return db;
}

const dirs: string[] = [];
function projectDir(gitRepo: boolean): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fb-fleet-store-project-")));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, "README.md"), "# Fleet\n");
  if (gitRepo) { git(dir, "init", "-q", "-b", "main"); git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "initial"); }
  return dir;
}

function addProject(db: Database.Database, userId: string, dir: string, name = "fleet-project"): string {
  const id = randomUUID();
  db.prepare("INSERT INTO projects(id,user_id,name,path,ai_tool,status) VALUES(?,?,?,?,?,?)").run(id, userId, name, dir, "claude", "active");
  return id;
}

interface Fixture { db: Database.Database; userId: string; otherId: string; projectId: string; store: FleetStore; other: FleetStore }

function fixture(): Fixture {
  const db = createDb();
  const users = new UserRepository(db);
  const user = users.create(`fleet-${randomUUID()}@example.com`, "hash");
  const other = users.create(`fleet-other-${randomUUID()}@example.com`, "hash");
  const projectId = addProject(db, user.id, projectDir(true));
  return { db, userId: user.id, otherId: other.id, projectId, store: new FleetStore(db, user.id), other: new FleetStore(db, other.id) };
}

const rejectsWith = (code: string) => (error: unknown) => error instanceof AgentError && error.code === code;

describe("FleetStore", () => {
  const dbs: Database.Database[] = [];
  function tracked(f: Fixture): Fixture { dbs.push(f.db); return f; }
  after(() => {
    for (const db of dbs) if (db.open) db.close();
    for (const dir of [...dirs, stateRoot]) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("creates one fleet per git project with its own lead conversation", () => {
    const f = tracked(fixture());
    const fleet = f.store.createFleet({ projectId: f.projectId, instructions: "  Keep the API stable.  ", grants: ["pm_dispatch", "pm_dispatch"] });
    assert.deepEqual([fleet.title, fleet.instructions, fleet.status, fleet.paused_reason, JSON.parse(fleet.grants_json)],
      ["fleet-project", "Keep the API stable.", "active", null, ["pm_dispatch"]]);
    const conversation = new CopilotConversationLog(f.db, f.userId).getConversation(fleet.conversation_id);
    assert.equal(conversation?.project_id, f.projectId, "the lead conversation is bound to the project");
    assert.equal(f.store.getFleetByProject(f.projectId)?.id, fleet.id);
    assert.equal(scopeKind(f.db, f.userId, fleet.id), "fleet");
    assert.ok(isFleetStore(workStore(f.db, f.userId, fleet.id)));

    assert.throws(() => f.store.createFleet({ projectId: f.projectId }), rejectsWith("FLEET_EXISTS"));
    const plain = addProject(f.db, f.userId, projectDir(false), "plain");
    assert.throws(() => f.store.createFleet({ projectId: plain }), rejectsWith("FLEET_GIT_REQUIRED"));
    assert.throws(() => f.store.createFleet({ projectId: randomUUID() }), rejectsWith("COPILOT_PROJECT_NOT_FOUND"));
    const second = addProject(f.db, f.userId, projectDir(true), "second");
    assert.throws(() => f.store.createFleet({ projectId: second, grants: ["operate_everything"] }), rejectsWith("FLEET_INPUT_INVALID"));
    assert.throws(() => f.store.createFleet({ projectId: second, title: "   " }), rejectsWith("FLEET_INPUT_INVALID"));
    assert.equal(f.store.listFleets().length, 1, "refused creations leave nothing behind");
    assert.equal((f.db.prepare("SELECT count(*) AS count FROM copilot_conversations WHERE user_id=?").get(f.userId) as { count: number }).count, 1);
  });

  it("refuses shared and team projects with the goal rule", () => {
    const f = tracked(fixture());
    const member = new UserRepository(f.db).create(`member-${randomUUID()}@example.com`, "hash");
    f.db.prepare("INSERT INTO collaboration_members(project_id,user_id,member_id,role) VALUES(?,?,?,?)").run(f.projectId, f.userId, member.id, "developer");
    assert.throws(() => f.store.createFleet({ projectId: f.projectId }), rejectsWith("COPILOT_GOAL_SHARED_PROJECT"));
    assert.equal(f.store.getFleetByProject(f.projectId), undefined);
  });

  it("isolates tenants: another user can neither read nor change a fleet", () => {
    const f = tracked(fixture());
    const fleet = f.store.createFleet({ projectId: f.projectId });
    const task = f.store.addTask(fleet.id, { description: "Mine", createdBy: "owner" });
    f.store.appendJournal(fleet.id, null, "owner note");
    assert.equal(f.other.getFleet(fleet.id), undefined);
    assert.equal(f.other.getGoal(fleet.id), undefined);
    assert.equal(f.other.getFleetByProject(f.projectId), undefined);
    assert.deepEqual(f.other.listFleets(), []);
    assert.deepEqual(f.other.listTasks(fleet.id), []);
    assert.deepEqual(f.other.recentJournal(fleet.id), []);
    assert.equal(scopeKind(f.db, f.otherId, fleet.id), undefined);
    assert.equal(isFleetStore(workStore(f.db, f.otherId, fleet.id)), false);
    assert.throws(() => f.other.updateFleet(fleet.id, { title: "stolen" }), rejectsWith("COPILOT_NOT_FOUND"));
    assert.throws(() => f.other.setStatus(fleet.id, "paused"), rejectsWith("COPILOT_NOT_FOUND"));
    assert.throws(() => f.other.addTask(fleet.id, { description: "x", createdBy: "owner" }), rejectsWith("COPILOT_NOT_FOUND"));
    assert.throws(() => f.other.addTasks(fleet.id, ["x"]), rejectsWith("COPILOT_NOT_FOUND"));
    assert.throws(() => f.other.updateTask(fleet.id, task.id, "in_progress"), rejectsWith("COPILOT_NOT_FOUND"));
    assert.throws(() => f.other.setHold(fleet.id, task.id, "q?"), rejectsWith("COPILOT_NOT_FOUND"));
    assert.throws(() => f.other.cancelTask(fleet.id, task.id), rejectsWith("COPILOT_NOT_FOUND"));
    assert.throws(() => f.other.setTaskDispatched(fleet.id, task.id, "session"), rejectsWith("COPILOT_NOT_FOUND"));
    assert.throws(() => f.other.markTaskVerified(fleet.id, task.id, 0, "verify"), rejectsWith("COPILOT_NOT_FOUND"));
    assert.throws(() => f.other.appendJournal(fleet.id, null, "x"), rejectsWith("COPILOT_NOT_FOUND"));
    assert.equal(f.other.settleDispatch(task.id, "completed"), undefined);
    f.other.setWorkspaceBase(fleet.id, "a".repeat(40));
    f.other.touchTask(fleet.id, task.id);
    // A workspace record of another tenant is never written.
    assert.throws(() => f.other.setWorkspace(fleet.id, { kind: "worktree", path: "/tmp/x" }), rejectsWith("COPILOT_NOT_FOUND"));
    const fresh = f.store.getFleet(fleet.id)!;
    assert.deepEqual([fresh.title, fresh.status, fresh.workspace_kind], [fleet.title, "active", null]);
    assert.deepEqual(f.store.listTasks(fleet.id).map(entry => [entry.status, entry.hold_question, entry.dispatch_status]), [["pending", null, null]]);
    assert.equal(f.store.recentJournal(fleet.id).length, 1);
  });

  it("projects onto goal rows so goal execution code reads it", () => {
    const f = tracked(fixture());
    const fleet = f.store.createFleet({ projectId: f.projectId, instructions: "standing orders" });
    const goal = f.store.getGoal(fleet.id)!;
    assert.deepEqual([goal.id, goal.spec, goal.status, goal.blocked_reason, goal.pending_question, goal.completed_at, goal.project_id, goal.conversation_id],
      [fleet.id, "standing orders", "active", null, null, null, f.projectId, fleet.conversation_id]);
    const [task] = f.store.addTasks(fleet.id, [{ description: "Lead task", verifyCommand: "make check" }]);
    assert.deepEqual([task!.goal_id, task!.fleet_id, task!.seq, task!.created_by, task!.verify_command], [fleet.id, fleet.id, 1, "lead", "make check"]);
    const goalStore = new CopilotGoalStore(f.db, f.userId);
    assert.equal(goalStore.getGoal(fleet.id), undefined, "a fleet id never resolves as a goal");
  });

  it("keeps the goal execution gates on tasks", () => {
    const f = tracked(fixture());
    const fleet = f.store.createFleet({ projectId: f.projectId });
    const gated = f.store.addTask(fleet.id, { description: "Gated", verifyCommand: "make check", createdBy: "owner" });
    const plain = f.store.addTask(fleet.id, { description: "Plain", createdBy: "lead" });
    assert.equal(plain.seq, 2);
    assert.throws(() => f.store.updateTask(fleet.id, gated.id, "passes", "looks good"), rejectsWith("COPILOT_GOAL_VERIFY_REQUIRED"));
    assert.throws(() => f.store.updateTask(fleet.id, plain.id, "passes"), rejectsWith("COPILOT_GOAL_EVIDENCE_REQUIRED"));
    assert.throws(() => f.store.updateTask(fleet.id, plain.id, "cancelled"), rejectsWith("COPILOT_GOAL_TASK_CANCELLED"));

    f.store.markTaskVerified(fleet.id, gated.id, 0, "verify: make check (exit 0)");
    // New CLI work clears the verify record and records the member.
    const dispatched = f.store.setTaskDispatched(fleet.id, gated.id, "session-1", "claude-dev");
    assert.deepEqual([dispatched.dispatch_status, dispatched.verified_at, dispatched.verify_exit_code, dispatched.member_id, dispatched.dispatched_session_id],
      ["running", null, null, "claude-dev", "session-1"]);
    assert.deepEqual(f.store.runningDispatchesForSession("session-1").map(entry => entry.id), [gated.id]);
    assert.throws(() => f.store.updateTask(fleet.id, gated.id, "passes", "done"), rejectsWith("COPILOT_GOAL_VERIFY_REQUIRED"));
    assert.equal(f.store.settleDispatch(gated.id, "completed")?.dispatch_status, "completed");
    assert.equal(f.store.settleDispatch(gated.id, "failed"), undefined, "only a running dispatch settles");
    assert.equal(f.store.setTaskDispatched(fleet.id, gated.id, "session-2").member_id, null, "a dispatch without a member clears the old one");
    f.store.settleDispatch(gated.id, "completed");
    f.store.markTaskVerified(fleet.id, gated.id, 0, "verify: make check (exit 0)");
    assert.equal(f.store.updateTask(fleet.id, gated.id, "passes", "verified")?.status, "passes");
    assert.equal(f.store.updateTask(fleet.id, plain.id, "passes", "manual evidence")?.evidence, "manual evidence");

    // Cancelled is final.
    const doomed = f.store.addTask(fleet.id, { description: "Doomed", createdBy: "owner" });
    f.store.setHold(fleet.id, doomed.id, "Which API?");
    const cancelled = f.store.cancelTask(fleet.id, doomed.id);
    assert.deepEqual([cancelled.status, cancelled.hold_question], ["cancelled", null]);
    assert.equal(f.store.cancelTask(fleet.id, doomed.id).status, "cancelled", "idempotent");
    assert.throws(() => f.store.updateTask(fleet.id, doomed.id, "in_progress"), rejectsWith("COPILOT_GOAL_TASK_CANCELLED"));
    assert.throws(() => f.store.setHold(fleet.id, doomed.id, "again?"), rejectsWith("COPILOT_GOAL_TASK_CANCELLED"));
    assert.throws(() => f.store.updateTask(fleet.id, randomUUID(), "in_progress"), rejectsWith("COPILOT_NOT_FOUND"));
  });

  it("holds one task without touching the fleet, and counts the board", () => {
    const f = tracked(fixture());
    const fleet = f.store.createFleet({ projectId: f.projectId });
    const [a, b, c, d] = ["A", "B", "C", "D"].map(description => f.store.addTask(fleet.id, { description, createdBy: "owner" }));
    const held = f.store.setHold(fleet.id, a!.id, "  Which database?  ");
    assert.equal(held.hold_question, "Which database?");
    assert.ok(held.hold_asked_at);
    assert.equal(f.store.getFleet(fleet.id)!.status, "active", "a hold never pauses the fleet");
    f.store.setTaskDispatched(fleet.id, b!.id, "session-b", "codex-dev");
    f.store.updateTask(fleet.id, c!.id, "passes", "evidence");
    f.store.cancelTask(fleet.id, d!.id);
    const [row] = f.store.listFleets();
    assert.deepEqual([row!.project_name, row!.task_total, row!.task_done, row!.task_held, row!.task_running], ["fleet-project", 4, 1, 1, 1]);
    assert.equal(f.store.clearHold(fleet.id, a!.id).hold_question, null);
    assert.equal(f.store.listFleets()[0]!.task_held, 0);
    assert.throws(() => f.store.setHold(fleet.id, b!.id, " "), rejectsWith("FLEET_INPUT_INVALID"));
  });

  it("validates task input, file scope and work item links", () => {
    const f = tracked(fixture());
    const fleet = f.store.createFleet({ projectId: f.projectId });
    const task = f.store.addTask(fleet.id, {
      description: "Scoped", details: "Long form", createdBy: "owner",
      fileScope: ["src/api/", "./src/api", "docs\\guide.md", "src/api/routes.ts"]
    });
    assert.deepEqual(parseFileScope(task.file_scope_json), ["src/api", "docs/guide.md", "src/api/routes.ts"]);
    assert.equal(task.details, "Long form");
    assert.equal(normalizeFileScope([]), undefined);
    for (const bad of [["/etc/passwd"], ["../outside"], ["src/../../x"], ["C:/win"], ["~/home"], [""], ["a\u0000b"], ["x".repeat(201)], Array.from({ length: 21 }, (_, index) => `p${index}`)])
      assert.throws(() => f.store.addTask(fleet.id, { description: "bad", fileScope: bad, createdBy: "owner" }), rejectsWith("FLEET_INPUT_INVALID"), JSON.stringify(bad).slice(0, 40));
    assert.throws(() => f.store.addTask(fleet.id, { description: "x".repeat(501), createdBy: "owner" }), rejectsWith("FLEET_INPUT_INVALID"));
    assert.throws(() => f.store.addTask(fleet.id, { description: "bad creator", createdBy: "model" as never }), rejectsWith("FLEET_INPUT_INVALID"));
    assert.equal(f.store.listTasks(fleet.id).length, 1, "rejected tasks are not stored");

    const board = new ProjectManagerRepository(f.db, f.userId);
    const item = board.createWorkItem(f.projectId, { title: "Board item", description: "d", acceptanceCriteria: ["ok"] });
    const linked = f.store.addTask(fleet.id, { description: "Linked", workItemId: item.id, createdBy: "owner" });
    assert.equal(linked.work_item_id, item.id);
    assert.throws(() => f.store.addTask(fleet.id, { description: "Twice", workItemId: item.id, createdBy: "owner" }), rejectsWith("FLEET_INPUT_INVALID"));
    assert.throws(() => f.store.addTask(fleet.id, { description: "Missing", workItemId: randomUUID(), createdBy: "owner" }), rejectsWith("COPILOT_NOT_FOUND"));
  });

  it("updates settings and status, and keeps a per-task journal", () => {
    const f = tracked(fixture());
    const fleet = f.store.createFleet({ projectId: f.projectId, title: "Ops" });
    const updated = f.store.updateFleet(fleet.id, { instructions: "New orders", grants: ["sandbox_checks"] });
    assert.deepEqual([updated.title, updated.instructions, JSON.parse(updated.grants_json)], ["Ops", "New orders", ["sandbox_checks"]]);
    assert.throws(() => f.store.updateFleet(fleet.id, { grants: ["root"] }), rejectsWith("FLEET_INPUT_INVALID"));
    const paused = f.store.setStatus(fleet.id, "paused", "run_rate_limit");
    assert.deepEqual([paused.status, paused.paused_reason, f.store.getGoal(fleet.id)!.status], ["paused", "run_rate_limit", "paused"]);
    assert.deepEqual([f.store.setStatus(fleet.id, "active", "ignored").paused_reason], [null]);
    assert.throws(() => f.store.setStatus(fleet.id, "completed" as never), rejectsWith("FLEET_INPUT_INVALID"));

    const task = f.store.addTask(fleet.id, { description: "T", createdBy: "owner" });
    f.store.appendJournal(fleet.id, null, "fleet note");
    const entry = f.store.appendJournal(fleet.id, "run-1", "task note", task.id);
    assert.deepEqual([entry.goal_id, entry.fleet_id, entry.task_id, entry.run_id], [fleet.id, fleet.id, task.id, "run-1"]);
    assert.deepEqual(f.store.recentJournal(fleet.id).map(row => row.note), ["task note", "fleet note"]);
    assert.deepEqual(f.store.recentJournal(fleet.id, 5, task.id).map(row => row.note), ["task note"]);
    assert.throws(() => f.store.appendJournal(fleet.id, null, "x", randomUUID()), rejectsWith("COPILOT_NOT_FOUND"));
  });
});
