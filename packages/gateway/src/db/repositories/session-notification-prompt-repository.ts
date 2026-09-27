import type { Database } from '../types.js';
import { redactAgentText } from '../../services/agent/redaction.js';

export const MAX_SESSION_NOTIFICATION_PROMPTS = 128;
export interface NativePromptIdentity { sessionId: string; turnId?: string }

/** Optional native metadata must never make a lifecycle notification fail. */
export function nativePromptIdentity(sessionId: unknown, turnId: unknown): NativePromptIdentity | undefined {
  const valid = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
  if (!valid(sessionId) || (turnId !== undefined && !valid(turnId))) return undefined;
  return { sessionId, ...(turnId === undefined ? {} : { turnId }) };
}

export function notificationPromptSummary(prompt: string): string {
  const chars = Array.from(redactAgentText(prompt).replace(/\s+/gu, ' ').trim());
  return chars.length > 600 ? chars.slice(0, 599).join('') + '…' : chars.join('');
}

/** Native IDs have meaning only within a tenant-owned ForgeBadger session. */
export class SessionNotificationPromptRepository {
  constructor(private readonly db: Database, private readonly userId: string) {}

  save(sessionId: string, native: NativePromptIdentity, prompt: string): void {
    const summary = notificationPromptSummary(prompt);
    if (!summary) return;
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO session_notification_prompts
        (user_id,session_id,native_session_id,native_turn_id,prompt,created_at)
        SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM sessions WHERE user_id=? AND id=?)
        ON CONFLICT(user_id,session_id,native_session_id,native_turn_id)
        DO UPDATE SET prompt=excluded.prompt,created_at=excluded.created_at`)
        .run(this.userId, sessionId, native.sessionId, native.turnId ?? '', summary, Date.now(), this.userId, sessionId);
      // A bounded per-session history retains interleaved native turns. Evicted
      // long-running turns lose only their summary, never their lifecycle event.
      this.db.prepare(`DELETE FROM session_notification_prompts WHERE user_id=? AND session_id=? AND rowid NOT IN
        (SELECT rowid FROM session_notification_prompts WHERE user_id=? AND session_id=? ORDER BY created_at DESC,rowid DESC LIMIT ?)`)
        .run(this.userId, sessionId, this.userId, sessionId, MAX_SESSION_NOTIFICATION_PROMPTS);
    }).immediate();
  }

  find(sessionId: string, native: NativePromptIdentity): string | undefined {
    const row = this.db.prepare(`SELECT prompt FROM session_notification_prompts
      WHERE user_id=? AND session_id=? AND native_session_id=? AND native_turn_id=?`)
      .get(this.userId, sessionId, native.sessionId, native.turnId ?? '') as { prompt: string } | undefined;
    // Exact key only: a known turn must never fall back to the no-turn record.
    return row ? notificationPromptSummary(row.prompt) : undefined;
  }
}
