import { randomUUID } from 'node:crypto';
import type { Database } from '../../db/types.js';
import { AgentError } from '../agent/types.js';
import { FleetInbox, wakeFleet } from './fleet-inbox.js';
import { FleetStore } from './fleet-store.js';

/**
 * One-shot follow-ups the lead sets for itself (spec §3.2). No recurring
 * schedules. At most MAX_PENDING_TIMERS pending per fleet; a delay of 1-1440
 * minutes. A due timer fires once: it turns `fired` and enqueues `timer_due`
 * (key `timer:<id>`) in the same transaction.
 */

export const MAX_PENDING_TIMERS = 20;
export const MIN_TIMER_MINUTES = 1;
export const MAX_TIMER_MINUTES = 1440;
export const MAX_TIMER_NOTE = 1000;

export interface FleetTimerRow {
  id: string; user_id: string; fleet_id: string; task_id: string | null; due_at: number; note: string;
  status: 'pending' | 'fired' | 'cancelled'; created_at: number; fired_at: number | null;
}

function invalid(message: string): AgentError {
  return new AgentError('FLEET_INPUT_INVALID', message);
}

export class FleetTimers {
  constructor(private db: Database, private userId: string) {}

  set(fleetId: string, input: { minutes: number; note: string; taskId?: string | undefined }, now = Date.now()): FleetTimerRow {
    if (!Number.isInteger(input.minutes) || input.minutes < MIN_TIMER_MINUTES || input.minutes > MAX_TIMER_MINUTES)
      throw invalid(`minutes must be an integer from ${MIN_TIMER_MINUTES} to ${MAX_TIMER_MINUTES}`);
    const note = input.note.trim();
    if (!note || Array.from(note).length > MAX_TIMER_NOTE) throw invalid(`note must be 1-${MAX_TIMER_NOTE} characters`);
    const store = new FleetStore(this.db, this.userId);
    return this.db.transaction(() => {
      if (!store.getFleet(fleetId)) throw new AgentError('COPILOT_NOT_FOUND', 'Fleet not found');
      if (input.taskId !== undefined && !store.getTask(fleetId, input.taskId)) throw new AgentError('COPILOT_NOT_FOUND', 'Task not found');
      if (this.listPending(fleetId).length >= MAX_PENDING_TIMERS)
        throw new AgentError('FLEET_TIMER_LIMIT', `This fleet already has ${MAX_PENDING_TIMERS} pending timers; cancel one (fleet_cancel_timer) first`);
      const id = randomUUID();
      this.db.prepare(`INSERT INTO fleet_timers(id,user_id,fleet_id,task_id,due_at,note,status,created_at) VALUES(?,?,?,?,?,?,'pending',?)`)
        .run(id, this.userId, fleetId, input.taskId ?? null, now + input.minutes * 60_000, note, now);
      return this.get(fleetId, id)!;
    }).immediate();
  }

  get(fleetId: string, timerId: string): FleetTimerRow | undefined {
    return this.db.prepare('SELECT * FROM fleet_timers WHERE user_id=? AND fleet_id=? AND id=?').get(this.userId, fleetId, timerId) as FleetTimerRow | undefined;
  }

  /** Idempotent: a timer that already fired or was cancelled is returned unchanged. */
  cancel(fleetId: string, timerId: string): FleetTimerRow {
    const timer = this.get(fleetId, timerId);
    if (!timer) throw new AgentError('COPILOT_NOT_FOUND', 'Timer not found');
    if (timer.status !== 'pending') return timer;
    this.db.prepare("UPDATE fleet_timers SET status='cancelled' WHERE user_id=? AND fleet_id=? AND id=? AND status='pending'").run(this.userId, fleetId, timerId);
    return this.get(fleetId, timerId)!;
  }

  listPending(fleetId: string): FleetTimerRow[] {
    return this.db.prepare("SELECT * FROM fleet_timers WHERE user_id=? AND fleet_id=? AND status='pending' ORDER BY due_at, rowid")
      .all(this.userId, fleetId) as FleetTimerRow[];
  }

  /** Fire every due timer of this tenant (paused fleets too: their events wait). Returns how many fired. */
  fireDue(now = Date.now()): number {
    const due = this.db.prepare("SELECT * FROM fleet_timers WHERE user_id=? AND status='pending' AND due_at<=? ORDER BY due_at, rowid")
      .all(this.userId, now) as FleetTimerRow[];
    const inbox = new FleetInbox(this.db, this.userId);
    let fired = 0;
    for (const timer of due) {
      const changed = this.db.transaction(() => {
        const updated = this.db.prepare("UPDATE fleet_timers SET status='fired', fired_at=? WHERE user_id=? AND id=? AND status='pending'")
          .run(now, this.userId, timer.id).changes;
        if (!updated) return false;
        inbox.enqueue(timer.fleet_id, { kind: 'timer_due', dedupeKey: `timer:${timer.id}`, taskId: timer.task_id, payload: { timerId: timer.id, note: timer.note } }, now);
        return true;
      }).immediate();
      if (!changed) continue;
      fired += 1;
      wakeFleet(this.db, this.userId, timer.fleet_id);
    }
    return fired;
  }
}
