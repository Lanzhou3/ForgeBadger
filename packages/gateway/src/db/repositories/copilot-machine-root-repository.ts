import { randomUUID } from 'node:crypto';
import type { Database } from '../types.js';

export interface MachineRoot {
  id: string;
  label: string;
  path: string;
  created_at: number;
}
interface MachineRootRow {
  id: string;
  label: string;
  path: string;
  created_at: number;
}

/**
 * Per-owner registry of local filesystem roots that the read-only
 * `machine_search` tool may traverse. A root is a scope grant, not a project:
 * the platform only reads from it and the row is the tenant boundary that keeps
 * one owner's roots invisible to another. Resolution is by (user_id, id); the
 * canonical `path` is realpath-resolved and root-guarded at registration, so
 * every later read reuses the exact cross-platform-safe guards (symlink
 * lstat, 64 KiB cap) against a single approved directory.
 */
export class CopilotMachineRootRepository {
  constructor(private db: Database, private userId: string) {}

  list(): MachineRoot[] {
    return this.db.prepare('SELECT id,label,path,created_at FROM copilot_machine_roots WHERE user_id=? ORDER BY created_at DESC, path')
      .all(this.userId) as MachineRootRow[];
  }

  getById(id: string): MachineRoot | undefined {
    const row = this.db.prepare('SELECT id,label,path,created_at FROM copilot_machine_roots WHERE user_id=? AND id=?')
      .get(this.userId, id) as MachineRootRow | undefined;
    return row;
  }

  /** Returns null when the user already registered this canonical path. */
  register(label: string, path: string): MachineRoot | null {
    const existing = this.db.prepare('SELECT id FROM copilot_machine_roots WHERE user_id=? AND path=?').get(this.userId, path);
    if (existing) return null;
    const row: MachineRoot = { id: randomUUID(), label, path, created_at: Date.now() };
    this.db.prepare('INSERT INTO copilot_machine_roots(id,user_id,label,path,created_at) VALUES(?,?,?,?,?)')
      .run(row.id, this.userId, row.label, row.path, row.created_at);
    return row;
  }

  unregister(id: string): boolean {
    return this.db.prepare('DELETE FROM copilot_machine_roots WHERE user_id=? AND id=?').run(this.userId, id).changes > 0;
  }
}
