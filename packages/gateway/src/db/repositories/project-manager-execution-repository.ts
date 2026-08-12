import { randomUUID } from "node:crypto";

import type { Database } from "../types.js";

export type ProjectManagerAttemptDesiredState = "prepared" | "running" | "cancelled";
export type ProjectManagerAttemptObservedState =
  | "prepared"
  | "dispatching"
  | "running"
  | "waiting_for_permission"
  | "evaluating"
  | "succeeded"
  | "blocked"
  | "failed"
  | "cancelled";

export interface ProjectManagerTaskAttempt {
  id: string;
  userId: string;
  projectId: string;
  workItemId: string;
  attemptNumber: number;
  desiredState: ProjectManagerAttemptDesiredState;
  observedState: ProjectManagerAttemptObservedState;
  inputVersion: number;
  inputDigest: string;
  activeSlot: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  reconcileCount: number;
  decisionCount: number;
  followUpCount: number;
  retryCount: number;
  deadlineAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface ProjectManagerSessionAssignment {
  id: string;
  userId: string;
  projectId: string;
  workItemId: string;
  attemptId: string;
  sessionId: string;
  adapter: string;
  capabilities: Record<string, unknown>;
  leaseToken: string;
  leaseExpiresAt: Date;
  activeSlot: string | null;
  releasedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  releasedAt: Date | null;
}

export interface ProjectManagerCommand {
  id: string;
  userId: string;
  projectId: string;
  workItemId: string;
  attemptId: string;
  assignmentId: string | null;
  approvalId: string | null;
  commandType: string;
  idempotencyKey: string;
  payloadDigest: string;
  status: string;
  result: Record<string, unknown> | null;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

interface AttemptRow {
  id: string;
  user_id: string;
  project_id: string;
  work_item_id: string;
  attempt_number: number;
  desired_state: ProjectManagerAttemptDesiredState;
  observed_state: ProjectManagerAttemptObservedState;
  input_version: number;
  input_digest: string;
  active_slot: string | null;
  failure_code: string | null;
  failure_message: string | null;
  reconcile_count: number;
  decision_count: number;
  follow_up_count: number;
  retry_count: number;
  deadline_at: number | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

interface AssignmentRow {
  id: string;
  user_id: string;
  project_id: string;
  work_item_id: string;
  attempt_id: string;
  session_id: string;
  adapter: string;
  capabilities_json: string;
  lease_token: string;
  lease_expires_at: number;
  active_slot: string | null;
  released_reason: string | null;
  created_at: number;
  updated_at: number;
  released_at: number | null;
}

interface CommandRow {
  id: string;
  user_id: string;
  project_id: string;
  work_item_id: string;
  attempt_id: string;
  assignment_id: string | null;
  approval_id: string | null;
  command_type: string;
  idempotency_key: string;
  payload_digest: string;
  status: string;
  result_json: string | null;
  failure_code: string | null;
  failure_message: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

function asDate(value: number | null): Date | null {
  return value === null ? null : new Date(value);
}

function parseRecord(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

function toAttempt(row: AttemptRow): ProjectManagerTaskAttempt {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    workItemId: row.work_item_id,
    attemptNumber: row.attempt_number,
    desiredState: row.desired_state,
    observedState: row.observed_state,
    inputVersion: row.input_version,
    inputDigest: row.input_digest,
    activeSlot: row.active_slot,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    reconcileCount: row.reconcile_count,
    decisionCount: row.decision_count,
    followUpCount: row.follow_up_count,
    retryCount: row.retry_count,
    deadlineAt: asDate(row.deadline_at),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    completedAt: asDate(row.completed_at)
  };
}

function toAssignment(row: AssignmentRow): ProjectManagerSessionAssignment {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    workItemId: row.work_item_id,
    attemptId: row.attempt_id,
    sessionId: row.session_id,
    adapter: row.adapter,
    capabilities: parseRecord(row.capabilities_json),
    leaseToken: row.lease_token,
    leaseExpiresAt: new Date(row.lease_expires_at),
    activeSlot: row.active_slot,
    releasedReason: row.released_reason,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    releasedAt: asDate(row.released_at)
  };
}

function toCommand(row: CommandRow): ProjectManagerCommand {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    workItemId: row.work_item_id,
    attemptId: row.attempt_id,
    assignmentId: row.assignment_id,
    approvalId: row.approval_id,
    commandType: row.command_type,
    idempotencyKey: row.idempotency_key,
    payloadDigest: row.payload_digest,
    status: row.status,
    result: row.result_json === null ? null : parseRecord(row.result_json),
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    completedAt: asDate(row.completed_at)
  };
}

function isTerminalState(state: ProjectManagerAttemptObservedState): boolean {
  return state === "succeeded" || state === "blocked" || state === "failed" || state === "cancelled";
}

export class ProjectManagerExecutionRepository {
  constructor(private readonly db: Database, private readonly userId: string) {}

  getAttempt(projectId: string, attemptId: string): ProjectManagerTaskAttempt | undefined {
    const row = this.db.prepare(`
      SELECT * FROM project_manager_task_attempts
      WHERE id = ? AND user_id = ? AND project_id = ?
    `).get(attemptId, this.userId, projectId) as AttemptRow | undefined;
    return row ? toAttempt(row) : undefined;
  }

  getAttemptById(attemptId: string): ProjectManagerTaskAttempt | undefined {
    const row = this.db.prepare(`
      SELECT * FROM project_manager_task_attempts WHERE id = ? AND user_id = ?
    `).get(attemptId, this.userId) as AttemptRow | undefined;
    return row ? toAttempt(row) : undefined;
  }

  createOrReusePreparedAttempt(input: {
    projectId: string;
    workItemId: string;
    inputVersion: number;
    inputDigest: string;
    deadlineAt?: Date | null;
  }): ProjectManagerTaskAttempt {
    const create = this.db.transaction(() => {
      this.requireOwnedWorkItem(input.projectId, input.workItemId);
      const existing = this.db.prepare(`
        SELECT * FROM project_manager_task_attempts
        WHERE user_id = ? AND project_id = ? AND work_item_id = ?
          AND desired_state = 'prepared' AND observed_state = 'prepared'
          AND input_version = ? AND input_digest = ?
        ORDER BY attempt_number DESC LIMIT 1
      `).get(
        this.userId,
        input.projectId,
        input.workItemId,
        input.inputVersion,
        input.inputDigest
      ) as AttemptRow | undefined;
      if (existing) {
        return toAttempt(existing);
      }

      const countRow = this.db.prepare(`
        SELECT COALESCE(MAX(attempt_number), 0) AS max_attempt_number
        FROM project_manager_task_attempts WHERE user_id = ? AND work_item_id = ?
      `).get(this.userId, input.workItemId) as { max_attempt_number: number };
      const id = randomUUID();
      const now = Date.now();
      try {
        this.db.prepare(`
          INSERT INTO project_manager_task_attempts (
            id, user_id, project_id, work_item_id, attempt_number, desired_state,
            observed_state, input_version, input_digest, active_slot, deadline_at,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'prepared', 'prepared', ?, ?, NULL, ?, ?, ?)
        `).run(
          id,
          this.userId,
          input.projectId,
          input.workItemId,
          countRow.max_attempt_number + 1,
          input.inputVersion,
          input.inputDigest,
          input.deadlineAt?.getTime() ?? null,
          now,
          now
        );
      } catch (error) {
        if (
          error instanceof Error
          && error.message.includes("project_manager_task_attempts.user_id")
          && error.message.includes("project_manager_task_attempts.active_slot")
        ) {
          throw new Error("ATTEMPT_ACTIVE_CONFLICT");
        }
        throw error;
      }
      return this.requireAttempt(id);
    });
    return create();
  }

  compareAndSwapAttempt(attemptId: string, input: {
    expectedObservedState: ProjectManagerAttemptObservedState;
    desiredState?: ProjectManagerAttemptDesiredState;
    observedState: ProjectManagerAttemptObservedState;
    failureCode?: string | null;
    failureMessage?: string | null;
  }): ProjectManagerTaskAttempt {
    const existing = this.requireAttempt(attemptId);
    const now = Date.now();
    const terminal = isTerminalState(input.observedState);
    const desiredState = input.desiredState ?? existing.desiredState;
    let result: { changes: number };
    try {
      result = this.db.prepare(`
        UPDATE project_manager_task_attempts
        SET desired_state = ?, observed_state = ?, active_slot = ?, failure_code = ?,
            failure_message = ?, updated_at = ?, completed_at = ?
        WHERE id = ? AND user_id = ? AND observed_state = ?
      `).run(
        desiredState,
        input.observedState,
        terminal || desiredState !== "running" ? null : "active",
        input.failureCode ?? null,
        input.failureMessage ?? null,
        now,
        terminal ? now : null,
        attemptId,
        this.userId,
        input.expectedObservedState
      );
    } catch (error) {
      if (
        error instanceof Error
        && error.message.includes("project_manager_task_attempts.user_id")
        && error.message.includes("project_manager_task_attempts.active_slot")
      ) {
        throw new Error("ATTEMPT_ACTIVE_CONFLICT");
      }
      throw error;
    }
    if (result.changes !== 1) throw new Error("ATTEMPT_STATE_CONFLICT");
    return this.requireAttempt(attemptId);
  }

  consumeBudget(
    attemptId: string,
    budget: "reconcile" | "decision" | "follow_up" | "retry",
    maximum: number,
    now = new Date()
  ): number {
    const columns = {
      reconcile: "reconcile_count",
      decision: "decision_count",
      follow_up: "follow_up_count",
      retry: "retry_count"
    } as const;
    const column = columns[budget];
    const timestamp = now.getTime();
    // The selected column comes from the closed map above, never from request input.
    const result = this.db.prepare(`
      UPDATE project_manager_task_attempts
      SET ${column} = ${column} + 1, updated_at = ?
      WHERE id = ? AND user_id = ? AND ${column} < ?
        AND (deadline_at IS NULL OR deadline_at >= ?)
    `).run(timestamp, attemptId, this.userId, maximum, timestamp);
    if (result.changes !== 1) {
      const attempt = this.requireAttempt(attemptId);
      if (attempt.deadlineAt && attempt.deadlineAt.getTime() < timestamp) {
        throw new Error("ATTEMPT_DEADLINE_EXCEEDED");
      }
      throw new Error(`ATTEMPT_${budget.toUpperCase()}_LIMIT`);
    }
    return this.requireAttempt(attemptId)[`${budget === "follow_up" ? "followUp" : budget}Count`];
  }

  getAssignment(projectId: string, assignmentId: string): ProjectManagerSessionAssignment | undefined {
    const row = this.db.prepare(`
      SELECT * FROM project_manager_session_assignments
      WHERE id = ? AND user_id = ? AND project_id = ?
    `).get(assignmentId, this.userId, projectId) as AssignmentRow | undefined;
    return row ? toAssignment(row) : undefined;
  }

  createAssignment(input: {
    projectId: string;
    workItemId: string;
    attemptId: string;
    sessionId: string;
    adapter: string;
    capabilities: Record<string, unknown>;
    leaseExpiresAt: Date;
    active?: boolean;
  }): ProjectManagerSessionAssignment {
    const create = this.db.transaction(() => {
      const attempt = this.requireAttempt(input.attemptId);
      if (attempt.projectId !== input.projectId || attempt.workItemId !== input.workItemId) {
        throw new Error("ASSIGNMENT_SCOPE_MISMATCH");
      }
      this.requireOwnedSession(input.projectId, input.sessionId);
      const now = Date.now();
      // Expired rows relinquish both project and session uniqueness slots atomically.
      this.db.prepare(`
        UPDATE project_manager_session_assignments
        SET active_slot = NULL, released_reason = 'lease_expired', released_at = ?, updated_at = ?
        WHERE user_id = ? AND active_slot = 'active' AND lease_expires_at <= ?
          AND (project_id = ? OR session_id = ?)
      `).run(now, now, this.userId, now, input.projectId, input.sessionId);

      const id = randomUUID();
      try {
        this.db.prepare(`
          INSERT INTO project_manager_session_assignments (
            id, user_id, project_id, work_item_id, attempt_id, session_id, adapter,
          capabilities_json, lease_token, lease_expires_at, active_slot, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          this.userId,
          input.projectId,
          input.workItemId,
          input.attemptId,
          input.sessionId,
          input.adapter,
          JSON.stringify(input.capabilities),
          randomUUID(),
          input.leaseExpiresAt.getTime(),
          input.active === false ? null : "active",
          now,
          now
        );
      } catch (error) {
        if (
          error instanceof Error
          && error.message.includes("project_manager_session_assignments")
          && error.message.includes("active_slot")
        ) {
          throw new Error("ASSIGNMENT_ACTIVE_CONFLICT");
        }
        throw error;
      }
      return this.requireAssignment(id);
    });
    return create();
  }

  createCommand(input: {
    projectId: string;
    workItemId: string;
    attemptId: string;
    assignmentId?: string | null;
    approvalId?: string | null;
    commandType: string;
    idempotencyKey: string;
    payloadDigest: string;
  }): ProjectManagerCommand {
    const create = this.db.transaction(() => {
      const attempt = this.requireAttempt(input.attemptId);
      if (attempt.projectId !== input.projectId || attempt.workItemId !== input.workItemId) {
        throw new Error("COMMAND_SCOPE_MISMATCH");
      }
      const existing = this.db.prepare(`
        SELECT * FROM project_manager_commands
        WHERE user_id = ? AND attempt_id = ? AND idempotency_key = ?
      `).get(this.userId, input.attemptId, input.idempotencyKey) as CommandRow | undefined;
      if (existing) {
        if (existing.payload_digest !== input.payloadDigest || existing.command_type !== input.commandType) {
          throw new Error("COMMAND_PAYLOAD_DRIFT");
        }
        return toCommand(existing);
      }

      if (input.assignmentId) {
        const assignment = this.requireAssignment(input.assignmentId);
        if (
          assignment.projectId !== input.projectId
          || assignment.workItemId !== input.workItemId
          || assignment.attemptId !== input.attemptId
        ) {
          throw new Error("COMMAND_SCOPE_MISMATCH");
        }
      }
      const id = randomUUID();
      const now = Date.now();
      this.db.prepare(`
        INSERT INTO project_manager_commands (
          id, user_id, project_id, work_item_id, attempt_id, assignment_id, approval_id,
          command_type, idempotency_key, payload_digest, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `).run(
        id,
        this.userId,
        input.projectId,
        input.workItemId,
        input.attemptId,
        input.assignmentId ?? null,
        input.approvalId ?? null,
        input.commandType,
        input.idempotencyKey,
        input.payloadDigest,
        now,
        now
      );
      return this.requireCommand(id);
    });
    return create();
  }

  private requireAttempt(attemptId: string): ProjectManagerTaskAttempt {
    const row = this.db.prepare(`
      SELECT * FROM project_manager_task_attempts WHERE id = ? AND user_id = ?
    `).get(attemptId, this.userId) as AttemptRow | undefined;
    if (!row) throw new Error("ATTEMPT_NOT_FOUND");
    return toAttempt(row);
  }

  private requireAssignment(assignmentId: string): ProjectManagerSessionAssignment {
    const row = this.db.prepare(`
      SELECT * FROM project_manager_session_assignments WHERE id = ? AND user_id = ?
    `).get(assignmentId, this.userId) as AssignmentRow | undefined;
    if (!row) throw new Error("ASSIGNMENT_NOT_FOUND");
    return toAssignment(row);
  }

  private requireCommand(commandId: string): ProjectManagerCommand {
    const row = this.db.prepare(`
      SELECT * FROM project_manager_commands WHERE id = ? AND user_id = ?
    `).get(commandId, this.userId) as CommandRow | undefined;
    if (!row) throw new Error("COMMAND_NOT_FOUND");
    return toCommand(row);
  }

  private requireOwnedWorkItem(projectId: string, workItemId: string): void {
    const row = this.db.prepare(`
      SELECT id FROM project_manager_work_items WHERE id = ? AND user_id = ? AND project_id = ?
    `).get(workItemId, this.userId, projectId);
    if (!row) throw new Error("WORK_ITEM_NOT_FOUND");
  }

  private requireOwnedSession(projectId: string, sessionId: string): void {
    const row = this.db.prepare(`
      SELECT id FROM sessions WHERE id = ? AND user_id = ? AND project_id = ?
    `).get(sessionId, this.userId, projectId);
    if (!row) throw new Error("SESSION_NOT_FOUND");
  }
}
