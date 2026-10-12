import type { Database } from '../../db/types.js';
import { memoryTokens, MEMORY_TOKENIZER_VERSION } from './recall-query.js';
import { AgentError } from './types.js';

interface IndexScope { scope: string; projectId?: string | null; conversationId?: string | null }
interface IndexEntry { id: string; user_id: string; scope: string; project_id: string | null; kind: string; text: string }
// At most 64 × 8,192 UTF-16 code units per transaction, not a retrieval cutoff.
export const MEMORY_INDEX_BATCH_SIZE = 64;
export const MAX_MEMORY_CHARACTERS = 8 * 1024;

export class MemorySearchIndex {
  constructor(private db: Database, private userId: string) {}

  /** Caller owns the transaction containing the corresponding memory write. */
  write(entry: IndexEntry): void {
    if (entry.user_id !== this.userId) throw new Error('AGENT_MEMORY_INDEX_OWNER');
    if (entry.text.length > MAX_MEMORY_CHARACTERS) throw new Error('AGENT_MEMORY_INDEX_DOCUMENT_TOO_LONG');
    const tokens = memoryTokens(entry.text).join(' ');
    this.db.prepare('DELETE FROM copilot_memory_fts WHERE user_id=? AND memory_id=?').run(this.userId, entry.id);
    this.db.prepare('INSERT INTO copilot_memory_fts(memory_id,user_id,scope,project_id,kind,text) VALUES(?,?,?,?,?,?)')
      .run(entry.id, this.userId, entry.scope, entry.project_id ?? '', entry.kind, tokens);
    this.db.prepare(`INSERT INTO copilot_memory_search_index(user_id,memory_id,version) VALUES(?,?,?)
      ON CONFLICT(user_id,memory_id) DO UPDATE SET version=excluded.version`)
      .run(this.userId, entry.id, MEMORY_TOKENIZER_VERSION);
  }

  /** Missing/outdated markers are durable work items; no in-memory cursor needed. */
  rebuildBatch(scopes?: readonly IndexScope[]): boolean {
    return this.db.transaction(() => {
      const rows = this.pending(scopes, MEMORY_INDEX_BATCH_SIZE + 1);
      for (const row of rows.slice(0, MEMORY_INDEX_BATCH_SIZE)) this.write(row);
      return rows.length <= MEMORY_INDEX_BATCH_SIZE;
    }).immediate();
  }

  /** Persist rebuild progress first, then pin readiness and all query reads to
   * one snapshot. Peer invalidation must not turn a ready search into false empty. */
  withReadySnapshot<T>(scopes: readonly IndexScope[], read: () => T): T {
    if (!this.rebuildBatch(scopes)) throw indexBuilding();
    return this.db.transaction(() => {
      if (this.pending(scopes, 1).length) throw indexBuilding();
      return read();
    }).deferred();
  }

  private pending(scopes: readonly IndexScope[] | undefined, limit: number): IndexEntry[] {
    const scopeJson = scopes === undefined ? null : JSON.stringify(scopes);
    return this.db.prepare(`SELECT m.* FROM copilot_memory m
      LEFT JOIN copilot_memory_search_index i ON i.user_id=m.user_id AND i.memory_id=m.id
      WHERE m.user_id=? AND (i.version IS NULL OR i.version<>?)
        AND (? IS NULL OR EXISTS(SELECT 1 FROM json_each(?) s
          WHERE m.scope=json_extract(s.value,'$.scope')
            AND m.project_id IS json_extract(s.value,'$.projectId')
            AND m.conversation_id IS json_extract(s.value,'$.conversationId')))
      ORDER BY m.id LIMIT ?`)
      .all(this.userId, MEMORY_TOKENIZER_VERSION, scopeJson, scopeJson, limit) as IndexEntry[];
  }
}

function indexBuilding(): AgentError {
  return new AgentError('AGENT_MEMORY_INDEX_BUILDING',
    'AGENT_MEMORY_INDEX_BUILDING: memory search index is rebuilding; retry shortly.');
}
