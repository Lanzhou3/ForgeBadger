import { randomUUID } from 'node:crypto';
import type { Database } from '../types.js';

export interface TypingJob {
  inbox_id: string; account_id: string; app_id: string; message_id: string;
  state: 'pending' | 'adding' | 'active' | 'uncertain' | 'done';
  reaction_id: string | null; claim_token: string; attempt_count: number; created_at: number; reconcile_until: number;
}

export class FeishuTypingRepository {
  constructor(private readonly db: Database, private readonly userId: string) {}

  project(): void {
    // Admission is already durable and authorized. Never flash historical backlog.
    this.db.prepare(`INSERT OR IGNORE INTO feishu_typing_reactions
      (user_id,inbox_id,account_id,app_id,message_id,created_at)
      SELECT m.user_id,m.id,m.account_id,a.app_id,m.message_id,m.created_at FROM channel_messages m
      JOIN feishu_channel_accounts a ON a.user_id=m.user_id AND a.id=m.account_id
      WHERE m.user_id=? AND m.created_at>=? AND m.status IN ('pending','adopted')`)
      .run(this.userId, Date.now() - 120_000);
  }

  claim(): TypingJob | undefined {
    return this.db.transaction(() => {
      const now = Date.now();
      this.db.prepare(`UPDATE feishu_typing_reactions SET state='uncertain'
        WHERE user_id=? AND state='adding' AND lease_until<=?`).run(this.userId, now);
      const row = this.db.prepare(`SELECT * FROM feishu_typing_reactions WHERE user_id=? AND state NOT IN ('done','adding')
        AND next_attempt_at<=? AND (claim_token IS NULL OR lease_until<=?) ORDER BY next_attempt_at,created_at LIMIT 1`)
        .get(this.userId, now, now) as TypingJob | undefined;
      if (!row) return undefined;
      const token = randomUUID();
      this.db.prepare(`UPDATE feishu_typing_reactions SET claim_token=?,lease_until=?
        WHERE user_id=? AND inbox_id=?`).run(token, now + 30_000, this.userId, row.inbox_id);
      return { ...row, claim_token: token };
    }).immediate();
  }

  owns(job: TypingJob): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM feishu_typing_reactions
      WHERE user_id=? AND inbox_id=? AND claim_token=? AND lease_until>?`)
      .get(this.userId, job.inbox_id, job.claim_token, Date.now()));
  }

  adding(job: TypingJob): void {
    if (!this.owns(job)) throw new Error('FEISHU_TYPING_CLAIM_LOST');
    job.reconcile_until = Date.now() + 120_000;
    this.db.prepare(`UPDATE feishu_typing_reactions SET state='adding',reconcile_until=?
      WHERE user_id=? AND inbox_id=? AND claim_token=?`).run(job.reconcile_until, this.userId, job.inbox_id, job.claim_token);
  }

  saveReceipt(job: TypingJob, reactionId: string): void {
    // Save a successful POST even if its route was revoked while the request was in flight.
    // A successor that reclaimed the lease reconciles uncertain POSTs through the provider.
    const saved = this.db.prepare(`UPDATE feishu_typing_reactions SET state='active',reaction_id=?
      WHERE user_id=? AND inbox_id=? AND claim_token=?`).run(reactionId, this.userId, job.inbox_id, job.claim_token);
    if (!saved.changes) throw new Error('FEISHU_TYPING_CLAIM_LOST');
    job.reaction_id = reactionId; job.state = 'active';
  }

  release(job: TypingJob, state: TypingJob['state'], delayMs = 1000, failed = false): void {
    this.db.prepare(`UPDATE feishu_typing_reactions SET state=?,claim_token=NULL,lease_until=NULL,
      next_attempt_at=?,attempt_count=attempt_count+? WHERE user_id=? AND inbox_id=? AND claim_token=?`)
      .run(state, Date.now() + delayMs, Number(failed), this.userId, job.inbox_id, job.claim_token);
  }

  ended(job: TypingJob): boolean {
    if (Date.now() - job.created_at > 30 * 60_000) return true;
    const row = this.db.prepare(`SELECT m.status,r.status run_status FROM channel_messages m
      LEFT JOIN copilot_runs r ON r.user_id=m.user_id AND r.id=m.run_id WHERE m.user_id=? AND m.id=?`)
      .get(this.userId, job.inbox_id) as { status: string; run_status: string | null } | undefined;
    if (!row || row.status === 'rejected' || ['failed','cancelled','stopped','indeterminate'].includes(row.run_status ?? '')) return true;
    // Completion alone is not delivery: keep Typing while the final response is queued/retrying.
    return Boolean(this.db.prepare(`SELECT 1 FROM channel_deliveries WHERE user_id=? AND inbox_id=?
      AND status IN ('delivered','failed','unknown','cancelled') LIMIT 1`).get(this.userId, job.inbox_id));
  }

  actorActive(): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM users WHERE id=? AND status='active'").get(this.userId));
  }
}
