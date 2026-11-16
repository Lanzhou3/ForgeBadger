import { z } from 'zod';
import type { Database } from '../../../db/types.js';
import { FleetNotes, FLEET_NOTE_SCOPES } from '../../fleet/fleet-notes.js';
import { notifyFleetHold } from '../../fleet/fleet-notify.js';
import { FleetStore, type FleetRow } from '../../fleet/fleet-store.js';
import { FleetTimers, MAX_TIMER_MINUTES, MAX_TIMER_NOTE, MIN_TIMER_MINUTES, type FleetTimerRow } from '../../fleet/fleet-timers.js';
import { AgentError } from '../types.js';
import { scopeKind } from '../work-store.js';
import { goalIdForRun } from './goals.js';
import type { AgentTool, AgentToolContext } from '../tool-registry.js';

/**
 * Fleet lead tools (spec §3.6). They change only fleet-owned state (task
 * hold, the lead's timers and notes), so they are read-risk and need no
 * approval. Each one refuses anything but the fleet's own lead run: the tool
 * catalog hides them elsewhere, but hidden tools are not rejected at
 * execution time, so the check lives here.
 */

const taskId = z.string().trim().min(1).max(128);
const holdInput = z.object({ taskId, question: z.string().trim().min(1).max(4000) }).strict();
const setTimerInput = z.object({
  minutes: z.number().int().min(MIN_TIMER_MINUTES).max(MAX_TIMER_MINUTES),
  note: z.string().trim().min(1).max(MAX_TIMER_NOTE),
  taskId: taskId.optional()
}).strict();
const cancelTimerInput = z.object({ timerId: z.string().trim().min(1).max(128) }).strict();
const noteRef = { scope: z.enum(FLEET_NOTE_SCOPES), refId: z.string().trim().max(128).optional() };
const writeNoteInput = z.object({ ...noteRef, body: z.string().trim().min(1).max(4000) }).strict();
const readNoteInput = z.object(noteRef).strict();

/** The fleet of the current lead run; anything else (goal run, plain chat, delegate child) is refused. */
export function fleetForLeadRun(context: AgentToolContext): FleetRow {
  const db = context.db as Database;
  let scopeId: string;
  try { scopeId = goalIdForRun(context); }
  catch { throw new AgentError('FLEET_CONTEXT_REQUIRED', 'Fleet tools are only available in a fleet lead run'); }
  if (scopeKind(db, context.userId, scopeId) !== 'fleet')
    throw new AgentError('FLEET_CONTEXT_REQUIRED', 'This run is not a fleet lead run; fleet tools are unavailable');
  const fleet = new FleetStore(db, context.userId).getFleet(scopeId)!;
  const run = db.prepare('SELECT conversation_id FROM copilot_runs WHERE user_id=? AND id=?').get(context.userId, context.runId) as { conversation_id: string } | undefined;
  if (run?.conversation_id !== fleet.conversation_id)
    throw new AgentError('FLEET_CONTEXT_REQUIRED', 'Fleet tools belong to the flagship run on the fleet conversation');
  return fleet;
}

function runIdOf(context: AgentToolContext): string | null {
  return typeof context.runId === 'string' ? context.runId : null;
}

function timerDto(timer: FleetTimerRow) {
  return { id: timer.id, taskId: timer.task_id, dueAt: new Date(timer.due_at).toISOString(), note: timer.note, status: timer.status };
}

export function createFleetTools(): AgentTool[] {
  return [
    {
      name: 'fleet_hold_task',
      description: 'Put ONE fleet task on hold with a question for the owner (fleet runs only). Only that task waits: other tasks keep moving and the fleet stays active. A held task cannot be dispatched; when the owner answers, a hold_answered event wakes you. 挂起单个任务等 owner 决定。',
      risk: 'read',
      requiresApproval: false,
      inputSchema: holdInput,
      async execute(input, context) {
        const fleet = fleetForLeadRun(context);
        const db = context.db as Database;
        const parsed = holdInput.parse(input);
        const store = new FleetStore(db, context.userId);
        const task = store.setHold(fleet.id, parsed.taskId, parsed.question);
        store.appendJournal(fleet.id, runIdOf(context), `Task #${task.seq} held for the owner: ${parsed.question}`, task.id);
        notifyFleetHold(db, context.userId, store.getFleet(fleet.id)!, task);
        return { task: { id: task.id, seq: task.seq, hold: { question: task.hold_question, askedAt: new Date(task.hold_asked_at!).toISOString() } } };
      }
    },
    {
      name: 'fleet_set_timer',
      description: `Set a one-shot follow-up for yourself (fleet runs only): after ${MIN_TIMER_MINUTES}-${MAX_TIMER_MINUTES} minutes a timer_due event wakes you with this note. Use it instead of waiting or polling. At most 20 pending timers per fleet. 设定一次性跟进定时器。`,
      risk: 'read',
      requiresApproval: false,
      inputSchema: setTimerInput,
      async execute(input, context) {
        const fleet = fleetForLeadRun(context);
        const parsed = setTimerInput.parse(input);
        const timer = new FleetTimers(context.db as Database, context.userId).set(fleet.id, parsed);
        return { timer: timerDto(timer) };
      }
    },
    {
      name: 'fleet_cancel_timer',
      description: 'Cancel one of your pending fleet timers (fleet runs only). 取消定时器。',
      risk: 'read',
      requiresApproval: false,
      inputSchema: cancelTimerInput,
      async execute(input, context) {
        const fleet = fleetForLeadRun(context);
        const timer = new FleetTimers(context.db as Database, context.userId).cancel(fleet.id, cancelTimerInput.parse(input).timerId);
        return { timer: timerDto(timer) };
      }
    },
    {
      name: 'fleet_write_note',
      description: 'Replace one fleet note (fleet runs only; max 4000 chars, whole note replaced). scope fleet = your project memo (no refId); task = progress of a task (refId = task id: what was done, what is left); member = what a team member should know about this project or got wrong before (refId = member id; appended to that member\'s future dispatches, first 1500 chars). The context shows only a 160-char index; read full notes with fleet_read_note. 写舰队备忘（整条替换）。',
      risk: 'read',
      requiresApproval: false,
      inputSchema: writeNoteInput,
      async execute(input, context) {
        const fleet = fleetForLeadRun(context);
        const parsed = writeNoteInput.parse(input);
        const note = new FleetNotes(context.db as Database, context.userId).write(fleet.id, parsed.scope, parsed.refId, parsed.body);
        return { note: { scope: note.scope, refId: note.ref_id, chars: Array.from(note.body).length, updatedAt: new Date(note.updated_at).toISOString() } };
      }
    },
    {
      name: 'fleet_read_note',
      description: 'Read the full text of one fleet note (fleet runs only): scope fleet (no refId), task (refId = task id) or member (refId = member id). Returns note: null when none was written. 读取舰队备忘全文。',
      risk: 'read',
      requiresApproval: false,
      inputSchema: readNoteInput,
      async execute(input, context) {
        const fleet = fleetForLeadRun(context);
        const parsed = readNoteInput.parse(input);
        const note = new FleetNotes(context.db as Database, context.userId).read(fleet.id, parsed.scope, parsed.refId);
        return { note: note ? { scope: note.scope, refId: note.ref_id, body: note.body, updatedAt: new Date(note.updated_at).toISOString() } : null };
      }
    }
  ];
}
