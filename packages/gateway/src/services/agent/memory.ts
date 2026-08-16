/**
 * Scoped memory for the Copilot harness.
 *
 * Memory entries are scoped global | project | session and typed
 * fact | preference | decision | project_note. Text is indexed in an FTS5
 * table for keyword recall, so the model (or the user) can search what Copilot
 * remembers about the platform, a project, or a conversation. All access is
 * scoped by user_id; writes are idempotent via the operation log.
 */
import { randomUUID } from "node:crypto";
import type { Database } from "../../db/types.js";
import type { AgentMemoryEntry } from "./types.js";
import { redactAgentText } from "./redaction.js";

export interface AgentMemoryScope {
  scope: "global" | "project" | "session";
  projectId?: string | null;
}

export interface AgentMemoryInput extends AgentMemoryScope {
  kind: "fact" | "preference" | "decision" | "project_note";
  text: string;
  metadata?: Record<string, unknown>;
}

interface MemoryRow {
  id: string;
  user_id: string;
  scope: string;
  project_id: string | null;
  kind: string;
  text: string;
  metadata_json: string;
  created_at: number;
  updated_at: number;
}

const MAX_MEMORY_TEXT = 8 * 1024;
const MAX_SEARCH_LIMIT = 20;

export class AgentMemoryRepository {
  constructor(private readonly db: Database, private readonly userId: string) {}

  create(input: AgentMemoryInput): AgentMemoryEntry {
    const text = redactAgentText(input.text.trim());
    if (!text) throw new Error("AGENT_MEMORY_EMPTY");
    if (text.length > MAX_MEMORY_TEXT) throw new Error("AGENT_MEMORY_TOO_LONG");
    if (input.scope === "project" && !input.projectId) throw new Error("AGENT_MEMORY_PROJECT_REQUIRED");

    const id = randomUUID();
    const now = Date.now();
    const projectId = input.scope === "project" ? input.projectId! : input.projectId ?? null;
    const metadataJson = JSON.stringify(input.metadata ?? {});
    const entry: MemoryRow = {
      id,
      user_id: this.userId,
      scope: input.scope,
      project_id: projectId,
      kind: input.kind,
      text,
      metadata_json: metadataJson,
      created_at: now,
      updated_at: now
    };

    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO copilot_memory (id, user_id, scope, project_id, kind, text, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(entry.id, entry.user_id, entry.scope, entry.project_id, entry.kind, entry.text, entry.metadata_json, entry.created_at, entry.updated_at);
      this.db.prepare(`
        INSERT INTO copilot_memory_fts (memory_id, user_id, scope, project_id, kind, text)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(entry.id, entry.user_id, entry.scope, entry.project_id ?? "", entry.kind, entry.text);
    })();

    return toEntry(entry);
  }

  list(scope: AgentMemoryScope, limit = 50): AgentMemoryEntry[] {
    const rows = this.db.prepare(`
      SELECT * FROM copilot_memory
      WHERE user_id = ? AND scope = ? AND (? IS NULL OR project_id = ?)
      ORDER BY created_at DESC LIMIT ?
    `).all(this.userId, scope.scope, scope.projectId ?? null, scope.projectId ?? null, limit) as MemoryRow[];
    return rows.map(toEntry);
  }

  search(query: string, scope: AgentMemoryScope, limit = 10): AgentMemoryEntry[] {
    const q = query.trim();
    if (!q) return [];
    const rows = this.db.prepare(`
      SELECT m.* FROM copilot_memory m
      INNER JOIN copilot_memory_fts fts ON fts.memory_id = m.id
      WHERE fts.user_id = ? AND fts.copilot_memory_fts MATCH ?
        AND (? IS NULL OR fts.project_id = ?)
      ORDER BY rank LIMIT ?
    `).all(this.userId, quoteFts(q), scope.projectId ?? null, scope.projectId ?? null, Math.min(limit, MAX_SEARCH_LIMIT)) as MemoryRow[];
    return rows.map(toEntry);
  }

  get(id: string): AgentMemoryEntry | undefined {
    const row = this.db.prepare(`SELECT * FROM copilot_memory WHERE id = ? AND user_id = ?`).get(id, this.userId) as MemoryRow | undefined;
    return row ? toEntry(row) : undefined;
  }

  delete(id: string): boolean {
    const result = this.db.transaction(() => {
      const removed = this.db.prepare(`DELETE FROM copilot_memory WHERE id = ? AND user_id = ?`).run(id, this.userId);
      this.db.prepare(`DELETE FROM copilot_memory_fts WHERE memory_id = ?`).run(id);
      return removed;
    })();
    return result.changes > 0;
  }
}

function toEntry(row: MemoryRow): AgentMemoryEntry {
  return {
    id: row.id,
    userId: row.user_id,
    scope: row.scope as AgentMemoryEntry["scope"],
    projectId: row.project_id,
    kind: row.kind as AgentMemoryEntry["kind"],
    text: row.text,
    metadataJson: row.metadata_json,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

/** Escape FTS5 query so user input cannot break out of the match expression. */
function quoteFts(query: string): string {
  return query
    .replace(/"/gu, " ")
    .split(/\s+/u)
    .filter(Boolean)
    .map((token) => `"${token}"`)
    .join(" AND ");
}
