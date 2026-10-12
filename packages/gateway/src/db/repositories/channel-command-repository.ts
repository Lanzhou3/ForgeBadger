import type { Database } from '../types.js';

/** Queries for commands are always constrained to the authorized tenant/conversation. */
export class ChannelCommandRepository {
  constructor(private readonly db: Database, private readonly userId: string) {}

  activeRuns(conversationId: string): {id: string; status: string}[] {
    return this.db.prepare(`WITH RECURSIVE family(id) AS (
      SELECT id FROM copilot_runs WHERE user_id=? AND conversation_id=?
      UNION SELECT j.child_run_id FROM copilot_research_jobs j JOIN family f ON j.origin_run_id=f.id WHERE j.user_id=?
    ) SELECT r.id,r.status FROM copilot_runs r JOIN family f ON f.id=r.id
      WHERE r.user_id=? AND r.status IN ('pending','running','awaiting_approval')`)
      .all(this.userId,conversationId,this.userId,this.userId) as {id:string;status:string}[];
  }

  queuedFollowups(conversationId: string): number {
    return (this.db.prepare("SELECT count(*) n FROM copilot_followups WHERE user_id=? AND conversation_id=? AND status='queued'")
      .get(this.userId,conversationId) as {n:number}).n;
  }

  cancelFollowups(conversationId: string): number {
    return this.db.prepare("UPDATE copilot_followups SET status='cancelled' WHERE user_id=? AND conversation_id=? AND status='queued'")
      .run(this.userId,conversationId).changes;
  }

  hasUnsettledReplies(conversationId: string, excludingInboxId: string): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM channel_messages m WHERE m.user_id=? AND m.conversation_id=? AND m.id<>?
      AND m.status IN ('command','adopted') AND (
        NOT EXISTS (SELECT 1 FROM channel_deliveries d WHERE d.user_id=m.user_id AND d.inbox_id=m.id
          AND d.phase=CASE WHEN m.status='command' THEN 'command' ELSE 'terminal' END)
        OR EXISTS (SELECT 1 FROM channel_deliveries d WHERE d.user_id=m.user_id AND d.inbox_id=m.id AND d.status IN ('pending','sending'))
      ) LIMIT 1`).get(this.userId,conversationId,excludingInboxId));
  }
}
