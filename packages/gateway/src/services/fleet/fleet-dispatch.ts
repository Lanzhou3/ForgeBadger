import type { Database } from '../../db/types.js';
import type { InMemorySessionManager } from '../session-manager.js';
import { AgentError } from '../agent/types.js';
import { isFleetStore, type WorkStore } from '../agent/work-store.js';
import { FleetNotes } from './fleet-notes.js';
import { parseFileScope, type FleetStore, type FleetTaskRow } from './fleet-store.js';

/**
 * Fleet-only additions to the shared member dispatch (goal_dispatch_task):
 * a held task is never dispatched (spec §3.4), a parallel dispatch may not
 * overlap the file scope of a running dispatch (spec §3.3), and the member's
 * instructions carry its memo and the task's file scope (spec §3.3/§3.5).
 * Goal dispatch never calls these.
 */

/** Path-segment prefix overlap: equal, or one is a directory prefix of the other. */
export function scopesOverlap(left: string, right: string): boolean {
  return left === right || right.startsWith(`${left}/`) || left.startsWith(`${right}/`);
}

/** A held task waits for the owner; a cancelled one is final. */
export function assertFleetTaskDispatchable(task: FleetTaskRow): void {
  if (task.status === 'cancelled')
    throw new AgentError('COPILOT_GOAL_TASK_CANCELLED', `Task #${task.seq} was cancelled by the owner; it can no longer be worked on`);
  if (task.hold_question)
    throw new AgentError('FLEET_TASK_HELD', `Task #${task.seq} is on hold waiting for the owner's answer; work on other tasks meanwhile (a hold_answered event wakes you when it is answered)`);
}

/**
 * Fleet scope only (goal stores pass through): refuse work on a held or
 * cancelled task. Used by goal_delegate, goal_dispatch_task,
 * goal_integrate_task and goal_review_task.
 */
export function assertScopeTaskOpen(store: WorkStore, scopeId: string, taskId: string): void {
  if (!isFleetStore(store)) return;
  const task = store.getTask(scopeId, taskId);
  if (task) assertFleetTaskDispatchable(task);
}

/**
 * Refuse a parallel dispatch whose file scope overlaps a running dispatch's.
 * Tasks without a declared scope (either side) are not checked.
 */
export function assertNoFileScopeOverlap(store: FleetStore, fleetId: string, task: FleetTaskRow): void {
  const mine = parseFileScope(task.file_scope_json);
  if (!mine.length) return;
  for (const other of store.listTasks(fleetId)) {
    if (other.id === task.id || other.dispatch_status !== 'running') continue;
    const theirs = parseFileScope(other.file_scope_json);
    const conflicts = mine.flatMap(path => theirs.filter(entry => scopesOverlap(path, entry)).map(entry => path === entry ? path : `${path} ↔ ${entry}`));
    if (conflicts.length)
      throw new AgentError('COPILOT_GOAL_SCOPE_OVERLAP', `Task #${task.seq}'s file scope overlaps running task #${other.seq} (${other.id}): ${conflicts.slice(0, 10).join(', ')}; wait for it to finish, or narrow the scopes`);
  }
}

/** Memo (after the role preamble) and file scope lines appended to a fleet member's instructions. */
export function fleetDispatchNotes(db: Database, userId: string, fleetId: string, task: FleetTaskRow, memberId: string | undefined): string {
  let text = '';
  const memo = memberId ? new FleetNotes(db, userId).memberMemo(fleetId, memberId) : undefined;
  if (memo) text += `\n\n[ForgeBadger] Notes from the lead for you about this project:\n${memo}`;
  const scope = parseFileScope(task.file_scope_json);
  if (scope.length)
    text += `\n\n[ForgeBadger] File scope of this task: change only files under ${scope.join(', ')}. If the task needs changes elsewhere, do not make them; say so in your final message.`;
  return text;
}

/**
 * Fleet merge gate: every session still alive in the shared integration tree,
 * whatever its dispatch record says (a dispatch settled `ended` by the report
 * timeout may still have its CLI running there). Live = the session row says
 * running, or the session manager still holds it as running.
 */
export function liveSessionsInTree(db: Database, userId: string, treePath: string, sessionManager?: InMemorySessionManager): string[] {
  const rows = db.prepare("SELECT id, status FROM sessions WHERE user_id=? AND working_dir=?").all(userId, treePath) as Array<{ id: string; status: string }>;
  return rows.filter(row => row.status === 'running' || sessionManager?.getSession(row.id)?.status === 'running').map(row => row.id);
}
