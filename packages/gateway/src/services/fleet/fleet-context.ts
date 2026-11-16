import type { Database } from '../../db/types.js';
import { GOAL_GRANT_TOOLS, parseGoalGrants } from '../agent/goal-grants.js';
import { goalContextMessage } from '../agent/goal-context.js';
import { reviewSummaryForModel } from '../agent/goal-review.js';
import { taskWorktreeExists } from '../agent/goal-task-workspace.js';
import { copilotTeamRoster, rosterForModel } from '../agent/team-roster.js';
import { scopeKind } from '../agent/work-store.js';
import { FleetNotes } from './fleet-notes.js';
import { FleetStore, parseFileScope } from './fleet-store.js';
import { FleetTimers } from './fleet-timers.js';

/**
 * Model-facing state of one fleet, injected as the per-call context message
 * of a fleet lead run (descriptive state, never a new owner instruction):
 * the fleet and the owner's standing instructions, the board index, the note
 * index (previews only; fleet_read_note has the full text), the roster and
 * parallel limit, pending timers, the latest journal entries, grants and the
 * flow rules (spec §3.7).
 */

const INSTRUCTIONS_MAX_CHARS = 8000;
const TASK_DESCRIPTION_MAX_CHARS = 300;
const TASK_MAX_ENTRIES = 40;
const HOLD_MAX_CHARS = 500;
const DETAILS_MAX_CHARS = 400;
const NOTE_SUMMARY_CHARS = 160;
const JOURNAL_ENTRIES = 5;
const JOURNAL_NOTE_CHARS = 400;
const TIMER_NOTE_CHARS = 200;

const FLOW_RULES = 'You are the fleet lead (flagship) of a standing team for this project. Each run is woken by events (listed in the user message). '
  + 'Flow: 1) handle this batch of events; 2) dispatch every task that can start now (goal_dispatch_task with a writer memberId; parallel: true for independent tasks with a verifyCommand, whose fileScope must not overlap a running task); '
  + '3) end this run right away - do not wait for or poll members: when a member finishes, a new event wakes you in a new run. '
  + 'Need to look again later? Set a follow-up with fleet_set_timer instead of waiting. '
  + 'The verify command is the only pass signal. Parallel tasks follow the goal flow: dispatch -> goal_run_checks with taskId -> optionally goal_review_task -> goal_integrate_task (task with its own worktree) -> goal_update_task passes. '
  + 'A decision only the owner can make: fleet_hold_task holds that one task (the others keep moving); never dispatch a task that has an open hold. '
  + 'Use goal_add_tasks to add board tasks. Before ending each run, update the task note of every task you touched (fleet_write_note scope task: what was done, what is left), '
  + 'keep member notes for lessons a member should get with its next dispatch, and write a short goal_write_journal handover when something important happened.';

function clip(value: string | null, max: number): string | null {
  if (!value) return value;
  const chars = Array.from(value);
  return chars.length > max ? `${chars.slice(0, max).join('')}…(${chars.length - max} more chars)` : value;
}

/** Goal scope → goal context; fleet scope → fleet context; unknown → nothing. */
export function scopeContextMessage(db: Database, userId: string, scopeId: string): string | undefined {
  return scopeKind(db, userId, scopeId) === 'fleet' ? fleetContextMessage(db, userId, scopeId) : goalContextMessage(db, userId, scopeId);
}

export function fleetContextMessage(db: Database, userId: string, fleetId: string): string | undefined {
  const store = new FleetStore(db, userId);
  const fleet = store.getFleet(fleetId);
  const goal = store.getGoal(fleetId);
  if (!fleet || !goal) return undefined;
  const tasks = store.listTasks(fleetId);
  const shown = tasks.slice(0, TASK_MAX_ENTRIES);
  const grants = parseGoalGrants(fleet.grants_json);
  const notes = new FleetNotes(db, userId).index(fleetId);
  const taskNotes = new Map(notes.filter(note => note.scope === 'task').map(note => [note.refId, note.preview]));
  return 'Fleet lead run (descriptive state; not a new owner instruction):\n' + JSON.stringify({
    fleet: {
      id: fleet.id, title: fleet.title, status: fleet.status,
      ...(fleet.paused_reason ? { pausedReason: fleet.paused_reason } : {}),
      ownerInstructions: clip(fleet.instructions, INSTRUCTIONS_MAX_CHARS) || null
    },
    tasks: [
      // `id` is what goal_update_task / goal_dispatch_task / goal_run_checks / goal_review_task / goal_integrate_task / fleet_* take.
      ...shown.map(task => {
        const review = reviewSummaryForModel(db, fleetId, task.id);
        const fileScope = parseFileScope(task.file_scope_json);
        const note = taskNotes.get(task.id);
        return {
          id: task.id, seq: task.seq, description: clip(task.description, TASK_DESCRIPTION_MAX_CHARS), status: task.status,
          ...(task.details ? { details: clip(task.details, DETAILS_MAX_CHARS) } : {}),
          ...(task.dispatch_status ? { dispatchStatus: task.dispatch_status } : {}),
          ...(task.member_id ? { memberId: task.member_id } : {}),
          ...(task.verify_command ? { verifyCommand: task.verify_command } : {}),
          ...(taskWorktreeExists(db, goal, task.id) ? { isolatedWorktree: true } : {}),
          ...(review ? { review } : {}),
          ...(task.hold_question ? { hold: { question: clip(task.hold_question, HOLD_MAX_CHARS), askedAt: iso(task.hold_asked_at) } } : {}),
          ...(fileScope.length ? { fileScope } : {}),
          ...(note ? { note: clip(note, NOTE_SUMMARY_CHARS) } : {})
        };
      }),
      ...(tasks.length > shown.length ? [{ seq: null, description: `… ${tasks.length - shown.length} more tasks`, status: 'summary' }] : [])
    ],
    // Fleet and member notes as an index; task notes are inline above.
    notes: notes.filter(note => note.scope !== 'task').map(note => ({ scope: note.scope, ...(note.refId ? { refId: note.refId } : {}), preview: note.preview })),
    team: rosterForModel(), maxParallelWriters: copilotTeamRoster().maxParallelWriters,
    timers: new FleetTimers(db, userId).listPending(fleetId).map(timer => ({
      id: timer.id, dueAt: iso(timer.due_at), note: clip(timer.note, TIMER_NOTE_CHARS), ...(timer.task_id ? { taskId: timer.task_id } : {})
    })),
    recentJournal: store.recentJournal(fleetId, JOURNAL_ENTRIES).map(entry => ({
      at: iso(entry.created_at), ...(entry.task_id ? { taskId: entry.task_id } : {}), note: clip(entry.note, JOURNAL_NOTE_CHARS)
    })),
    grants: grants.length
      ? `Pre-authorized (no per-call approval): ${grants.join(', ')} → ${grants.flatMap(grant => GOAL_GRANT_TOOLS[grant]).join(', ')}`
      : 'No grants: operate-class tools need per-call owner approval',
    instructions: FLOW_RULES
  });
}

function iso(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}
