import { createHash, randomUUID } from 'node:crypto';
import type { Database } from '../types.js';
import { cliSummarySchema, readCliSummary, type CliSummary } from '../../services/notifications/cli-observation.js';

export const MAX_CLI_OBSERVATIONS = 128;
export const CLI_OBSERVATION_RETENTION_MS = 7 * 86400_000;
interface Row { summary_json: string }
export class CliObservationRepository {
  constructor(private readonly db: Database, private readonly userId: string) {}
  /** Server-owned random epoch persists through Gateway reconnects. Token
   * rotation creates a new epoch. The token itself is never stored here. */
  runtime(sessionId: string, attachToken: string): string | undefined {
    if (!this.owns(sessionId)) return;
    const fingerprint = createHash('sha256').update(attachToken).digest('hex');
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT epoch,token_fingerprint FROM cli_observation_runtimes WHERE user_id=? AND session_id=?')
        .get(this.userId, sessionId) as { epoch: string; token_fingerprint: string } | undefined;
      if (row?.token_fingerprint === fingerprint) return row.epoch;
      const epoch = randomUUID();
      this.db.prepare(`INSERT INTO cli_observation_runtimes(user_id,session_id,epoch,token_fingerprint) VALUES(?,?,?,?)
        ON CONFLICT(user_id,session_id) DO UPDATE SET epoch=excluded.epoch,token_fingerprint=excluded.token_fingerprint,
        current_native_session_id=NULL,current_turn_id=NULL`)
        .run(this.userId, sessionId, epoch, fingerprint);
      return epoch;
    })();
  }
  find(sessionId: string, epoch: string, nativeSessionId: string, turnId: string): CliSummary | undefined {
    this.prune(sessionId);
    const row = this.db.prepare(`SELECT summary_json FROM cli_observations WHERE user_id=? AND session_id=?
      AND runtime_epoch=? AND native_session_id=? AND turn_id=?`).get(this.userId, sessionId, epoch, nativeSessionId, turnId) as Row | undefined;
    return this.parse(row);
  }
  save(sessionId: string, input: CliSummary, activate = false): void {
    if (!this.owns(sessionId)) return;
    const summary = cliSummarySchema.parse(input);
    // Unidentified events get unique slots and cannot enrich another event.
    const turn = summary.identityQuality === 'exact_turn' ? summary.turnId! : randomUUID();
    this.db.prepare(`INSERT INTO cli_observations(user_id,session_id,runtime_epoch,native_session_id,turn_id,summary_json,observed_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,session_id,runtime_epoch,native_session_id,turn_id)
      DO UPDATE SET summary_json=excluded.summary_json,observed_at=excluded.observed_at`)
      .run(this.userId, sessionId, summary.runtimeEpoch, summary.nativeSessionId ?? '', turn, JSON.stringify(summary), summary.observedAt);
    if (activate) this.db.prepare(`UPDATE cli_observation_runtimes SET current_native_session_id=?,current_turn_id=?
      WHERE user_id=? AND session_id=? AND epoch=?`).run(summary.nativeSessionId ?? '', turn, this.userId, sessionId, summary.runtimeEpoch);
    this.prune(sessionId);
  }
  latest(sessionId: string): CliSummary | undefined {
    this.prune(sessionId);
    return this.parse(this.db.prepare('SELECT summary_json FROM cli_observations WHERE user_id=? AND session_id=? ORDER BY observed_at DESC,rowid DESC LIMIT 1')
      .get(this.userId, sessionId) as Row | undefined);
  }
  current(sessionId: string, attachToken: string): CliSummary | undefined {
    this.prune(sessionId);
    const fingerprint = createHash('sha256').update(attachToken).digest('hex');
    return this.parse(this.db.prepare(`SELECT o.summary_json FROM cli_observations o JOIN cli_observation_runtimes r
      ON r.user_id=o.user_id AND r.session_id=o.session_id AND r.epoch=o.runtime_epoch
      AND r.current_native_session_id=o.native_session_id AND r.current_turn_id=o.turn_id
      WHERE o.user_id=? AND o.session_id=? AND r.token_fingerprint=? ORDER BY o.observed_at DESC,o.rowid DESC LIMIT 1`)
      .get(this.userId, sessionId, fingerprint) as Row | undefined);
  }
  latestResult(sessionId: string): CliSummary | undefined {
    this.prune(sessionId);
    return this.parse(this.db.prepare(`SELECT summary_json FROM cli_observations WHERE user_id=? AND session_id=?
      AND json_extract(summary_json,'$.endedAt') IS NOT NULL ORDER BY observed_at DESC,rowid DESC LIMIT 1`)
      .get(this.userId, sessionId) as Row | undefined);
  }
  private owns(sessionId: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM sessions WHERE user_id=? AND id=?').get(this.userId, sessionId));
  }
  private parse(row: Row | undefined): CliSummary | undefined {
    try { return row ? readCliSummary(JSON.parse(row.summary_json)) : undefined; } catch { return; }
  }
  private prune(sessionId: string): void {
    this.db.prepare('DELETE FROM cli_observations WHERE user_id=? AND session_id=? AND observed_at<?')
      .run(this.userId, sessionId, Date.now() - CLI_OBSERVATION_RETENTION_MS);
    this.db.prepare(`DELETE FROM cli_observations WHERE user_id=? AND session_id=? AND rowid NOT IN
      (SELECT rowid FROM cli_observations WHERE user_id=? AND session_id=? ORDER BY observed_at DESC,rowid DESC LIMIT ?)`)
      .run(this.userId, sessionId, this.userId, sessionId, MAX_CLI_OBSERVATIONS);
  }
}
