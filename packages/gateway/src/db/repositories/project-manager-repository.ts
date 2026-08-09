import { randomUUID } from "node:crypto";

import { AuditLogRepository } from "./audit-log-repository.js";
import type { Database } from "../types.js";

export const PROJECT_MANAGER_WORK_ITEM_STATUSES = [
  "todo",
  "in_progress",
  "blocked",
  "ready_for_review",
  "done",
  "cancelled"
] as const;

export const PROJECT_MANAGER_LEDGER_EVENT_TYPES = [
  "goal_updated",
  "work_item_created",
  "work_item_updated",
  "work_item_deleted",
  "work_item_status_changed",
  "evidence_attached",
  "blocker_recorded",
  "blocker_resolved",
  "copilot_observation_recorded",
  "feishu_reference_linked",
  "next_step_proposed",
  "manual_completion_recorded"
] as const;

export type ProjectManagerWorkItemStatus = typeof PROJECT_MANAGER_WORK_ITEM_STATUSES[number];
export type ProjectManagerLedgerEventType = typeof PROJECT_MANAGER_LEDGER_EVENT_TYPES[number];

export interface ProjectManagerEvidenceRef {
  kind?: string | undefined;
  label?: string | undefined;
  status?: string | undefined;
  ref?: string | undefined;
  path?: string | undefined;
  sessionId?: string | undefined;
  copilotRunId?: string | undefined;
  pendingActionId?: string | undefined;
  feishuChatId?: string | undefined;
  feishuMessageId?: string | undefined;
  createdAt?: string | undefined;
}

export interface ProjectManagerGoal {
  id: string;
  userId: string;
  projectId: string;
  summary: string;
  constraints: string[];
  acceptanceCriteria: string[];
  details: Record<string, unknown>;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectManagerWorkItem {
  id: string;
  userId: string;
  projectId: string;
  title: string;
  description: string | null;
  status: ProjectManagerWorkItemStatus;
  priority: number;
  acceptanceCriteria: string[];
  evidenceRefs: ProjectManagerEvidenceRef[];
  feishuRefs: ProjectManagerEvidenceRef[];
  details: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectManagerLedgerEvent {
  id: string;
  userId: string;
  projectId: string;
  workItemId: string | null;
  eventType: ProjectManagerLedgerEventType;
  status: ProjectManagerWorkItemStatus | null;
  evidenceRefs: ProjectManagerEvidenceRef[];
  feishuRefs: ProjectManagerEvidenceRef[];
  details: Record<string, unknown>;
  createdAt: number;
}

export interface ProjectManagerSummary {
  goalCount: number;
  workItemCountsByStatus: Record<ProjectManagerWorkItemStatus, number>;
  ledgerEventCount: number;
  latestEvent: {
    eventType: ProjectManagerLedgerEventType;
    createdAt: number;
  } | null;
}

export interface UpsertProjectManagerGoalInput {
  summary: string;
  constraints?: string[] | undefined;
  acceptanceCriteria?: string[] | undefined;
  details?: Record<string, unknown> | undefined;
  status?: string | undefined;
}

export interface CreateProjectManagerWorkItemInput {
  title: string;
  description?: string | null | undefined;
  status?: ProjectManagerWorkItemStatus | undefined;
  priority?: number | undefined;
  acceptanceCriteria?: string[] | undefined;
  evidenceRefs?: ProjectManagerEvidenceRef[] | undefined;
  feishuRefs?: ProjectManagerEvidenceRef[] | undefined;
  details?: Record<string, unknown> | undefined;
}

export interface UpdateProjectManagerWorkItemInput {
  title?: string | undefined;
  description?: string | null | undefined;
  priority?: number | undefined;
  acceptanceCriteria?: string[] | undefined;
  details?: Record<string, unknown> | undefined;
}

export interface UpdateProjectManagerWorkItemStatusInput {
  status: ProjectManagerWorkItemStatus;
  evidenceRefs?: ProjectManagerEvidenceRef[] | undefined;
  manualCompletionReason?: string | undefined;
  details?: Record<string, unknown> | undefined;
}

export interface BatchUpdateProjectManagerWorkItemStatusInput extends UpdateProjectManagerWorkItemStatusInput {
  workItemId: string;
}

export interface BatchUpdateProjectManagerWorkItemStatusesInput {
  updates: BatchUpdateProjectManagerWorkItemStatusInput[];
}

export interface AttachProjectManagerEvidenceInput {
  evidenceRefs: ProjectManagerEvidenceRef[];
  details?: Record<string, unknown> | undefined;
}

export interface DeleteProjectManagerWorkItemInput {
  confirm: true;
  details?: Record<string, unknown> | undefined;
}

interface GoalRow {
  id: string;
  user_id: string;
  project_id: string;
  summary: string;
  constraints_json: string;
  acceptance_criteria_json: string;
  details_json: string;
  status: string;
  created_at: number;
  updated_at: number;
}

interface WorkItemRow {
  id: string;
  user_id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  acceptance_criteria_json: string;
  evidence_refs_json: string;
  feishu_refs_json: string;
  details_json: string;
  created_at: number;
  updated_at: number;
}

interface LedgerEventRow {
  id: string;
  user_id: string;
  project_id: string;
  work_item_id: string | null;
  event_type: string;
  status: string | null;
  evidence_refs_json: string;
  feishu_refs_json: string;
  details_json: string;
  created_at: number;
}

const statusTransitions: Record<ProjectManagerWorkItemStatus, ProjectManagerWorkItemStatus[]> = {
  todo: ["in_progress", "blocked", "cancelled"],
  in_progress: ["blocked", "ready_for_review", "done", "cancelled"],
  blocked: ["todo", "in_progress", "cancelled"],
  ready_for_review: ["in_progress", "done", "cancelled"],
  done: [],
  cancelled: []
};

const evidenceRefKeys = new Set([
  "kind",
  "label",
  "status",
  "ref",
  "path",
  "sessionId",
  "copilotRunId",
  "pendingActionId",
  "feishuChatId",
  "feishuMessageId",
  "createdAt"
]);
const maxEvidenceRefs = 20;
const maxStringLength = 512;
const maxDetailArrayItems = 20;
const maxDetailKeys = 20;
const maxDetailDepth = 4;
const sensitiveKeyPattern = /(secret|token|password|credential|authorization|api[_-]?key|private[_-]?key|signature|encrypt[_-]?key|std(?:err|out)|raw|terminal)/iu;
const rawDetailTextPattern = /[\r\n\x00-\x08\x0B\x0C\x0E-\x1F]|\b(?:std(?:err|out)|terminal transcript|raw terminal|command output)\b|\$\s+\S+/iu;
const bearerPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gu;
const attachTokenPattern = /\bOPENFORGE_ATTACH_TOKEN=([^\s,;]+)/gu;
const openAiSecretPattern = /\b[s]k-[A-Za-z0-9_-]{6,}\b/gu;
const headerSecretPattern = /\b(X-Lark-[Ss]ignature|Authorization)(\s*:\s*)([^\s,;]+)/giu;
const keyValueSecretPattern = /\b(api[_-]?key|token|password|secret|private[_-]?key|credential|event[_-]?encrypt[_-]?key)\b(\s*[:=]\s*)([^\s,;]+)/giu;

export class ProjectManagerRepository {
  constructor(private readonly db: Database, private readonly userId: string) {}

  getGoal(projectId: string): ProjectManagerGoal | undefined {
    const row = this.db.prepare(`
      SELECT *
      FROM project_manager_goals
      WHERE user_id = ? AND project_id = ?
    `).get(this.userId, projectId) as GoalRow | undefined;
    return row ? toGoal(row) : undefined;
  }

  upsertGoal(projectId: string, input: UpsertProjectManagerGoalInput): ProjectManagerGoal {
    const summary = normalizeRequiredText(input.summary, "goal summary", 1_000);
    const constraints = normalizeTextList(input.constraints ?? []);
    const acceptanceCriteria = normalizeTextList(input.acceptanceCriteria ?? []);
    const details = normalizeDetails(input.details ?? {});
    const status = normalizeRequiredText(input.status ?? "active", "goal status", 64);
    const existing = this.getGoal(projectId);
    const id = existing?.id ?? randomUUID();
    const now = Date.now();

    const write = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO project_manager_goals (
          id, user_id, project_id, summary, constraints_json, acceptance_criteria_json,
          details_json, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, project_id) DO UPDATE SET
          summary = excluded.summary,
          constraints_json = excluded.constraints_json,
          acceptance_criteria_json = excluded.acceptance_criteria_json,
          details_json = excluded.details_json,
          status = excluded.status,
          updated_at = excluded.updated_at
      `).run(
        id,
        this.userId,
        projectId,
        summary,
        JSON.stringify(constraints),
        JSON.stringify(acceptanceCriteria),
        JSON.stringify(details),
        status,
        now,
        now
      );
      this.insertLedgerEvent(projectId, null, "goal_updated", null, [], [], {
        status,
        acceptanceCriteriaCount: acceptanceCriteria.length,
        constraintCount: constraints.length
      }, now);
      this.writeAudit("project_manager.goal.upsert", "project_manager_goal", id, {
        projectId,
        status,
        acceptanceCriteriaCount: acceptanceCriteria.length,
        constraintCount: constraints.length
      });
    });
    write();
    return this.getGoal(projectId) as ProjectManagerGoal;
  }

  createWorkItem(projectId: string, input: CreateProjectManagerWorkItemInput): ProjectManagerWorkItem {
    const id = randomUUID();
    const now = Date.now();
    const status = normalizeStatus(input.status ?? "todo");
    const item = normalizeWorkItemInput(input);
    const eventDetails = mergeLedgerDetails({
      targetType: "work_item",
      targetId: id,
      status,
      evidenceRefCount: item.evidenceRefs.length,
      acceptanceCriteriaCount: item.acceptanceCriteria.length
    }, item.details);

    const write = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO project_manager_work_items (
          id, user_id, project_id, title, description, status, priority,
          acceptance_criteria_json, evidence_refs_json, feishu_refs_json,
          details_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        this.userId,
        projectId,
        item.title,
        item.description,
        status,
        item.priority,
        JSON.stringify(item.acceptanceCriteria),
        JSON.stringify(item.evidenceRefs),
        JSON.stringify(item.feishuRefs),
        JSON.stringify(item.details),
        now,
        now
      );
      this.insertLedgerEvent(projectId, id, "work_item_created", status, item.evidenceRefs, item.feishuRefs, eventDetails, now);
      this.writeAudit("project_manager.work_item.create", "project_manager_work_item", id, {
        projectId,
        status,
        evidenceRefCount: item.evidenceRefs.length,
        acceptanceCriteriaCount: item.acceptanceCriteria.length
      });
    });
    write();
    return this.getWorkItem(projectId, id) as ProjectManagerWorkItem;
  }

  listWorkItems(projectId: string, options: { status?: ProjectManagerWorkItemStatus; limit?: number } = {}): ProjectManagerWorkItem[] {
    const limit = clampLimit(options.limit);
    if (options.status) {
      const status = normalizeStatus(options.status);
      return (this.db.prepare(`
        SELECT *
        FROM project_manager_work_items
        WHERE user_id = ? AND project_id = ? AND status = ?
        ORDER BY updated_at DESC, title ASC
        LIMIT ?
      `).all(this.userId, projectId, status, limit) as WorkItemRow[]).map(toWorkItem);
    }

    return (this.db.prepare(`
      SELECT *
      FROM project_manager_work_items
      WHERE user_id = ? AND project_id = ?
      ORDER BY updated_at DESC, title ASC
      LIMIT ?
    `).all(this.userId, projectId, limit) as WorkItemRow[]).map(toWorkItem);
  }

  getWorkItem(projectId: string, workItemId: string): ProjectManagerWorkItem | undefined {
    const row = this.db.prepare(`
      SELECT *
      FROM project_manager_work_items
      WHERE id = ? AND user_id = ? AND project_id = ?
    `).get(workItemId, this.userId, projectId) as WorkItemRow | undefined;
    return row ? toWorkItem(row) : undefined;
  }

  updateWorkItem(
    projectId: string,
    workItemId: string,
    input: UpdateProjectManagerWorkItemInput
  ): ProjectManagerWorkItem {
    const existing = this.requireWorkItem(projectId, workItemId);
    const nextTitle = input.title === undefined
      ? existing.title
      : normalizeRequiredText(input.title, "work item title", 256);
    const nextDescription = input.description === undefined
      ? existing.description
      : normalizeOptionalText(input.description, 4_000);
    const nextPriority = input.priority === undefined ? existing.priority : normalizePriority(input.priority);
    const nextAcceptanceCriteria = input.acceptanceCriteria === undefined
      ? existing.acceptanceCriteria
      : normalizeTextList(input.acceptanceCriteria);
    const details = input.details === undefined ? existing.details : normalizeDetails(input.details);
    const changedFields = [
      nextTitle !== existing.title ? "title" : null,
      nextDescription !== existing.description ? "description" : null,
      nextPriority !== existing.priority ? "priority" : null,
      JSON.stringify(nextAcceptanceCriteria) !== JSON.stringify(existing.acceptanceCriteria) ? "acceptanceCriteria" : null
    ].filter((field): field is string => Boolean(field));
    if (changedFields.length === 0 && input.details === undefined) {
      throw new Error("At least one work item field must change");
    }
    const eventDetails = mergeLedgerDetails({
      targetType: "work_item",
      targetId: workItemId,
      changedFields
    }, input.details === undefined ? {} : details);
    const now = Date.now();

    const write = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE project_manager_work_items
        SET title = ?, description = ?, priority = ?, acceptance_criteria_json = ?, details_json = ?, updated_at = ?
        WHERE id = ? AND user_id = ? AND project_id = ?
      `).run(
        nextTitle,
        nextDescription,
        nextPriority,
        JSON.stringify(nextAcceptanceCriteria),
        JSON.stringify(details),
        now,
        workItemId,
        this.userId,
        projectId
      );
      this.insertLedgerEvent(projectId, workItemId, "work_item_updated", existing.status, existing.evidenceRefs, existing.feishuRefs, eventDetails, now);
      this.writeAudit("project_manager.work_item.update", "project_manager_work_item", workItemId, {
        projectId,
        changedFields
      });
    });
    write();
    return this.getWorkItem(projectId, workItemId) as ProjectManagerWorkItem;
  }

  updateWorkItemStatus(
    projectId: string,
    workItemId: string,
    input: UpdateProjectManagerWorkItemStatusInput
  ): ProjectManagerWorkItem {
    const existing = this.requireWorkItem(projectId, workItemId);
    const nextStatus = normalizeStatus(input.status);
    validateTransition(existing.status, nextStatus);
    const inputEvidenceRefs = normalizeEvidenceRefs(input.evidenceRefs ?? []);
    const evidenceRefs = [...existing.evidenceRefs, ...inputEvidenceRefs];
    const hasManualReason = typeof input.manualCompletionReason === "string" && input.manualCompletionReason.trim().length > 0;
    if (nextStatus === "done" && evidenceRefs.length === 0 && !hasManualReason) {
      throw new Error("Marking done requires evidence references or a manual completion reason");
    }

    const details = mergeWorkItemDetails(existing.details, input.details);
    const eventType = statusLedgerEventType(existing.status, nextStatus, hasManualReason);
    const eventDetails = mergeLedgerDetails({
      fromStatus: existing.status,
      toStatus: nextStatus,
      evidenceRefCount: evidenceRefs.length,
      manualCompletionReasonPresent: hasManualReason
    }, details);
    const now = Date.now();
    const write = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE project_manager_work_items
        SET status = ?, evidence_refs_json = ?, details_json = ?, updated_at = ?
        WHERE id = ? AND user_id = ? AND project_id = ?
      `).run(nextStatus, JSON.stringify(evidenceRefs), JSON.stringify(details), now, workItemId, this.userId, projectId);
      this.insertLedgerEvent(projectId, workItemId, eventType, nextStatus, evidenceRefs, existing.feishuRefs, eventDetails, now);
      this.writeAudit("project_manager.work_item.status_change", "project_manager_work_item", workItemId, {
        projectId,
        fromStatus: existing.status,
        toStatus: nextStatus,
        evidenceRefCount: evidenceRefs.length,
        manualCompletionReasonPresent: hasManualReason
      });
    });
    write();
    return this.getWorkItem(projectId, workItemId) as ProjectManagerWorkItem;
  }

  batchUpdateWorkItemStatuses(
    projectId: string,
    input: BatchUpdateProjectManagerWorkItemStatusesInput
  ): ProjectManagerWorkItem[] {
    if (input.updates.length === 0) throw new Error("Batch status updates are required");
    if (input.updates.length > 20) throw new Error("Batch status updates cannot exceed 20 items");
    const seen = new Set<string>();
    const prepared = input.updates.map((update) => {
      if (seen.has(update.workItemId)) throw new Error("Duplicate work item in batch status update");
      seen.add(update.workItemId);
      const existing = this.requireWorkItem(projectId, update.workItemId);
      const nextStatus = normalizeStatus(update.status);
      validateTransition(existing.status, nextStatus);
      const inputEvidenceRefs = normalizeEvidenceRefs(update.evidenceRefs ?? []);
      const evidenceRefs = [...existing.evidenceRefs, ...inputEvidenceRefs];
      const hasManualReason = typeof update.manualCompletionReason === "string" && update.manualCompletionReason.trim().length > 0;
      if (nextStatus === "done" && evidenceRefs.length === 0 && !hasManualReason) {
        throw new Error("Marking done requires evidence references or a manual completion reason");
      }
      const details = mergeWorkItemDetails(existing.details, update.details);
      return {
        existing,
        nextStatus,
        evidenceRefs,
        hasManualReason,
        details,
        eventType: statusLedgerEventType(existing.status, nextStatus, hasManualReason)
      };
    });
    const now = Date.now();
    const write = this.db.transaction(() => {
      for (const item of prepared) {
        const eventDetails = mergeLedgerDetails({
          fromStatus: item.existing.status,
          toStatus: item.nextStatus,
          evidenceRefCount: item.evidenceRefs.length,
          manualCompletionReasonPresent: item.hasManualReason,
          batch: true
        }, item.details);
        this.db.prepare(`
          UPDATE project_manager_work_items
          SET status = ?, evidence_refs_json = ?, details_json = ?, updated_at = ?
          WHERE id = ? AND user_id = ? AND project_id = ?
        `).run(
          item.nextStatus,
          JSON.stringify(item.evidenceRefs),
          JSON.stringify(item.details),
          now,
          item.existing.id,
          this.userId,
          projectId
        );
        this.insertLedgerEvent(projectId, item.existing.id, item.eventType, item.nextStatus, item.evidenceRefs, item.existing.feishuRefs, eventDetails, now);
        this.writeAudit("project_manager.work_item.status_change", "project_manager_work_item", item.existing.id, {
          projectId,
          fromStatus: item.existing.status,
          toStatus: item.nextStatus,
          evidenceRefCount: item.evidenceRefs.length,
          manualCompletionReasonPresent: item.hasManualReason,
          batch: true
        });
      }
    });
    write();
    return input.updates.map((update) => this.getWorkItem(projectId, update.workItemId) as ProjectManagerWorkItem);
  }

  deleteWorkItem(
    projectId: string,
    workItemId: string,
    input: DeleteProjectManagerWorkItemInput
  ): ProjectManagerWorkItem {
    if (input.confirm !== true) throw new Error("Work item deletion requires confirmation");
    const existing = this.requireWorkItem(projectId, workItemId);
    const details = normalizeDetails(input.details ?? {});
    const eventDetails = mergeLedgerDetails({
      targetType: "work_item",
      targetId: workItemId,
      status: existing.status,
      evidenceRefCount: existing.evidenceRefs.length
    }, details);
    const now = Date.now();
    const write = this.db.transaction(() => {
      this.insertLedgerEvent(projectId, null, "work_item_deleted", existing.status, existing.evidenceRefs, existing.feishuRefs, eventDetails, now);
      this.db.prepare(`
        DELETE FROM project_manager_work_items
        WHERE id = ? AND user_id = ? AND project_id = ?
      `).run(workItemId, this.userId, projectId);
      this.writeAudit("project_manager.work_item.delete", "project_manager_work_item", workItemId, {
        projectId,
        status: existing.status,
        evidenceRefCount: existing.evidenceRefs.length
      });
    });
    write();
    return existing;
  }

  attachEvidence(
    projectId: string,
    workItemId: string,
    input: AttachProjectManagerEvidenceInput
  ): ProjectManagerWorkItem {
    const existing = this.requireWorkItem(projectId, workItemId);
    const nextEvidenceRefs = [...existing.evidenceRefs, ...normalizeEvidenceRefs(input.evidenceRefs)];
    if (nextEvidenceRefs.length === existing.evidenceRefs.length) {
      throw new Error("Evidence references are required");
    }
    const details = mergeWorkItemDetails(existing.details, input.details);
    const eventDetails = mergeLedgerDetails({
      evidenceRefCount: nextEvidenceRefs.length
    }, details);
    const now = Date.now();

    const write = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE project_manager_work_items
        SET evidence_refs_json = ?, details_json = ?, updated_at = ?
        WHERE id = ? AND user_id = ? AND project_id = ?
      `).run(JSON.stringify(nextEvidenceRefs), JSON.stringify(details), now, workItemId, this.userId, projectId);
      this.insertLedgerEvent(projectId, workItemId, "evidence_attached", existing.status, nextEvidenceRefs, existing.feishuRefs, eventDetails, now);
      this.writeAudit("project_manager.work_item.evidence_attach", "project_manager_work_item", workItemId, {
        projectId,
        evidenceRefCount: nextEvidenceRefs.length
      });
    });
    write();
    return this.getWorkItem(projectId, workItemId) as ProjectManagerWorkItem;
  }

  listLedgerEvents(
    projectId: string,
    options: { workItemId?: string; eventType?: ProjectManagerLedgerEventType; limit?: number } = {}
  ): ProjectManagerLedgerEvent[] {
    const limit = clampLimit(options.limit);
    const eventType = options.eventType ? normalizeEventType(options.eventType) : undefined;
    if (options.workItemId && eventType) {
      return (this.db.prepare(`
        SELECT *
        FROM project_manager_ledger_events
        WHERE user_id = ? AND project_id = ? AND work_item_id = ? AND event_type = ?
        ORDER BY created_at ASC, rowid ASC
        LIMIT ?
      `).all(this.userId, projectId, options.workItemId, eventType, limit) as LedgerEventRow[]).map(toLedgerEvent);
    }

    if (options.workItemId) {
      return (this.db.prepare(`
        SELECT *
        FROM project_manager_ledger_events
        WHERE user_id = ? AND project_id = ? AND work_item_id = ?
        ORDER BY created_at ASC, rowid ASC
        LIMIT ?
      `).all(this.userId, projectId, options.workItemId, limit) as LedgerEventRow[]).map(toLedgerEvent);
    }

    if (eventType) {
      return (this.db.prepare(`
        SELECT *
        FROM project_manager_ledger_events
        WHERE user_id = ? AND project_id = ? AND event_type = ?
        ORDER BY created_at ASC, rowid ASC
        LIMIT ?
      `).all(this.userId, projectId, eventType, limit) as LedgerEventRow[]).map(toLedgerEvent);
    }

    return (this.db.prepare(`
      SELECT *
      FROM project_manager_ledger_events
      WHERE user_id = ? AND project_id = ?
      ORDER BY created_at ASC, rowid ASC
      LIMIT ?
    `).all(this.userId, projectId, limit) as LedgerEventRow[]).map(toLedgerEvent);
  }

  getSummary(projectId?: string): ProjectManagerSummary {
    const workItemRows = this.countWorkItemsByStatus(projectId);
    const counts = Object.fromEntries(
      PROJECT_MANAGER_WORK_ITEM_STATUSES.map((status) => [status, workItemRows.get(status) ?? 0])
    ) as Record<ProjectManagerWorkItemStatus, number>;
    const latest = this.latestLedgerEvent(projectId);
    return {
      goalCount: this.countGoals(projectId),
      workItemCountsByStatus: counts,
      ledgerEventCount: this.countLedgerEvents(projectId),
      latestEvent: latest ? {
        eventType: normalizeEventType(latest.event_type),
        createdAt: latest.created_at
      } : null
    };
  }

  private requireWorkItem(projectId: string, workItemId: string): ProjectManagerWorkItem {
    const item = this.getWorkItem(projectId, workItemId);
    if (!item) throw new Error("Project-manager work item not found");
    return item;
  }

  private insertLedgerEvent(
    projectId: string,
    workItemId: string | null,
    eventType: ProjectManagerLedgerEventType,
    status: ProjectManagerWorkItemStatus | null,
    evidenceRefs: ProjectManagerEvidenceRef[],
    feishuRefs: ProjectManagerEvidenceRef[],
    details: Record<string, unknown>,
    createdAt: number
  ): void {
    this.db.prepare(`
      INSERT INTO project_manager_ledger_events (
        id, user_id, project_id, work_item_id, event_type, status,
        evidence_refs_json, feishu_refs_json, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      this.userId,
      projectId,
      workItemId,
      eventType,
      status,
      JSON.stringify(normalizeEvidenceRefs(evidenceRefs)),
      JSON.stringify(normalizeEvidenceRefs(feishuRefs)),
      JSON.stringify(normalizeDetails(details)),
      createdAt
    );
  }

  private writeAudit(
    action: string,
    resourceType: string,
    resourceId: string,
    details: Record<string, unknown>
  ): void {
    new AuditLogRepository(this.db, this.userId).create({
      action,
      resourceType,
      resourceId,
      details: normalizeDetails(details)
    });
  }

  private countGoals(projectId?: string): number {
    const sql = projectId
      ? "SELECT COUNT(*) AS count FROM project_manager_goals WHERE user_id = ? AND project_id = ?"
      : "SELECT COUNT(*) AS count FROM project_manager_goals WHERE user_id = ?";
    const args = projectId ? [this.userId, projectId] : [this.userId];
    return ((this.db.prepare(sql).get(...args) as { count: number } | undefined)?.count) ?? 0;
  }

  private countLedgerEvents(projectId?: string): number {
    const sql = projectId
      ? "SELECT COUNT(*) AS count FROM project_manager_ledger_events WHERE user_id = ? AND project_id = ?"
      : "SELECT COUNT(*) AS count FROM project_manager_ledger_events WHERE user_id = ?";
    const args = projectId ? [this.userId, projectId] : [this.userId];
    return ((this.db.prepare(sql).get(...args) as { count: number } | undefined)?.count) ?? 0;
  }

  private countWorkItemsByStatus(projectId?: string): Map<ProjectManagerWorkItemStatus, number> {
    const sql = projectId
      ? "SELECT status, COUNT(*) AS count FROM project_manager_work_items WHERE user_id = ? AND project_id = ? GROUP BY status"
      : "SELECT status, COUNT(*) AS count FROM project_manager_work_items WHERE user_id = ? GROUP BY status";
    const args = projectId ? [this.userId, projectId] : [this.userId];
    const rows = this.db.prepare(sql).all(...args) as Array<{ status: string; count: number }>;
    return new Map(rows.map((row) => [normalizeStatus(row.status), row.count]));
  }

  private latestLedgerEvent(projectId?: string): LedgerEventRow | undefined {
    const sql = projectId
      ? "SELECT * FROM project_manager_ledger_events WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1"
      : "SELECT * FROM project_manager_ledger_events WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1";
    const args = projectId ? [this.userId, projectId] : [this.userId];
    return this.db.prepare(sql).get(...args) as LedgerEventRow | undefined;
  }
}

function normalizeWorkItemInput(input: CreateProjectManagerWorkItemInput) {
  return {
    title: normalizeRequiredText(input.title, "work item title", 256),
    description: normalizeOptionalText(input.description, 4_000),
    priority: normalizePriority(input.priority),
    acceptanceCriteria: normalizeTextList(input.acceptanceCriteria ?? []),
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs ?? []),
    feishuRefs: normalizeEvidenceRefs(input.feishuRefs ?? []),
    details: normalizeDetails(input.details ?? {})
  };
}

function mergeLedgerDetails(
  base: Record<string, unknown>,
  details: Record<string, unknown>
): Record<string, unknown> {
  return Object.keys(details).length > 0 ? { ...base, ...details } : base;
}

function normalizeStatus(value: string): ProjectManagerWorkItemStatus {
  if (PROJECT_MANAGER_WORK_ITEM_STATUSES.includes(value as ProjectManagerWorkItemStatus)) {
    return value as ProjectManagerWorkItemStatus;
  }
  throw new Error(`Unsupported project-manager work item status: ${value}`);
}

function normalizeEventType(value: string): ProjectManagerLedgerEventType {
  if (PROJECT_MANAGER_LEDGER_EVENT_TYPES.includes(value as ProjectManagerLedgerEventType)) {
    return value as ProjectManagerLedgerEventType;
  }
  throw new Error(`Unsupported project-manager ledger event type: ${value}`);
}

function validateTransition(from: ProjectManagerWorkItemStatus, to: ProjectManagerWorkItemStatus): void {
  if (from === to) return;
  if (statusTransitions[from].includes(to)) return;
  throw new Error(`Invalid project-manager status transition from ${from} to ${to}`);
}

function statusLedgerEventType(
  fromStatus: ProjectManagerWorkItemStatus,
  nextStatus: ProjectManagerWorkItemStatus,
  hasManualReason: boolean
): ProjectManagerLedgerEventType {
  if (nextStatus === "done" && hasManualReason) return "manual_completion_recorded";
  if (nextStatus === "blocked" && fromStatus !== "blocked") return "blocker_recorded";
  if (fromStatus === "blocked" && nextStatus !== "blocked") return "blocker_resolved";
  return "work_item_status_changed";
}

function normalizeRequiredText(value: string, label: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  if (normalized.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer`);
  return redactSensitiveString(normalized);
}

function normalizeOptionalText(value: string | null | undefined, maxLength: number): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) throw new Error(`Value must be ${maxLength} characters or fewer`);
  return redactSensitiveString(normalized);
}

function normalizeTextList(values: string[]): string[] {
  if (values.length > 50) throw new Error("Text lists cannot exceed 50 items");
  return Array.from(new Set(values.map((value) => normalizeRequiredText(value, "text value", 1_000))));
}

function normalizeEvidenceRefs(values: ProjectManagerEvidenceRef[]): ProjectManagerEvidenceRef[] {
  if (values.length > maxEvidenceRefs) throw new Error("Evidence references cannot exceed 20 items");
  return values
    .map((value) => normalizeEvidenceRef(value))
    .filter((value) => Object.keys(value).length > 0);
}

function normalizeEvidenceRef(value: ProjectManagerEvidenceRef): ProjectManagerEvidenceRef {
  const entries = Object.entries(value).filter(([key]) => evidenceRefKeys.has(key));
  return Object.fromEntries(entries.map(([key, entry]) => [
    key,
    typeof entry === "string" ? normalizeEvidenceString(entry) : entry
  ])) as ProjectManagerEvidenceRef;
}

function normalizeEvidenceString(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "";
  if (normalized.length > maxStringLength) throw new Error("Evidence reference values must be 512 characters or fewer");
  const redacted = redactSensitiveString(normalized);
  return rawDetailTextPattern.test(redacted) ? "[REDACTED]" : redacted;
}

function normalizeDetails(value: unknown): Record<string, unknown> {
  const normalized = normalizeDetailValue(value, "", 0);
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) return {};
  return normalized as Record<string, unknown>;
}

/**
 * Merge incoming details into the existing stored details (deep shallow-merge
 * one level) so a status change or evidence attach never wipes out existing
 * fields such as `taskPacket.sessionId`. The stored `taskPacket` is treated as
 * an opaque value and preserved wholesale unless explicitly replaced.
 */
function mergeWorkItemDetails(
  existing: Record<string, unknown>,
  incoming: unknown
): Record<string, unknown> {
  const normalizedIncoming = normalizeDetails(incoming);
  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(normalizedIncoming)) {
    // Preserve the stored taskPacket (e.g. its sessionId link) when the caller
    // only patches unrelated fields.
    if (key === "taskPacket" && typeof merged.taskPacket === "object" && merged.taskPacket !== null) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        merged.taskPacket = {
          ...(merged.taskPacket as Record<string, unknown>),
          ...(value as Record<string, unknown>)
        };
        continue;
      }
    }
    merged[key] = value;
  }
  return merged;
}

function normalizeDetailValue(value: unknown, key: string, depth: number): unknown {
  if (sensitiveKeyPattern.test(key)) return "[REDACTED]";
  if (typeof value === "string") return normalizeDetailString(value);
  if (Array.isArray(value)) {
    if (value.length > maxDetailArrayItems) throw new Error("Project-manager detail arrays cannot exceed 20 items");
    return value.map((item) => normalizeDetailValue(item, key, depth + 1));
  }
  if (value && typeof value === "object") {
    if (depth >= maxDetailDepth) return "[REDACTED]";
    const entries = Object.entries(value);
    if (entries.length > maxDetailKeys) throw new Error("Project-manager details cannot exceed 20 keys");
    return Object.fromEntries(
      entries.map(([entryKey, entryValue]) => [
        entryKey,
        normalizeDetailValue(entryValue, entryKey, depth + 1)
      ])
    );
  }
  return value;
}

function normalizeDetailString(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "";
  if (normalized.length > maxStringLength) throw new Error("Project-manager detail values must be 512 characters or fewer");
  const redacted = redactSensitiveString(normalized);
  return rawDetailTextPattern.test(redacted) ? "[REDACTED]" : redacted;
}

function redactSensitiveString(value: string): string {
  return value
    .replace(attachTokenPattern, "OPENFORGE_ATTACH_TOKEN=[REDACTED]")
    .replace(bearerPattern, "Bearer [REDACTED]")
    .replace(openAiSecretPattern, "sk" + "-[REDACTED]")
    .replace(headerSecretPattern, "$1$2[REDACTED]")
    .replace(keyValueSecretPattern, "$1$2[REDACTED]");
}

function normalizePriority(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error("Project-manager priority must be an integer from 0 to 100");
  }
  return value;
}

function clampLimit(value: number | undefined): number {
  if (value === undefined) return 50;
  return Math.min(200, Math.max(1, value));
}

function parseJsonArray<T>(text: string): T[] {
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function toGoal(row: GoalRow): ProjectManagerGoal {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    summary: row.summary,
    constraints: parseJsonArray<string>(row.constraints_json),
    acceptanceCriteria: parseJsonArray<string>(row.acceptance_criteria_json),
    details: parseJsonObject(row.details_json),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toWorkItem(row: WorkItemRow): ProjectManagerWorkItem {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    status: normalizeStatus(row.status),
    priority: row.priority,
    acceptanceCriteria: parseJsonArray<string>(row.acceptance_criteria_json),
    evidenceRefs: parseJsonArray<ProjectManagerEvidenceRef>(row.evidence_refs_json),
    feishuRefs: parseJsonArray<ProjectManagerEvidenceRef>(row.feishu_refs_json),
    details: parseJsonObject(row.details_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toLedgerEvent(row: LedgerEventRow): ProjectManagerLedgerEvent {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    workItemId: row.work_item_id,
    eventType: normalizeEventType(row.event_type),
    status: row.status ? normalizeStatus(row.status) : null,
    evidenceRefs: parseJsonArray<ProjectManagerEvidenceRef>(row.evidence_refs_json),
    feishuRefs: parseJsonArray<ProjectManagerEvidenceRef>(row.feishu_refs_json),
    details: parseJsonObject(row.details_json),
    createdAt: row.created_at
  };
}
