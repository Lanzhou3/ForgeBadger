import { randomUUID } from 'node:crypto';
import type { Database } from '../../db/types.js';
import { readReviewState, type ReviewAttempt } from '../agent/goal-review.js';
import { AgentError } from '../agent/types.js';
import { FleetStore } from './fleet-store.js';

/**
 * The fleet lead's inbox (spec §3.1): every wake-up reason is a row in
 * fleet_events, deduplicated per fleet by `dedupe_key`
 * (INSERT … ON CONFLICT DO NOTHING). The table is the source of truth: a
 * worker that restarts resumes from these rows alone.
 *
 * Lifecycle: pending → claimed (with the lead run id, atomically with the run
 * admission) → done (run completed) | pending again (run failed/stopped,
 * attempt_count+1) | failed (MAX_EVENT_ATTEMPTS reached). A released event is
 * claimable again after the retry delay × attempt_count, measured from its
 * last failed attempt (claimed_at is restamped then). All statements are parameterized and tenant scoped by user_id.
 */

export const FLEET_EVENT_KINDS = ['task_added', 'owner_message', 'hold_answered', 'task_cancelled', 'member_turn_ended',
  'member_session_ended', 'review_settled', 'timer_due', 'fleet_resumed', 'merge_done'] as const;
export type FleetEventKind = (typeof FLEET_EVENT_KINDS)[number];
export type FleetEventStatus = 'pending' | 'claimed' | 'done' | 'failed';

export const MAX_EVENT_ATTEMPTS = 3;
export const EVENT_BATCH_SIZE = 20;
const MAX_DEDUPE_KEY = 300;
/**
 * Hard cap on one event payload. The largest schema-valid input is an owner
 * message of 8000 characters (or a 4000-char answer plus its question), up to
 * 4 UTF-8 bytes each plus JSON escaping: 64 KiB covers it with room to spare.
 */
const MAX_PAYLOAD_BYTES = 64 * 1024;
/** Owner-originated kinds: the owner gave the flagship something new to act on (resets the no-progress guard). */
export const OWNER_EVENT_KINDS: ReadonlySet<FleetEventKind> = new Set(['task_added', 'owner_message', 'hold_answered', 'fleet_resumed']);
const RETAIN_PROCESSED_MS = 14 * 24 * 60 * 60_000;
const PRUNE_BATCH = 500;

export interface FleetEventRow {
  id: string; user_id: string; fleet_id: string; kind: FleetEventKind; task_id: string | null; dedupe_key: string;
  payload_json: string; status: FleetEventStatus; run_id: string | null; attempt_count: number;
  created_at: number; claimed_at: number | null; processed_at: number | null;
}

export interface FleetEventInput {
  kind: FleetEventKind;
  dedupeKey: string;
  taskId?: string | null | undefined;
  payload?: Record<string, unknown> | undefined;
}

export function parseEventPayload(row: FleetEventRow): Record<string, unknown> {
  try {
    const value = JSON.parse(row.payload_json) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

export class FleetInbox {
  constructor(private db: Database, private userId: string) {}

  /** True when a new row was written; a duplicate dedupe key (or a fleet of another tenant) writes nothing. */
  enqueue(fleetId: string, input: FleetEventInput, now = Date.now()): boolean {
    if (!(FLEET_EVENT_KINDS as readonly string[]).includes(input.kind)) throw new AgentError('FLEET_INPUT_INVALID', `Unknown fleet event kind: ${input.kind}`);
    if (!input.dedupeKey || input.dedupeKey.length > MAX_DEDUPE_KEY) throw new AgentError('FLEET_INPUT_INVALID', 'Invalid fleet event dedupe key');
    const payload = JSON.stringify(input.payload ?? {});
    if (Buffer.byteLength(payload) > MAX_PAYLOAD_BYTES) throw new AgentError('FLEET_INPUT_INVALID', 'Fleet event payload is too large');
    // INSERT … SELECT needs its WHERE clause before ON CONFLICT; the EXISTS keeps the row inside this tenant's fleet.
    const inserted = this.db.prepare(`INSERT INTO fleet_events(id,user_id,fleet_id,kind,task_id,dedupe_key,payload_json,status,attempt_count,created_at)
        SELECT ?,?,?,?,?,?,?,'pending',0,? WHERE EXISTS (SELECT 1 FROM fleets WHERE user_id=? AND id=?)
        ON CONFLICT(fleet_id,dedupe_key) DO NOTHING`)
      .run(randomUUID(), this.userId, fleetId, input.kind, input.taskId ?? null, input.dedupeKey, payload, now, this.userId, fleetId).changes > 0;
    if (inserted && OWNER_EVENT_KINDS.has(input.kind))
      this.db.prepare('UPDATE fleets SET idle_lead_runs=0 WHERE user_id=? AND id=?').run(this.userId, fleetId);
    return inserted;
  }

  /** Drop done/failed events older than the retention window, a bounded batch per call. */
  prune(now: number): number {
    return this.db.prepare(`DELETE FROM fleet_events WHERE id IN (SELECT id FROM fleet_events WHERE user_id=? AND status IN ('done','failed')
        AND COALESCE(processed_at, created_at) < ? LIMIT ?)`).run(this.userId, now - RETAIN_PROCESSED_MS, PRUNE_BATCH).changes;
  }

  list(fleetId: string, status: FleetEventStatus): FleetEventRow[] {
    return this.db.prepare('SELECT * FROM fleet_events WHERE user_id=? AND fleet_id=? AND status=? ORDER BY created_at, rowid')
      .all(this.userId, fleetId, status) as FleetEventRow[];
  }

  countPending(fleetId: string): number {
    return (this.db.prepare("SELECT count(*) AS count FROM fleet_events WHERE user_id=? AND fleet_id=? AND status='pending'")
      .get(this.userId, fleetId) as { count: number }).count;
  }

  hasClaimed(fleetId: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM fleet_events WHERE user_id=? AND fleet_id=? AND status='claimed' LIMIT 1").get(this.userId, fleetId);
  }

  /** Pending events whose retry delay (retryDelayMs × attempt_count since the last claim) has elapsed, oldest first. */
  claimable(fleetId: string, now: number, retryDelayMs: number, limit = EVENT_BATCH_SIZE): FleetEventRow[] {
    return this.db.prepare(`SELECT * FROM fleet_events WHERE user_id=? AND fleet_id=? AND status='pending'
        AND (attempt_count=0 OR claimed_at IS NULL OR claimed_at + attempt_count * ? <= ?)
      ORDER BY created_at, rowid LIMIT ?`).all(this.userId, fleetId, retryDelayMs, now, limit) as FleetEventRow[];
  }

  /** Caller holds the transaction that also admitted the run. */
  markClaimed(eventIds: readonly string[], runId: string, now: number): void {
    const statement = this.db.prepare("UPDATE fleet_events SET status='claimed', run_id=?, claimed_at=? WHERE user_id=? AND id=? AND status='pending'");
    for (const id of eventIds) statement.run(runId, now, this.userId, id);
  }

  forRun(runId: string): FleetEventRow[] {
    return this.db.prepare("SELECT * FROM fleet_events WHERE user_id=? AND run_id=? AND status='claimed' ORDER BY created_at, rowid")
      .all(this.userId, runId) as FleetEventRow[];
  }

  /** Distinct lead runs that still hold claimed events of this fleet. */
  claimedRuns(fleetId: string): string[] {
    return (this.db.prepare("SELECT DISTINCT run_id FROM fleet_events WHERE user_id=? AND fleet_id=? AND status='claimed' AND run_id IS NOT NULL")
      .all(this.userId, fleetId) as Array<{ run_id: string }>).map(row => row.run_id);
  }

  complete(runId: string, now: number): number {
    return this.db.prepare("UPDATE fleet_events SET status='done', processed_at=? WHERE user_id=? AND run_id=? AND status='claimed'")
      .run(now, this.userId, runId).changes;
  }

  /**
   * Return the run's events to pending. A counted release adds an attempt and
   * gives up (status failed) at MAX_EVENT_ATTEMPTS; the exhausted rows are returned.
   */
  release(runId: string, now: number, counted: boolean): FleetEventRow[] {
    return this.db.transaction(() => {
      const claimed = this.forRun(runId);
      if (!counted) {
        this.db.prepare("UPDATE fleet_events SET status='pending', run_id=NULL WHERE user_id=? AND run_id=? AND status='claimed'").run(this.userId, runId);
        return [];
      }
      return this.countAttempt(claimed.map(event => event.id), now);
    })();
  }

  /** One failed attempt for each pending/claimed event; returns the events that reached the attempt cap. */
  countAttempt(eventIds: readonly string[], now: number): FleetEventRow[] {
    const update = this.db.prepare(`UPDATE fleet_events SET attempt_count=attempt_count+1,
        status=CASE WHEN attempt_count+1 >= ? THEN 'failed' ELSE 'pending' END,
        run_id=CASE WHEN attempt_count+1 >= ? THEN run_id ELSE NULL END,
        claimed_at=?,
        processed_at=CASE WHEN attempt_count+1 >= ? THEN ? ELSE processed_at END
      WHERE user_id=? AND id=? AND status IN ('pending','claimed')`);
    const exhausted: FleetEventRow[] = [];
    for (const id of eventIds) {
      update.run(MAX_EVENT_ATTEMPTS, MAX_EVENT_ATTEMPTS, now, MAX_EVENT_ATTEMPTS, now, this.userId, id);
      const row = this.db.prepare('SELECT * FROM fleet_events WHERE user_id=? AND id=?').get(this.userId, id) as FleetEventRow | undefined;
      if (row?.status === 'failed') exhausted.push(row);
    }
    return exhausted;
  }
}

// --- Merge lock --------------------------------------------------------------

/**
 * One owner merge per fleet at a time, held for the whole gate → merge →
 * cleanup sequence. While held, pumpFleet starts no flagship run (events stay
 * pending); releasing wakes the fleet. In-process: one Gateway owns a database.
 */
const mergeLocks = new Set<string>();

export function fleetMergeLocked(fleetId: string): boolean {
  return mergeLocks.has(fleetId);
}

/** Returns the release function, or undefined when a merge already holds the lock. */
export function acquireFleetMergeLock(db: Database, userId: string, fleetId: string): (() => void) | undefined {
  if (mergeLocks.has(fleetId)) return undefined;
  mergeLocks.add(fleetId);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    mergeLocks.delete(fleetId);
    if (db.open) wakeFleet(db, userId, fleetId);
  };
}

// --- Wake-up seam ----------------------------------------------------------

/** Called after a new event row exists; the worker defers the pump (never runs inside the caller's transaction). */
export type FleetWaker = (userId: string, fleetId: string) => void;
const wakers = new WeakMap<Database, Set<FleetWaker>>();

export function registerFleetWaker(db: Database, waker: FleetWaker): () => void {
  let set = wakers.get(db);
  if (!set) { set = new Set(); wakers.set(db, set); }
  set.add(waker);
  return () => { wakers.get(db)?.delete(waker); };
}

export function wakeFleet(db: Database, userId: string, fleetId: string): void {
  for (const waker of wakers.get(db) ?? []) {
    try { waker(userId, fleetId); } catch { /* a waker never breaks the producer */ }
  }
}

/** Insert one event and wake the worker when it is new. */
export function enqueueFleetEvent(db: Database, userId: string, fleetId: string, input: FleetEventInput): boolean {
  const inserted = new FleetInbox(db, userId).enqueue(fleetId, input);
  if (inserted) wakeFleet(db, userId, fleetId);
  return inserted;
}

// --- Event keys ------------------------------------------------------------

/**
 * One wake-up per dispatched CLI turn: the task plus the time it was
 * dispatched (setTaskDispatched stamps dispatch_updated_at). The turn-end
 * hook and the dead-session sweep share it, so whichever settles the turn
 * first wins and a re-dispatch of the same task is a new key.
 */
export function dispatchEventKey(taskId: string, dispatchedAt: number | null, sessionId: string | null): string {
  return `dispatch:${taskId}:${sessionId ?? '-'}:${dispatchedAt ?? 0}`;
}

export function reviewEventKey(taskId: string, attempt: number): string {
  return `review:${taskId}:${attempt}`;
}

/**
 * review_settled for every settled review attempt of the fleet (idempotent by
 * attempt). Used by the goal driver's review hook for fleet scopes and by the
 * worker's periodic pass, so a review settled by either path wakes the lead once.
 */
export function enqueueSettledFleetReviews(db: Database, userId: string, fleetId: string, options: { unresolvedOnly?: boolean } = {}): number {
  const store = new FleetStore(db, userId);
  if (!store.getFleet(fleetId)) return 0;
  let inserted = 0;
  for (const task of store.listTasks(fleetId)) {
    if (options.unresolvedOnly && (task.status === 'passes' || task.status === 'cancelled')) continue;
    let attempts: ReviewAttempt[];
    try { attempts = readReviewState(db, fleetId, task.id).attempts; } catch { continue; }
    for (const attempt of attempts) {
      if (attempt.status === 'running') continue;
      const added = enqueueFleetEvent(db, userId, fleetId, {
        kind: 'review_settled', dedupeKey: reviewEventKey(task.id, attempt.attempt), taskId: task.id,
        payload: {
          attempt: attempt.attempt, outcome: attempt.status, reviewer: attempt.reviewer.id,
          ...(attempt.report ? { verdict: attempt.report.verdict, findings: attempt.report.findings.length } : {})
        }
      });
      if (added) inserted += 1;
    }
  }
  return inserted;
}
