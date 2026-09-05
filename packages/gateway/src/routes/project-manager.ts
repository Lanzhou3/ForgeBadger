import { PlatformActions } from "../services/platform-commands/actions.js";
import { createPlatformCommands } from "../services/platform-commands/catalog.js";
import { createHash, randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import type { CommandRunner } from "../lib/dependency-check.js";
import { getAdapterLaunchStatus, isAdapterId } from "../services/adapter-discovery.js";
import {
  PROJECT_MANAGER_LEDGER_EVENT_TYPES,
  PROJECT_MANAGER_STAGE_STATUSES,
  PROJECT_MANAGER_WORK_ITEM_STATUSES,
  ProjectManagerRepository,
  type ProjectManagerEvidenceRef,
  type ProjectManagerGoal,
  type ProjectManagerLedgerEvent,
  type ProjectManagerStage,
  type ProjectManagerWorkItem,
  type ProjectManagerWorkItemLink,
  type ProjectManagerWorkItemStatus
} from "../db/repositories/project-manager-repository.js";
import { ProjectRepository, type Project } from "../db/repositories/project-repository.js";
import { SessionRepository, type Session } from "../db/repositories/session-repository.js";
import type { Database } from "../db/types.js";
import { getStarterTaskPack, listStarterTaskPacks, type StarterTaskPack } from "../services/starter-task-packs.js";
import {
  buildTaskPacket,
  createTaskPacketContext,
  createTaskPacketSessionName,
  isActiveSessionStatus,
  queueStatusForWorkItem,
  readStringArray,
  readStringValue,
  readTaskPacketDetails,
  resolveTaskPacketSession,
  resolveTaskPacketSessions,
  toTaskPacketSessionDto,
  withTaskPacketSessionLink
} from "../services/project-manager/task-packets.js";

const statusSchema = z.enum(PROJECT_MANAGER_WORK_ITEM_STATUSES);
const eventTypeSchema = z.enum(PROJECT_MANAGER_LEDGER_EVENT_TYPES);

const evidenceRefSchema = z.object({
  kind: z.string().min(1).max(64).optional(),
  label: z.string().min(1).max(256).optional(),
  status: z.string().min(1).max(64).optional(),
  ref: z.string().min(1).max(512).optional(),
  path: z.string().min(1).max(512).optional(),
  sessionId: z.string().min(1).max(128).optional(),
  feishuChatId: z.string().min(1).max(128).optional(),
  feishuMessageId: z.string().min(1).max(128).optional(),
  createdAt: z.string().min(1).max(64).optional()
}).strict();

const goalBodySchema = z.object({
  summary: z.string().min(1).max(1_000),
  constraints: z.array(z.string().min(1).max(1_000)).max(50).optional(),
  acceptanceCriteria: z.array(z.string().min(1).max(1_000)).max(50).optional(),
  status: z.string().min(1).max(64).optional()
}).strict();

const workItemCreateSchema = z.object({
  title: z.string().min(1).max(256),
  description: z.string().min(1).max(4_000).nullable().optional(),
  status: z.literal("todo").optional(),
  priority: z.number().int().min(0).max(100).optional(),
  acceptanceCriteria: z.array(z.string().min(1).max(1_000)).max(50).optional(),
  evidenceRefs: z.array(evidenceRefSchema).max(20).optional(),
  feishuRefs: z.array(evidenceRefSchema).max(20).optional(),
  stageId: z.string().min(1).max(128).nullable().optional()
}).strict();

const workItemUpdateSchema = z.object({
  title: z.string().min(1).max(256).optional(),
  description: z.string().min(1).max(4_000).nullable().optional(),
  priority: z.number().int().min(0).max(100).optional(),
  acceptanceCriteria: z.array(z.string().min(1).max(1_000)).max(50).optional(),
  stageId: z.string().min(1).max(128).nullable().optional()
}).strict().refine((value) => Object.keys(value).length > 0);

const stageCreateSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().min(1).max(1_000).nullable().optional()
}).strict();

const stageUpdateSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().min(1).max(1_000).nullable().optional(),
  status: z.enum(PROJECT_MANAGER_STAGE_STATUSES).optional()
}).strict().refine((value) => Object.keys(value).length > 0);

const stageReorderSchema = z.object({
  stageIds: z.array(z.string().min(1).max(128)).min(1).max(50)
}).strict();

const dependencyBodySchema = z.object({
  blockerWorkItemId: z.string().min(1).max(128)
}).strict();

const statusBodySchema = z.object({
  status: statusSchema,
  evidenceRefs: z.array(evidenceRefSchema).max(20).optional(),
  manualCompletionReason: z.string().min(1).max(1_000).optional()
}).strict();

const batchStatusBodySchema = z.object({
  updates: z.array(z.object({
    workItemId: z.string().min(1).max(128),
    status: statusSchema,
    evidenceRefs: z.array(evidenceRefSchema).max(20).optional(),
    manualCompletionReason: z.string().min(1).max(1_000).optional()
  }).strict()).min(1).max(20)
}).strict();

const deleteWorkItemBodySchema = z.object({
  confirm: z.literal(true)
}).strict();

const evidenceBodySchema = z.object({
  evidenceRefs: z.array(evidenceRefSchema).min(1).max(20)
}).strict();

const taskPacketSessionLinkBodySchema = z.object({
  sessionId: z.string().min(1).max(128)
}).strict();

const taskPacketStartBodySchema = z.object({
  aiTool: z.enum(["claude", "opencode", "codex", "kimi"]).optional()
}).strict();

const workItemsQuerySchema = z.object({
  status: statusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
}).strict();

const taskPacketsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional()
}).strict();

const ledgerQuerySchema = z.object({
  eventType: eventTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
}).strict();

interface ProjectManagerLedgerTrace {
  actionType?: string;
  targetType?: string;
  targetId?: string;
  evidenceRefCount?: number;
  approvalStatus?: string;
  executionStatus?: string;
}

interface ProjectManagerTaskPacket {
  id: string;
  projectId: string;
  workItemId: string;
  workItemStatus: ProjectManagerWorkItemStatus;
  queueStatus: ProjectManagerTaskPacketQueueStatus;
  title: string;
  updatedAt: number;
  prompt: string;
  acceptanceCriteria: string[];
  expectedVerification: string[];
  evidenceRequirements: string[];
  runtime: {
    adapter: string | null;
    templateId: string | null;
  };
  sessionLink: {
    sessionId: string;
    status: string;
    aiTool: string;
    href: string;
  } | null;
  blockedReason: "no_linked_session" | "linked_session_not_running" | null;
}

type ProjectManagerTaskPacketQueueStatus =
  | "planned"
  | "running"
  | "waiting_for_review"
  | "blocked"
  | "completed"
  | "cancelled";

export function createProjectManagerRoutes(
  db: Database,
  options: { adapterCommandRunner?: CommandRunner; masterKey?: string } = {}
): Router {
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

  router.post("/:projectId/project-manager/work-items", async (req, res) => {
    const parse = workItemCreateSchema.safeParse(req.body ?? {});
    if (!parse.success) return sendInvalidInput(res);
    const userId = userIdFor(req);
    const project = requireProject(db, userId, req.params.projectId);
    if (!project) return sendProjectNotFound(res);
    try {
      const { status: _status, ...input } = parse.data;
      const workItem = await new PlatformActions({db,userId,...options},createPlatformCommands()).executeOwner("pm.work_item.create_with_evidence",{projectId:project.id,...input},randomUUID()) as ProjectManagerWorkItem;
      res.status(201).json({ code: 0, data: { workItem: toWorkItemDto(workItem) }, message: "" });
    } catch (error) {
      sendMutationError(res, error, "Work item creation failed");
    }
  });

  router.get("/:projectId/project-manager/task-packets", (req, res) => {
    const parse = taskPacketsQuerySchema.safeParse(req.query ?? {});
    if (!parse.success) return sendInvalidInput(res);
    const userId = userIdFor(req);
    const project = requireProject(db, userId, req.params.projectId);
    if (!project) return sendProjectNotFound(res);
    const workItems = new ProjectManagerRepository(db, userId).listWorkItems(project.id, {
      ...(parse.data.limit !== undefined ? { limit: parse.data.limit } : {})
    });
    const sessionsByWorkItem = resolveTaskPacketSessions(db, userId, project.id, workItems);
    const taskPackets = workItems.map((workItem) => buildTaskPacket({
      project,
      workItem,
      session: sessionsByWorkItem.get(workItem.id) ?? null
    }));
    res.json({ code: 0, data: { taskPackets }, message: "" });
  });

  router.get("/:projectId/project-manager/starter-packs", (req, res) => {
    const userId = userIdFor(req);
    const project = requireProject(db, userId, req.params.projectId);
    if (!project) return sendProjectNotFound(res);
    res.json({ code: 0, data: { starterPacks: listStarterTaskPacks().map(toStarterPackDto) }, message: "" });
  });

  router.post("/:projectId/project-manager/starter-packs/:packId/task-packet", (req, res) => {
    const userId = userIdFor(req);
    const project = requireProject(db, userId, req.params.projectId);
    if (!project) return sendProjectNotFound(res);
    const pack = getStarterTaskPack(req.params.packId);
    if (!pack) return sendStarterPackNotFound(res);
    try {
      const repo = new ProjectManagerRepository(db, userId);
      const workItem = repo.createWorkItem(project.id, createStarterPackWorkItemInput(pack));
      const taskPacket = buildTaskPacket({ project, workItem });
      res.status(201).json({
        code: 0,
        data: {
          pack: toStarterPackDto(pack),
          workItem: toWorkItemDto(workItem),
          taskPacket
        },
        message: ""
      });
    } catch (error) {
      sendMutationError(res, error, "Starter pack task packet creation failed");
    }
  });

  router.post("/:projectId/project-manager/work-items/batch/status", (req, res) => {
    const parse = batchStatusBodySchema.safeParse(req.body ?? {});
    if (!parse.success) return sendInvalidInput(res);
    const userId = userIdFor(req);
    const project = requireProject(db, userId, req.params.projectId);
    if (!project) return sendProjectNotFound(res);
    try {
      const workItems = new ProjectManagerRepository(db, userId)
        .batchUpdateWorkItemStatuses(project.id, parse.data)
        .map(toWorkItemDto);
      res.json({ code: 0, data: { workItems }, message: "" });
    } catch (error) {
      sendMutationError(res, error, "Work item batch status update failed");
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

  router.get("/:projectId/project-manager/work-items/:workItemId/task-packet", (req, res) => {
    const userId = userIdFor(req);
    const project = requireProject(db, userId, req.params.projectId);
    if (!project) return sendProjectNotFound(res);
    const workItem = new ProjectManagerRepository(db, userId).getWorkItem(project.id, req.params.workItemId);
    if (!workItem) return sendWorkItemNotFound(res);
    const packet = buildTaskPacket({
      project,
      workItem,
      session: resolveTaskPacketSession(db, userId, project.id, workItem)
    });
    res.json({ code: 0, data: { taskPacket: packet }, message: "" });
  });

  router.post("/:projectId/project-manager/work-items/:workItemId/task-packet/session-link", (req, res) => {
    const parse = taskPacketSessionLinkBodySchema.safeParse(req.body ?? {});
    if (!parse.success) return sendInvalidInput(res);
    const userId = userIdFor(req);
    const project = requireProject(db, userId, req.params.projectId);
    if (!project) return sendProjectNotFound(res);
    const repo = new ProjectManagerRepository(db, userId);
    const workItem = repo.getWorkItem(project.id, req.params.workItemId);
    if (!workItem) return sendWorkItemNotFound(res);
    const session = new SessionRepository(db, userId).getById(parse.data.sessionId);
    if (!session || session.projectId !== project.id) return sendSessionNotFound(res);
    try {
      const updated = repo.updateWorkItem(project.id, workItem.id, {
        details: withTaskPacketSessionLink(workItem.details, session, project)
      });
      const packet = buildTaskPacket({ project, workItem: updated, session });
      res.json({ code: 0, data: { taskPacket: packet }, message: "" });
    } catch (error) {
      sendMutationError(res, error, "Task packet session link failed");
    }
  });

  router.post("/:projectId/project-manager/work-items/:workItemId/task-packet/start", async (req, res) => {
    const parse = taskPacketStartBodySchema.safeParse(req.body ?? {});
    if (!parse.success) return sendInvalidInput(res);
    const userId = userIdFor(req);
    const project = requireProject(db, userId, req.params.projectId);
    if (!project) return sendProjectNotFound(res);

    const requestedAdapter = parse.data.aiTool ?? project.aiTool ?? "";
    if (!isAdapterId(requestedAdapter)) {
      res.status(400).json({
        code: 1,
        message: "Runtime CLI selection is required for CLI-agnostic projects",
        details: {}
      });
      return;
    }
    const launchStatus = await getAdapterLaunchStatus(requestedAdapter, options.adapterCommandRunner);
    if (!launchStatus.launchEnabled) {
      res.status(409).json({
        code: 1,
        message: `${launchStatus.label} is not available for launch`,
        details: {
          adapter: launchStatus.id,
          command: launchStatus.command,
          status: launchStatus.status,
          error: launchStatus.error
        }
      });
      return;
    }

    const repo = new ProjectManagerRepository(db, userId);
    const workItem = repo.getWorkItem(project.id, req.params.workItemId);
    if (!workItem) return sendWorkItemNotFound(res);

    try {
      const result = await new PlatformActions({db,userId,...options},createPlatformCommands()).executeOwner(
        "pm.task.prepare",{projectId:project.id,workItemId:workItem.id,aiTool:requestedAdapter},randomUUID()
      ) as {taskPacket:unknown;session:unknown;existed:boolean};
      res.status(result.existed ? 200 : 201).json({
        code:0,data:{taskPacket:result.taskPacket,session:result.session},message:""
      });
    } catch (error) {
      sendMutationError(res, error, "Task packet start failed");
    }
  });

  router.patch("/:projectId/project-manager/work-items/:workItemId", async (req, res) => {
    const parse = workItemUpdateSchema.safeParse(req.body ?? {});
    if (!parse.success) return sendInvalidInput(res);
    const userId = userIdFor(req);
    const project = requireProject(db, userId, req.params.projectId);
    if (!project) return sendProjectNotFound(res);
    const repo = new ProjectManagerRepository(db, userId);
    if (!repo.getWorkItem(project.id, req.params.workItemId)) return sendWorkItemNotFound(res);
    try {
      const workItem = await new PlatformActions({db,userId,...options},createPlatformCommands()).executeOwner("pm.work_item.update",{projectId:project.id,workItemId:req.params.workItemId,...parse.data},randomUUID()) as ProjectManagerWorkItem;
      res.json({ code: 0, data: { workItem: toWorkItemDto(workItem) }, message: "" });
    } catch (error) {
      sendMutationError(res, error, "Work item update failed");
    }
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

  router.delete("/:projectId/project-manager/work-items/:workItemId", (req, res) => {
    const parse = deleteWorkItemBodySchema.safeParse(req.body ?? {});
    if (!parse.success) return sendInvalidInput(res);
    const userId = userIdFor(req);
    const project = requireProject(db, userId, req.params.projectId);
    if (!project) return sendProjectNotFound(res);
    const repo = new ProjectManagerRepository(db, userId);
    if (!repo.getWorkItem(project.id, req.params.workItemId)) return sendWorkItemNotFound(res);
    try {
      const workItem = repo.deleteWorkItem(project.id, req.params.workItemId, parse.data);
      res.json({ code: 0, data: { workItem: toWorkItemDto(workItem) }, message: "" });
    } catch (error) {
      sendMutationError(res, error, "Work item deletion failed");
    }
  });

  router.get("/:projectId/project-manager/stages", (req, res) => {
    const userId = userIdFor(req);
    const project = requireProject(db, userId, req.params.projectId);
    if (!project) return sendProjectNotFound(res);
    const stages = new ProjectManagerRepository(db, userId)
      .listStages(project.id)
      .map(toStageDto);
    res.json({ code: 0, data: { stages }, message: "" });
  });

  router.post("/:projectId/project-manager/stages", (req, res) => {
    const parse = stageCreateSchema.safeParse(req.body ?? {});
    if (!parse.success) return sendInvalidInput(res);
    const userId = userIdFor(req);
    const project = requireProject(db, userId, req.params.projectId);
    if (!project) return sendProjectNotFound(res);
    try {
      const stage = new ProjectManagerRepository(db, userId).createStage(project.id, parse.data);
      res.status(201).json({ code: 0, data: { stage: toStageDto(stage) }, message: "" });
    } catch (error) {
      sendMutationError(res, error, "Stage creation failed");
    }
  });

  router.post("/:projectId/project-manager/stages/seed-template", (req, res) => {
    const userId = userIdFor(req);
    const project = requireProject(db, userId, req.params.projectId);
    if (!project) return sendProjectNotFound(res);
    try {
      const stages = new ProjectManagerRepository(db, userId)
        .seedStageTemplate(project.id)
        .map(toStageDto);
      res.status(201).json({ code: 0, data: { stages }, message: "" });
    } catch (error) {
      sendMutationError(res, error, "Stage template seeding failed");
    }
  });

  router.post("/:projectId/project-manager/stages/reorder", (req, res) => {
    const parse = stageReorderSchema.safeParse(req.body ?? {});
    if (!parse.success) return sendInvalidInput(res);
    const userId = userIdFor(req);
    const project = requireProject(db, userId, req.params.projectId);
    if (!project) return sendProjectNotFound(res);
    try {
      const stages = new ProjectManagerRepository(db, userId)
        .reorderStages(project.id, parse.data.stageIds)
        .map(toStageDto);
      res.json({ code: 0, data: { stages }, message: "" });
    } catch (error) {
      sendMutationError(res, error, "Stage reorder failed");
    }
  });

  router.patch("/:projectId/project-manager/stages/:stageId", (req, res) => {
    const parse = stageUpdateSchema.safeParse(req.body ?? {});
    if (!parse.success) return sendInvalidInput(res);
    const userId = userIdFor(req);
    const project = requireProject(db, userId, req.params.projectId);
    if (!project) return sendProjectNotFound(res);
    const repo = new ProjectManagerRepository(db, userId);
    if (!repo.getStage(project.id, req.params.stageId)) return sendStageNotFound(res);
    try {
      const stage = repo.updateStage(project.id, req.params.stageId, parse.data);
      res.json({ code: 0, data: { stage: toStageDto(stage) }, message: "" });
    } catch (error) {
      sendMutationError(res, error, "Stage update failed");
    }
  });

  router.delete("/:projectId/project-manager/stages/:stageId", (req, res) => {
    const userId = userIdFor(req);
    const project = requireProject(db, userId, req.params.projectId);
    if (!project) return sendProjectNotFound(res);
    const repo = new ProjectManagerRepository(db, userId);
    if (!repo.getStage(project.id, req.params.stageId)) return sendStageNotFound(res);
    try {
      const stage = repo.deleteStage(project.id, req.params.stageId);
      res.json({ code: 0, data: { stage: toStageDto(stage) }, message: "" });
    } catch (error) {
      sendMutationError(res, error, "Stage deletion failed");
    }
  });

  router.get("/:projectId/project-manager/work-item-links", (req, res) => {
    const userId = userIdFor(req);
    const project = requireProject(db, userId, req.params.projectId);
    if (!project) return sendProjectNotFound(res);
    const links = new ProjectManagerRepository(db, userId)
      .listWorkItemLinks(project.id)
      .map(toWorkItemLinkDto);
    res.json({ code: 0, data: { links }, message: "" });
  });

  router.post("/:projectId/project-manager/work-items/:workItemId/dependencies", (req, res) => {
    const parse = dependencyBodySchema.safeParse(req.body ?? {});
    if (!parse.success) return sendInvalidInput(res);
    const userId = userIdFor(req);
    const project = requireProject(db, userId, req.params.projectId);
    if (!project) return sendProjectNotFound(res);
    const repo = new ProjectManagerRepository(db, userId);
    if (!repo.getWorkItem(project.id, req.params.workItemId)) return sendWorkItemNotFound(res);
    try {
      const link = repo.addWorkItemDependency(project.id, req.params.workItemId, parse.data.blockerWorkItemId);
      res.status(201).json({ code: 0, data: { link: toWorkItemLinkDto(link) }, message: "" });
    } catch (error) {
      sendMutationError(res, error, "Dependency creation failed");
    }
  });

  router.delete("/:projectId/project-manager/work-items/:workItemId/dependencies/:blockerWorkItemId", (req, res) => {
    const userId = userIdFor(req);
    const project = requireProject(db, userId, req.params.projectId);
    if (!project) return sendProjectNotFound(res);
    const repo = new ProjectManagerRepository(db, userId);
    if (!repo.getWorkItem(project.id, req.params.workItemId)) return sendWorkItemNotFound(res);
    try {
      repo.removeWorkItemDependency(project.id, req.params.workItemId, req.params.blockerWorkItemId);
      res.json({ code: 0, data: {}, message: "" });
    } catch (error) {
      sendMutationError(res, error, "Dependency removal failed");
    }
  });

  router.get("/:projectId/project-manager/ledger", (req, res) => {
    const parse = ledgerQuerySchema.safeParse(req.query ?? {});
    if (!parse.success) return sendInvalidInput(res);
    const userId = userIdFor(req);
    const project = requireProject(db, userId, req.params.projectId);
    if (!project) return sendProjectNotFound(res);
    const options = {
      ...(parse.data.eventType ? { eventType: parse.data.eventType } : {}),
      ...(parse.data.limit !== undefined ? { limit: parse.data.limit } : {})
    };
    const events = new ProjectManagerRepository(db, userId)
      .listLedgerEvents(project.id, options)
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
    stageId: workItem.stageId,
    createdAt: workItem.createdAt,
    updatedAt: workItem.updatedAt
  };
}

function toStageDto(stage: ProjectManagerStage) {
  return {
    id: stage.id,
    projectId: stage.projectId,
    name: stage.name,
    description: stage.description,
    position: stage.position,
    status: stage.status,
    createdAt: stage.createdAt,
    updatedAt: stage.updatedAt
  };
}

function toWorkItemLinkDto(link: ProjectManagerWorkItemLink) {
  return {
    id: link.id,
    projectId: link.projectId,
    blockerWorkItemId: link.blockerWorkItemId,
    blockedWorkItemId: link.blockedWorkItemId,
    createdAt: link.createdAt
  };
}

function toStarterPackDto(pack: StarterTaskPack) {
  return {
    id: pack.id,
    name: pack.name,
    description: pack.description,
    recommendedAdapter: pack.recommendedAdapter,
    promptFrame: pack.promptFrame,
    acceptanceChecklist: pack.acceptanceChecklist,
    verificationGuidance: pack.verificationGuidance,
    evidenceFields: pack.evidenceFields
  };
}

function createStarterPackWorkItemInput(pack: StarterTaskPack) {
  return {
    title: pack.name,
    description: pack.promptFrame,
    acceptanceCriteria: pack.acceptanceChecklist,
    details: {
      taskPacket: {
        starterPackId: pack.id,
        starterPackName: pack.name,
        recommendedAdapter: pack.recommendedAdapter,
        promptFrame: pack.promptFrame,
        expectedVerification: pack.verificationGuidance,
        evidenceRequirements: pack.evidenceFields
      }
    }
  };
}












function toLedgerEventDto(event: ProjectManagerLedgerEvent) {
  const trace = toLedgerTraceDto(event.details);
  return {
    id: event.id,
    projectId: event.projectId,
    workItemId: event.workItemId,
    eventType: event.eventType,
    status: event.status,
    evidenceRefCount: event.evidenceRefs.length,
    feishuRefCount: event.feishuRefs.length,
    ...(trace ? { trace } : {}),
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
    feishuChatId: ref.feishuChatId,
    feishuMessageId: ref.feishuMessageId,
    createdAt: ref.createdAt
  };
}

function toLedgerTraceDto(details: Record<string, unknown>): ProjectManagerLedgerTrace | undefined {
  const trace: ProjectManagerLedgerTrace = {};
  assignTraceString(trace, "actionType", details.actionType);
  assignTraceString(trace, "targetType", details.targetType);
  assignTraceString(trace, "targetId", details.targetId);
  assignTraceCount(trace, details.evidenceRefCount);
  assignTraceString(trace, "approvalStatus", details.approvalStatus);
  assignTraceString(trace, "executionStatus", details.executionStatus);
  return Object.keys(trace).length > 0 ? trace : undefined;
}

function assignTraceString(
  trace: ProjectManagerLedgerTrace,
  key: keyof Omit<ProjectManagerLedgerTrace, "evidenceRefCount">,
  value: unknown
): void {
  if (typeof value !== "string") return;
  const normalized = value.trim();
  if (!normalized || normalized.length > 512) return;
  trace[key] = normalized;
}

function assignTraceCount(trace: ProjectManagerLedgerTrace, value: unknown): void {
  if (!Number.isInteger(value) || typeof value !== "number" || value < 0 || value > 20) return;
  trace.evidenceRefCount = value;
}

function sendProjectNotFound(res: { status(code: number): { json(body: unknown): void } }): void {
  res.status(404).json({ code: 1, message: "Project not found" });
}

function sendWorkItemNotFound(res: { status(code: number): { json(body: unknown): void } }): void {
  res.status(404).json({ code: 1, message: "Work item not found" });
}

function sendStageNotFound(res: { status(code: number): { json(body: unknown): void } }): void {
  res.status(404).json({ code: 1, message: "Stage not found" });
}

function sendSessionNotFound(res: { status(code: number): { json(body: unknown): void } }): void {
  res.status(404).json({ code: 1, message: "Session not found" });
}

function sendStarterPackNotFound(res: { status(code: number): { json(body: unknown): void } }): void {
  res.status(404).json({ code: 1, message: "Starter pack not found" });
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
