import type { Database } from '../types.js';
import type { WriterLease } from '../../services/session-writer-leases.js';

/** Workspace exclusivity is global; tenant callers can observe only busy or their own lease. */
export class SessionWriterLeaseRepository {
  constructor(private readonly db: Database, private readonly userId: string) {}

  acquire(workspace: string, sessionId: string, token: string, now: number, ttlMs: number): WriterLease {
    return this.db.transaction(() => {
      const session=this.db.prepare('SELECT project_id FROM sessions WHERE user_id=? AND id=?').get(this.userId,sessionId) as {project_id:string}|undefined;
      if(!session)throw new Error('SESSION_NOT_FOUND');
      const row=this.db.prepare(`INSERT INTO session_writer_leases(workspace,user_id,project_id,session_id,token,fence,expires_at)
        VALUES(?,?,?,?,?,1,?) ON CONFLICT(workspace) DO UPDATE SET user_id=excluded.user_id,
        project_id=excluded.project_id,session_id=excluded.session_id,token=excluded.token,
        fence=session_writer_leases.fence+1,expires_at=excluded.expires_at
        WHERE session_writer_leases.expires_at<=? RETURNING fence,expires_at`).get(
          workspace,this.userId,session.project_id,sessionId,token,now+ttlMs,now
        ) as {fence:number;expires_at:number}|undefined;
      if(!row)throw new Error('SESSION_WRITER_BUSY');
      return {userId:this.userId,sessionId,workspace,token,fence:row.fence,expiresAt:row.expires_at};
    }).immediate();
  }

  assertCurrent(lease: WriterLease, now: number): void {
    const row=this.db.prepare('SELECT 1 FROM session_writer_leases WHERE user_id=? AND workspace=? AND session_id=? AND token=? AND fence=? AND expires_at>?')
      .get(this.userId,lease.workspace,lease.sessionId,lease.token,lease.fence,now);
    if(!row)throw new Error('SESSION_WRITER_FENCE_STALE');
  }

  release(lease: WriterLease): void {
    this.db.prepare('UPDATE session_writer_leases SET token=NULL,expires_at=0 WHERE user_id=? AND workspace=? AND session_id=? AND token=? AND fence=?')
      .run(this.userId,lease.workspace,lease.sessionId,lease.token,lease.fence);
  }

  assertAvailable(workspace: string, now: number): void {
    if(this.db.prepare('SELECT 1 FROM session_writer_leases WHERE workspace=? AND expires_at>?').get(workspace,now))throw new Error('SESSION_WRITER_BUSY');
  }

  takeover(workspace: string, sessionId: string, now: number): void {
    this.db.transaction(()=>{
      const updated=this.db.prepare('UPDATE session_writer_leases SET token=NULL,expires_at=0,fence=fence+1 WHERE user_id=? AND session_id=? AND workspace=?')
        .run(this.userId,sessionId,workspace);
      if(!updated.changes)this.assertAvailable(workspace,now);
    }).immediate();
  }

  revokeSession(sessionId: string): void {
    this.db.prepare('UPDATE session_writer_leases SET token=NULL,expires_at=0,fence=fence+1 WHERE user_id=? AND session_id=?')
      .run(this.userId,sessionId);
  }
}
