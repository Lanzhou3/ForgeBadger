import { randomUUID } from 'node:crypto';
import type { Database } from '../../db/types.js';
import { AgentError } from '../agent/types.js';
import { FleetStore } from './fleet-store.js';

/**
 * Lead memory (spec §3.5). One note per (fleet, scope, ref): `fleet` (the
 * lead's own project memo, ref ''), `task` (progress of one board task, ref =
 * task id), `member` (what the lead learned about one roster member, ref =
 * member id). Each note is at most MAX_NOTE_BODY characters and replaced
 * whole. The context only carries an index (NOTE_PREVIEW_CHARS per note);
 * fleet_read_note returns the full body.
 */

export const FLEET_NOTE_SCOPES = ['fleet', 'task', 'member'] as const;
export type FleetNoteScope = (typeof FLEET_NOTE_SCOPES)[number];
export const MAX_NOTE_BODY = 4000;
export const NOTE_PREVIEW_CHARS = 160;
export const MEMBER_MEMO_CHARS = 1500;
const MEMBER_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

export interface FleetNoteRow {
  id: string; user_id: string; fleet_id: string; scope: FleetNoteScope; ref_id: string; body: string; updated_at: number;
}

function invalid(message: string): AgentError {
  return new AgentError('FLEET_INPUT_INVALID', message);
}

/** First `max` characters (code points) with an ellipsis when clipped. */
export function clipText(value: string, max: number): string {
  const chars = Array.from(value);
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : value;
}

export class FleetNotes {
  constructor(private db: Database, private userId: string) {}

  /** Validates the scope/ref pair against this fleet and returns the stored ref id. */
  resolveRef(fleetId: string, scope: string, refId: string | undefined): string {
    if (!(FLEET_NOTE_SCOPES as readonly string[]).includes(scope)) throw invalid(`scope must be one of: ${FLEET_NOTE_SCOPES.join(', ')}`);
    const store = new FleetStore(this.db, this.userId);
    if (!store.getFleet(fleetId)) throw new AgentError('COPILOT_NOT_FOUND', 'Fleet not found');
    const ref = (refId ?? '').trim();
    if (scope === 'fleet') {
      if (ref) throw invalid('A fleet note takes no refId');
      return '';
    }
    if (scope === 'task') {
      if (!ref || !store.getTask(fleetId, ref)) throw new AgentError('COPILOT_NOT_FOUND', 'A task note needs refId = a task id of this fleet');
      return ref;
    }
    if (!MEMBER_ID.test(ref)) throw invalid('A member note needs refId = a team member id');
    return ref;
  }

  write(fleetId: string, scope: FleetNoteScope, refId: string | undefined, body: string, now = Date.now()): FleetNoteRow {
    const ref = this.resolveRef(fleetId, scope, refId);
    const text = body.trim();
    if (!text || Array.from(text).length > MAX_NOTE_BODY) throw invalid(`A note body must be 1-${MAX_NOTE_BODY} characters`);
    this.db.prepare(`INSERT INTO fleet_notes(id,user_id,fleet_id,scope,ref_id,body,updated_at) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(fleet_id,scope,ref_id) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at
        WHERE fleet_notes.user_id=excluded.user_id`)
      .run(randomUUID(), this.userId, fleetId, scope, ref, text, now);
    return this.get(fleetId, scope, ref)!;
  }

  read(fleetId: string, scope: FleetNoteScope, refId: string | undefined): FleetNoteRow | undefined {
    return this.get(fleetId, scope, this.resolveRef(fleetId, scope, refId));
  }

  /** Every note of the fleet as a short preview (fleet first, then tasks, then members). */
  index(fleetId: string): Array<{ scope: FleetNoteScope; refId: string; preview: string; updatedAt: number }> {
    const rows = this.db.prepare(`SELECT * FROM fleet_notes WHERE user_id=? AND fleet_id=?
        ORDER BY CASE scope WHEN 'fleet' THEN 0 WHEN 'task' THEN 1 ELSE 2 END, updated_at DESC, ref_id`)
      .all(this.userId, fleetId) as FleetNoteRow[];
    return rows.map(row => ({ scope: row.scope, refId: row.ref_id, preview: clipText(row.body, NOTE_PREVIEW_CHARS), updatedAt: row.updated_at }));
  }

  taskNote(fleetId: string, taskId: string, max: number): string | null {
    const row = this.get(fleetId, 'task', taskId);
    return row ? clipText(row.body, max) : null;
  }

  /** The member memo appended to a fleet dispatch (clipped to MEMBER_MEMO_CHARS). */
  memberMemo(fleetId: string, memberId: string): string | undefined {
    const row = this.get(fleetId, 'member', memberId);
    return row ? clipText(row.body, MEMBER_MEMO_CHARS) : undefined;
  }

  /**
   * Append an entry to a task note (the owner's hold answer). When the note
   * would exceed MAX_NOTE_BODY the oldest text is dropped, never the new entry.
   */
  appendTaskNote(fleetId: string, taskId: string, entry: string, now = Date.now()): FleetNoteRow {
    const ref = this.resolveRef(fleetId, 'task', taskId);
    const addition = clipText(entry.trim(), MAX_NOTE_BODY - 1);
    const existing = this.get(fleetId, 'task', ref)?.body;
    const combined = Array.from(existing ? `${existing}\n\n${addition}` : addition);
    const body = combined.length > MAX_NOTE_BODY ? combined.slice(combined.length - MAX_NOTE_BODY).join('') : combined.join('');
    return this.write(fleetId, 'task', ref, body, now);
  }

  private get(fleetId: string, scope: FleetNoteScope, refId: string): FleetNoteRow | undefined {
    return this.db.prepare('SELECT * FROM fleet_notes WHERE user_id=? AND fleet_id=? AND scope=? AND ref_id=?')
      .get(this.userId, fleetId, scope, refId) as FleetNoteRow | undefined;
  }
}
