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
import { SessionRepository } from "../src/db/repositories/session-repository.js";
import type { AgentStackDeps } from "../src/services/agent/agent-stack.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { attachGoalDriver, DISPATCH_REPORT_TIMEOUT_MS } from "../src/services/agent/goal-driver.js";
import { CopilotGoalStore } from "../src/services/agent/goal-store.js";
import { goalWorktreeBase } from "../src/services/agent/goal-workspace.js";
import type { TurnInput } from "../src/services/agent/run-ledger.js";
import { ForgeBadgerEventBus, type ForgeBadgerEvent } from "../src/services/event-bus.js";
import { acquireFleetMergeLock, enqueueFleetEvent, enqueueSettledFleetReviews, FleetInbox, type FleetEventRow } from "../src/services/fleet/fleet-inbox.js";
import { createCopilotOrchestrator } from "../src/services/agent/orchestrator.js";
import type { AgentLlmClient, AgentLlmStreamEvent } from "../src/services/agent/orchestrator-types.js";
import { createAgentToolRegistry } from "../src/services/agent/tool-registry.js";
import { createFleetTools } from "../src/services/agent/tools/fleet.js";
import { FleetStore } from "../src/services/fleet/fleet-store.js";
import {
  attachFleetWorker, LEAD_RUNS_PER_HOUR, NO_PROGRESS_RUN_LIMIT, pumpFleet, settleFleetDispatchFromHook, settleLeadRun, sweepFleetDispatches
} from "../src/services/fleet/fleet-worker.js";

const stateRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fb-fleet-worker-state-")));
process.env.FORGEBADGER_STATE_DIR = stateRoot;

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd, stdio: "ignore",
    env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "O", GIT_AUTHOR_EMAIL: "o@example.com",
      GIT_COMMITTER_NAME: "O", GIT_COMMITTER_EMAIL: "o@example.com" }
  });
}

interface Fixture {
  db: Database.Database; userId: string; projectId: string; store: FleetStore; inbox: FleetInbox; fleetId: string; conversationId: string;
  deps: AgentStackDeps; runs: TurnInput[]; enqueue: (userId: string, input: TurnInput) => string;
}

const dbs: Database.Database[] = [];

function fixture(): Fixture {
  const db = new Database(":memory:");
  dbs.push(db);
  migrate(drizzle(db), { migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations") });
  const user = new UserRepository(db).create(`fleet-worker-${randomUUID()}@example.com`, "hash");
  const projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fb-fleet-worker-project-")));
  fs.writeFileSync(path.join(projectDir, "README.md"), "x\n");
  git(projectDir, "init", "-q", "-b", "main"); git(projectDir, "add", "-A"); git(projectDir, "commit", "-q", "-m", "init");
  const projectId = randomUUID();
  db.prepare("INSERT INTO projects(id,user_id,name,path,ai_tool,status) VALUES(?,?,?,?,?,?)").run(projectId, user.id, "p", projectDir, "claude", "active");
  const store = new FleetStore(db, user.id);
  const fleet = store.createFleet({ projectId });
  const runs: TurnInput[] = [];
  // Fake admission: a real run row (pending) like the orchestrator writes, never a model call.
  const enqueue = (userId: string, input: TurnInput): string => {
    const id = randomUUID();
    db.prepare(`INSERT INTO copilot_runs(id,user_id,conversation_id,status,goal_id,input_json,created_at,updated_at) VALUES(?,?,?,'pending',?,?,?,?)`)
      .run(id, userId, input.conversationId, input.goalId ?? null, JSON.stringify(input), Date.now(), Date.now());
    runs.push(input);
    return id;
  };
  return {
    db, userId: user.id, projectId, store, inbox: new FleetInbox(db, user.id), fleetId: fleet.id, conversationId: fleet.conversation_id,
    deps: { db, masterKey: "k", eventBus: new ForgeBadgerEventBus() } as AgentStackDeps, runs, enqueue
  };
}

const events = (f: Fixture): FleetEventRow[] => f.db.prepare("SELECT * FROM fleet_events WHERE fleet_id=? ORDER BY created_at, rowid").all(f.fleetId) as FleetEventRow[];
const finishRun = (f: Fixture, runId: string, status: string, stopReason: string | null = null) =>
  f.db.prepare("UPDATE copilot_runs SET status=?, stop_reason=? WHERE id=?").run(status, stopReason, runId);
const notifications = (f: Fixture) => f.db.prepare("SELECT * FROM notifications WHERE user_id=? AND type='copilot_fleet'").all(f.userId) as Array<{ payload: string; message: string }>;
const tick = () => new Promise(resolve => setImmediate(resolve));
const add = (f: Fixture, key: string, kind: FleetEventRow["kind"] = "owner_message") => f.inbox.enqueue(f.fleetId, { kind, dedupeKey: key, payload: { text: key } });

function session(f: Fixture, status = "running"): string {
  const repo = new SessionRepository(f.db, f.userId);
  const row = repo.create({ projectId: f.projectId, name: "member", aiTool: "claude", workingDir: os.tmpdir(), credentialMode: "host_environment" });
  repo.updateStatus(row.id, status);
  return row.id;
}

function hook(userId: string, sessionId: string, extra: Partial<Record<string, unknown>> = {}): ForgeBadgerEvent {
  return { type: "session_notification", userId, sessionId, hookEventName: "Stop", notificationType: "task_completed", message: "done", adapter: "claude", ...extra } as ForgeBadgerEvent;
}

after(() => { for (const db of dbs) if (db.open) db.close(); fs.rmSync(stateRoot, { recursive: true, force: true }); });

describe("fleet inbox and worker", () => {
  it("dedupes events per fleet and never writes into another tenant's fleet", () => {
    const f = fixture();
    assert.equal(add(f, "k1"), true);
    assert.equal(add(f, "k1"), false);
    assert.equal(add(f, "k2"), true);
    const other = fixture();
    assert.equal(new FleetInbox(other.db, other.userId).enqueue(f.fleetId, { kind: "owner_message", dedupeKey: "x" }), false);
    assert.equal(new FleetInbox(f.db, randomUUID()).enqueue(f.fleetId, { kind: "owner_message", dedupeKey: "x" }), false);
    assert.equal(events(f).length, 2);
  });

  it("batches pending events into one run, keeps one active run, and completes them", () => {
    const f = fixture();
    for (const key of ["a", "b", "c"]) add(f, key);
    const first = pumpFleet(f.deps, f.userId, f.fleetId, { enqueue: f.enqueue });
    assert.equal(first.action, "enqueued");
    assert.equal(f.runs.length, 1);
    assert.deepEqual([f.runs[0]!.goalId, f.runs[0]!.conversationId, f.runs[0]!.goalContinuation, f.runs[0]!.source], [f.fleetId, f.conversationId, true, "user"]);
    assert.match(f.runs[0]!.userText, /3 new event\(s\)/);
    assert.deepEqual(events(f).map(e => [e.status, e.run_id]), [["claimed", first.runId], ["claimed", first.runId], ["claimed", first.runId]]);
    add(f, "d");
    assert.equal(pumpFleet(f.deps, f.userId, f.fleetId, { enqueue: f.enqueue }).action, "busy");
    assert.equal(f.runs.length, 1);
    finishRun(f, first.runId!, "completed");
    assert.equal(settleLeadRun(f.db, f.userId, first.runId!), f.fleetId);
    assert.deepEqual(events(f).map(e => e.status), ["done", "done", "done", "pending"]);
    const second = pumpFleet(f.deps, f.userId, f.fleetId, { enqueue: f.enqueue });
    assert.equal(second.action, "enqueued");
    assert.deepEqual(second.eventIds?.length, 1);
    assert.equal(pumpFleet(f.deps, f.userId, f.fleetId, { enqueue: f.enqueue }).action, "busy");
  });

  it("returns events of a failed run to pending and gives up after three attempts with a journal line and one notification", () => {
    const f = fixture();
    add(f, "m");
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const decision = pumpFleet(f.deps, f.userId, f.fleetId, { enqueue: f.enqueue, retryDelayMs: 0 });
      assert.equal(decision.action, "enqueued", `attempt ${attempt}`);
      finishRun(f, decision.runId!, "failed", "COPILOT_FAILED");
      settleLeadRun(f.db, f.userId, decision.runId!);
      const [event] = events(f);
      assert.deepEqual([event!.status, event!.attempt_count], [attempt < 3 ? "pending" : "failed", attempt]);
    }
    assert.equal(pumpFleet(f.deps, f.userId, f.fleetId, { enqueue: f.enqueue, retryDelayMs: 0 }).action, "idle");
    assert.equal(notifications(f).length, 1);
    assert.ok(f.store.recentJournal(f.fleetId, 10).some(entry => entry.note.startsWith("Gave up on 1 event(s)")));
  });

  it("waits out the retry delay and does not count a run stopped by an owner pause", () => {
    const f = fixture();
    add(f, "m");
    const run = pumpFleet(f.deps, f.userId, f.fleetId, { enqueue: f.enqueue, retryDelayMs: 60_000 });
    finishRun(f, run.runId!, "failed");
    settleLeadRun(f.db, f.userId, run.runId!);
    assert.equal(pumpFleet(f.deps, f.userId, f.fleetId, { enqueue: f.enqueue, retryDelayMs: 60_000 }).action, "idle");
    assert.equal(pumpFleet(f.deps, f.userId, f.fleetId, { enqueue: f.enqueue, retryDelayMs: 60_000, now: () => Date.now() + 61_000 }).action, "enqueued");
    const paused = f.runs.length;
    const last = f.db.prepare("SELECT id FROM copilot_runs WHERE goal_id=? AND status='pending'").get(f.fleetId) as { id: string };
    finishRun(f, last.id, "stopped", "goal_paused");
    settleLeadRun(f.db, f.userId, last.id);
    assert.deepEqual([events(f)[0]!.status, events(f)[0]!.attempt_count, f.runs.length], ["pending", 1, paused]);
  });

  it("recovers claims whose run vanished or ended without its terminal event", () => {
    const f = fixture();
    add(f, "lost");
    f.db.prepare("UPDATE fleet_events SET status='claimed', run_id=?, claimed_at=? WHERE fleet_id=?").run(randomUUID(), Date.now(), f.fleetId);
    const decision = pumpFleet(f.deps, f.userId, f.fleetId, { enqueue: f.enqueue });
    assert.equal(decision.action, "enqueued");
    assert.deepEqual([events(f)[0]!.status, events(f)[0]!.attempt_count, events(f)[0]!.run_id], ["claimed", 0, decision.runId]);
    finishRun(f, decision.runId!, "completed");
    // No terminal event was seen: the next pump settles the claim first.
    assert.equal(pumpFleet(f.deps, f.userId, f.fleetId, { enqueue: f.enqueue }).action, "idle");
    assert.equal(events(f)[0]!.status, "done");
  });

  it("lets a paused fleet accumulate events and pumps after resume", () => {
    const f = fixture();
    f.store.setStatus(f.fleetId, "paused", "owner");
    add(f, "a"); add(f, "b");
    assert.equal(pumpFleet(f.deps, f.userId, f.fleetId, { enqueue: f.enqueue }).action, "paused");
    assert.equal(f.runs.length, 0);
    f.store.setStatus(f.fleetId, "active");
    const decision = pumpFleet(f.deps, f.userId, f.fleetId, { enqueue: f.enqueue });
    assert.deepEqual([decision.action, decision.eventIds?.length], ["enqueued", 2]);
  });

  it("resumes from rows alone with a fresh worker instance", async () => {
    const f = fixture();
    const first = attachFleetWorker(f.deps, { enqueue: f.enqueue, intervalMs: 0 });
    enqueueFleetEvent(f.db, f.userId, f.fleetId, { kind: "owner_message", dedupeKey: "before-restart", payload: { text: "hi" } });
    await tick(); await tick();
    assert.equal(f.runs.length, 1);
    first.stop();
    // While "down": the run completes unseen, a timer comes due and a new event arrives.
    const runId = (f.db.prepare("SELECT id FROM copilot_runs WHERE goal_id=?").get(f.fleetId) as { id: string }).id;
    finishRun(f, runId, "completed");
    f.db.prepare("INSERT INTO fleet_timers(id,user_id,fleet_id,due_at,note,status,created_at) VALUES(?,?,?,?,?,'pending',?)")
      .run(randomUUID(), f.userId, f.fleetId, Date.now() - 1000, "check back", Date.now() - 60_000);
    add(f, "while-down");
    const second = attachFleetWorker(f.deps, { enqueue: f.enqueue, intervalMs: 0 });
    try {
      second.sweep();
      await tick(); await tick();
      const rows = events(f);
      assert.equal(rows.find(e => e.dedupe_key === "before-restart")!.status, "done");
      assert.deepEqual(rows.filter(e => e.dedupe_key !== "before-restart").map(e => e.status), ["claimed", "claimed"]);
      assert.equal(f.runs.length, 2);
      assert.match(f.runs[1]!.userText, /timer fired/);
    } finally { second.stop(); }
  });

  it("settles lead runs from copilot_run_updated events through the attached worker", async () => {
    const f = fixture();
    const worker = attachFleetWorker(f.deps, { enqueue: f.enqueue, intervalMs: 0 });
    try {
      enqueueFleetEvent(f.db, f.userId, f.fleetId, { kind: "owner_message", dedupeKey: "x", payload: { text: "x" } });
      await tick();
      const runId = (f.db.prepare("SELECT id FROM copilot_runs WHERE goal_id=?").get(f.fleetId) as { id: string }).id;
      add(f, "y");
      finishRun(f, runId, "completed");
      f.deps.eventBus.emitEvent({ type: "copilot_run_updated", userId: f.userId, runId, conversationId: f.conversationId, status: "completed", occurredAt: new Date() });
      await tick(); await tick(); await tick();
      assert.deepEqual(events(f).map(e => e.status), ["done", "claimed"]);
      assert.equal(f.runs.length, 2);
    } finally { worker.stop(); }
  });

  it("pauses the fleet at the hourly run cap and notifies once", () => {
    const f = fixture();
    const insert = f.db.prepare(`INSERT INTO copilot_runs(id,user_id,conversation_id,status,goal_id,input_json,created_at,updated_at) VALUES(?,?,?,'completed',?,'{}',?,?)`);
    for (let index = 0; index < LEAD_RUNS_PER_HOUR; index += 1) insert.run(randomUUID(), f.userId, f.conversationId, f.fleetId, Date.now() - 1000, Date.now());
    add(f, "a");
    assert.equal(pumpFleet(f.deps, f.userId, f.fleetId, { enqueue: f.enqueue }).action, "rate_limited");
    const fleet = f.store.getFleet(f.fleetId)!;
    assert.deepEqual([fleet.status, fleet.paused_reason, f.runs.length], ["paused", "run_rate_limit", 0]);
    assert.equal(notifications(f).length, 1);
    assert.equal(events(f)[0]!.status, "pending");
    // An owner resume opens a new window.
    f.store.setStatus(f.fleetId, "active");
    f.inbox.enqueue(f.fleetId, { kind: "fleet_resumed", dedupeKey: "resume:1" });
    assert.equal(pumpFleet(f.deps, f.userId, f.fleetId, { enqueue: f.enqueue }).action, "enqueued");
  });

  it("settles a fleet dispatch from the CLI hook once and ignores subagents, other users and unrelated sessions", () => {
    const f = fixture();
    const task = f.store.addTask(f.fleetId, { description: "Build", createdBy: "owner" });
    const sessionId = session(f);
    f.store.setTaskDispatched(f.fleetId, task.id, sessionId, "claude-a");
    const other = fixture();
    assert.deepEqual(settleFleetDispatchFromHook(f.db, hook(other.userId, sessionId)), []);
    assert.deepEqual(settleFleetDispatchFromHook(f.db, hook(f.userId, sessionId, { nativeSubagent: true })), []);
    assert.deepEqual(settleFleetDispatchFromHook(f.db, hook(f.userId, randomUUID())), []);
    assert.deepEqual(settleFleetDispatchFromHook(f.db, hook(f.userId, sessionId, { notificationType: "permission_required" })), []);
    assert.equal(events(f).length, 0);
    assert.deepEqual(settleFleetDispatchFromHook(f.db, hook(f.userId, sessionId)), [{ userId: f.userId, fleetId: f.fleetId }]);
    assert.deepEqual(settleFleetDispatchFromHook(f.db, hook(f.userId, sessionId)), []);
    assert.equal(f.store.getTask(f.fleetId, task.id)!.dispatch_status, "completed");
    const rows = events(f);
    assert.deepEqual(rows.map(e => [e.kind, e.task_id]), [["member_turn_ended", task.id]]);
    const journal = f.store.recentJournal(f.fleetId, 5, task.id)[0]!;
    assert.match(journal.note, /reported task_completed/);
    assert.match(journal.note, /changed files/);
    // A new turn of the same task is a new wake-up.
    f.db.prepare("UPDATE fleet_tasks SET dispatch_status='running', dispatch_updated_at=? WHERE id=?").run(Date.now() + 5, task.id);
    settleFleetDispatchFromHook(f.db, hook(f.userId, sessionId, { notificationType: "task_failed" }));
    assert.equal(events(f).length, 2);
    assert.equal(f.store.getTask(f.fleetId, task.id)!.dispatch_status, "failed");
  });

  it("ends dispatches whose session died or stayed silent and enqueues member_session_ended", () => {
    const f = fixture();
    const dead = f.store.addTask(f.fleetId, { description: "Dead", createdBy: "owner" });
    const silent = f.store.addTask(f.fleetId, { description: "Silent", createdBy: "owner" });
    const alive = f.store.addTask(f.fleetId, { description: "Alive", createdBy: "owner" });
    f.store.setTaskDispatched(f.fleetId, dead.id, session(f, "exited"));
    f.store.setTaskDispatched(f.fleetId, silent.id, session(f));
    f.store.setTaskDispatched(f.fleetId, alive.id, session(f));
    f.db.prepare("UPDATE fleet_tasks SET dispatch_updated_at=? WHERE id=?").run(Date.now() - DISPATCH_REPORT_TIMEOUT_MS - 1000, silent.id);
    assert.equal(sweepFleetDispatches(f.db, f.userId, f.fleetId), 2);
    assert.equal(sweepFleetDispatches(f.db, f.userId, f.fleetId), 0);
    assert.deepEqual([dead, silent, alive].map(task => f.store.getTask(f.fleetId, task.id)!.dispatch_status), ["ended", "ended", "running"]);
    const rows = events(f);
    assert.deepEqual(rows.map(e => e.kind), ["member_session_ended", "member_session_ended"]);
    assert.deepEqual(rows.map(e => JSON.parse(e.payload_json).reason).sort(), ["session_ended", "timeout"]);
  });

  it("routes a fleet review settle from the goal driver hook into review_settled, once", async () => {
    const f = fixture();
    const task = f.store.addTask(f.fleetId, { description: "Reviewed", createdBy: "owner" });
    const reviewsRoot = path.join(goalWorktreeBase(f.db), `reviews-${f.fleetId}`);
    const checkout = path.join(reviewsRoot, `${task.id}-r1`);
    fs.mkdirSync(checkout, { recursive: true });
    const repo = new SessionRepository(f.db, f.userId);
    const reviewer = repo.create({ projectId: f.projectId, name: "reviewer", aiTool: "codex", workingDir: checkout, credentialMode: "host_environment" });
    repo.updateStatus(reviewer.id, "running");
    fs.writeFileSync(path.join(reviewsRoot, `${task.id}.json`), JSON.stringify({ version: 1, taskId: task.id, attempts: [{
      attempt: 1, status: "running", reviewer: { id: "codex-rev", name: "codex-rev", adapter: "codex" }, writerAdapter: "claude", sessionId: reviewer.id,
      scope: "task", commit: "a".repeat(40), baseCommit: "b".repeat(40), tree: "c".repeat(40), startedAt: Date.now(), settledAt: null, report: null
    }] }));
    const goalEnqueues: TurnInput[] = [];
    const driver = attachGoalDriver(f.deps, { minIntervalMs: 0, enqueue: (_user, input) => { goalEnqueues.push(input); return randomUUID(); } });
    try {
      f.deps.eventBus.emitEvent(hook(f.userId, reviewer.id, { adapter: "codex" }));
      const rows = events(f);
      assert.deepEqual(rows.map(e => [e.kind, e.task_id, e.dedupe_key]), [["review_settled", task.id, `review:${task.id}:1`]]);
      assert.equal(JSON.parse(rows[0]!.payload_json).outcome, "no_report");
      assert.equal(enqueueSettledFleetReviews(f.db, f.userId, f.fleetId), 0, "the periodic pass finds nothing new");
      assert.equal(goalEnqueues.length, 0);
    } finally { driver.stop(); }
  });

  it("leaves goals unaffected: a goal dispatch hook still drives goal continuation", async () => {
    const f = fixture();
    const conversation = new CopilotConversationLog(f.db, f.userId).createConversation();
    const goals = new CopilotGoalStore(f.db, f.userId);
    const goal = goals.createGoal({ conversationId: conversation.id, title: "G", spec: "S" });
    const [task] = goals.addTasks(goal.id, ["Goal task"]);
    const sessionId = session(f);
    goals.setTaskDispatched(goal.id, task!.id, sessionId);
    const goalEnqueues: TurnInput[] = [];
    const driver = attachGoalDriver(f.deps, { minIntervalMs: 0, enqueue: (_user, input) => { goalEnqueues.push(input); return randomUUID(); } });
    const worker = attachFleetWorker(f.deps, { enqueue: f.enqueue, intervalMs: 0 });
    try {
      f.deps.eventBus.emitEvent(hook(f.userId, sessionId));
      await tick();
      assert.equal(goals.listTasks(goal.id)[0]!.dispatch_status, "completed");
      assert.equal(goalEnqueues.length, 1);
      assert.equal(goalEnqueues[0]!.goalId, goal.id);
      assert.equal(events(f).length, 0);
      assert.equal(f.runs.length, 0);
    } finally { worker.stop(); driver.stop(); }
  });

  it("refuses to delete the flagship conversation, and self-heals a fleet whose conversation is gone without charging the batch", () => {
    const f = fixture();
    assert.throws(() => new CopilotConversationLog(f.db, f.userId).deleteConversation(f.conversationId),
      (error: unknown) => (error as { code?: string }).code === "COPILOT_FLEET_CONVERSATION");
    add(f, "m");
    f.db.prepare("UPDATE fleet_events SET attempt_count=1 WHERE fleet_id=?").run(f.fleetId);
    // Removed behind the service's back (soft delete straight in the database).
    f.db.prepare("UPDATE copilot_conversations SET status='deleted' WHERE id=?").run(f.conversationId);
    const decision = pumpFleet(f.deps, f.userId, f.fleetId, { enqueue: f.enqueue, retryDelayMs: 0 });
    assert.equal(decision.action, "enqueued");
    const healed = f.store.getFleet(f.fleetId)!;
    assert.notEqual(healed.conversation_id, f.conversationId);
    assert.equal(f.runs[0]!.conversationId, healed.conversation_id);
    assert.equal((f.db.prepare("SELECT status FROM copilot_conversations WHERE id=?").get(healed.conversation_id) as { status: string }).status, "active");
    assert.deepEqual([events(f)[0]!.status, events(f)[0]!.attempt_count], ["claimed", 1], "the batch keeps its attempt count");
    assert.ok(f.store.recentJournal(f.fleetId, 5).some(entry => entry.note.includes("flagship conversation was missing")));
  });

  it("starts no flagship run while a merge holds the lock and pumps the pending events right after release", async () => {
    const f = fixture();
    const worker = attachFleetWorker(f.deps, { enqueue: f.enqueue, intervalMs: 0 });
    try {
      const release = acquireFleetMergeLock(f.db, f.userId, f.fleetId)!;
      assert.equal(acquireFleetMergeLock(f.db, f.userId, f.fleetId), undefined, "one merge at a time");
      enqueueFleetEvent(f.db, f.userId, f.fleetId, { kind: "owner_message", dedupeKey: "during-merge", payload: { text: "hi" } });
      await tick(); await tick();
      worker.sweep();
      await tick();
      assert.equal(pumpFleet(f.deps, f.userId, f.fleetId, { enqueue: f.enqueue }).action, "busy");
      assert.deepEqual([f.runs.length, events(f)[0]!.status], [0, "pending"]);
      release();
      await tick(); await tick();
      assert.deepEqual([f.runs.length, events(f)[0]!.status], [1, "claimed"]);
    } finally { worker.stop(); }
  });

  it("pauses with no_progress after six idle flagship runs, is reset by an owner event, and keeps the count across worker instances", async () => {
    const f = fixture();
    const idleRun = (worker: { sweep(): void }, key: string) => {
      f.inbox.enqueue(f.fleetId, { kind: "timer_due", dedupeKey: key, payload: { note: key } });
      worker.sweep();
      const runId = (f.db.prepare("SELECT id FROM copilot_runs WHERE goal_id=? AND status='pending'").get(f.fleetId) as { id: string } | undefined)?.id;
      assert.ok(runId, `a run for ${key}`);
      f.db.prepare("UPDATE copilot_runs SET status='completed', created_at=? WHERE id=?").run(Date.now() + 1, runId);
      settleLeadRun(f.db, f.userId, runId!);
    };
    const idle = () => f.store.getFleet(f.fleetId)!.idle_lead_runs;
    let worker = attachFleetWorker(f.deps, { enqueue: f.enqueue, intervalMs: 0 });
    for (const key of ["a", "b", "c"]) idleRun(worker, key);
    assert.equal(idle(), 3);
    f.inbox.enqueue(f.fleetId, { kind: "owner_message", dedupeKey: "owner", payload: { text: "keep going" } });
    assert.equal(idle(), 0, "an owner event resets the guard");
    worker.sweep();
    const ownerRun = (f.db.prepare("SELECT id FROM copilot_runs WHERE goal_id=? AND status='pending'").get(f.fleetId) as { id: string }).id;
    f.db.prepare("UPDATE copilot_runs SET status='completed', created_at=? WHERE id=?").run(Date.now() + 1, ownerRun);
    settleLeadRun(f.db, f.userId, ownerRun);
    assert.equal(idle(), 0, "a run that handled an owner event is not idle");
    // A run that changed a task is progress.
    const task = f.store.addTask(f.fleetId, { description: "T", createdBy: "owner" });
    f.inbox.enqueue(f.fleetId, { kind: "timer_due", dedupeKey: "progress", payload: {} });
    worker.sweep();
    const progressRun = (f.db.prepare("SELECT id FROM copilot_runs WHERE goal_id=? AND status='pending'").get(f.fleetId) as { id: string }).id;
    f.db.prepare("UPDATE copilot_runs SET created_at=? WHERE id=?").run(Date.now() - 10, progressRun);
    f.store.updateTask(f.fleetId, task.id, "in_progress");
    f.db.prepare("UPDATE copilot_runs SET status='completed' WHERE id=?").run(progressRun);
    settleLeadRun(f.db, f.userId, progressRun);
    assert.equal(idle(), 0);
    for (const key of ["d", "e", "f"]) idleRun(worker, key);
    worker.stop();
    worker = attachFleetWorker(f.deps, { enqueue: f.enqueue, intervalMs: 0 });
    assert.equal(idle(), 3, "the count lives in the row");
    for (const key of ["g", "h"]) idleRun(worker, key);
    assert.equal(f.store.getFleet(f.fleetId)!.status, "active");
    idleRun(worker, "i");
    worker.stop();
    const fleet = f.store.getFleet(f.fleetId)!;
    assert.deepEqual([fleet.status, fleet.paused_reason], ["paused", "no_progress"]);
    assert.equal(NO_PROGRESS_RUN_LIMIT, 6);
    assert.equal(notifications(f).filter(n => JSON.parse(n.payload).kind === "no_progress").length, 1);
    assert.ok(f.store.recentJournal(f.fleetId, 5).some(entry => entry.note.startsWith("Paused by the no-progress guard")));
  });

  it("stops a running flagship run when the owner pauses the fleet, and returns its events without an attempt", async () => {
    const f = fixture();
    let calls = 0;
    const llm: AgentLlmClient = {
      async stream(request) {
        calls += 1;
        if (calls === 1) {
          // The owner pauses mid-run: the same store call POST /fleets/:id/pause makes.
          f.store.setStatus(f.fleetId, "paused", "owner");
          (request.onEvent as (event: AgentLlmStreamEvent) => void)({ type: "tool_call", toolCall: { id: "c1", name: "fleet_read_note", arguments: JSON.stringify({ scope: "fleet" }) } });
          return { message: "" };
        }
        return { message: "done" };
      },
      async summarize() { return ""; }, async generateTitle() { return ""; }
    };
    const orchestrator = createCopilotOrchestrator({ db: f.db, masterKey: "k", toolRegistry: createAgentToolRegistry(createFleetTools()), llm, eventBus: f.deps.eventBus });
    add(f, "m");
    const decision = pumpFleet(f.deps, f.userId, f.fleetId, { enqueue: (_user, input) => orchestrator.enqueue(input) });
    assert.equal(decision.action, "enqueued");
    await orchestrator.executeRun(f.userId, decision.runId!);
    const run = f.db.prepare("SELECT status, stop_reason, input_json FROM copilot_runs WHERE id=?").get(decision.runId) as { status: string; stop_reason: string; input_json: string };
    assert.deepEqual([run.status, run.stop_reason, JSON.parse(run.input_json).fleetScope], ["stopped", "goal_paused", true]);
    settleLeadRun(f.db, f.userId, decision.runId!);
    assert.deepEqual([events(f)[0]!.status, events(f)[0]!.attempt_count], ["pending", 0]);
  });

  it("stops a flagship run whose fleet disappeared mid-run", async () => {
    const f = fixture();
    let calls = 0;
    const llm: AgentLlmClient = {
      async stream(request) {
        calls += 1;
        if (calls === 1) {
          f.db.prepare("DELETE FROM fleets WHERE id=?").run(f.fleetId);
          (request.onEvent as (event: AgentLlmStreamEvent) => void)({ type: "tool_call", toolCall: { id: "c1", name: "fleet_read_note", arguments: JSON.stringify({ scope: "fleet" }) } });
          return { message: "" };
        }
        return { message: "done" };
      },
      async summarize() { return ""; }, async generateTitle() { return ""; }
    };
    const orchestrator = createCopilotOrchestrator({ db: f.db, masterKey: "k", toolRegistry: createAgentToolRegistry(createFleetTools()), llm, eventBus: f.deps.eventBus });
    const runId = orchestrator.enqueue({ userId: f.userId, conversationId: f.conversationId, goalId: f.fleetId, userText: "x", source: "user", clientRequestId: randomUUID() });
    await orchestrator.executeRun(f.userId, runId);
    const run = f.db.prepare("SELECT status, stop_reason FROM copilot_runs WHERE id=?").get(runId) as { status: string; stop_reason: string };
    assert.deepEqual([run.status, run.stop_reason], ["stopped", "fleet_missing"]);
  });

  it("prunes old processed events in bounded batches and ignores wake-ups after stop", async () => {
    const f = fixture();
    add(f, "old"); add(f, "fresh"); add(f, "pending");
    const old = Date.now() - 15 * 24 * 60 * 60_000;
    f.db.prepare("UPDATE fleet_events SET status='done', processed_at=? WHERE dedupe_key='old'").run(old);
    f.db.prepare("UPDATE fleet_events SET status='done', processed_at=? WHERE dedupe_key='fresh'").run(Date.now());
    assert.equal(f.inbox.prune(Date.now()), 1);
    assert.deepEqual(events(f).map(e => e.dedupe_key), ["fresh", "pending"]);
    const worker = attachFleetWorker(f.deps, { enqueue: f.enqueue, intervalMs: 0 });
    enqueueFleetEvent(f.db, f.userId, f.fleetId, { kind: "owner_message", dedupeKey: "late", payload: { text: "x" } });
    worker.stop();
    await tick(); await tick();
    assert.equal(f.runs.length, 0, "a deferred pump scheduled before stop() does nothing");
  });
});
