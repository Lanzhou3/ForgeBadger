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
import { CopilotGoalStore, type GoalRow } from "../src/services/agent/goal-store.js";
import { ensureGoalWorkspace } from "../src/services/agent/goal-workspace.js";
import { ensureTaskWorkspace } from "../src/services/agent/goal-task-workspace.js";
import { goalContextMessage } from "../src/services/agent/goal-context.js";
import { evaluateGoalContinuation } from "../src/services/agent/goal-driver.js";
import {
  MAX_REVIEW_ATTEMPTS, parseReviewReport, readReviewState, REVIEW_DIFF_FILE, REVIEW_REPORT_FILE, REVIEW_REPORT_TIMEOUT_MS, settleGoalReviewFromHook
} from "../src/services/agent/goal-review.js";
import { goalTeamView } from "../src/services/agent/goal-team-view.js";
import { createGoalReviewTools } from "../src/services/agent/tools/goal-review.js";
import { createGoalDelegateTools } from "../src/services/agent/tools/goal-delegate.js";
import { createGoalTools } from "../src/services/agent/tools/goals.js";
import { CODING_READS, GOAL_TOOLS } from "../src/services/agent/tool-surface.js";
import { GOAL_GRANT_TOOLS } from "../src/services/agent/goal-grants.js";
import { defaultCopilotTeam, setCopilotTeamRoster, type TeamMember } from "../src/services/agent/team-roster.js";
import { AgentError } from "../src/services/agent/types.js";
import type { AgentToolContext } from "../src/services/agent/tool-registry.js";
import { ForgeBadgerEventBus, type ForgeBadgerEvent } from "../src/services/event-bus.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";

const masterKey = "abcdef0123456789abcdef0123456789";
const stateRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fb-goal-review-state-")));
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

/** Claude-shaped fake terminal: composer ready, staged text echoed, Enter consumes it. */
const stagedInputs: string[] = [];
const killed: string[] = [];
function claudeSessionManager(): InMemorySessionManager {
  const ready = "some output\n────────────\n❯ \n────────────\n";
  let pane = ready;
  return new InMemorySessionManager({
    async createSession() {}, async killSession(name: string) { killed.push(name); }, async listSessions() { return []; }, async hasSession() { return true; },
    async capturePane() { return pane; }, async inspectPane() { return { content: pane, dead: false }; },
    async stageProgrammaticInput(_name: string, data: string) { stagedInputs.push(data); pane = `────────────\n❯ ${data}\n────────────\n`; },
    async pressEnter() { pane = ready; }
  } as never, undefined, undefined, { sleep: async () => {} });
}

interface Fixture {
  db: Database.Database; userId: string; projectDir: string; store: CopilotGoalStore; goalId: string; taskA: string; taskB: string;
  context: AgentToolContext; sessionManager: InMemorySessionManager; project: { id: string; path: string };
  goal(): GoalRow; reviewsDir(): string; deps: never;
}

function fixture(options: { git: boolean } = { git: true }): Fixture {
  const db = new Database(":memory:");
  migrate(drizzle(db), { migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations") });
  const user = new UserRepository(db).create(`review-${randomUUID()}@example.com`, "hash");
  const projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fb-goal-review-project-")));
  fs.writeFileSync(path.join(projectDir, "README.md"), "line1\nline2\n");
  if (options.git) { git(projectDir, "init", "-q", "-b", "main"); git(projectDir, "add", "-A"); git(projectDir, "commit", "-q", "-m", "initial"); }
  const projectId = randomUUID();
  db.prepare("INSERT INTO projects(id,user_id,name,path,ai_tool,status) VALUES(?,?,?,?,?,?)").run(projectId, user.id, "p", projectDir, "claude", "active");
  const conversation = new CopilotConversationLog(db, user.id).createConversation();
  const store = new CopilotGoalStore(db, user.id);
  const goalId = store.createGoal({ conversationId: conversation.id, projectId, title: "Review goal", spec: "s" }).id;
  const [a, b] = store.addTasks(goalId, [{ description: "Add the parser", verifyCommand: "test -f parser.txt" }, { description: "Shared task" }]);
  const runId = randomUUID();
  db.prepare(`INSERT INTO copilot_runs(id,user_id,conversation_id,status,goal_id,runtime_version,input_json,created_at,updated_at)
    VALUES(?,?,?,'completed',?,1,'{}',?,?)`).run(runId, user.id, conversation.id, goalId, Date.now(), Date.now());
  const sessionManager = claudeSessionManager();
  return {
    db, userId: user.id, projectDir, store, goalId, taskA: a!.id, taskB: b!.id, sessionManager, project: { id: projectId, path: projectDir },
    context: { db, userId: user.id, masterKey: "k", runId, sessionManager, adapterCommandRunner, eventBus: new ForgeBadgerEventBus() } as AgentToolContext,
    goal: () => store.getGoal(goalId)!, reviewsDir: () => path.join(stateRoot, "goal-worktrees", `reviews-${goalId}`),
    deps: { db, masterKey, eventBus: new ForgeBadgerEventBus(), sessionManager } as never
  };
}

function member(adapter: TeamMember["adapter"], roles: TeamMember["roles"], over: Partial<TeamMember> = {}): TeamMember {
  return { id: `${adapter}-${roles.join("-")}`, name: `${adapter} ${roles[0]}`, title: "Reviewer", description: "Reads diffs carefully", adapter, roles, enabled: true, ...over };
}
function roster(members: TeamMember[], maxParallelWriters = 3): void { setCopilotTeamRoster({ maxParallelWriters, members }); }

const rejectsWith = (code: string) => (error: unknown) => error instanceof AgentError && error.code === code;
const reviewTool = createGoalReviewTools().find(entry => entry.name === "goal_review_task")!;
const getTool = createGoalReviewTools().find(entry => entry.name === "goal_get_review")!;
type Started = { sessionId: string; round: number; roundsLeftAfterThis: number; reviewer: { id: string; adapter: string }; writerAdapter: string | null; scope: string; changedFiles: number };
type Collected = { rounds: number; roundsLeft: number; attempts: Array<{ status: string; verdict?: string; findings?: Array<{ file: string; line: number | null; severity: string; message: string }>; droppedFindings?: number }> };

const hookEvent = (f: Fixture, sessionId: string, patch: Record<string, unknown> = {}) => ({
  type: "session_notification", userId: f.userId, sessionId, projectId: "p", sessionName: "s",
  hookEventName: "Stop", notificationType: "task_completed", message: "done", adapter: "claude", ...patch
}) as unknown as ForgeBadgerEvent;

async function until(check: () => boolean): Promise<void> {
  for (let index = 0; index < 200 && !check(); index += 1) await new Promise(done => setTimeout(done, 25));
  assert.ok(check(), "condition not reached in time");
}

/** A task worktree with uncommitted work, written by a (settled) codex session. */
async function taskWithWork(f: Fixture, writerAdapter: string | null = "codex"): Promise<string> {
  await ensureGoalWorkspace(f.db, f.userId, f.goal(), f.project);
  const ws = await ensureTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
  fs.writeFileSync(path.join(ws.path, "parser.txt"), "parse()\n");
  fs.mkdirSync(path.join(ws.path, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(ws.path, ".claude", "settings.local.json"), "{\"hook\":true}\n");
  if (writerAdapter) {
    const session = new SessionRepository(f.db, f.userId).create({ projectId: f.project.id, name: "writer", aiTool: writerAdapter, workingDir: ws.path, credentialMode: "host_environment" });
    f.store.setTaskDispatched(f.goalId, f.taskA, session.id);
    f.store.settleDispatch(f.taskA, "completed");
  }
  return ws.path;
}

const start = (f: Fixture, input: Record<string, unknown> = {}) => reviewTool.execute({ taskId: f.taskA, ...input }, f.context) as Promise<Started>;
const checkoutOf = (f: Fixture, sessionId: string) => (f.db.prepare("SELECT working_dir FROM sessions WHERE id=?").get(sessionId) as { working_dir: string }).working_dir;
const report = (dir: string, value: unknown) => fs.writeFileSync(path.join(dir, REVIEW_REPORT_FILE), typeof value === "string" ? value : JSON.stringify(value));
const taskRow = (f: Fixture, id = f.taskA) => f.store.listTasks(f.goalId).find(entry => entry.id === id)!;

describe("goal_review_task", () => {
  const dbs: Database.Database[] = [];
  function tracked(f: Fixture): Fixture { dbs.push(f.db); return f; }
  beforeEach(() => { setCopilotTeamRoster(defaultCopilotTeam()); stagedInputs.length = 0; killed.length = 0; });
  after(() => { setCopilotTeamRoster(defaultCopilotTeam()); for (const db of dbs) if (db.open) db.close(); fs.rmSync(stateRoot, { recursive: true, force: true }); });

  it("is an approval-gated dispatch tool of goal runs only, covered by the pm_dispatch grant", () => {
    assert.equal(reviewTool.risk, "operate");
    assert.equal(reviewTool.requiresApproval, true);
    assert.equal(getTool.risk, "read");
    for (const name of ["goal_review_task", "goal_get_review"]) {
      assert.ok(GOAL_TOOLS.has(name));
      assert.equal(CODING_READS.has(name), false, "not on the coding sub-run surface");
    }
    assert.ok(GOAL_GRANT_TOOLS.pm_dispatch.includes("goal_review_task"));
    assert.equal(Object.values(GOAL_GRANT_TOOLS).flat().includes("goal_get_review"), false);
  });

  it("needs a reviewer on a different, programmatically drivable CLI than the writer", async () => {
    const f = tracked(fixture());
    await taskWithWork(f, "claude");
    await assert.rejects(start(f), rejectsWith("COPILOT_GOAL_REVIEWER_UNAVAILABLE"));
    roster([member("claude", ["writer"]), member("claude", ["reviewer"]), member("codex", ["reviewer"], { enabled: false }), member("grok", ["reviewer"])]);
    await assert.rejects(start(f), rejectsWith("COPILOT_GOAL_REVIEWER_UNAVAILABLE"), "same CLI, disabled and manual-only reviewers do not qualify");
    await assert.rejects(start(f, { memberId: "claude-reviewer" }), rejectsWith("COPILOT_GOAL_INPUT_INVALID"));
    await assert.rejects(start(f, { memberId: "claude-writer" }), rejectsWith("COPILOT_GOAL_INPUT_INVALID"));
    await assert.rejects(start(f, { memberId: "codex-reviewer" }), rejectsWith("COPILOT_GOAL_INPUT_INVALID"));
    await assert.rejects(start(f, { memberId: "grok-reviewer" }), rejectsWith("COPILOT_ADAPTER_AUTONOMY_DENIED"));
    assert.equal(fs.existsSync(f.reviewsDir()), false, "nothing was created");
    assert.deepEqual(readReviewState(f.db, f.goalId, f.taskA).attempts, []);
  });

  it("reviews a snapshot of the task tree in a throwaway checkout and collects the findings", async () => {
    const f = tracked(fixture());
    roster([member("claude", ["reviewer"])]);
    const taskPath = await taskWithWork(f);
    const goalPath = f.goal().workspace_path!;
    const before = { task: git(taskPath, "rev-parse", "HEAD"), taskStatus: git(taskPath, "status", "--porcelain=v1", "--untracked-files=all"),
      goal: git(goalPath, "rev-parse", "HEAD"), project: git(f.projectDir, "rev-parse", "HEAD"), row: taskRow(f) };

    const started = await start(f, { focus: "check the empty-input case" });
    assert.deepEqual({ round: started.round, left: started.roundsLeftAfterThis, reviewer: started.reviewer.id, writer: started.writerAdapter, scope: started.scope, files: started.changedFiles },
      { round: 1, left: 1, reviewer: "claude-reviewer", writer: "codex", scope: "task", files: 1 });
    const checkout = checkoutOf(f, started.sessionId);
    assert.equal(checkout, path.join(f.reviewsDir(), `${f.taskA}-r1`));
    assert.equal(fs.readFileSync(path.join(checkout, "parser.txt"), "utf8"), "parse()\n", "uncommitted task work is in the snapshot");
    assert.equal(git(checkout, "ls-tree", "-r", "--name-only", "HEAD").includes("settings.local.json"), false, "hook files are not part of the snapshot");
    assert.throws(() => git(checkout, "symbolic-ref", "-q", "HEAD"), "detached: no branch can receive reviewer commits by accident");
    const diff = fs.readFileSync(path.join(checkout, REVIEW_DIFF_FILE), "utf8");
    assert.match(diff, /\+parse\(\)/);
    assert.equal(diff.includes("settings.local.json"), false);
    // Nothing of the goal, the task or the project moved.
    assert.equal(git(taskPath, "rev-parse", "HEAD"), before.task);
    assert.equal(git(taskPath, "status", "--porcelain=v1", "--untracked-files=all"), before.taskStatus);
    assert.equal(git(goalPath, "rev-parse", "HEAD"), before.goal);
    assert.equal(git(f.projectDir, "rev-parse", "HEAD"), before.project);
    // The reviewer gets the task, the lead's focus and the output contract; nothing else.
    const sent = stagedInputs.at(-1)!;
    for (const part of ["Add the parser", "check the empty-input case", REVIEW_REPORT_FILE, "You did not write them", "claude reviewer"]) assert.ok(sent.includes(part), part);

    assert.deepEqual(evaluateGoalContinuation(f.deps, f.userId, f.goalId, (() => randomUUID()) as never), { action: "busy", reason: "awaiting_review" });
    assert.deepEqual(settleGoalReviewFromHook(f.db, hookEvent(f, started.sessionId, { nativeSubagent: true }), f.deps), []);
    assert.deepEqual(settleGoalReviewFromHook(f.db, hookEvent(f, started.sessionId, { userId: randomUUID() }), f.deps), []);
    report(checkout, { verdict: "request_changes", summary: "One real bug.", findings: [
      { file: "parser.txt", line: 1, severity: "low", message: "naming" },
      { file: "parser.txt", line: 1, severity: "HIGH", message: "crashes on empty input" },
      { file: "x", severity: "bogus", message: "odd" }, { file: "y", line: 2, severity: "low", message: "" }] });
    assert.deepEqual(settleGoalReviewFromHook(f.db, hookEvent(f, started.sessionId), f.deps), [{ userId: f.userId, goalId: f.goalId }]);
    assert.deepEqual(settleGoalReviewFromHook(f.db, hookEvent(f, started.sessionId), f.deps), [], "duplicate reports are no-ops");

    const collected = await getTool.execute({ taskId: f.taskA }, f.context) as Collected;
    assert.deepEqual({ rounds: collected.rounds, left: collected.roundsLeft, status: collected.attempts[0]!.status, verdict: collected.attempts[0]!.verdict, dropped: collected.attempts[0]!.droppedFindings },
      { rounds: 1, left: 1, status: "reported", verdict: "request_changes", dropped: 1 });
    assert.deepEqual(collected.attempts[0]!.findings!.map(finding => [finding.severity, finding.line, finding.message]),
      [["high", 1, "crashes on empty input"], ["medium", null, "odd"], ["low", 1, "naming"]]);
    const note = f.store.recentJournal(f.goalId).find(entry => entry.note.startsWith("Review of task"))!.note;
    for (const part of ["verdict request_changes", "1 high, 1 medium, 1 low", "crashes on empty input", "does not replace the verify_command"]) assert.ok(note.includes(part), part);
    assert.match(goalContextMessage(f.db, f.userId, f.goalId)!, /"review":\{"rounds":1,"roundsLeft":1,"last":"reported","verdict":"request_changes"/);

    // The owner-facing team view carries the same findings, the worker and the worktree state.
    const view = (await goalTeamView(f.db, f.userId, f.goal())).tasks.find(entry => entry.taskId === f.taskA)!;
    assert.deepEqual([view.worker?.adapter, view.workspace, view.integrated, view.review?.rounds, view.review?.attempts[0]?.verdict, view.review?.attempts[0]?.findings.length],
      ["codex", "own", false, 1, "request_changes", 3]);
    assert.deepEqual((await goalTeamView(f.db, f.userId, f.goal())).members.map(entry => entry.id), ["claude-reviewer"]);

    // Evidence only: status, verify record and evidence are untouched, and the verify gate still holds.
    const row = taskRow(f);
    assert.deepEqual([row.status, row.verified_at, row.verify_exit_code, row.evidence], [before.row.status, null, null, before.row.evidence]);
    assert.throws(() => f.store.updateTask(f.goalId, f.taskA, "passes", "review approved"), rejectsWith("COPILOT_GOAL_VERIFY_REQUIRED"));
    const update = createGoalTools().find(entry => entry.name === "goal_update_task")!;
    await assert.rejects(update.execute({ taskId: f.taskA, status: "passes", evidence: "review approved" }, f.context) as Promise<unknown>);
    assert.equal(taskRow(f).status, before.row.status);

    // The checkout is gone, its session stopped, and the goal moves on.
    await until(() => !fs.existsSync(checkout));
    assert.equal(git(goalPath, "worktree", "list").includes("reviews-"), false);
    assert.equal(new SessionRepository(f.db, f.userId).getById(started.sessionId)!.status, "exited");
    assert.equal(killed.length, 1);
    assert.equal(evaluateGoalContinuation(f.deps, f.userId, f.goalId, (() => randomUUID()) as never).action, "enqueued");
  });

  it("caps a task at two reported rounds; attempts without a report do not count but are bounded", async () => {
    const f = tracked(fixture());
    roster([member("claude", ["reviewer"])]);
    await taskWithWork(f);
    const round = async (withReport: boolean) => {
      const started = await start(f);
      const checkout = checkoutOf(f, started.sessionId);
      if (withReport) report(checkout, { verdict: "approve", summary: "", findings: [] });
      else report(checkout, "not json");
      settleGoalReviewFromHook(f.db, hookEvent(f, started.sessionId), f.deps);
      await until(() => !fs.existsSync(checkout));
      return started;
    };
    assert.equal((await round(false)).round, 1);
    assert.ok(f.store.recentJournal(f.goalId).some(entry => entry.note.includes("does not count as a review round")));
    assert.equal((await round(true)).round, 1, "the attempt without a report did not use up a round");
    const second = await round(true);
    assert.deepEqual([second.round, second.roundsLeftAfterThis], [2, 0]);
    await assert.rejects(start(f), rejectsWith("COPILOT_GOAL_REVIEW_LIMIT"));
    assert.deepEqual(readReviewState(f.db, f.goalId, f.taskA).attempts.map(entry => entry.status), ["no_report", "reported", "reported"]);

    const g = tracked(fixture());
    await taskWithWork(g);
    for (let index = 0; index < MAX_REVIEW_ATTEMPTS; index += 1) {
      const started = await reviewTool.execute({ taskId: g.taskA }, g.context) as Started;
      settleGoalReviewFromHook(g.db, hookEvent(g, started.sessionId, { notificationType: "task_failed" }), g.deps);
      await until(() => !fs.existsSync(checkoutOf(g, started.sessionId)));
    }
    await assert.rejects(reviewTool.execute({ taskId: g.taskA }, g.context) as Promise<unknown>, rejectsWith("COPILOT_GOAL_REVIEW_LIMIT"));
    // An unreadable record refuses instead of resetting the cap.
    fs.writeFileSync(path.join(g.reviewsDir(), `${g.taskA}.json`), "{");
    await assert.rejects(reviewTool.execute({ taskId: g.taskA }, g.context) as Promise<unknown>, rejectsWith("COPILOT_GOAL_REVIEW_STATE_INVALID"));
  });

  it("releases the goal when the reviewer session ends or stays silent, keeping a report that was written", async () => {
    const f = tracked(fixture());
    roster([member("claude", ["reviewer"])]);
    await taskWithWork(f);
    const enqueue = (() => randomUUID()) as never;
    const first = await start(f);
    f.db.prepare("UPDATE sessions SET status='stopped' WHERE id=?").run(first.sessionId);
    assert.equal(evaluateGoalContinuation(f.deps, f.userId, f.goalId, enqueue).action, "enqueued");
    assert.equal(readReviewState(f.db, f.goalId, f.taskA).attempts[0]!.status, "ended");
    await until(() => !fs.existsSync(checkoutOf(f, first.sessionId)));
    f.db.prepare("UPDATE copilot_runs SET status='completed' WHERE user_id=? AND goal_id=?").run(f.userId, f.goalId);

    const second = await start(f);
    report(checkoutOf(f, second.sessionId), { verdict: "approve", summary: "fine", findings: [] });
    assert.equal(evaluateGoalContinuation(f.deps, f.userId, f.goalId, enqueue).reason, "awaiting_review");
    const later = Date.now() + REVIEW_REPORT_TIMEOUT_MS + 1;
    assert.notEqual(evaluateGoalContinuation(f.deps, f.userId, f.goalId, enqueue, { now: later }).reason, "awaiting_review");
    assert.deepEqual(readReviewState(f.db, f.goalId, f.taskA).attempts.map(entry => entry.status), ["ended", "reported"]);
    await until(() => !fs.existsSync(checkoutOf(f, second.sessionId)));
  });

  it("keeps an attempt whose delivery failed on the record, so failures cannot bypass the attempt cap", async () => {
    const f = tracked(fixture());
    roster([member("claude", ["reviewer"])]);
    await taskWithWork(f);
    f.sessionManager.submitProgrammaticTask = async () => { throw new Error("PROGRAMMATIC_INPUT_NOT_READY"); };
    await assert.rejects(start(f));
    assert.deepEqual(readReviewState(f.db, f.goalId, f.taskA).attempts.map(entry => [entry.attempt, entry.status]), [[1, "ended"]]);
    assert.equal(fs.existsSync(path.join(f.reviewsDir(), `${f.taskA}-r1`)), false);
    assert.equal(killed.length, 1, "the reviewer session was stopped");
    await assert.rejects(start(f));
    assert.deepEqual(readReviewState(f.db, f.goalId, f.taskA).attempts.map(entry => entry.attempt), [1, 2]);
    assert.equal(evaluateGoalContinuation(f.deps, f.userId, f.goalId, (() => randomUUID()) as never).action, "enqueued");
  });

  it("refuses when there is nothing reviewable or the tree is still being written", async () => {
    const f = tracked(fixture());
    roster([member("claude", ["reviewer"]), member("claude", ["writer"])]);
    await ensureGoalWorkspace(f.db, f.userId, f.goal(), f.project);
    const ws = await ensureTaskWorkspace(f.db, f.userId, f.goal(), f.taskA);
    await assert.rejects(start(f), rejectsWith("COPILOT_GOAL_TASK_NOT_READY"), "no changes");
    assert.equal(fs.existsSync(path.join(f.reviewsDir(), `${f.taskA}-r1`)), false, "the empty checkout was discarded");
    assert.deepEqual(readReviewState(f.db, f.goalId, f.taskA).attempts, []);
    fs.writeFileSync(path.join(ws.path, "parser.txt"), "x\n");
    const writer = new SessionRepository(f.db, f.userId).create({ projectId: f.project.id, name: "w", aiTool: "codex", workingDir: ws.path, credentialMode: "host_environment" });
    f.store.setTaskDispatched(f.goalId, f.taskA, writer.id);
    await assert.rejects(start(f), rejectsWith("COPILOT_GOAL_TASK_NOT_READY"), "writer still running");
    assert.equal(fs.existsSync(path.join(f.reviewsDir(), `${f.taskA}-r1`)), false);

    const copy = tracked(fixture({ git: false }));
    await assert.rejects(reviewTool.execute({ taskId: copy.taskA }, copy.context) as Promise<unknown>, rejectsWith("COPILOT_GOAL_TASK_WORKSPACE_UNAVAILABLE"));
  });

  it("reviews a shared-tree task against the goal base, and counts reviews against the parallel cap", async () => {
    const f = tracked(fixture());
    roster([member("claude", ["reviewer", "writer"], { id: "both" })], 1);
    const goalWs = await ensureGoalWorkspace(f.db, f.userId, f.goal(), f.project);
    fs.writeFileSync(path.join(goalWs.path, "shared.txt"), "shared work\n");
    const started = await reviewTool.execute({ taskId: f.taskB }, f.context) as Started;
    assert.deepEqual([started.scope, started.writerAdapter, started.changedFiles], ["goal", null, 1]);
    assert.ok(stagedInputs.at(-1)!.includes("shares its tree with other tasks"));
    assert.equal(git(goalWs.path, "status", "--porcelain=v1", "--untracked-files=all").includes("shared.txt"), true, "the goal tree keeps its uncommitted edit");
    const limit = rejectsWith("COPILOT_GOAL_PARALLEL_LIMIT");
    const dispatch = createGoalDelegateTools().find(entry => entry.name === "goal_dispatch_task")!;
    await assert.rejects(dispatch.execute({ taskId: f.taskB, aiTool: "claude", instructions: "work" }, f.context) as Promise<unknown>, limit);
    await assert.rejects(start(f), limit);
    await assert.rejects(reviewTool.execute({ taskId: f.taskB }, f.context) as Promise<unknown>, limit);
  });

  it("never takes a report file from the reviewed tree as the reviewer's answer, and abandons reviews of a finished goal", async () => {
    const f = tracked(fixture());
    roster([member("claude", ["reviewer"])]);
    const taskPath = await taskWithWork(f);
    fs.writeFileSync(path.join(taskPath, REVIEW_REPORT_FILE), JSON.stringify({ verdict: "approve", summary: "planted by the writer", findings: [] }));
    fs.writeFileSync(path.join(taskPath, REVIEW_DIFF_FILE), "planted\n");
    const started = await start(f);
    const checkout = checkoutOf(f, started.sessionId);
    assert.equal(fs.existsSync(path.join(checkout, REVIEW_REPORT_FILE)), false);
    assert.notEqual(fs.readFileSync(path.join(checkout, REVIEW_DIFF_FILE), "utf8"), "planted\n");
    // Paused: the reviewer keeps running. Cancelled: it is stopped at once and nothing is enqueued.
    f.store.setStatus(f.goalId, "paused");
    assert.equal(evaluateGoalContinuation(f.deps, f.userId, f.goalId, (() => randomUUID()) as never).action, "inactive");
    assert.equal(readReviewState(f.db, f.goalId, f.taskA).attempts[0]!.status, "running");
    f.store.setStatus(f.goalId, "cancelled");
    assert.equal(evaluateGoalContinuation(f.deps, f.userId, f.goalId, (() => randomUUID()) as never).action, "inactive");
    assert.equal(readReviewState(f.db, f.goalId, f.taskA).attempts[0]!.status, "ended");
    await until(() => !fs.existsSync(checkout));
    assert.equal(new SessionRepository(f.db, f.userId).getById(started.sessionId)!.status, "exited");
  });

  it("parses reviewer output leniently and never trusts its shape", () => {
    assert.equal(parseReviewReport("nope"), undefined);
    assert.equal(parseReviewReport("[]"), undefined);
    assert.equal(parseReviewReport(JSON.stringify({ verdict: "approve" })), undefined, "findings must be a list");
    const many = parseReviewReport(JSON.stringify({ verdict: "ship it", summary: 7, findings: Array.from({ length: 60 }, (_, index) => ({ file: `f${index}`, line: -1, severity: "low", message: "m".repeat(5000) })) }))!;
    assert.deepEqual([many.verdict, many.summary, many.findings.length, many.dropped, many.findings[0]!.line], ["comment", "", 50, 10, null]);
    assert.ok(many.findings[0]!.message.length <= 1200);
    assert.equal(parseReviewReport(JSON.stringify({ findings: [] }))!.verdict, "approve");
  });

  it("ignores a report that is not a regular file and hooks of unrelated sessions", async () => {
    const f = tracked(fixture());
    roster([member("claude", ["reviewer"])]);
    await taskWithWork(f);
    const other = new SessionRepository(f.db, f.userId).create({ projectId: f.project.id, name: "o", aiTool: "claude", workingDir: f.projectDir, credentialMode: "host_environment" });
    assert.deepEqual(settleGoalReviewFromHook(f.db, hookEvent(f, other.id), f.deps), []);
    const started = await start(f);
    const checkout = checkoutOf(f, started.sessionId);
    const outside = path.join(stateRoot, `outside-${randomUUID()}.json`);
    fs.writeFileSync(outside, JSON.stringify({ verdict: "approve", findings: [] }));
    fs.symlinkSync(outside, path.join(checkout, REVIEW_REPORT_FILE));
    settleGoalReviewFromHook(f.db, hookEvent(f, started.sessionId), f.deps);
    assert.equal(readReviewState(f.db, f.goalId, f.taskA).attempts[0]!.status, "no_report");
    await until(() => !fs.existsSync(checkout));
  });
});
