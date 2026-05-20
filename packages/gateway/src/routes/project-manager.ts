import { Router } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import {
  PROJECT_MANAGER_LEDGER_EVENT_TYPES,
  PROJECT_MANAGER_WORK_ITEM_STATUSES,
  ProjectManagerRepository,
  type ProjectManagerEvidenceRef,
  type ProjectManagerGoal,
  type ProjectManagerLedgerEvent,
  type ProjectManagerWorkItem
} from "../db/repositories/project-manager-repository.js";
import { ProjectRepository } from "../db/repositories/project-repository.js";
import type { Database } from "../db/types.js";

const statusSchema = z.enum(PROJECT_MANAGER_WORK_ITEM_STATUSES);
const eventTypeSchema = z.enum(PROJECT_MANAGER_LEDGER_EVENT_TYPES);

const evidenceRefSchema = z.object({
  kind: z.string().min(1).max(64).optional(),
  label: z.string().min(1).max(256).optional(),
  status: z.string().min(1).max(64).optional(),
  ref: z.string().min(1).max(512).optional(),
  path: z.string().min(1).max(512).optional(),
  sessionId: z.string().min(1).max(128).optional(),
  copilotRunId: z.string().min(1).max(128).optional(),
  feishuChatId: z.string().min(1).max(128).optional(),
  feishuMessageId: z.string().min(1).max(128).optional(),
  createdAt: z.string().min(1).max(64).optional()
}).strict();

const goalBodySchema = z.object({
  summary: z.string().min(1).max(1_000),
  constraints: z.array(z.string().min(1).max(1_000)).max(50).optional(),
  acceptanceCriteria: z.array(z.string().min(1).max(1_000)).max(50).optional(),
  details: z.record(z.unknown()).optional(),
  status: z.string().min(1).max(64).optional()
}).strict();

const workItemCreateSchema = z.object({
  title: z.string().min(1).max(256),
  description: z.string().min(1).max(4_000).nullable().optional(),
  status: statusSchema.optional(),
  priority: z.number().int().min(0).max(100).optional(),
  acceptanceCriteria: z.array(z.string().min(1).max(1_000)).max(50).optional(),
  evidenceRefs: z.array(evidenceRefSchema).max(20).optional(),
  feishuRefs: z.array(evidenceRefSchema).max(20).optional(),
  details: z.record(z.unknown()).optional()
}).strict();

const statusBodySchema = z.object({
  status: statusSchema,
  evidenceRefs: z.array(evidenceRefSchema).max(20).optional(),
  manualCompletionReason: z.string().min(1).max(1_000).optional(),
  details: z.record(z.unknown()).optional()
}).strict();

const evidenceBodySchema = z.object({
  evidenceRefs: z.array(evidenceRefSchema).min(1).max(20),
  details: z.record(z.unknown()).optional()
}).strict();

const workItemsQuerySchema = z.object({
  status: statusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
}).strict();

const ledgerQuerySchema = z.object({
  eventType: eventTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
}).strict();

export function createProjectManagerRoutes(db: Database): Router {
  const router = Router({ mergeParams: true });
  router.use(authenticate);

  router.get("/:projectId/project-manager/goal", (req, res) => {
    const userId = userIdFor(req);
    const project = requireProject(db, userId, req.params.projectId);
    if (!project) return sendProjectNotFound(res);
    const goal = new ProjectManagerRepository(db, userId).getGoal(project.id);
    res.json({ code: 0, data: { goal: goal ? toGoalDto(goal) : null }, message: "" });
  });

  router.put("/:projectId/project-manager/goal", (req, res) => {
    const parse = goalBodySchema.safeParse(req.body ?? {});
    if (!parse.success) return sendInvalidInput(res);
    const userId = userIdFor(req);
    const project = requireProject(db, userId, req.params.projectId);
    if (!project) return sendProjectNotFound(res);
    try {
      const goal = new ProjectManagerRepository(db, userId).upsertGoal(project.id, parse.data);
      res.json({ code: 0, data: { goal: toGoalDto(goal) }, message: "" });
    } catch (error) {
      sendMutationError(res, error, "Goal update failed");
    }
  });

  router.get("/:projectId/project-manager/work-items", (req, res) => {
    const parse = workItemsQuerySchema.safeParse(req.query ?? {});
    if (!parse.success) return sendInvalidInput(res);
    const userId = userIdFor(req);
    const project = requireProject(db, userId, req.params.projectId);
    if (!project) return sendProjectNotFound(res);
    const options = {
      ...(parse.data.status ? { status: parse.data.status } : {}),
      ...(parse.data.limit !== undefined ? { limit: parse.data.limit } : {})
    };
    const workItems = new ProjectManagerRepository(db, userId)
      .listWorkItems(project.id, options)
      .map(toWorkItemDto);
    res.json({ code: 0, data: { workItems }, message: "" });
  });

  router.post("/:projectId/project-manager/work-items", (req, res) => {
    const parse = workItemCreateSchema.safeParse(req.body ?? {});
    if (!parse.success) return sendInvalidInput(res);
    const userId = userIdFor(req);
    const project = requireProject(db, userId, req.params.projectId);
    if (!project) return sendProjectNotFound(res);
    try {
      const workItem = new ProjectManagerRepository(db, userId).createWorkItem(project.id, parse.data);
      res.status(201).json({ code: 0, data: { workItem: toWorkItemDto(workItem) }, message: "" });
    } catch (error) {
      sendMutationError(res, error, "Work item creation failed");
    }
  });

  router.get("/:projectId/project-manager/work-items/:workItemId", (req, res) => {
    const userId = userIdFor(req);
    const project = requireProject(db, userId, req.params.projectId);
    if (!project) return sendProjectNotFound(res);
    const workItem = new ProjectManagerRepository(db, userId).getWorkItem(project.id, req.params.workItemId);
    if (!workItem) return sendWorkItemNotFound(res);
    res.json({ code: 0, data: { workItem: toWorkItemDto(workItem) }, message: "" });
  });

  router.patch("/:projectId/project-manager/work-items/:workItemId/status", (req, res) => {
    const parse = statusBodySchema.safeParse(req.body ?? {});
    if (!parse.success) return sendInvalidInput(res);
    const userId = userIdFor(req);
    const project = requireProject(db, userId, req.params.projectId);
    if (!project) return sendProjectNotFound(res);
    const repo = new ProjectManagerRepository(db, userId);
    if (!repo.getWorkItem(project.id, req.params.workItemId)) return sendWorkItemNotFound(res);
    try {
      const workItem = repo.updateWorkItemStatus(project.id, req.params.workItemId, parse.data);
      res.json({ code: 0, data: { workItem: toWorkItemDto(workItem) }, message: "" });
    } catch (error) {
      sendMutationError(res, error, "Work item status update failed");
    }
  });

  router.post("/:projectId/project-manager/work-items/:workItemId/evidence", (req, res) => {
    const parse = evidenceBodySchema.safeParse(req.body ?? {});
    if (!parse.success) return sendInvalidInput(res);
    const userId = userIdFor(req);
    const project = requireProject(db, userId, req.params.projectId);
    if (!project) return sendProjectNotFound(res);
    const repo = new ProjectManagerRepository(db, userId);
    if (!repo.getWorkItem(project.id, req.params.workItemId)) return sendWorkItemNotFound(res);
    try {
      const workItem = repo.attachEvidence(project.id, req.params.workItemId, parse.data);
      res.json({ code: 0, data: { workItem: toWorkItemDto(workItem) }, message: "" });
    } catch (error) {
      sendMutationError(res, error, "Evidence attachment failed");
    }
  });

  router.get("/:projectId/project-manager/ledger", (req, res) => {
    const parse = ledgerQuerySchema.safeParse(req.query ?? {});
    if (!parse.success) return sendInvalidInput(res);
    const userId = userIdFor(req);
    const project = requireProject(db, userId, req.params.projectId);
    if (!project) return sendProjectNotFound(res);
    const options = parse.data.limit !== undefined ? { limit: parse.data.limit } : {};
    const events = new ProjectManagerRepository(db, userId)
      .listLedgerEvents(project.id, options)
      .filter((event) => !parse.data.eventType || event.eventType === parse.data.eventType)
      .map(toLedgerEventDto);
    res.json({ code: 0, data: { events }, message: "" });
  });

  return router;
}

function userIdFor(req: unknown): string {
  return (req as AuthenticatedRequest).userId;
}

function requireProject(db: Database, userId: string, projectId: string | undefined) {
  if (!projectId) return undefined;
  return new ProjectRepository(db, userId).getById(projectId);
}

function toGoalDto(goal: ProjectManagerGoal) {
  return {
    id: goal.id,
    projectId: goal.projectId,
    summary: goal.summary,
    constraints: goal.constraints,
    acceptanceCriteria: goal.acceptanceCriteria,
    status: goal.status,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt
  };
}

function toWorkItemDto(workItem: ProjectManagerWorkItem) {
  return {
    id: workItem.id,
    projectId: workItem.projectId,
    title: workItem.title,
    description: workItem.description,
    status: workItem.status,
    priority: workItem.priority,
    acceptanceCriteria: workItem.acceptanceCriteria,
    evidenceRefCount: workItem.evidenceRefs.length,
    evidenceRefs: workItem.evidenceRefs.map(toEvidenceRefDto),
    feishuRefCount: workItem.feishuRefs.length,
    createdAt: workItem.createdAt,
    updatedAt: workItem.updatedAt
  };
}

function toLedgerEventDto(event: ProjectManagerLedgerEvent) {
  return {
    id: event.id,
    projectId: event.projectId,
    workItemId: event.workItemId,
    eventType: event.eventType,
    status: event.status,
    evidenceRefCount: event.evidenceRefs.length,
    feishuRefCount: event.feishuRefs.length,
    createdAt: event.createdAt
  };
}

function toEvidenceRefDto(ref: ProjectManagerEvidenceRef) {
  return {
    kind: ref.kind,
    label: ref.label,
    status: ref.status,
    ref: ref.ref,
    path: ref.path,
    sessionId: ref.sessionId,
    copilotRunId: ref.copilotRunId,
    feishuChatId: ref.feishuChatId,
    feishuMessageId: ref.feishuMessageId,
    createdAt: ref.createdAt
  };
}

function sendProjectNotFound(res: { status(code: number): { json(body: unknown): void } }): void {
  res.status(404).json({ code: 1, message: "Project not found" });
}

function sendWorkItemNotFound(res: { status(code: number): { json(body: unknown): void } }): void {
  res.status(404).json({ code: 1, message: "Work item not found" });
}

function sendInvalidInput(res: { status(code: number): { json(body: unknown): void } }): void {
  res.status(400).json({ code: 1, message: "Invalid input" });
}

function sendMutationError(
  res: { status(code: number): { json(body: unknown): void } },
  error: unknown,
  fallback: string
): void {
  res.status(400).json({
    code: 1,
    message: error instanceof Error ? error.message : fallback
  });
}
