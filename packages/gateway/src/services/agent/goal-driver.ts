import { randomUUID } from 'node:crypto';
import type { Database } from '../../db/types.js';
import { SessionRepository } from '../../db/repositories/session-repository.js';
import type { ForgeBadgerEvent } from '../event-bus.js';
import { buildAgentStack, type AgentStackDeps } from './agent-stack.js';
import { notifyGoalStatus } from './goal-notify.js';
import { CopilotGoalStore, goalBudgetExhausted, RESOLVED_TASK_STATUSES, type GoalRow } from './goal-store.js';
import { syncGoalFromBoard } from './goal-board.js';
import type { TurnInput } from './run-ledger.js';

/**
 * GoalDriver: after a goal-owned run reaches a terminal state, decide the
 * goal's next step and enqueue the following run until the checklist passes,
 * a goal-level budget trips, or task progress stagnates. Evaluation is
 * idempotent — the single-active-run invariant and the goal status gate make
 * duplicate triggers safe — and it is shared by the event hook, the recovery
 * sweep, and the resume route.
 */

export type GoalContinuationAction = 'inactive' | 'completed' | 'blocked' | 'busy' | 'enqueued';
export interface GoalContinuationDecision { action: GoalContinuationAction; reason?: string; runId?: string }

const TERMINAL_RUN_STATES = ['completed', 'stopped', 'failed'];
const STAGNATION_RUN_LIMIT = 3;
export const GOAL_BUDGET_EXHAUSTED_REASON = 'goal_budget_exhausted';
/** Run failures with these codes never benefit from an immediate retry. */
const NON_RETRYABLE_RUN_ERRORS = new Set(['COPILOT_CONTEXT_TOO_LARGE', 'COPILOT_USER_INACTIVE', 'COPILOT_NOT_FOUND']);
const FAILURE_COOLDOWN_INITIAL_MS = 15_000;
const FAILURE_COOLDOWN_MAX_MS = 300_000;
/** A running dispatch with no turn-end report this long stops holding the goal (adapters without hooks, lost reports). */
export const DISPATCH_REPORT_TIMEOUT_MS = 60 * 60_000;

/** Per-goal consecutive-failure cooldown (in-memory; a settled success clears it). */
const failureCooldowns = new Map<string, { code: string; count: number; retryAt: number }>();

/** Owner-intent entry points (answer/resume) reset the failure cooldown. */
export function clearGoalFailureCooldown(goalId: string): void {
  failureCooldowns.delete(goalId);
}

export function goalContinuationText(goal: GoalRow): string {
  return `[Goal 自动续跑] 继续推进 Goal「${goal.title}」：检查任务清单，完成下一项 pending 任务；`
    + '每轮结束用 goal_write_journal 写交接笔记；任务标记 passes 必须附 evidence。';
}

export function evaluateGoalContinuation(
  deps: AgentStackDeps,
  userId: string,
  goalId: string,
  enqueue?: (input: TurnInput) => string,
  options?: { userText?: string; now?: number }
): GoalContinuationDecision {
  const now = options?.now ?? Date.now();
  const store = new CopilotGoalStore(deps.db, userId);
  const goal = store.getGoal(goalId);
  if (!goal || goal.status !== 'active') return { action: 'inactive' };
  // The owner's board decisions (accept / cancel) settle linked tasks first.
  syncGoalFromBoard(deps.db, userId, goal);
  const tasks = store.listTasks(goalId);
  if (tasks.length > 0 && tasks.every(task => RESOLVED_TASK_STATUSES.includes(task.status))) {
    failureCooldowns.delete(goalId);
    store.setStatus(goalId, 'completed');
    store.appendJournal(goalId, null, 'All tasks passed; goal completed.');
    notifyGoalStatus(deps.db, userId, store.getGoal(goalId)!);
    return { action: 'completed' };
  }
  const usage = store.usage(goalId, now);
  if (goalBudgetExhausted(goal, usage, now)) {
    failureCooldowns.delete(goalId);
    store.setStatus(goalId, 'blocked', GOAL_BUDGET_EXHAUSTED_REASON);
    store.appendJournal(goalId, null, `Goal budget exhausted (tokens=${usage.chargedTokens}/${goal.token_budget}, runs=${usage.runCount}/${goal.max_runs}).`);
    notifyGoalStatus(deps.db, userId, store.getGoal(goalId)!);
    return { action: 'blocked', reason: GOAL_BUDGET_EXHAUSTED_REASON };
  }
  // An active parent, delegate-child, or same-conversation run owns the
  // goal: never enqueue a competing run, regardless of stagnation or
  // failure counters.
  if (store.hasActiveGoalRun(goalId) || store.hasActiveRun(goal.conversation_id)) return { action: 'busy' };
  // A dispatched CLI still working on its turn owns the next step: waiting
  // for it is not stagnation, and a continuation run would only re-poll it.
  if (awaitingDispatchedCli(deps.db, store, userId, goalId, now)) return { action: 'busy', reason: 'awaiting_cli' };
  // Failure classification of the most recent settled run: unrecoverable
  // codes block immediately; repeated failures cool down exponentially
  // instead of spinning a retry loop.
  const lastSettled = store.latestSettledRun(goalId);
  if (lastSettled?.status === 'failed') {
    const code = lastSettled.stop_reason ?? 'COPILOT_FAILED';
    if (NON_RETRYABLE_RUN_ERRORS.has(code)) {
      failureCooldowns.delete(goalId);
      const reason = `unrecoverable_error:${code}`;
      store.setStatus(goalId, 'blocked', reason);
      store.appendJournal(goalId, null, `Blocked: last run failed with non-retryable ${code}.`);
      notifyGoalStatus(deps.db, userId, store.getGoal(goalId)!);
      return { action: 'blocked', reason };
    }
    const cooldown = failureCooldowns.get(goalId);
    if (cooldown && cooldown.code === code && now < cooldown.retryAt)
      return { action: 'busy', reason: `failure_cooldown:${code}` };
    const count = cooldown && cooldown.code === code ? cooldown.count + 1 : 1;
    const retryAt = now + Math.min(FAILURE_COOLDOWN_MAX_MS, FAILURE_COOLDOWN_INITIAL_MS * 2 ** (count - 1));
    failureCooldowns.set(goalId, { code, count, retryAt });
    store.appendJournal(goalId, null, `Run failed (${code}); failure cooldown #${count}, retry at ${new Date(retryAt).toISOString()}.`);
  } else if (lastSettled?.status === 'completed') {
    failureCooldowns.delete(goalId);
  }
  if (store.countRunsWithoutTaskChange(goalId) >= STAGNATION_RUN_LIMIT) {
    failureCooldowns.delete(goalId);
    store.setStatus(goalId, 'blocked', 'no_task_progress');
    store.appendJournal(goalId, null, `Blocked: ${STAGNATION_RUN_LIMIT} consecutive completed runs without a task status change.`);
    notifyGoalStatus(deps.db, userId, store.getGoal(goalId)!);
    return { action: 'blocked', reason: 'no_task_progress' };
  }
  const enqueueRun = enqueue ?? ((input: TurnInput) => buildAgentStack(deps, userId).orchestrator.enqueue(input));
  const runId = enqueueRun({
    userId,
    conversationId: goal.conversation_id,
    goalId,
    source: 'user',
    userText: options?.userText ?? goalContinuationText(goal),
    clientRequestId: randomUUID()
  });
  return { action: 'enqueued', runId };
}

/**
 * True while a dispatched task's CLI turn is still running. A dispatch whose
 * session stopped (or vanished) without a turn-end report settles as `ended`
 * so the goal never waits on a dead terminal.
 */
function awaitingDispatchedCli(db: Database, store: CopilotGoalStore, userId: string, goalId: string, now: number): boolean {
  const sessions = new SessionRepository(db, userId);
  let waiting = false;
  for (const task of store.listTasks(goalId)) {
    if (task.dispatch_status !== 'running' || !task.dispatched_session_id) continue;
    const running = sessions.getById(task.dispatched_session_id)?.status === 'running';
    const stale = now - (task.dispatch_updated_at ?? 0) >= DISPATCH_REPORT_TIMEOUT_MS;
    if (running && !stale) { waiting = true; continue; }
    if (store.settleDispatch(task.id, 'ended'))
      store.appendJournal(goalId, null, running
        ? `CLI session ${task.dispatched_session_id} for task '${task.id}' sent no turn-end report within ${DISPATCH_REPORT_TIMEOUT_MS / 60_000} minutes; no longer waiting on it.`
        : `CLI session ${task.dispatched_session_id} for task '${task.id}' ended without reporting a finished turn.`);
  }
  return waiting;
}

/**
 * CLI turn-end hook for a goal-dispatched session: settle the running
 * dispatch (completed/failed — a finished turn, never acceptance) and return
 * the goals to re-evaluate. Child-agent turns never settle the parent task.
 */
export function settleGoalDispatchFromHook(db: Database, event: ForgeBadgerEvent): Array<{ userId: string; goalId: string }> {
  if (event.type !== 'session_notification' || event.nativeSubagent) return [];
  if (event.notificationType !== 'task_completed' && event.notificationType !== 'task_failed') return [];
  const store = new CopilotGoalStore(db, event.userId);
  const settled: Array<{ userId: string; goalId: string }> = [];
  for (const task of store.runningDispatchesForSession(event.sessionId)) {
    const status = event.notificationType === 'task_completed' ? 'completed' : 'failed';
    if (!store.settleDispatch(task.id, status)) continue;
    store.appendJournal(task.goal_id, null, `CLI session ${event.sessionId} reported ${event.notificationType} for task '${task.id}' `
      + '(the CLI turn ended; this is not verification — run the task verify_command before marking it passes).');
    settled.push({ userId: event.userId, goalId: task.goal_id });
  }
  return settled;
}

/** Active goals whose conversation has no active run (restart-gap recovery). Idempotent. */
export function sweepStaleGoals(deps: AgentStackDeps, enqueue?: (userId: string, input: TurnInput) => string): void {
  if (!deps.db.open) return;
  const users = deps.db.prepare('SELECT id FROM users').all() as { id: string }[];
  for (const user of users) {
    const goals = deps.db.prepare(`SELECT g.id FROM copilot_goals g WHERE g.user_id=? AND g.status='active'
      AND NOT EXISTS (SELECT 1 FROM copilot_runs r WHERE r.user_id=g.user_id AND r.goal_id=g.id
        AND r.status IN ('pending','running','awaiting_approval'))`).all(user.id) as { id: string }[];
    for (const goal of goals) {
      try { evaluateGoalContinuation(deps, user.id, goal.id, enqueue ? (input) => enqueue(user.id, input) : undefined); }
      catch (error) { logGoalDriverError('sweep-evaluate', user.id, error); }
    }
  }
}

function logGoalDriverError(operation: string, userId: string, error: unknown): void {
  // Do not copy arbitrary provider/SQL error text into process logs.
  console.error('[goal driver]', {
    operation, userId, timestamp: new Date().toISOString(),
    code: error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'COPILOT_GOAL_DRIVER_FAILED'
  });
}

export interface GoalDriver { stop(): void }
const drivers = new WeakMap<Database, { references: number; stop(): void }>();

export interface GoalDriverOptions {
  /** Minimum spacing between continuation evaluations per goal (default 2000 ms). */
  minIntervalMs?: number;
  /** Test seam: override how continuation runs are admitted (default: per-user agent stack). */
  enqueue?: (userId: string, input: TurnInput) => string;
}

/**
 * Event-driven continuation hook, reference counted per database like the
 * dispatch supervisor. Terminal-state run events are evaluated with a minimum
 * interval per goal; a throttled evaluation is re-scheduled rather than
 * dropped, so terminal event storms cannot stall or double-enqueue a goal.
 */
export function attachGoalDriver(deps: AgentStackDeps, options?: GoalDriverOptions): GoalDriver {
  let active = drivers.get(deps.db);
  if (!active) {
    const minIntervalMs = options?.minIntervalMs ?? 2000;
    const enqueue = options?.enqueue;
    const lastAttemptAt = new Map<string, number>();
    const pending = new Map<string, NodeJS.Timeout>();
    const evaluate = (userId: string, goalId: string): void => {
      if (!deps.db.open) return;
      const elapsed = Date.now() - (lastAttemptAt.get(goalId) ?? 0);
      if (elapsed < minIntervalMs) { schedule(userId, goalId, minIntervalMs - elapsed); return; }
      lastAttemptAt.set(goalId, Date.now());
      try { evaluateGoalContinuation(deps, userId, goalId, enqueue ? (input) => enqueue(userId, input) : undefined); }
      catch (error) { logGoalDriverError('evaluate', userId, error); }
    };
    const schedule = (userId: string, goalId: string, delayMs: number): void => {
      const key = `${userId}:${goalId}`;
      if (pending.has(key)) return;
      const timer = setTimeout(() => { pending.delete(key); evaluate(userId, goalId); }, delayMs);
      timer.unref();
      pending.set(key, timer);
    };
    const onEvent = (event: ForgeBadgerEvent): void => {
      if (!deps.db.open) return;
      if (event.type === 'session_notification') {
        try { for (const target of settleGoalDispatchFromHook(deps.db, event)) evaluate(target.userId, target.goalId); }
        catch (error) { logGoalDriverError('dispatch-hook', event.userId, error); }
        return;
      }
      if (event.type !== 'copilot_run_updated' || !TERMINAL_RUN_STATES.includes(event.status)) return;
      const run = deps.db.prepare('SELECT goal_id FROM copilot_runs WHERE user_id=? AND id=?')
        .get(event.userId, event.runId) as { goal_id: string | null } | undefined;
      if (run?.goal_id) evaluate(event.userId, run.goal_id);
    };
    deps.eventBus.on('event', onEvent);
    active = {
      references: 0,
      stop() {
        deps.eventBus.off('event', onEvent);
        for (const timer of pending.values()) clearTimeout(timer);
        pending.clear();
        drivers.delete(deps.db);
      }
    };
    drivers.set(deps.db, active);
  }
  active.references += 1;
  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      if (--active!.references === 0) active!.stop();
    }
  };
}
