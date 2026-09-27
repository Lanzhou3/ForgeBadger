import type { Database } from '../types.js';

/** Cursor commits are fenced by the same account revision as the active transport. */
export class TelegramCursorRepository {
  constructor(private readonly db: Database, private readonly userId: string, private readonly accountId: string, private readonly revision: number) {}

  load(): number | undefined {
    return (this.db.prepare('SELECT next_offset FROM telegram_polling_cursors WHERE user_id=? AND account_id=? AND account_revision=?')
      .get(this.userId,this.accountId,this.revision) as {next_offset:number}|undefined)?.next_offset;
  }

  save(nextOffset: number): void {
    if (!Number.isSafeInteger(nextOffset) || nextOffset < 0) throw new Error('TELEGRAM_CURSOR_INVALID');
    this.db.transaction(() => {
      const current = this.db.prepare('SELECT 1 FROM telegram_channel_accounts WHERE user_id=? AND id=? AND config_revision=? AND enabled=1')
        .get(this.userId,this.accountId,this.revision);
      if (!current) throw new Error('TELEGRAM_CURSOR_ACCOUNT_STALE');
      this.db.prepare(`INSERT INTO telegram_polling_cursors(user_id,account_id,account_revision,next_offset) VALUES (?,?,?,?)
        ON CONFLICT(user_id,account_id,account_revision) DO UPDATE SET next_offset=MAX(next_offset,excluded.next_offset)`)
        .run(this.userId,this.accountId,this.revision,nextOffset);
    }).immediate();
  }
}
