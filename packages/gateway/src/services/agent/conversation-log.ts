/**
 * Durable conversation log for the Copilot harness.
 *
 * An append-only store of conversations, messages, runs, and pending actions.
 * Everything the model sees is logged here, so model-visible history is always
 * reconstructable from the ForgeBadger-owned log. All
 * access is scoped by user_id; message sequences are monotonically increasing
 * per conversation.
 */
import { randomUUID } from "node:crypto";
import type { Database } from "../../db/types.js";
import type {
  AgentMessage,
  AgentPendingAction,
  AgentRun,
  AgentRunStatus
} from "./types.js";
import { redactAgentText } from "./redaction.js";

interface ConversationRow {
  id: string;
  user_id: string;
  title: string | null;
  status: string;
  summary: string | null;
  summary_covered_sequence: number | null;
  last_summary_at: number | null;
  created_at: number;
  updated_at: number;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  user_id: string;
  role: string;
  kind: string;
  content: string;
  tool_name: string | null;
  tool_input_json: string | null;
  tool_call_id: string | null;
  sequence: number;
  created_at: number;
}

interface RunRow {
  id: string;
  conversation_id: string;
  user_id: string;
  status: string;
  provider: string | null;
  model: string | null;
  steps: number;
  error: string | null;
  started_at: number | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
}

interface PendingActionRow {
  id: string;
  run_id: string;
  user_id: string;
  tool: string;
  input_json: string;
  input_digest: string;
  status: string;
  created_at: number;
  decided_at: number | null;
  updated_at: number;
}

export class CopilotConversationLog {
  readonly userId: string;
  constructor(private readonly db: Database, userId: string) {
    this.userId = userId;
  }

  createConversation(title?: string): { id: string; title: string | null } {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO copilot_conversations (id, user_id, title, status, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?)
    `).run(id, this.userId, title ?? null, now, now);
    return { id, title: title ?? null };
  }

  listConversations(): ConversationRow[] {
    return this.db.prepare(`
      SELECT * FROM copilot_conversations WHERE user_id = ? ORDER BY updated_at DESC
    `).all(this.userId) as ConversationRow[];
  }

  getConversation(id: string): ConversationRow | undefined {
    return this.db.prepare(`SELECT * FROM copilot_conversations WHERE id = ? AND user_id = ?`).get(id, this.userId) as ConversationRow | undefined;
  }

  /** Persist the rolling context-compression summary up to a message sequence. */
  updateConversationSummary(id: string, input: { summary: string; coveredSequence: number }): boolean {
    const result = this.db.prepare(`
      UPDATE copilot_conversations
      SET summary = ?, summary_covered_sequence = ?, last_summary_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(input.summary, input.coveredSequence, Date.now(), Date.now(), id, this.userId);
    return result.changes > 0;
  }

  renameConversation(id: string, title: string): boolean {
    const result = this.db.prepare(`UPDATE copilot_conversations SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
      .run(title, Date.now(), id, this.userId);
    return result.changes > 0;
  }

  deleteConversation(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM copilot_conversations WHERE id = ? AND user_id = ?`).run(id, this.userId);
    return result.changes > 0;
  }

  /**
   * Edit a message: rewrite its content in place and drop everything recorded
   * after it (later messages, runs, pending actions). When `newContent` is
   * omitted the edit target's row is removed along with its descendants.
   * Returns the target's sequence, or undefined when the message does not
   * belong to this user. The caller is responsible for starting a new run.
   */
  truncateAfterMessage(messageId: string, newContent?: string): { sequence: number } | undefined {
    const row = this.db.prepare(`SELECT sequence, created_at, conversation_id FROM copilot_messages WHERE id = ? AND user_id = ?`)
      .get(messageId, this.userId) as { sequence: number; created_at: number; conversation_id: string } | undefined;
    if (!row) return undefined;
    // Drop runs (and via FK their pending_actions) that were created at or
    // after the edit target — their messages are about to disappear.
    this.db.prepare(`DELETE FROM copilot_runs WHERE user_id = ? AND conversation_id = ? AND created_at >= ?`)
      .run(this.userId, row.conversation_id, row.created_at);
    if (newContent !== undefined) {
      this.db.prepare(`UPDATE copilot_messages SET content = ? WHERE id = ? AND user_id = ?`)
        .run(redactAgentText(newContent), messageId, this.userId);
      this.db.prepare(`DELETE FROM copilot_messages WHERE user_id = ? AND conversation_id = ? AND sequence > ?`)
        .run(this.userId, row.conversation_id, row.sequence);
    } else {
      this.db.prepare(`DELETE FROM copilot_messages WHERE user_id = ? AND conversation_id = ? AND sequence >= ?`)
        .run(this.userId, row.conversation_id, row.sequence);
    }
    return { sequence: row.sequence };
  }

  appendMessage(conversationId: string, input: {
    role: AgentMessage["role"];
    kind: AgentMessage["kind"];
    content: string;
    toolName?: string;
    toolInputJson?: string;
    toolCallId?: string;
  }): AgentMessage {
    const nextSequence = this.nextSequence(conversationId);
    const id = randomUUID();
    const now = Date.now();
    const content = redactAgentText(input.content);
    this.db.prepare(`
      INSERT INTO copilot_messages (id, conversation_id, user_id, role, kind, content, tool_name, tool_input_json, tool_call_id, sequence, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, conversationId, this.userId, input.role, input.kind, content, input.toolName ?? null, input.toolInputJson ?? null, input.toolCallId ?? null, nextSequence, now);
    this.touchConversation(conversationId);
    return {
      id,
      conversationId,
      userId: this.userId,
      role: input.role,
      kind: input.kind,
      content,
      ...(input.toolName !== undefined ? { toolName: input.toolName } : {}),
      ...(input.toolInputJson !== undefined ? { toolInputJson: input.toolInputJson } : {}),
      ...(input.toolCallId !== undefined ? { toolCallId: input.toolCallId } : {}),
      sequence: nextSequence,
      createdAt: new Date(now)
    };
  }

  listMessages(conversationId: string): AgentMessage[] {
    const rows = this.db.prepare(`
      SELECT * FROM copilot_messages WHERE conversation_id = ? AND user_id = ? ORDER BY sequence ASC
    `).all(conversationId, this.userId) as MessageRow[];
    return rows.map(toMessage);
  }

  createRun(conversationId: string, input: { provider?: string; model?: string }): AgentRun {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO copilot_runs (id, conversation_id, user_id, status, provider, model, steps, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', ?, ?, 0, ?, ?)
    `).run(id, conversationId, this.userId, input.provider ?? null, input.model ?? null, now, now);
    return this.getRun(id)!;
  }

  getRun(id: string): AgentRun | undefined {
    const row = this.db.prepare(`SELECT * FROM copilot_runs WHERE id = ? AND user_id = ?`).get(id, this.userId) as RunRow | undefined;
    return row ? toRun(row) : undefined;
  }

  listRuns(conversationId: string): AgentRun[] {
    const rows = this.db.prepare(`
      SELECT * FROM copilot_runs WHERE conversation_id = ? AND user_id = ? ORDER BY created_at DESC
    `).all(conversationId, this.userId) as RunRow[];
    return rows.map(toRun);
  }

  updateRun(id: string, input: { status?: AgentRunStatus; error?: string; steps?: number; startedAt?: Date; completedAt?: Date }): AgentRun | undefined {
    const existing = this.getRun(id);
    if (!existing) return undefined;
    const now = Date.now();
    this.db.prepare(`
      UPDATE copilot_runs
      SET status = ?, error = ?, steps = ?, started_at = ?, completed_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(
      input.status ?? existing.status,
      input.error !== undefined ? input.error : existing.error,
      input.steps ?? existing.steps,
      input.startedAt ? input.startedAt.getTime() : existing.startedAt ? existing.startedAt.getTime() : null,
      input.completedAt ? input.completedAt.getTime() : existing.completedAt ? existing.completedAt.getTime() : null,
      now,
      id,
      this.userId
    );
    return this.getRun(id);
  }

  createPendingAction(input: { runId: string; tool: string; inputJson: string; inputDigest: string }): AgentPendingAction {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO copilot_pending_actions (id, run_id, user_id, tool, input_json, input_digest, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(id, input.runId, this.userId, input.tool, input.inputJson, input.inputDigest, now, now);
    return this.getPendingAction(id)!;
  }

  getPendingAction(id: string): AgentPendingAction | undefined {
    const row = this.db.prepare(`SELECT * FROM copilot_pending_actions WHERE id = ? AND user_id = ?`).get(id, this.userId) as PendingActionRow | undefined;
    return row ? toPendingAction(row) : undefined;
  }

  listPendingActions(runId: string): AgentPendingAction[] {
    const rows = this.db.prepare(`
      SELECT * FROM copilot_pending_actions WHERE run_id = ? AND user_id = ? ORDER BY created_at ASC
    `).all(runId, this.userId) as PendingActionRow[];
    return rows.map(toPendingAction);
  }

  decidePendingAction(id: string, decision: "approved" | "rejected"): AgentPendingAction | undefined {
    const existing = this.getPendingAction(id);
    if (!existing || existing.status !== "pending") return undefined;
    const now = Date.now();
    this.db.prepare(`
      UPDATE copilot_pending_actions SET status = ?, decided_at = ?, updated_at = ? WHERE id = ? AND user_id = ?
    `).run(decision, now, now, id, this.userId);
    return this.getPendingAction(id);
  }

  private nextSequence(conversationId: string): number {
    const row = this.db.prepare(`SELECT MAX(sequence) AS seq FROM copilot_messages WHERE conversation_id = ? AND user_id = ?`)
      .get(conversationId, this.userId) as { seq: number | null };
    return (row.seq ?? 0) + 1;
  }

  private touchConversation(conversationId: string): void {
    this.db.prepare(`UPDATE copilot_conversations SET updated_at = ? WHERE id = ? AND user_id = ?`)
      .run(Date.now(), conversationId, this.userId);
  }
}

function toMessage(row: MessageRow): AgentMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    role: row.role as AgentMessage["role"],
    kind: row.kind as AgentMessage["kind"],
    content: row.content,
    ...(row.tool_name !== null ? { toolName: row.tool_name } : {}),
    ...(row.tool_input_json !== null ? { toolInputJson: row.tool_input_json } : {}),
    ...(row.tool_call_id !== null ? { toolCallId: row.tool_call_id } : {}),
    sequence: row.sequence,
    createdAt: new Date(row.created_at)
  };
}

function toRun(row: RunRow): AgentRun {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    status: row.status as AgentRunStatus,
    ...(row.provider !== null ? { provider: row.provider } : {}),
    ...(row.model !== null ? { model: row.model } : {}),
    steps: row.steps,
    ...(row.error !== null ? { error: row.error } : {}),
    ...(row.started_at !== null ? { startedAt: new Date(row.started_at) } : {}),
    ...(row.completed_at !== null ? { completedAt: new Date(row.completed_at) } : {}),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

function toPendingAction(row: PendingActionRow): AgentPendingAction {
  return {
    id: row.id,
    runId: row.run_id,
    userId: row.user_id,
    tool: row.tool,
    inputJson: row.input_json,
    inputDigest: row.input_digest,
    status: row.status as AgentPendingAction["status"],
    createdAt: new Date(row.created_at),
    ...(row.decided_at !== null ? { decidedAt: new Date(row.decided_at) } : {}),
    updatedAt: new Date(row.updated_at)
  };
}
