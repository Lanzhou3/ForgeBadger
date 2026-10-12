import { createHash } from 'node:crypto';
import type { Database } from '../types.js';
import type { SessionStopTarget } from '../../services/session-stop-target.js';

type ObservationMetadata = Omit<SessionStopTarget, 'terminalExcerpt'>;
const operation = 'mcp.session_observation';
export const MCP_OBSERVATION_TTL_MS = 15 * 60000;

/** Durable stop identity only. Terminal output and attach tokens never enter SQLite. */
export class McpSessionObservationRepository {
  constructor(private readonly db: Database, private readonly userId: string, private readonly tokenId: string) {}

  save(target: SessionStopTarget): void {
    const { terminalExcerpt: _excluded, ...metadata } = target;
    const value = JSON.stringify(metadata);
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM copilot_operation_log WHERE user_id=? AND operation=? AND created_at<?')
        .run(this.userId, operation, Date.now() - MCP_OBSERVATION_TTL_MS);
      this.db.prepare(`INSERT INTO copilot_operation_log
        (id,user_id,operation,idempotency_key,payload_digest,result_json,created_at)
        VALUES (?,?,?,?,?,?,?)`).run(target.observationId, this.userId, operation,
          this.key(target.observationId), createHash('sha256').update(value).digest('hex'), value, target.observedAt);
    })();
  }

  get(id: string): { metadata: ObservationMetadata; createdAt: number } | undefined {
    const row = this.db.prepare(`SELECT result_json,created_at FROM copilot_operation_log
      WHERE user_id=? AND operation=? AND id=? AND idempotency_key=?`)
      .get(this.userId, operation, id, this.key(id)) as { result_json: string; created_at: number } | undefined;
    if (!row) return undefined;
    try { return { metadata: JSON.parse(row.result_json) as ObservationMetadata, createdAt: row.created_at }; }
    catch { return undefined; }
  }

  private key(id: string): string { return `mcp-observation:${this.tokenId}:${id}`; }
}
