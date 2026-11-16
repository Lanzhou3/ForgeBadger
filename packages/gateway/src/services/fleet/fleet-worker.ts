import { randomUUID } from 'node:crypto';
import type { Database } from '../../db/types.js';
import { SessionRepository } from '../../db/repositories/session-repository.js';
import type { ForgeBadgerEvent } from '../event-bus.js';
import { buildAgentStack, type AgentStackDeps } from '../agent/agent-stack.js';
import { DISPATCH_REPORT_TIMEOUT_MS } from '../agent/goal-driver.js';
import { buildEndedReportSuffix, buildHookReportSuffix } from '../agent/goal-dispatch-report.js';
import { CopilotConversationLog } from '../agent/conversation-log.js';
import { awaitingReviews, readReviewState } from '../agent/goal-review.js';
import type { TurnInput } from '../agent/run-ledger.js';
import { scopeKind } from '../agent/work-store.js';
import {
  dispatchEventKey, enqueueSettledFleetReviews, FleetInbox, fleetMergeLocked, MAX_EVENT_ATTEMPTS, OWNER_EVENT_KINDS, parseEventPayload,
  registerFleetWaker, wakeFleet, type FleetEventRow
} from './fleet-inbox.js';
import { notifyFleetClearedIfDone, notifyFleetEventsFailed, notifyFleetNoProgress, notifyFleetRateLimited } from './fleet-notify.js';
import { clipText } from './fleet-notes.js';
import { FleetStore, type FleetRow, type FleetTaskRow } from './fleet-store.js';
import { FleetTimers } from './fleet-timers.js';

/**
 * Fleet worker (spec §3.1): turns inbox rows into lead runs.
 *
 * - pump: an active fleet with no active run (lead, delegate child or any
 *   run on the lead conversation) and claimable events gets ONE lead run;
 *   up to EVENT_BATCH_SIZE events are claimed with that run id in the same
 *   transaction that admits the run.
 * - run settle: a terminal lead run completes its events (completed) or
 *   returns them to pending with one more attempt (failed/stopped/...);
 *   MAX_EVENT_ATTEMPTS gives up with a journal line and one owner
 *   notification. A run stopped because the owner paused the fleet returns
 *   its events without counting an attempt.
 * - hooks: a member's CLI turn-end settles its fleet dispatch with the same
 *   report suffix goals get and enqueues member_turn_ended.
 * - periodic pass: due timers, dead/silent member sessions, reviews, claims
 *   whose run vanished or ended unseen, and a pump of every active fleet.
 *
 * The lead never waits for members: it dispatches and ends its run; the next
 * event wakes it. Nothing here keeps state that a restart would lose: a new
 * worker on the same database resumes from the rows alone.
 */

export const LEAD_RUNS_PER_HOUR = 30;
/** Consecutive completed lead runs that changed nothing on the board before the fleet pauses (`no_progress`). */
export const NO_PROGRESS_RUN_LIMIT = 6;
const RUN_RATE_WINDOW_MS = 60 * 60_000;
export const DEFAULT_RETRY_DELAY_MS = 15_000;
export const FLEET_SWEEP_INTERVAL_MS = 5000;
const TERMINAL_RUN_STATES = ['completed', 'failed', 'stopped', 'cancelled', 'indeterminate'];
/** Admission refusals that say "not now" rather than "this batch cannot run". */
const TRANSIENT_ENQUEUE_ERRORS = new Set(['COPILOT_RUNTIME_STOPPED', 'COPILOT_CONVERSATION_BUSY']);
const EVENT_TEXT_CHARS = 4000;
const TASK_LABEL_CHARS = 120;

export interface FleetWorkerOptions {
  /** Test seam: how a lead run is admitted (default: the user's orchestrator). Must return the admitted run id. */
  enqueue?: (userId: string, input: TurnInput) => string;
  /** Delay × attempt_count before a returned event is claimable again (default 15 s). */
  retryDelayMs?: number;
  /** Periodic pass interval; 0 disables it (tests drive sweepFleets directly). Default 5 s. */
  intervalMs?: number;
  /** Test seam for the clock. */
  now?: () => number;
}

export type FleetPumpAction = 'inactive' | 'paused' | 'busy' | 'idle' | 'rate_limited' | 'enqueued' | 'failed';
export interface FleetPumpDecision { action: FleetPumpAction; runId?: string; eventIds?: string[] }

interface RunRow { goal_id: string | null; conversation_id: string; status: string; stop_reason: string | null; created_at: number }

function logFleetError(operation: string, userId: string, error: unknown): void {
  // Never copy provider/SQL error text into process logs.
  console.error('[fleet worker]', {
    operation, userId, timestamp: new Date().toISOString(),
    code: error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'FLEET_WORKER_FAILED'
  });
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

function text(value: unknown, max = EVENT_TEXT_CHARS): string {
  return typeof value === 'string' ? clipText(value.trim(), max) : '';
}

// --- Event batch → run input ------------------------------------------------

function taskLabel(event: FleetEventRow, tasks: Map<string, FleetTaskRow>): string {
  if (!event.task_id) return '';
  const task = tasks.get(event.task_id);
  return task ? `task #${task.seq} (${task.id}) "${clipText(task.description, TASK_LABEL_CHARS)}"` : `task ${event.task_id}`;
}

function eventLine(event: FleetEventRow, tasks: Map<string, FleetTaskRow>): string {
  const payload = parseEventPayload(event);
  const task = taskLabel(event, tasks);
  switch (event.kind) {
    case 'task_added': return `${task}: added to the board by the owner.`;
    case 'owner_message': return `Message from the owner: ${text(payload.text)}`;
    case 'hold_answered': return `${task}: the owner answered your hold. Question: ${text(payload.question, 1000)} Answer: ${text(payload.answer)}`;
    case 'task_cancelled': return `${task}: cancelled by the owner (a CLI session still working on it was not stopped).`;
    case 'member_turn_ended': return `${task}: member ${text(payload.memberId, 64) || 'CLI'} ended its turn (${text(payload.outcome, 20)}); its report is in the journal. A finished turn is not verification.`;
    case 'member_session_ended': return `${task}: the member's CLI session ${payload.reason === 'timeout' ? 'sent no turn-end report in time' : 'ended without reporting a finished turn'}; nobody is working on it now.`;
    case 'review_settled': return `${task}: review attempt ${Number(payload.attempt) || '?'} settled (${text(payload.outcome, 20)}${typeof payload.verdict === 'string' ? `, verdict ${text(payload.verdict, 20)}` : ''}); read it with goal_get_review.`;
    case 'timer_due': return `Your follow-up timer fired${task ? ` for ${task}` : ''}: ${text(payload.note, 1000)}`;
    case 'fleet_resumed': return 'The owner resumed the fleet.';
    case 'merge_done': return `The owner merged the fleet branch into the project${typeof payload.commit === 'string' ? ` at ${payload.commit.slice(0, 12)}` : ''}.`;
  }
}

export function describeEventBatch(fleet: FleetRow, tasks: FleetTaskRow[], events: FleetEventRow[]): string {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const lines = events.map((event, index) =>
    `${index + 1}. [${event.kind}]${event.attempt_count ? ` (retry ${event.attempt_count})` : ''} ${eventLine(event, byId)}`);
  return `[Fleet 事件] ${events.length} new event(s) for fleet "${clipText(fleet.title, 120)}". `
    + 'Handle them, dispatch every task that can start now, update the task notes, then end this run - do not wait for members; the next event wakes you.\n'
    + lines.join('\n');
}

// --- Pump --------------------------------------------------------------------

function nowOf(options: FleetWorkerOptions): number {
  return options.now?.() ?? Date.now();
}

/** Lead runs in the guard window; an owner resume starts a new window. */
function leadRunsInWindow(db: Database, userId: string, fleet: FleetRow, now: number): number {
  const resumed = (db.prepare("SELECT MAX(created_at) AS at FROM fleet_events WHERE user_id=? AND fleet_id=? AND kind='fleet_resumed'")
    .get(userId, fleet.id) as { at: number | null }).at ?? 0;
  const since = Math.max(now - RUN_RATE_WINDOW_MS, resumed);
  return (db.prepare('SELECT count(*) AS count FROM copilot_runs WHERE user_id=? AND goal_id=? AND conversation_id=? AND created_at>=?')
    .get(userId, fleet.id, fleet.conversation_id, since) as { count: number }).count;
}

function pauseForRunRate(db: Database, userId: string, fleet: FleetRow): void {
  const store = new FleetStore(db, userId);
  store.setStatus(fleet.id, 'paused', 'run_rate_limit');
  store.appendJournal(fleet.id, null, `Paused by the run-rate guard: the flagship started ${LEAD_RUNS_PER_HOUR} runs within an hour. Pending events wait; resume the fleet to continue.`);
  notifyFleetRateLimited(db, userId, store.getFleet(fleet.id)!, LEAD_RUNS_PER_HOUR);
}

function giveUp(db: Database, userId: string, fleetId: string, exhausted: FleetEventRow[], batchKey: string): void {
  if (!exhausted.length) return;
  const store = new FleetStore(db, userId);
  const fleet = store.getFleet(fleetId);
  if (!fleet) return;
  const kinds = [...new Set(exhausted.map(event => event.kind))].join(', ');
  store.appendJournal(fleetId, null, `Gave up on ${exhausted.length} event(s) (${kinds}) after ${MAX_EVENT_ATTEMPTS} failed flagship attempts; they will not be retried. Send a message to the flagship to pick the work up again.`);
  notifyFleetEventsFailed(db, userId, fleet, batchKey, exhausted.length);
}

function enqueueFailed(db: Database, userId: string, fleetId: string, events: FleetEventRow[], error: unknown, now: number): FleetPumpDecision {
  logFleetError('enqueue', userId, error);
  const code = errorCode(error);
  if (code && TRANSIENT_ENQUEUE_ERRORS.has(code)) return { action: 'busy' };
  const exhausted = new FleetInbox(db, userId).countAttempt(events.map(event => event.id), now);
  giveUp(db, userId, fleetId, exhausted, `enqueue:${exhausted[0]?.id ?? 'none'}`);
  return { action: 'failed' };
}

/**
 * The flagship conversation must exist and not be (soft-)deleted, or every
 * admission fails. A missing one is replaced: fresh conversation on the same
 * project, fleet rebound, journaled. Caller holds the transaction.
 */
function healLeadConversation(db: Database, userId: string, fleet: FleetRow): FleetRow {
  const conversation = db.prepare('SELECT status FROM copilot_conversations WHERE user_id=? AND id=?').get(userId, fleet.conversation_id) as { status: string } | undefined;
  if (conversation && conversation.status !== 'deleted') return fleet;
  const store = new FleetStore(db, userId);
  const fresh = new CopilotConversationLog(db, userId).createConversation(`Fleet: ${fleet.title}`.slice(0, 200), fleet.project_id);
  const healed = store.setConversation(fleet.id, fresh.id);
  store.appendJournal(fleet.id, null, 'The flagship conversation was missing or deleted; started a new one for the flagship. Earlier conversation history is not carried over.');
  return healed;
}

/**
 * Start one lead run for the fleet when it is active, idle and has claimable
 * events. Claim and admission share one transaction, so a run never exists
 * without its claimed batch and no batch is claimed for a run that was not admitted.
 */
export function pumpFleet(deps: AgentStackDeps, userId: string, fleetId: string, options: FleetWorkerOptions = {}): FleetPumpDecision {
  if (!deps.db.open) return { action: 'inactive' };
  const now = nowOf(options);
  recoverFleetClaims(deps.db, userId, fleetId, now);
  const store = new FleetStore(deps.db, userId);
  const inbox = new FleetInbox(deps.db, userId);
  const enqueueRun = options.enqueue
    ? (input: TurnInput) => options.enqueue!(userId, input)
    : (input: TurnInput) => buildAgentStack(deps, userId).orchestrator.enqueue(input);
  return deps.db.transaction((): FleetPumpDecision => {
    const found = store.getFleet(fleetId);
    if (!found) return { action: 'inactive' };
    if (found.status !== 'active') return { action: 'paused' };
    // The owner is merging: no flagship run may touch the trees; releasing the lock wakes the fleet.
    if (fleetMergeLocked(fleetId)) return { action: 'busy' };
    if (store.hasActiveGoalRun(fleetId) || store.hasActiveRun(found.conversation_id) || inbox.hasClaimed(fleetId)) return { action: 'busy' };
    const fleet = healLeadConversation(deps.db, userId, found);
    const events = inbox.claimable(fleetId, now, options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
    if (!events.length) return { action: 'idle' };
    if (leadRunsInWindow(deps.db, userId, fleet, now) >= LEAD_RUNS_PER_HOUR) {
      pauseForRunRate(deps.db, userId, fleet);
      return { action: 'rate_limited' };
    }
    let runId: string;
    try {
      runId = enqueueRun({
        userId, conversationId: fleet.conversation_id, goalId: fleetId, projectId: fleet.project_id, source: 'user', goalContinuation: true, fleetScope: true,
        userText: describeEventBatch(fleet, store.listTasks(fleetId), events), clientRequestId: randomUUID()
      });
    } catch (error) { return enqueueFailed(deps.db, userId, fleetId, events, error, now); }
    const eventIds = events.map(event => event.id);
    inbox.markClaimed(eventIds, runId, now);
    return { action: 'enqueued', runId, eventIds };
  }).immediate();
}

// --- Run settle --------------------------------------------------------------

/**
 * No-progress guard, from rows only: a completed lead run that changed no
 * fleet task (status, dispatch, verify record and hold all bump updated_at)
 * and handled no owner event adds one to fleets.idle_lead_runs; progress or
 * an owner event resets it. NO_PROGRESS_RUN_LIMIT in a row pauses the fleet.
 */
function trackProgress(db: Database, userId: string, fleetId: string, run: Pick<RunRow, 'created_at'>, events: FleetEventRow[]): void {
  const store = new FleetStore(db, userId);
  const fleet = store.getFleet(fleetId);
  if (!fleet) return;
  const changed = !!db.prepare('SELECT 1 FROM fleet_tasks WHERE user_id=? AND fleet_id=? AND updated_at>=? LIMIT 1').get(userId, fleetId, run.created_at);
  if (changed || events.some(event => OWNER_EVENT_KINDS.has(event.kind))) {
    db.prepare('UPDATE fleets SET idle_lead_runs=0 WHERE user_id=? AND id=?').run(userId, fleetId);
    return;
  }
  const idle = fleet.idle_lead_runs + 1;
  db.prepare('UPDATE fleets SET idle_lead_runs=? WHERE user_id=? AND id=?').run(idle, userId, fleetId);
  if (idle < NO_PROGRESS_RUN_LIMIT || fleet.status !== 'active') return;
  store.setStatus(fleetId, 'paused', 'no_progress');
  db.prepare('UPDATE fleets SET idle_lead_runs=0 WHERE user_id=? AND id=?').run(userId, fleetId);
  store.appendJournal(fleetId, null, `Paused by the no-progress guard: ${NO_PROGRESS_RUN_LIMIT} flagship runs in a row changed nothing on the board. Pending events wait; resume the fleet or send a message to continue.`);
  notifyFleetNoProgress(db, userId, store.getFleet(fleetId)!, NO_PROGRESS_RUN_LIMIT);
}

function applyRunOutcome(db: Database, userId: string, fleetId: string, runId: string, run: Pick<RunRow, 'status' | 'stop_reason' | 'created_at'>, now: number): void {
  const inbox = new FleetInbox(db, userId);
  if (run.status === 'completed') {
    const events = inbox.forRun(runId);
    inbox.complete(runId, now);
    if (events.length) trackProgress(db, userId, fleetId, run, events);
    const store = new FleetStore(db, userId);
    const fleet = store.getFleet(fleetId);
    if (fleet) notifyFleetClearedIfDone(db, userId, fleet, store.listTasks(fleetId));
    return;
  }
  // The owner paused the fleet mid-run: the events were not mishandled.
  if (run.stop_reason === 'goal_paused') { inbox.release(runId, now, false); return; }
  giveUp(db, userId, fleetId, inbox.release(runId, now, true), `run:${runId}`);
}

/** Claims whose run vanished (released without an attempt) or ended without its terminal event being seen. */
export function recoverFleetClaims(db: Database, userId: string, fleetId: string, now = Date.now()): void {
  const inbox = new FleetInbox(db, userId);
  for (const runId of inbox.claimedRuns(fleetId)) {
    const run = db.prepare('SELECT goal_id, conversation_id, status, stop_reason, created_at FROM copilot_runs WHERE user_id=? AND id=?')
      .get(userId, runId) as RunRow | undefined;
    if (!run) { inbox.release(runId, now, false); continue; }
    if (TERMINAL_RUN_STATES.includes(run.status)) db.transaction(() => applyRunOutcome(db, userId, fleetId, runId, run, now)).immediate();
  }
}

/** A terminal run of a fleet scope settles its claimed events. Returns the fleet id to pump, if any. */
export function settleLeadRun(db: Database, userId: string, runId: string, now = Date.now()): string | undefined {
  const run = db.prepare('SELECT goal_id, conversation_id, status, stop_reason, created_at FROM copilot_runs WHERE user_id=? AND id=?')
    .get(userId, runId) as RunRow | undefined;
  if (!run?.goal_id || !TERMINAL_RUN_STATES.includes(run.status)) return undefined;
  if (scopeKind(db, userId, run.goal_id) !== 'fleet') return undefined;
  const fleetId = run.goal_id;
  db.transaction(() => applyRunOutcome(db, userId, fleetId, runId, run, now)).immediate();
  return fleetId;
}

// --- Member turns --------------------------------------------------------------

/**
 * CLI turn-end hook for a fleet-dispatched session: settle the running
 * dispatch (completed/failed — a finished turn, never acceptance), journal the
 * CLI's report and enqueue member_turn_ended. Child-agent turns, other
 * users' sessions and sessions that run no fleet task do nothing.
 */
export function settleFleetDispatchFromHook(db: Database, event: ForgeBadgerEvent): Array<{ userId: string; fleetId: string }> {
  if (event.type !== 'session_notification' || event.nativeSubagent) return [];
  if (event.notificationType !== 'task_completed' && event.notificationType !== 'task_failed') return [];
  const store = new FleetStore(db, event.userId);
  const inbox = new FleetInbox(db, event.userId);
  const outcome = event.notificationType === 'task_completed' ? 'completed' : 'failed';
  const settled: Array<{ userId: string; fleetId: string }> = [];
  for (const task of store.runningDispatchesForSession(event.sessionId)) {
    // Computed before the transaction: it runs git and must not hold the write lock.
    const suffix = buildHookReportSuffix(store.getGoal(task.fleet_id), event, task.id);
    const done = db.transaction(() => {
      if (!store.settleDispatch(task.id, outcome)) return false;
      store.appendJournal(task.fleet_id, null, `CLI session ${event.sessionId} reported ${event.notificationType} for task '${task.id}' `
        + '(the CLI turn ended; this is not verification — run the task verify_command before marking it passes).' + suffix, task.id);
      inbox.enqueue(task.fleet_id, {
        kind: 'member_turn_ended', dedupeKey: dispatchEventKey(task.id, task.dispatch_updated_at, task.dispatched_session_id), taskId: task.id,
        payload: { sessionId: event.sessionId, outcome, memberId: task.member_id }
      });
      return true;
    }).immediate();
    if (!done) continue;
    settled.push({ userId: event.userId, fleetId: task.fleet_id });
    wakeFleet(db, event.userId, task.fleet_id);
  }
  return settled;
}

/** Running dispatches whose session stopped, vanished or stayed silent past the timeout settle as `ended`. */
export function sweepFleetDispatches(db: Database, userId: string, fleetId: string, now = Date.now()): number {
  const store = new FleetStore(db, userId);
  const inbox = new FleetInbox(db, userId);
  const sessions = new SessionRepository(db, userId);
  let ended = 0;
  for (const task of store.listTasks(fleetId)) {
    if (task.dispatch_status !== 'running' || !task.dispatched_session_id) continue;
    const running = sessions.getById(task.dispatched_session_id)?.status === 'running';
    if (running && now - (task.dispatch_updated_at ?? 0) < DISPATCH_REPORT_TIMEOUT_MS) continue;
    const suffix = buildEndedReportSuffix(store.getGoal(fleetId), task.id);
    const done = db.transaction(() => {
      if (!store.settleDispatch(task.id, 'ended')) return false;
      store.appendJournal(fleetId, null, running
        ? `CLI session ${task.dispatched_session_id} for task '${task.id}' sent no turn-end report within ${DISPATCH_REPORT_TIMEOUT_MS / 60_000} minutes; no longer waiting on it.${suffix}`
        : `CLI session ${task.dispatched_session_id} for task '${task.id}' ended without reporting a finished turn.${suffix}`, task.id);
      inbox.enqueue(fleetId, {
        kind: 'member_session_ended', dedupeKey: dispatchEventKey(task.id, task.dispatch_updated_at, task.dispatched_session_id), taskId: task.id,
        payload: { sessionId: task.dispatched_session_id, reason: running ? 'timeout' : 'session_ended', memberId: task.member_id }
      }, now);
      return true;
    }).immediate();
    if (done) ended += 1;
  }
  return ended;
}

// --- Periodic pass -------------------------------------------------------------

/** Review records are read only for unresolved tasks; a passed or cancelled task has no review to wait for. */
function hasRunningReview(db: Database, userId: string, fleetId: string): boolean {
  for (const task of new FleetStore(db, userId).listTasks(fleetId)) {
    if (task.status === 'passes' || task.status === 'cancelled') continue;
    try { if (readReviewState(db, fleetId, task.id).attempts.some(attempt => attempt.status === 'running')) return true; }
    catch { /* unreadable record: nothing to settle from here */ }
  }
  return false;
}

function sweepFleet(deps: AgentStackDeps, userId: string, fleetId: string, options: FleetWorkerOptions, now: number): void {
  sweepFleetDispatches(deps.db, userId, fleetId, now);
  // Settles dead/silent reviewer turns; review_settled is idempotent per attempt, whichever path settled it.
  if (hasRunningReview(deps.db, userId, fleetId)) awaitingReviews(deps.db, deps, userId, fleetId, now);
  enqueueSettledFleetReviews(deps.db, userId, fleetId, { unresolvedOnly: true });
  pumpFleet(deps, userId, fleetId, options);
}

/** One recovery pass over every tenant's fleets. Idempotent; resumes everything from rows after a restart. */
export function sweepFleets(deps: AgentStackDeps, options: FleetWorkerOptions = {}): void {
  if (!deps.db.open) return;
  const now = nowOf(options);
  const users = deps.db.prepare('SELECT DISTINCT user_id FROM fleets').all() as Array<{ user_id: string }>;
  for (const { user_id: userId } of users) {
    try { new FleetTimers(deps.db, userId).fireDue(now); }
    catch (error) { logFleetError('timers', userId, error); }
    try { new FleetInbox(deps.db, userId).prune(now); }
    catch (error) { logFleetError('prune', userId, error); }
    const fleets = deps.db.prepare('SELECT id FROM fleets WHERE user_id=? ORDER BY created_at').all(userId) as Array<{ id: string }>;
    for (const fleet of fleets) {
      try { sweepFleet(deps, userId, fleet.id, options, now); }
      catch (error) { logFleetError('sweep', userId, error); }
    }
  }
}

// --- Attachment ------------------------------------------------------------------

export interface FleetWorker {
  stop(): void;
  /** Run one periodic pass now. */
  sweep(): void;
}

/**
 * Event hooks + wake-ups + the periodic pass for one database. Pumps are
 * deferred (setImmediate) and coalesced per fleet, so a producer's transaction
 * never nests a lead-run admission.
 */
export function attachFleetWorker(deps: AgentStackDeps, options: FleetWorkerOptions = {}): FleetWorker {
  const scheduled = new Map<string, NodeJS.Immediate>();
  let stopped = false;
  const schedule = (userId: string, fleetId: string): void => {
    const key = `${userId}:${fleetId}`;
    if (stopped || scheduled.has(key)) return;
    const handle = setImmediate(() => {
      scheduled.delete(key);
      if (stopped || !deps.db.open) return;
      try { pumpFleet(deps, userId, fleetId, options); }
      catch (error) { logFleetError('pump', userId, error); }
    });
    handle.unref();
    scheduled.set(key, handle);
  };
  const unregister = registerFleetWaker(deps.db, schedule);
  const onEvent = (event: ForgeBadgerEvent): void => {
    if (!deps.db.open) return;
    if (event.type === 'session_notification') {
      try { settleFleetDispatchFromHook(deps.db, event); }
      catch (error) { logFleetError('dispatch-hook', event.userId, error); }
      return;
    }
    if (event.type !== 'copilot_run_updated' || !TERMINAL_RUN_STATES.includes(event.status)) return;
    const handle = setImmediate(() => {
      if (stopped || !deps.db.open) return;
      try {
        const fleetId = settleLeadRun(deps.db, event.userId, event.runId, nowOf(options));
        if (fleetId) schedule(event.userId, fleetId);
      } catch (error) { logFleetError('run-settle', event.userId, error); }
    });
    handle.unref();
  };
  deps.eventBus.on('event', onEvent);
  const sweep = (): void => {
    if (stopped) return;
    try { sweepFleets(deps, options); }
    catch (error) { logFleetError('sweep', '', error); }
  };
  const intervalMs = options.intervalMs ?? FLEET_SWEEP_INTERVAL_MS;
  const timer = intervalMs > 0 ? setInterval(sweep, intervalMs) : undefined;
  timer?.unref();
  return {
    sweep,
    stop() {
      if (stopped) return;
      stopped = true;
      deps.eventBus.off('event', onEvent);
      unregister();
      if (timer) clearInterval(timer);
      for (const handle of scheduled.values()) clearImmediate(handle);
      scheduled.clear();
    }
  };
}
