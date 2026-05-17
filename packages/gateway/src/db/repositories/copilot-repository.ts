import { randomUUID } from "node:crypto";

import type { Database } from "../types.js";

export type CopilotRunStatus =
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "completed"
  | "failed"
  | "cancelled";

export interface CopilotRun {
  id: string;
  userId: string;
  status: CopilotRunStatus | string;
  providerProfileId: string | null;
  providerProfileName: string | null;
  modelProfileId: string | null;
  modelProfileName: string | null;
  source: string;
  sourceRefId: string | null;
  goal: string;
  stepCount: number;
  maxSteps: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  completedAt: number | null;
}

export interface CopilotRunEvent {
  id: string;
  userId: string;
  runId: string;
  type: string;
  sequence: number;
  message: string | null;
  payload: Record<string, unknown>;
  createdAt: number | null;
}

export interface CopilotPendingAction {
  id: string;
  userId: string;
  runId: string;
  type: string;
  status: string;
  input: Record<string, unknown>;
  result: Record<string, unknown> | null;
  approvedBy: string | null;
  approvedAt: number | null;
  createdAt: number | null;
  updatedAt: number | null;
}

export interface CopilotConversation {
  id: string;
  userId: string;
  title: string;
  source: string;
  sourceRefId: string | null;
  status: string;
  createdAt: number | null;
  updatedAt: number | null;
  lastMessageAt: number | null;
  deletedAt: number | null;
}

export interface CopilotMessage {
  id: string;
  userId: string;
  conversationId: string;
  runId: string | null;
  role: "user" | "assistant" | "system" | string;
  content: string;
  payload: Record<string, unknown>;
  createdAt: number | null;
  deletedAt: number | null;
}

export interface CreateCopilotRunInput {
  status?: CopilotRunStatus | string;
  providerProfileId?: string | null;
  modelProfileId?: string | null;
  source: string;
  sourceRefId?: string | null;
  goal: string;
  maxSteps?: number;
}

export interface UpdateCopilotRunInput {
  status?: CopilotRunStatus | string;
  providerProfileId?: string | null;
  modelProfileId?: string | null;
  stepCount?: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  completedAt?: number | null;
}

export interface CreateCopilotRunEventInput {
  type: string;
  message?: string | null;
  payload?: Record<string, unknown>;
}

export interface CreatePendingActionInput {
  type: string;
  input?: Record<string, unknown>;
}

export interface UpdatePendingActionInput {
  status?: string;
  result?: Record<string, unknown> | null;
  approvedBy?: string | null;
  approvedAt?: number | null;
}

export interface CreateCopilotConversationInput {
  title: string;
  source: string;
  sourceRefId?: string | null;
}

export interface UpdateCopilotConversationInput {
  title?: string;
}

export interface CreateCopilotMessageInput {
  role: "user" | "assistant" | "system" | string;
  content: string;
  runId?: string | null;
  payload?: Record<string, unknown>;
}

interface CopilotRunRow {
  id: string;
  user_id: string;
  status: string;
  provider_profile_id: string | null;
  provider_profile_name: string | null;
  model_profile_id: string | null;
  model_profile_name: string | null;
  source: string;
  source_ref_id: string | null;
  goal: string;
  step_count: number;
  max_steps: number;
  error_code: string | null;
  error_message: string | null;
  created_at: number | null;
  updated_at: number | null;
  completed_at: number | null;
}

interface CopilotRunEventRow {
  id: string;
  user_id: string;
  run_id: string;
  type: string;
  sequence: number;
  message: string | null;
  payload_json: string;
  created_at: number | null;
}

interface CopilotPendingActionRow {
  id: string;
  user_id: string;
  run_id: string;
  type: string;
  status: string;
  input_json: string;
  result_json: string | null;
  approved_by: string | null;
  approved_at: number | null;
  created_at: number | null;
  updated_at: number | null;
}

interface CopilotConversationRow {
  id: string;
  user_id: string;
  title: string;
  source: string;
  source_ref_id: string | null;
  status: string;
  created_at: number | null;
  updated_at: number | null;
  last_message_at: number | null;
  deleted_at: number | null;
}

interface CopilotMessageRow {
  id: string;
  user_id: string;
  conversation_id: string;
  run_id: string | null;
  role: string;
  content: string;
  payload_json: string;
  created_at: number | null;
  deleted_at: number | null;
}

export class CopilotRepository {
  constructor(private readonly db: Database, private readonly userId: string) {}

  createConversation(input: CreateCopilotConversationInput): CopilotConversation {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO copilot_conversations (
        id, user_id, title, source, source_ref_id, status, created_at, updated_at, last_message_at
      ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(
      id,
      this.userId,
      input.title.trim(),
      input.source,
      input.sourceRefId ?? null,
      now,
      now,
      now
    );
    return this.getConversation(id) as CopilotConversation;
  }

  listConversations(limit = 50): CopilotConversation[] {
    const rows = this.db.prepare(`
      SELECT * FROM copilot_conversations
      WHERE user_id = ? AND deleted_at IS NULL
      ORDER BY coalesce(last_message_at, updated_at, created_at) DESC
      LIMIT ?
    `).all(this.userId, clampLimit(limit)) as CopilotConversationRow[];
    return rows.map(toConversation);
  }

  getConversation(id: string): CopilotConversation | undefined {
    const row = this.db.prepare(`
      SELECT * FROM copilot_conversations
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL
    `).get(id, this.userId) as CopilotConversationRow | undefined;
    return row ? toConversation(row) : undefined;
  }

  updateConversation(id: string, input: UpdateCopilotConversationInput): CopilotConversation | undefined {
    const existing = this.getConversation(id);
    if (!existing) return undefined;
    this.db.prepare(`
      UPDATE copilot_conversations
      SET title = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL
    `).run(
      input.title?.trim() || existing.title,
      Date.now(),
      id,
      this.userId
    );
    return this.getConversation(id);
  }

  deleteConversation(id: string): CopilotConversation | undefined {
    const existing = this.getConversation(id);
    if (!existing) return undefined;
    const now = Date.now();
    this.db.prepare(`
      UPDATE copilot_conversations
      SET deleted_at = ?, updated_at = ?, status = 'deleted'
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL
    `).run(now, now, id, this.userId);
    this.db.prepare(`
      UPDATE copilot_messages
      SET deleted_at = ?
      WHERE conversation_id = ? AND user_id = ? AND deleted_at IS NULL
    `).run(now, id, this.userId);
    return { ...existing, status: "deleted", updatedAt: now, deletedAt: now };
  }

  createConversationMessage(conversationId: string, input: CreateCopilotMessageInput): CopilotMessage {
    if (!this.getConversation(conversationId)) throw new Error("Copilot conversation not found");
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO copilot_messages (
        id, user_id, conversation_id, run_id, role, content, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      this.userId,
      conversationId,
      input.runId ?? null,
      input.role,
      input.content,
      JSON.stringify(input.payload ?? {}),
      now
    );
    this.db.prepare(`
      UPDATE copilot_conversations
      SET last_message_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL
    `).run(now, now, conversationId, this.userId);
    return this.getConversationMessage(id) as CopilotMessage;
  }

  listConversationMessages(conversationId: string): CopilotMessage[] {
    if (!this.getConversation(conversationId)) return [];
    const rows = this.db.prepare(`
      SELECT * FROM copilot_messages
      WHERE conversation_id = ? AND user_id = ? AND deleted_at IS NULL
      ORDER BY created_at ASC
    `).all(conversationId, this.userId) as CopilotMessageRow[];
    return rows.map(toMessage);
  }

  findConversationIdByRunId(runId: string): string | undefined {
    const row = this.db.prepare(`
      SELECT cm.conversation_id
      FROM copilot_messages cm
      INNER JOIN copilot_conversations cc
        ON cc.id = cm.conversation_id
        AND cc.user_id = cm.user_id
        AND cc.deleted_at IS NULL
      WHERE cm.run_id = ?
        AND cm.user_id = ?
        AND cm.deleted_at IS NULL
      ORDER BY cm.created_at DESC
      LIMIT 1
    `).get(runId, this.userId) as { conversation_id: string } | undefined;
    return row?.conversation_id;
  }

  deleteConversationMessage(id: string): CopilotMessage | undefined {
    const existing = this.getConversationMessage(id);
    if (!existing || existing.deletedAt !== null) return undefined;
    const now = Date.now();
    this.db.prepare(`
      UPDATE copilot_messages
      SET deleted_at = ?
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL
    `).run(now, id, this.userId);
    return { ...existing, deletedAt: now };
  }

  createRun(input: CreateCopilotRunInput): CopilotRun {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO copilot_runs (
        id, user_id, status, provider_profile_id, model_profile_id, source,
        source_ref_id, goal, step_count, max_steps, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(
      id,
      this.userId,
      input.status ?? "queued",
      input.providerProfileId ?? null,
      input.modelProfileId ?? null,
      input.source,
      input.sourceRefId ?? null,
      input.goal,
      input.maxSteps ?? 8,
      now,
      now
    );
    return this.getRun(id) as CopilotRun;
  }

  getRun(id: string): CopilotRun | undefined {
    const row = this.db.prepare(`
      ${copilotRunSelectSql()}
      WHERE cr.id = ? AND cr.user_id = ?
    `).get(id, this.userId) as CopilotRunRow | undefined;
    return row ? toRun(row) : undefined;
  }

  listRuns(limit = 50): CopilotRun[] {
    const rows = this.db.prepare(`
      ${copilotRunSelectSql()}
      WHERE cr.user_id = ?
      ORDER BY cr.created_at DESC
      LIMIT ?
    `).all(this.userId, clampLimit(limit)) as CopilotRunRow[];
    return rows.map(toRun);
  }

  updateRun(id: string, input: UpdateCopilotRunInput): CopilotRun | undefined {
    const existing = this.getRun(id);
    if (!existing) return undefined;
    this.db.prepare(`
      UPDATE copilot_runs
      SET status = ?, provider_profile_id = ?, model_profile_id = ?,
        step_count = ?, error_code = ?, error_message = ?,
        completed_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(
      input.status ?? existing.status,
      input.providerProfileId === undefined ? existing.providerProfileId : input.providerProfileId,
      input.modelProfileId === undefined ? existing.modelProfileId : input.modelProfileId,
      input.stepCount ?? existing.stepCount,
      input.errorCode === undefined ? existing.errorCode : input.errorCode,
      input.errorMessage === undefined ? existing.errorMessage : input.errorMessage,
      input.completedAt === undefined ? existing.completedAt : input.completedAt,
      Date.now(),
      id,
      this.userId
    );
    return this.getRun(id);
  }

  updateRunIfStatus(
    id: string,
    expectedStatus: string,
    input: UpdateCopilotRunInput
  ): CopilotRun | undefined {
    const existing = this.getRun(id);
    if (!existing) return undefined;
    this.db.prepare(`
      UPDATE copilot_runs
      SET status = ?, provider_profile_id = ?, model_profile_id = ?,
        step_count = ?, error_code = ?, error_message = ?,
        completed_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND status = ?
    `).run(
      input.status ?? existing.status,
      input.providerProfileId === undefined ? existing.providerProfileId : input.providerProfileId,
      input.modelProfileId === undefined ? existing.modelProfileId : input.modelProfileId,
      input.stepCount ?? existing.stepCount,
      input.errorCode === undefined ? existing.errorCode : input.errorCode,
      input.errorMessage === undefined ? existing.errorMessage : input.errorMessage,
      input.completedAt === undefined ? existing.completedAt : input.completedAt,
      Date.now(),
      id,
      this.userId,
      expectedStatus
    );
    return this.getRun(id);
  }

  addEvent(runId: string, input: CreateCopilotRunEventInput): CopilotRunEvent {
    if (!this.getRun(runId)) throw new Error("Copilot run not found");
    const id = randomUUID();
    const sequence = this.nextSequence(runId);
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO copilot_run_events (
        id, user_id, run_id, type, sequence, message, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      this.userId,
      runId,
      input.type,
      sequence,
      input.message ?? null,
      JSON.stringify(input.payload ?? {}),
      now
    );
    this.db.prepare(`
      UPDATE copilot_runs
      SET step_count = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(
      sequence,
      now,
      runId,
      this.userId
    );
    return this.getEvent(id) as CopilotRunEvent;
  }

  listEvents(runId: string): CopilotRunEvent[] {
    if (!this.getRun(runId)) return [];
    const rows = this.db.prepare(`
      SELECT * FROM copilot_run_events
      WHERE user_id = ? AND run_id = ?
      ORDER BY sequence ASC
    `).all(this.userId, runId) as CopilotRunEventRow[];
    return rows.map(toEvent);
  }

  listPendingActions(runId: string): CopilotPendingAction[] {
    if (!this.getRun(runId)) return [];
    const rows = this.db.prepare(`
      SELECT * FROM copilot_pending_actions
      WHERE user_id = ? AND run_id = ?
      ORDER BY created_at ASC
    `).all(this.userId, runId) as CopilotPendingActionRow[];
    return rows.map(toPendingAction);
  }

  createPendingAction(runId: string, input: CreatePendingActionInput): CopilotPendingAction {
    if (!this.getRun(runId)) throw new Error("Copilot run not found");
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO copilot_pending_actions (
        id, user_id, run_id, type, status, input_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(id, this.userId, runId, input.type, JSON.stringify(input.input ?? {}), now, now);
    return this.getPendingAction(id) as CopilotPendingAction;
  }

  getPendingAction(id: string): CopilotPendingAction | undefined {
    const row = this.db.prepare(`
      SELECT * FROM copilot_pending_actions WHERE id = ? AND user_id = ?
    `).get(id, this.userId) as CopilotPendingActionRow | undefined;
    return row ? toPendingAction(row) : undefined;
  }

  updatePendingAction(
    actionId: string,
    input: UpdatePendingActionInput
  ): CopilotPendingAction | undefined {
    const existing = this.getPendingAction(actionId);
    if (!existing) return undefined;
    this.db.prepare(`
      UPDATE copilot_pending_actions
      SET status = ?, result_json = ?, approved_by = ?, approved_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(
      input.status ?? existing.status,
      stringifyNullable(input.result === undefined ? existing.result : input.result),
      input.approvedBy === undefined ? existing.approvedBy : input.approvedBy,
      input.approvedAt === undefined ? existing.approvedAt : input.approvedAt,
      Date.now(),
      actionId,
      this.userId
    );
    return this.getPendingAction(actionId);
  }

  updatePendingActionIfStatus(
    actionId: string,
    expectedStatus: string,
    input: UpdatePendingActionInput
  ): CopilotPendingAction | undefined {
    const existing = this.getPendingAction(actionId);
    if (!existing) return undefined;
    const result = this.db.prepare(`
      UPDATE copilot_pending_actions
      SET status = ?, result_json = ?, approved_by = ?, approved_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND status = ?
    `).run(
      input.status ?? existing.status,
      stringifyNullable(input.result === undefined ? existing.result : input.result),
      input.approvedBy === undefined ? existing.approvedBy : input.approvedBy,
      input.approvedAt === undefined ? existing.approvedAt : input.approvedAt,
      Date.now(),
      actionId,
      this.userId,
      expectedStatus
    );
    if (result.changes !== 1) return undefined;
    return this.getPendingAction(actionId);
  }

  updatePendingActionIfStatusAndRunStatus(
    actionId: string,
    expectedStatus: string,
    expectedRunStatus: string,
    input: UpdatePendingActionInput
  ): CopilotPendingAction | undefined {
    const existing = this.getPendingAction(actionId);
    if (!existing) return undefined;
    const result = this.db.prepare(`
      UPDATE copilot_pending_actions
      SET status = ?, result_json = ?, approved_by = ?, approved_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND status = ?
        AND EXISTS (
          SELECT 1 FROM copilot_runs
          WHERE copilot_runs.id = copilot_pending_actions.run_id
            AND copilot_runs.user_id = copilot_pending_actions.user_id
            AND copilot_runs.status = ?
        )
    `).run(
      input.status ?? existing.status,
      stringifyNullable(input.result === undefined ? existing.result : input.result),
      input.approvedBy === undefined ? existing.approvedBy : input.approvedBy,
      input.approvedAt === undefined ? existing.approvedAt : input.approvedAt,
      Date.now(),
      actionId,
      this.userId,
      expectedStatus,
      expectedRunStatus
    );
    if (result.changes !== 1) return undefined;
    return this.getPendingAction(actionId);
  }

  private nextSequence(runId: string): number {
    const row = this.db.prepare(`
      SELECT max(sequence) AS sequence
      FROM copilot_run_events
      WHERE user_id = ? AND run_id = ?
    `).get(this.userId, runId) as { sequence: number | null } | undefined;
    return (row?.sequence ?? 0) + 1;
  }

  private getEvent(id: string): CopilotRunEvent | undefined {
    const row = this.db.prepare(`
      SELECT * FROM copilot_run_events WHERE id = ? AND user_id = ?
    `).get(id, this.userId) as CopilotRunEventRow | undefined;
    return row ? toEvent(row) : undefined;
  }

  private getConversationMessage(id: string): CopilotMessage | undefined {
    const row = this.db.prepare(`
      SELECT * FROM copilot_messages
      WHERE id = ? AND user_id = ?
    `).get(id, this.userId) as CopilotMessageRow | undefined;
    return row ? toMessage(row) : undefined;
  }

}

function toRun(row: CopilotRunRow): CopilotRun {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    providerProfileId: row.provider_profile_id,
    providerProfileName: row.provider_profile_name,
    modelProfileId: row.model_profile_id,
    modelProfileName: row.model_profile_name,
    source: row.source,
    sourceRefId: row.source_ref_id,
    goal: row.goal,
    stepCount: row.step_count,
    maxSteps: row.max_steps,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at
  };
}

function copilotRunSelectSql(): string {
  return `
      SELECT cr.*, mpp.name AS provider_profile_name, mp.name AS model_profile_name
      FROM copilot_runs cr
      LEFT JOIN model_provider_profiles mpp
        ON mpp.id = cr.provider_profile_id AND mpp.user_id = cr.user_id
      LEFT JOIN model_profiles mp
        ON mp.id = cr.model_profile_id AND mp.user_id = cr.user_id
    `;
}

function toEvent(row: CopilotRunEventRow): CopilotRunEvent {
  return {
    id: row.id,
    userId: row.user_id,
    runId: row.run_id,
    type: row.type,
    sequence: row.sequence,
    message: row.message,
    payload: parseRecord(row.payload_json),
    createdAt: row.created_at
  };
}

function toPendingAction(row: CopilotPendingActionRow): CopilotPendingAction {
  return {
    id: row.id,
    userId: row.user_id,
    runId: row.run_id,
    type: row.type,
    status: row.status,
    input: parseRecord(row.input_json),
    result: row.result_json ? parseRecord(row.result_json) : null,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toConversation(row: CopilotConversationRow): CopilotConversation {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    source: row.source,
    sourceRefId: row.source_ref_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
    deletedAt: row.deleted_at
  };
}

function toMessage(row: CopilotMessageRow): CopilotMessage {
  return {
    id: row.id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    runId: row.run_id,
    role: row.role,
    content: row.content,
    payload: parseRecord(row.payload_json),
    createdAt: row.created_at,
    deletedAt: row.deleted_at
  };
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

function stringifyNullable(value: Record<string, unknown> | null): string | null {
  return value === null ? null : JSON.stringify(value);
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 50;
  return Math.max(1, Math.min(Math.trunc(limit), 200));
}
