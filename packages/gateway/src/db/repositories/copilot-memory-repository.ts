import { randomUUID } from "node:crypto";

import type { Database } from "../types.js";
import { redactCopilotPayload, redactCopilotText } from "../../services/copilot/redaction.js";

export type CopilotMemoryKind = "fact" | "preference" | "decision" | "project_note" | string;
export type CopilotMemoryScope = "global" | "project" | "session" | string;
export type CopilotMemoryItemType = "entry" | "note";

export interface CopilotMemoryEntry {
  id: string;
  userId: string;
  kind: CopilotMemoryKind;
  scope: CopilotMemoryScope;
  projectId: string | null;
  sourceRunId: string | null;
  redactedText: string;
  metadata: Record<string, unknown>;
  createdAt: number | null;
  updatedAt: number | null;
}

export interface CopilotMemoryNote {
  id: string;
  userId: string;
  projectId: string | null;
  sessionId: string | null;
  sourceRunId: string | null;
  redactedText: string;
  metadata: Record<string, unknown>;
  createdAt: number | null;
}

export interface CopilotMemorySearchResult {
  id: string;
  type: CopilotMemoryItemType;
  scope: string;
  projectId: string | null;
  snippet: string;
  rank: number;
}

export interface CreateMemoryEntryInput {
  kind: CopilotMemoryKind;
  scope: CopilotMemoryScope;
  text: string;
  projectId?: string | null;
  sourceRunId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateMemoryNoteInput {
  text: string;
  projectId?: string | null;
  sessionId?: string | null;
  sourceRunId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ListMemoryInput {
  scope?: CopilotMemoryScope;
  projectId?: string | null;
  limit?: number;
}

export interface ListMemoryNotesInput {
  projectId?: string | null;
  sessionId?: string | null;
  limit?: number;
}

export interface SearchMemoryInput {
  query: string;
  scope?: CopilotMemoryScope;
  projectId?: string | null;
  includeNotes?: boolean;
  limit?: number;
}

interface MemoryEntryRow {
  id: string;
  user_id: string;
  kind: string;
  scope: string;
  project_id: string | null;
  source_run_id: string | null;
  redacted_text: string;
  metadata_json: string;
  created_at: number | null;
  updated_at: number | null;
}

interface MemoryNoteRow {
  id: string;
  user_id: string;
  project_id: string | null;
  session_id: string | null;
  source_run_id: string | null;
  redacted_text: string;
  metadata_json: string;
  created_at: number | null;
}

interface MemorySearchRow {
  memory_id: string;
  item_type: CopilotMemoryItemType;
  scope: string;
  project_id: string | null;
  snippet: string | null;
  rank: number;
}

export class CopilotMemoryRepository {
  constructor(private readonly db: Database, private readonly userId: string) {}

  createEntry(input: CreateMemoryEntryInput): CopilotMemoryEntry {
    const id = randomUUID();
    const now = Date.now();
    const redactedText = redactCopilotText(input.text);
    this.db.prepare(`
      INSERT INTO copilot_memory_entries (
        id, user_id, kind, scope, project_id, source_run_id,
        redacted_text, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      this.userId,
      input.kind,
      input.scope,
      input.projectId ?? null,
      input.sourceRunId ?? null,
      redactedText,
      JSON.stringify(redactMetadata(input.metadata)),
      now,
      now
    );
    this.indexMemory({
      id,
      itemType: "entry",
      scope: input.scope,
      projectId: input.projectId ?? null,
      redactedText
    });
    return this.getEntry(id) as CopilotMemoryEntry;
  }

  createNote(input: CreateMemoryNoteInput): CopilotMemoryNote {
    const id = randomUUID();
    const now = Date.now();
    const redactedText = redactCopilotText(input.text);
    this.db.prepare(`
      INSERT INTO copilot_memory_notes (
        id, user_id, project_id, session_id, source_run_id,
        redacted_text, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      this.userId,
      input.projectId ?? null,
      input.sessionId ?? null,
      input.sourceRunId ?? null,
      redactedText,
      JSON.stringify(redactMetadata(input.metadata)),
      now
    );
    this.indexMemory({
      id,
      itemType: "note",
      scope: noteScope(input),
      projectId: input.projectId ?? null,
      redactedText
    });
    return this.getNote(id) as CopilotMemoryNote;
  }

  search(input: SearchMemoryInput): CopilotMemorySearchResult[] {
    const query = toFtsQuery(input.query);
    if (!query) return [];
    const clauses = ["copilot_memory_fts MATCH ?", "user_id = ?"];
    const params: unknown[] = [query, this.userId];
    if (!input.includeNotes) clauses.push("item_type = 'entry'");
    if (input.scope) {
      clauses.push("scope = ?");
      params.push(input.scope);
    }
    if (input.projectId !== undefined) {
      clauses.push(input.projectId === null ? "project_id IS NULL" : "project_id = ?");
      if (input.projectId !== null) params.push(input.projectId);
    }
    params.push(clampLimit(input.limit, 20));
    const rows = this.db.prepare(`
      SELECT
        memory_id,
        item_type,
        scope,
        project_id,
        snippet(copilot_memory_fts, 5, '', '', '...', 16) AS snippet,
        bm25(copilot_memory_fts) AS rank
      FROM copilot_memory_fts
      WHERE ${clauses.join(" AND ")}
      ORDER BY rank ASC
      LIMIT ?
    `).all(...params) as MemorySearchRow[];
    return rows.map(toSearchResult);
  }

  getEntry(id: string): CopilotMemoryEntry | undefined {
    const row = this.db.prepare(`
      SELECT * FROM copilot_memory_entries WHERE id = ? AND user_id = ?
    `).get(id, this.userId) as MemoryEntryRow | undefined;
    return row ? toEntry(row) : undefined;
  }

  getNote(id: string): CopilotMemoryNote | undefined {
    const row = this.db.prepare(`
      SELECT * FROM copilot_memory_notes WHERE id = ? AND user_id = ?
    `).get(id, this.userId) as MemoryNoteRow | undefined;
    return row ? toNote(row) : undefined;
  }

  listEntries(input: ListMemoryInput): CopilotMemoryEntry[] {
    const clauses = ["user_id = ?"];
    const params: unknown[] = [this.userId];
    if (input.scope) {
      clauses.push("scope = ?");
      params.push(input.scope);
    }
    if (input.projectId !== undefined) {
      clauses.push(input.projectId === null ? "project_id IS NULL" : "project_id = ?");
      if (input.projectId !== null) params.push(input.projectId);
    }
    params.push(clampLimit(input.limit, 50));
    const rows = this.db.prepare(`
      SELECT * FROM copilot_memory_entries
      WHERE ${clauses.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT ?
    `).all(...params) as MemoryEntryRow[];
    return rows.map(toEntry);
  }

  listNotes(input: ListMemoryNotesInput): CopilotMemoryNote[] {
    const clauses = ["user_id = ?"];
    const params: unknown[] = [this.userId];
    if (input.projectId !== undefined) {
      clauses.push(input.projectId === null ? "project_id IS NULL" : "project_id = ?");
      if (input.projectId !== null) params.push(input.projectId);
    }
    if (input.sessionId !== undefined) {
      clauses.push(input.sessionId === null ? "session_id IS NULL" : "session_id = ?");
      if (input.sessionId !== null) params.push(input.sessionId);
    }
    params.push(clampLimit(input.limit, 50));
    const rows = this.db.prepare(`
      SELECT * FROM copilot_memory_notes
      WHERE ${clauses.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT ?
    `).all(...params) as MemoryNoteRow[];
    return rows.map(toNote);
  }

  private indexMemory(input: {
    id: string;
    itemType: CopilotMemoryItemType;
    scope: string;
    projectId: string | null;
    redactedText: string;
  }): void {
    this.db.prepare(`
      INSERT INTO copilot_memory_fts (
        memory_id, user_id, item_type, scope, project_id, redacted_text
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(input.id, this.userId, input.itemType, input.scope, input.projectId, input.redactedText);
  }
}

function toEntry(row: MemoryEntryRow): CopilotMemoryEntry {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    scope: row.scope,
    projectId: row.project_id,
    sourceRunId: row.source_run_id,
    redactedText: row.redacted_text,
    metadata: parseRecord(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toNote(row: MemoryNoteRow): CopilotMemoryNote {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    sessionId: row.session_id,
    sourceRunId: row.source_run_id,
    redactedText: row.redacted_text,
    metadata: parseRecord(row.metadata_json),
    createdAt: row.created_at
  };
}

function toSearchResult(row: MemorySearchRow): CopilotMemorySearchResult {
  return {
    id: row.memory_id,
    type: row.item_type,
    scope: row.scope,
    projectId: row.project_id,
    snippet: row.snippet ?? "",
    rank: row.rank
  };
}

function noteScope(input: CreateMemoryNoteInput): string {
  if (input.sessionId) return "session";
  if (input.projectId) return "project";
  return "global";
}

function parseRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function redactMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  const redacted = redactCopilotPayload(metadata ?? {});
  if (!redacted || typeof redacted !== "object" || Array.isArray(redacted)) return {};
  return redacted as Record<string, unknown>;
}

function clampLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.trunc(value), 100));
}

function toFtsQuery(query: string): string {
  const redacted = redactCopilotText(query);
  const terms = redacted.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const unique = [...new Set(terms.map((term) => term.toLowerCase()))].slice(0, 8);
  return unique.map((term) => `"${term.replace(/"/gu, "\"\"")}"`).join(" OR ");
}
