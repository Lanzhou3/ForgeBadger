import { createHash } from 'node:crypto';
import type { Database } from '../../db/types.js';
import { NotificationService } from '../notification-service.js';
import type { FleetRow, FleetTaskRow } from './fleet-store.js';

/**
 * The fleet's outbox (spec §3.8), quiet by default. Immediate notifications:
 * a task is held for the owner, events were given up after repeated lead-run
 * failures, the run-rate guard paused the fleet. Digest: every non-cancelled
 * task passes ("fleet is clear, N tasks wait for your merge"). Each fires once
 * per payload dedupe key, like goal-notify; delivery never breaks the caller.
 */

export const FLEET_NOTIFICATION_TYPE = 'copilot_fleet';
export const FLEET_NOTIFICATION_TITLE_KEY = 'notifications.copilotFleetUpdated';
export type FleetNotificationKind = 'hold' | 'events_failed' | 'run_rate_limit' | 'no_progress' | 'cleared';

const MAX_MESSAGE_PART = 300;

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function clip(value: string, max = MAX_MESSAGE_PART): string {
  const chars = Array.from(value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').trim());
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join('');
}

function notifyOnce(db: Database, userId: string, fleet: FleetRow, kind: FleetNotificationKind, dedupe: string, message: string, taskId?: string): boolean {
  const duplicate = db.prepare(`SELECT 1 FROM notifications WHERE user_id=? AND type=?
      AND json_extract(CASE WHEN json_valid(payload) THEN payload ELSE '{}' END,'$.fleet_id')=?
      AND json_extract(CASE WHEN json_valid(payload) THEN payload ELSE '{}' END,'$.dedupe')=?
    LIMIT 1`).get(userId, FLEET_NOTIFICATION_TYPE, fleet.id, dedupe);
  if (duplicate) return false;
  try {
    new NotificationService(db, userId).create({
      type: FLEET_NOTIFICATION_TYPE,
      titleKey: FLEET_NOTIFICATION_TITLE_KEY,
      message,
      href: `/fleet/${fleet.id}`,
      payload: { fleet_id: fleet.id, kind, dedupe, ...(taskId ? { task_id: taskId } : {}) }
    });
    return true;
  } catch {
    // Notification delivery must never break the fleet state machine.
    return false;
  }
}

/** Once per hold cycle (task, asked-at, question): asking the same question again later notifies again. */
export function notifyFleetHold(db: Database, userId: string, fleet: FleetRow, task: FleetTaskRow): boolean {
  if (!task.hold_question) return false;
  return notifyOnce(db, userId, fleet, 'hold', `hold:${task.id}:${task.hold_asked_at ?? 0}:${digest(task.hold_question)}`,
    `Fleet "${clip(fleet.title, 120)}" task #${task.seq} waits for your decision: ${clip(task.hold_question)}`, task.id);
}

/** Once per given-up batch (keyed by the lead run, or the enqueue attempt that failed). */
export function notifyFleetEventsFailed(db: Database, userId: string, fleet: FleetRow, batchKey: string, count: number): boolean {
  return notifyOnce(db, userId, fleet, 'events_failed', `events_failed:${batchKey}`,
    `Fleet "${clip(fleet.title, 120)}": the flagship failed to handle ${count} event(s) after repeated attempts; see the fleet journal.`);
}

/** Once per pause (the fleet row's updated_at at the moment it was paused). */
export function notifyFleetRateLimited(db: Database, userId: string, fleet: FleetRow, limit: number): boolean {
  return notifyOnce(db, userId, fleet, 'run_rate_limit', `run_rate_limit:${fleet.updated_at}`,
    `Fleet "${clip(fleet.title, 120)}" was paused: the flagship started ${limit} runs within an hour. Resume it when you are ready.`);
}

/** Once per pause by the no-progress guard. */
export function notifyFleetNoProgress(db: Database, userId: string, fleet: FleetRow, runs: number): boolean {
  return notifyOnce(db, userId, fleet, 'no_progress', `no_progress:${fleet.updated_at}`,
    `Fleet "${clip(fleet.title, 120)}" was paused: ${runs} flagship runs in a row changed nothing on the board. Check the journal, then resume it or send it a message.`);
}

/** Digest once per set of passed tasks, when every non-cancelled task passes. */
export function notifyFleetClearedIfDone(db: Database, userId: string, fleet: FleetRow, tasks: FleetTaskRow[]): boolean {
  const open = tasks.filter(task => task.status !== 'cancelled');
  if (!open.length || open.some(task => task.status !== 'passes')) return false;
  const passed = open.map(task => task.id).sort();
  return notifyOnce(db, userId, fleet, 'cleared', `cleared:${digest(passed.join(','))}`,
    `Fleet "${clip(fleet.title, 120)}" is clear: ${passed.length} task(s) passed and wait for your merge.`);
}
