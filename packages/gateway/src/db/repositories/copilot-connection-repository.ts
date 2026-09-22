import { randomUUID } from 'node:crypto';
import type { Database } from '../types.js';
export interface ConnectionTool { name: string; description: string; inputSchema: Record<string, unknown>; compatible: boolean; unavailableReason: string | null; }
export interface ConnectionRecord {
 id: string; user_id: string; name: string; endpoint: string; credential_encrypted: string | null;
 enabled: number; revision: number; tools_json: string; enabled_tools_json: string; last_discovered_at: number | null;
}
export class CopilotConnectionRepository {
 constructor(private db: Database, private userId: string) {}
 signature(): string { return JSON.stringify(this.db.prepare('SELECT id,revision,enabled FROM copilot_connections WHERE user_id=? ORDER BY id').all(this.userId)); }
 list(): ConnectionRecord[] { return this.db.prepare('SELECT * FROM copilot_connections WHERE user_id=? ORDER BY created_at,id').all(this.userId) as ConnectionRecord[]; }
 get(id: string): ConnectionRecord | undefined { return this.db.prepare('SELECT * FROM copilot_connections WHERE user_id=? AND id=?').get(this.userId,id) as ConnectionRecord | undefined; }
 create(name: string, endpoint: string, encrypted: string | null): ConnectionRecord {
  if (this.list().length >= 20) throw new Error('Connection limit reached');
  const id=randomUUID(), now=Date.now();
  this.db.prepare('INSERT INTO copilot_connections (id,user_id,name,endpoint,credential_encrypted,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(id,this.userId,name,endpoint,encrypted,now,now);
  return this.get(id)!;
 }
 save(id: string, revision: number, next: Pick<ConnectionRecord,'name'|'endpoint'|'credential_encrypted'|'enabled'|'tools_json'|'enabled_tools_json'|'last_discovered_at'>): ConnectionRecord {
  const result=this.db.prepare('UPDATE copilot_connections SET name=?,endpoint=?,credential_encrypted=?,enabled=?,tools_json=?,enabled_tools_json=?,last_discovered_at=?,revision=revision+1,updated_at=? WHERE user_id=? AND id=? AND revision=?').run(next.name,next.endpoint,next.credential_encrypted,next.enabled,next.tools_json,next.enabled_tools_json,next.last_discovered_at,Date.now(),this.userId,id,revision);
  if (!result.changes) throw new Error('Connection changed; reload before saving');
  return this.get(id)!;
 }
 delete(id: string, revision: number): void {
  if (!this.get(id)) return;
  const result=this.db.prepare('DELETE FROM copilot_connections WHERE user_id=? AND id=? AND revision=?').run(this.userId,id,revision);
  if (!result.changes) throw new Error('Connection changed; reload before deleting');
 }
}
