import { adapterIds } from "../lib/adapter-ids.js";
import { canUseProjectPath, hasDeliveryHistory } from '../db/repositories/managed-project-access.js';
import { randomUUID } from "node:crypto";
import { PlatformActions } from "../services/platform-commands/actions.js";
import { createPlatformCommands } from "../services/platform-commands/catalog.js";
import { Router, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { createClaudeLaunchPlan } from "../adapters/claude.js";
import {
  ConfigWriteError,
  createRenderPlan,
  detectConfigConflicts,
  writeConfigPlan
} from "../config-generation/index.js";
import { validateProjectRoot } from "../lib/safe-resolve.js";
import { AuditLogRepository } from "../db/repositories/audit-log-repository.js";
import { ProjectRepository } from "../db/repositories/project-repository.js";
import { SessionRepository } from "../db/repositories/session-repository.js";
import { TemplateRepository } from "../db/repositories/template-repository.js";
import type { Database } from "../db/types.js";
import type { InMemorySessionManager } from "../services/session-manager.js";
import type { ForgeBadgerEventBus } from "../services/event-bus.js";
import type { RuntimeAuthorizationInvalidator } from "../services/runtime-authorization-invalidation.js";
import type { CredentialMode, WriteResult } from "../config-generation/types.js";
import { readGlobalAiConfig, readProjectAiConfig, writeProjectAiConfigFile } from "../services/project-ai-config.js";
import {
  createWorkspaceFile,
  listWorkspaceTree,
  maxFileWriteBytes,
  readWorkspaceFile,
  renameWorkspaceEntry,
  writeWorkspaceFile
} from "../services/workspace-context.js";
import {
  checkoutProjectGitBranch,
  commitProjectGitChanges,
  discardProjectGitFile,
  getProjectGitBranches,
  getProjectGitChangesCached,
  getProjectGitFileDiff,
  initProjectGitRepo,
  inspectDirectoryGitSummary,
  inspectDirectoryGitSummaryCached,
  ProjectGitError,
  stageProjectGitFiles,
  unstageProjectGitFiles
} from "../services/project-git.js";
import { recordActivity } from "../services/activity-events.js";
import { buildConfigSyncSummary, buildProjectConfigRenderPlan } from "../services/project-config-render.js";
import { extractProjectTemplate } from "../services/project-template-extract.js";
export {
  buildConfigSyncSummary,
  buildProjectConfigRenderPlan
} from "../services/project-config-render.js";

const aiToolSchema = z.enum(adapterIds);

const createProjectSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  description: z.string().optional(),
  techStack: z.string().optional(),
  templateId: z.string().min(1).optional(),
  initGit: z.boolean().optional()
});

const updateProjectSchema = z.object({
  templateId: z.string().min(1).nullable().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional()
});

const extractTemplateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  adapter: aiToolSchema.optional(),
  bind: z.boolean().optional()
});

const configPreviewSchema = z.object({
  templateId: z.string().min(1),
  credentialMode: z.enum(["host_environment", "stored_encrypted_key"]),
  decisions: z.record(z.enum(["skip", "overwrite"])).optional()
});

const configSyncSchema = z.object({
  templateId: z.string().min(1).optional(),
  credentialMode: z.enum(["host_environment", "stored_encrypted_key"]).default("host_environment"),
  decisions: z.record(z.enum(["skip", "overwrite"])).optional()
});

const configComplianceQuerySchema = z.object({
  templateId: z.string().min(1).optional(),
  credentialMode: z.enum(["host_environment", "stored_encrypted_key"]).default("host_environment")
});

const aiConfigWriteSchema = z.object({
  relativePath: z.string().min(1).max(512),
  content: z.string().max(128 * 1024),
  aiTool: z.enum(adapterIds).optional()
});

const aiConfigQuerySchema = z.object({
  aiTool: aiToolSchema.optional()
}).strict();

const workspaceTreeQuerySchema = z.object({
  path: z.string().max(512).optional(),
  depth: z.coerce.number().int().min(1).max(3).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional()
}).strict();

const workspaceFileQuerySchema = z.object({
  path: z.string().min(1).max(512)
}).strict();

const workspaceFileWriteSchema = z.object({
  path: z.string().min(1).max(512),
  content: z.string().max(maxFileWriteBytes)
}).strict();

const workspaceFileCreateSchema = z.object({
  path: z.string().min(1).max(512),
  content: z.string().max(maxFileWriteBytes).optional().default("")
}).strict();

const workspaceRenameSchema = z.object({
  fromPath: z.string().min(1).max(512),
  toPath: z.string().min(1).max(512)
}).strict();

const gitDiffQuerySchema = z.object({
  path: z.string().min(1).max(512),
  untracked: z.enum(["0", "1"]).optional()
}).strict();

const gitCheckoutSchema = z.object({
  branch: z.string().min(1).max(200),
  create: z.boolean().optional().default(false)
}).strict();

const gitStageSchema = z.object({
  paths: z.array(z.string().min(1).max(512)).max(200).optional(),
  all: z.boolean().optional()
}).strict().refine((value) => value.all === true || (value.paths && value.paths.length > 0), {
  message: "Either all=true or non-empty paths is required"
});

const gitCommitSchema = z.object({
  message: z.string().trim().min(1).max(4000)
}).strict();

const gitDiscardSchema = z.object({
  path: z.string().min(1).max(512),
  untracked: z.boolean().optional().default(false)
}).strict();

function gitCheckoutErrorStatus(code: ProjectGitError["code"]): number {
  switch (code) {
    case "GIT_BRANCH_NOT_FOUND":
      return 404;
    case "GIT_WORKING_TREE_DIRTY":
    case "GIT_BRANCH_EXISTS":
    case "GIT_NOTHING_STAGED":
      return 409;
    default:
      return 400;
  }
}

// Projects are created CLI-agnostic: ai_tool stays an empty sentinel until an
// explicit designation exists (e.g. a project draft naming an adapter).
// Legacy rows still carry "claude" and keep working through explicit overrides.
const unboundProjectAiTool = "";

function parseAiToolHint(value: string | null | undefined): z.infer<typeof aiToolSchema> | undefined {
  const parsed = aiToolSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
const rootInstructionFileNames = ["AGENT.md", "AGENTS.md", "CLAUDE.md"] as const;

export function createProjectRoutes(
  db: Database,
  runtimeAuthorizationInvalidator: RuntimeAuthorizationInvalidator,
  sessionManager?: InMemorySessionManager,
  eventBus?: ForgeBadgerEventBus
): Router {
  const router = Router();
  router.use(authenticate);
  router.use((req,res,next) => {
    const actorId=(req as unknown as AuthenticatedRequest).userId;
    if (typeof req.body?.path === "string" && !canUseProjectPath(db,actorId,req.body.path)) {
      res.status(403).json({code:1,message:"Protected project path",details:{code:"MANAGED_PROJECT_ACCESS_DENIED"}}); return;
    }
    next();
  });

  router.post("/", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = createProjectSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    if (parseResult.data.templateId) {
      try {
        resolveProjectTemplateId(db, userId, parseResult.data.templateId);
      } catch {
        res.status(404).json({ code: 1, message: "Template not found" });
        return;
      }
    }

    try {
      const { initGit, ...createInput } = parseResult.data;
      const project = await new PlatformActions({db,userId},createPlatformCommands()).executeOwner("project.create",createInput,randomUUID()) as { id: string; path: string };
      let gitInitialized: boolean | undefined;
      let gitInitError: string | undefined;
      if (initGit) {
        try {
          const initResult = await initProjectGitRepo(project.path);
          gitInitialized = initResult.initialized || initResult.alreadyRepo;
        } catch (gitError) {
          gitInitialized = false;
          gitInitError = gitError instanceof Error ? gitError.message : "Failed to initialize git repository";
        }
      }
      res.status(201).json({
        code: 0,
        data: {
          project,
          ...(gitInitialized !== undefined ? { gitInitialized } : {}),
          ...(gitInitError ? { gitInitError } : {})
        },
        message: ""
      });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Failed to create project"
      });
    }
  });

  router.get("/", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new ProjectRepository(db, userId);
    const projects = repo.list();
    res.json({
      code: 0,
      data: { projects },
      message: ""
    });
  });

  router.get("/git-summaries", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const projects = new ProjectRepository(db, userId).list();
    const entries = await mapWithConcurrency(projects, 6, async (project) => {
      try {
        const summary = await inspectDirectoryGitSummaryCached(project.path);
        return [project.id, summary] as const;
      } catch {
        return [project.id, { isGitRepo: false, branch: null, changedCount: 0 }] as const;
      }
    });
    res.json({
      code: 0,
      data: { summaries: Object.fromEntries(entries) },
      message: ""
    });
  });

  router.get("/:id", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new ProjectRepository(db, userId);
    const project = repo.getById(req.params.id);
    if (!project) {
      res.status(404).json({ code: 1, message: "Project not found" });
      return;
    }
    res.json({
      code: 0,
      data: { project },
      message: ""
    });
  });

  router.post("/scan", async (req, res) => {
    const { path: scanPath } = req.body ?? {};
    if (typeof scanPath !== "string" || scanPath.trim().length === 0) {
      res.status(400).json({ code: 1, message: "Path is required" });
      return;
    }

    try {
      const resolved = validateProjectRoot(scanPath.trim());
      const stats = await stat(resolved);
      if (!stats.isDirectory()) {
        res.status(400).json({ code: 1, message: "Path is not a directory" });
        return;
      }
      const gitSummary = await inspectDirectoryGitSummary(resolved).catch(() => ({
        isGitRepo: false,
        branch: null,
        changedCount: 0
      }));
      const hasCodeGraph = existsSync(resolve(resolved, ".codegraph", "codegraph.db"));
      res.json({
        code: 0,
        data: {
          path: resolved,
          exists: true,
          isDirectory: true,
          instructionFiles: listRootInstructionFiles(resolved),
          isGitRepo: gitSummary.isGitRepo,
          gitBranch: gitSummary.branch,
          gitChangedCount: gitSummary.changedCount,
          hasCodeGraph
        },
        message: ""
      });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Scan failed"
      });
    }
  });

  router.post("/import", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = createProjectSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    if (parseResult.data.templateId) {
      try {
        resolveProjectTemplateId(db, userId, parseResult.data.templateId);
      } catch {
        res.status(404).json({ code: 1, message: "Template not found" });
        return;
      }
    }

    try {
      const { name, path: rawPath, description, techStack, templateId } = parseResult.data;
      const rootPath = await prepareImportedProjectRoot(rawPath);
      const repo = new ProjectRepository(db, userId);
      const project = repo.import({
        name,
        path: rootPath,
        description,
        techStack,
        templateId,
        aiTool: unboundProjectAiTool
      });
      res.status(201).json({
        code: 0,
        data: { project },
        message: ""
      });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Failed to import project"
      });
    }
  });

  router.delete("/:id", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new ProjectRepository(db, userId);
    const project = repo.getById(req.params.id);
    if (!project) {
      res.status(404).json({ code: 1, message: "Project not found" });
      return;
    }
    if (hasDeliveryHistory(db,"project",project.id)) {
      res.status(409).json({code:1,message:"Project has delivery history; archive it in the workspace",details:{code:"DELIVERY_HISTORY_REQUIRES_ARCHIVE"}}); return;
    }
    const sessionRepo = new SessionRepository(db, userId);
    const projectSessions = sessionRepo.list().filter(session => session.projectId === project.id)
      .sort((a, b) => a.id.localeCompare(b.id));
    const removeWhenStopped = async (): Promise<void> => {
      if (sessionManager) {
        for (const session of projectSessions) {
          const live = sessionManager.getSession(session.id);
          const runtimeName = live?.runtimeSessionName ?? session.runtimeSessionName ?? undefined;
          if (live || runtimeName) await sessionManager.stopSession(session.id, runtimeName, userId);
        }
      }
      repo.delete(project.id);
    };
    // Hold every existing session lock through deletion, including error/idle
    // rows whose process can still be alive after a failed launch or IPC outage.
    const withSessionLocks = async (index: number): Promise<void> => {
      const session = projectSessions[index];
      if (!sessionManager || !session) return removeWhenStopped();
      await sessionManager.runExclusive(session.id, () => withSessionLocks(index + 1));
    };
    try {
      await withSessionLocks(0);
    } catch {
      res.status(409).json({ code: 1, message: "Project sessions have not all confirmed their stop; retry after the runtime is available", details: { code: "SESSION_RUNTIME_STOP_UNCONFIRMED" } });
      return;
    }
    runtimeAuthorizationInvalidator.invalidate({
      scope: "project",
      userId,
      projectId: project.id
    });
    new AuditLogRepository(db, userId).create({
      action: "project.delete",
      resourceType: "project",
      resourceId: project.id,
      details: { name: project.name, path: project.path }
    });
    res.json({
      code: 0,
      data: {},
      message: ""
    });
  });

  router.patch("/:id", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = updateProjectSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    const repo = new ProjectRepository(db, userId);
    let project = repo.getById(req.params.id);
    if (!project) {
      res.status(404).json({ code: 1, message: "Project not found" });
      return;
    }

    const { templateId, name, description } = parseResult.data;

    if (templateId !== undefined && templateId !== null) {
      const template = new TemplateRepository(db, userId).getById(templateId);
      if (!template) {
        res.status(404).json({ code: 1, message: "Template not found" });
        return;
      }
    }

    if (name !== undefined || description !== undefined) {
      const normalizedDescription =
        description === undefined ? undefined : description === null ? null : (description.trim() || null);
      const updatedMeta = repo.updateMetadata(project.id, {
        ...(name !== undefined ? { name } : {}),
        ...(normalizedDescription !== undefined ? { description: normalizedDescription } : {})
      });
      if (updatedMeta) project = updatedMeta;
      new AuditLogRepository(db, userId).create({
        action: "project.metadata.update",
        resourceType: "project",
        resourceId: project.id,
        details: { name: project.name }
      });
    }

    if (templateId !== undefined) {
      const updatedTemplate = repo.updateTemplateId(project.id, templateId);
      if (updatedTemplate) project = updatedTemplate;
      new AuditLogRepository(db, userId).create({
        action: templateId === null ? "project.template.unbind" : "project.template.bind",
        resourceType: "project",
        resourceId: project.id,
        details: { name: project.name, templateId }
      });
    }

    res.json({ code: 0, data: { project }, message: "" });
  });

  router.post("/:id/templates", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = extractTemplateSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    const repo = new ProjectRepository(db, userId);
    const project = repo.getById(req.params.id);
    if (!project) {
      res.status(404).json({ code: 1, message: "Project not found" });
      return;
    }

    const adapter = parseResult.data.adapter ?? parseAiToolHint(project.aiTool);
    if (!adapter) {
      res.status(400).json({ code: 1, message: "An explicit adapter in the request body is required for CLI-agnostic projects" });
      return;
    }

    try {
      const extracted = await extractProjectTemplate(project.path, adapter);
      if (extracted.files.length === 0) {
        res.status(400).json({ code: 1, message: "No extractable AI config files found in project" });
        return;
      }

      const { name, description, bind } = parseResult.data;
      const template = new TemplateRepository(db, userId).create({
        name,
        adapter,
        ...(description === undefined ? {} : { description }),
        files: extracted.files.map((f) => ({
          filePath: f.filePath,
          content: f.content,
          fileType: f.fileType
        }))
      });

      if (bind ?? true) {
        repo.updateTemplateId(project.id, template.id);
      }

      new AuditLogRepository(db, userId).create({
        action: "template.extract",
        resourceType: "template",
        resourceId: template.id,
        details: {
          name,
          projectId: project.id,
          bind,
          extractedFiles: extracted.files.map((f) => f.filePath),
          skippedFiles: extracted.skipped
        }
      });

      res.status(201).json({
        code: 0,
        data: {
          template,
          extracted: extracted.files.map((f) => ({
            filePath: f.filePath,
            sizeBytes: Buffer.byteLength(f.content, "utf8")
          })),
          skipped: extracted.skipped
        },
        message: ""
      });
    } catch (error) {
      res.status(400).json({ code: 1, message: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post("/:id/config/preview", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const projectId = req.params.id;
    const parseResult = configPreviewSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    try {
      const { templateId, credentialMode } = parseResult.data;
      const projectRepo = new ProjectRepository(db, userId);
      const project = projectRepo.getById(projectId);
      if (!project) {
        res.status(404).json({ code: 1, message: "Project not found" });
        return;
      }

      const templateRepo = new TemplateRepository(db, userId);
      const template = templateRepo.getById(templateId);
      if (!template || !template.files) {
        res.status(404).json({ code: 1, message: "Template not found" });
        return;
      }

      const plan = await buildProjectConfigRenderPlan(db, userId, project.id, template.id, credentialMode, true);

      const conflicts = await detectConfigConflicts(plan);
      res.json({
        code: 0,
        data: { plan, conflicts },
        message: ""
      });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Preview failed"
      });
    }
  });

  router.post("/:id/config/write", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const projectId = req.params.id;
    const parseResult = configPreviewSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    try {
      const { templateId, credentialMode, decisions } = parseResult.data;
      const projectRepo = new ProjectRepository(db, userId);
      const project = projectRepo.getById(projectId);
      if (!project) {
        res.status(404).json({ code: 1, message: "Project not found" });
        return;
      }

      const templateRepo = new TemplateRepository(db, userId);
      const template = templateRepo.getById(templateId);
      if (!template || !template.files) {
        res.status(404).json({ code: 1, message: "Template not found" });
        return;
      }

      const plan = await buildProjectConfigRenderPlan(db, userId, project.id, template.id, credentialMode, false);

      const result = await writeConfigPlan(
        plan,
        decisions === undefined ? {} : { decisions }
      );
      const activityStatus = result.outcome === "applied" ? "success" : result.outcome === "rolled_back" ? "warning" : "error";
      recordActivity({
        db,
        eventBus,
        userId,
        projectId: project.id,
        type: "config_write",
        status: activityStatus,
        message: `Config written for ${project.name}`,
        metadata: {
          templateId,
          writtenFiles: result.writtenFiles,
          skippedFiles: result.skippedFiles,
          outcome: result.outcome,
          failedFiles: result.failedFiles
        }
      });
      const outcomeResponse = configWriteOutcomeResponse(result.outcome);
      res.status(outcomeResponse.status).json({
        code: outcomeResponse.code,
        data: { result },
        message: outcomeResponse.message
      });
    } catch (error) {
      if (error instanceof ConfigWriteError) {
        res.status(409).json({
          code: 1,
          data: { conflicts: error.conflicts },
          message: error.message
        });
        return;
      }
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Write failed"
      });
    }
  });

  router.post("/:id/config/sync/preview", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const projectId = req.params.id;
    const parseResult = configSyncSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    try {
      const projectRepo = new ProjectRepository(db, userId);
      const project = projectRepo.getById(projectId);
      if (!project) {
        res.status(404).json({ code: 1, message: "Project not found" });
        return;
      }

      const templateId = parseResult.data.templateId ?? project.templateId ?? null;
      if (!templateId) {
        res.status(404).json({
          code: 1,
          message: "Project is not tracking any template",
          details: { code: "TEMPLATE_NOT_TRACKED" }
        });
        return;
      }
      const plan = await buildProjectConfigRenderPlan(
        db,
        userId,
        project.id,
        templateId,
        parseResult.data.credentialMode,
        true
      );
      const conflicts = await detectConfigConflicts(plan);

      res.json({
        code: 0,
        data: { plan, conflicts, summary: buildConfigSyncSummary(plan, conflicts) },
        message: ""
      });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Sync preview failed"
      });
    }
  });

  router.post("/:id/config/sync/apply", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const projectId = req.params.id;
    const parseResult = configSyncSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    try {
      const projectRepo = new ProjectRepository(db, userId);
      const project = projectRepo.getById(projectId);
      if (!project) {
        res.status(404).json({ code: 1, message: "Project not found" });
        return;
      }

      const templateId = parseResult.data.templateId ?? project.templateId ?? null;
      if (!templateId) {
        res.status(404).json({
          code: 1,
          message: "Project is not tracking any template",
          details: { code: "TEMPLATE_NOT_TRACKED" }
        });
        return;
      }
      const plan = await buildProjectConfigRenderPlan(
        db,
        userId,
        project.id,
        templateId,
        parseResult.data.credentialMode,
        false
      );
      const result = await writeConfigPlan(
        plan,
        parseResult.data.decisions === undefined ? {} : { decisions: parseResult.data.decisions }
      );
      const summary = buildConfigSyncSummary(plan, result.conflicts);
      const outcomeResponse = configWriteOutcomeResponse(result.outcome);
      recordActivity({
        db,
        eventBus,
        userId,
        projectId: project.id,
        type: "config_sync",
        status: result.outcome === "applied" ? "success" : result.outcome === "rolled_back" ? "warning" : "error",
        message: `Config synced for ${project.name}`,
        metadata: {
          templateId,
          writtenFiles: result.writtenFiles,
          skippedFiles: result.skippedFiles,
          outcome: result.outcome,
          failedFiles: result.failedFiles
        }
      });
      new AuditLogRepository(db, userId).create({
        action: "project.config_sync",
        resourceType: "project",
        resourceId: project.id,
        details: {
          templateId,
          writtenFiles: result.writtenFiles.length,
          skippedFiles: result.skippedFiles.length,
          conflicts: result.conflicts.length,
          decisionRequired: summary.requiresDecision.length,
          outcome: result.outcome,
          failedFiles: result.failedFiles.length
        },
        ipAddress: req.ip
      });

      res.status(outcomeResponse.status).json({
        code: outcomeResponse.code,
        data: { result, summary },
        message: outcomeResponse.message
      });
    } catch (error) {
      if (error instanceof ConfigWriteError) {
        res.status(409).json({
          code: 1,
          data: { conflicts: error.conflicts },
          message: error.message
        });
        return;
      }
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Sync apply failed"
      });
    }
  });

  router.get("/:id/config/compliance", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const projectId = req.params.id;
    const parseResult = configComplianceQuerySchema.safeParse(req.query ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    try {
      const projectRepo = new ProjectRepository(db, userId);
      const project = projectRepo.getById(projectId);
      if (!project) {
        res.status(404).json({ code: 1, message: "Project not found" });
        return;
      }

      const templateId = parseResult.data.templateId ?? project.templateId;
      if (!templateId) {
        res.status(404).json({
          code: 1,
          message: "Project is not tracking any template",
          details: { code: "TEMPLATE_NOT_TRACKED" }
        });
        return;
      }
      const plan = await buildProjectConfigRenderPlan(
        db,
        userId,
        project.id,
        templateId,
        parseResult.data.credentialMode,
        true
      );
      const conflicts = await detectConfigConflicts(plan);
      const summary = buildConfigComplianceSummary(plan, conflicts);

      res.json({
        code: 0,
        data: {
          compliance: summary,
          conflicts,
          files: plan.files.map((file) => ({
            relativePath: file.relativePath,
            sha256: file.sha256
          }))
        },
        message: ""
      });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Compliance check failed"
      });
    }
  });

  router.get("/:id/ai-config", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const projectRepo = new ProjectRepository(db, userId);
    const project = projectRepo.getById(req.params.id);
    if (!project) {
      res.status(404).json({ code: 1, message: "Project not found" });
      return;
    }

    const parseResult = aiConfigQuerySchema.safeParse(req.query ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    try {
      const aiTool = parseResult.data.aiTool ?? parseAiToolHint(project.aiTool);
      if (!aiTool) {
        res.status(400).json({
          code: 1,
          message: "An explicit aiTool query parameter is required for CLI-agnostic projects"
        });
        return;
      }
      const config = await readProjectAiConfig(project.path, aiTool);
      res.json({
        code: 0,
        data: config,
        message: ""
      });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "AI config read failed"
      });
    }
  });

  router.get("/:id/ai-config/global", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const projectRepo = new ProjectRepository(db, userId);
    const project = projectRepo.getById(req.params.id);
    if (!project) {
      res.status(404).json({ code: 1, message: "Project not found" });
      return;
    }

    const parseResult = aiConfigQuerySchema.safeParse(req.query ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    try {
      const aiTool = parseResult.data.aiTool ?? parseAiToolHint(project.aiTool);
      if (!aiTool) {
        res.status(400).json({
          code: 1,
          message: "An explicit aiTool query parameter is required for CLI-agnostic projects"
        });
        return;
      }
      const config = await readGlobalAiConfig(aiTool);
      res.json({
        code: 0,
        data: config,
        message: ""
      });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Global AI config read failed"
      });
    }
  });

  router.put("/:id/ai-config/files", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = aiConfigWriteSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    const projectRepo = new ProjectRepository(db, userId);
    const project = projectRepo.getById(req.params.id);
    if (!project) {
      res.status(404).json({ code: 1, message: "Project not found" });
      return;
    }

    try {
      const aiTool = parseResult.data.aiTool ?? parseAiToolHint(project.aiTool);
      if (!aiTool) {
        res.status(400).json({
          code: 1,
          message: "An explicit aiTool is required for CLI-agnostic projects"
        });
        return;
      }
      const config = await writeProjectAiConfigFile(
        project.path,
        parseResult.data.relativePath,
        parseResult.data.content,
        aiTool
      );
      recordActivity({
        db,
        eventBus,
        userId,
        projectId: project.id,
        type: "config_write",
        status: "success",
        message: `AI config file updated for ${project.name}`,
        metadata: {
          relativePath: parseResult.data.relativePath
        }
      });
      res.json({
        code: 0,
        data: config,
        message: ""
      });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "AI config write failed"
      });
    }
  });

  router.get("/:id/workspace/tree", async (req, res) => {
    const parseResult = workspaceTreeQuerySchema.safeParse(req.query ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    const userId = (req as unknown as AuthenticatedRequest).userId;
    const projectRepo = new ProjectRepository(db, userId);
    const project = projectRepo.getById(req.params.id);
    if (!project) {
      res.status(404).json({ code: 1, message: "Project not found" });
      return;
    }

    try {
      const tree = await listWorkspaceTree(project.path, parseResult.data);
      res.json({
        code: 0,
        data: {
          projectId: project.id,
          ...tree
        },
        message: ""
      });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Workspace tree read failed"
      });
    }
  });

  router.get("/:id/workspace/file", async (req, res) => {
    const parseResult = workspaceFileQuerySchema.safeParse(req.query ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    const userId = (req as unknown as AuthenticatedRequest).userId;
    const projectRepo = new ProjectRepository(db, userId);
    const project = projectRepo.getById(req.params.id);
    if (!project) {
      res.status(404).json({ code: 1, message: "Project not found" });
      return;
    }

    try {
      const file = await readWorkspaceFile(project.path, parseResult.data.path);
      res.json({
        code: 0,
        data: {
          projectId: project.id,
          ...file
        },
        message: ""
      });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Workspace file read failed"
      });
    }
  });

  router.put("/:id/workspace/file", async (req, res) => {
    const parseResult = workspaceFileWriteSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    const userId = (req as unknown as AuthenticatedRequest).userId;
    const projectRepo = new ProjectRepository(db, userId);
    const project = projectRepo.getById(req.params.id);
    if (!project) {
      res.status(404).json({ code: 1, message: "Project not found" });
      return;
    }

    try {
      const file = await writeWorkspaceFile(
        project.path,
        parseResult.data.path,
        parseResult.data.content
      );
      res.json({
        code: 0,
        data: {
          projectId: project.id,
          ...file
        },
        message: ""
      });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Workspace file write failed"
      });
    }
  });

  router.post("/:id/workspace/file", async (req, res) => {
    const parseResult = workspaceFileCreateSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    const userId = (req as unknown as AuthenticatedRequest).userId;
    const project = new ProjectRepository(db, userId).getById(req.params.id);
    if (!project) {
      res.status(404).json({ code: 1, message: "Project not found" });
      return;
    }

    try {
      const file = await createWorkspaceFile(
        project.path,
        parseResult.data.path,
        parseResult.data.content
      );
      res.status(201).json({
        code: 0,
        data: {
          projectId: project.id,
          ...file
        },
        message: ""
      });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Workspace file create failed"
      });
    }
  });

  router.post("/:id/workspace/rename", async (req, res) => {
    const parseResult = workspaceRenameSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    const userId = (req as unknown as AuthenticatedRequest).userId;
    const project = new ProjectRepository(db, userId).getById(req.params.id);
    if (!project) {
      res.status(404).json({ code: 1, message: "Project not found" });
      return;
    }

    try {
      const renamed = await renameWorkspaceEntry(
        project.path,
        parseResult.data.fromPath,
        parseResult.data.toPath
      );
      res.json({
        code: 0,
        data: {
          projectId: project.id,
          ...renamed
        },
        message: ""
      });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Workspace rename failed"
      });
    }
  });

  router.get("/:id/git-changes", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const projectRepo = new ProjectRepository(db, userId);
    const project = projectRepo.getById(req.params.id);
    if (!project) {
      res.status(404).json({ code: 1, message: "Project not found" });
      return;
    }

    try {
      const git = await getProjectGitChangesCached(project.path);
      res.json({
        code: 0,
        data: {
          projectId: project.id,
          git
        },
        message: ""
      });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Git changes read failed"
      });
    }
  });

  router.get("/:id/git-diff", async (req, res) => {
    const parseResult = gitDiffQuerySchema.safeParse(req.query ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    const userId = (req as unknown as AuthenticatedRequest).userId;
    const projectRepo = new ProjectRepository(db, userId);
    const project = projectRepo.getById(req.params.id);
    if (!project) {
      res.status(404).json({ code: 1, message: "Project not found" });
      return;
    }

    try {
      const file = await getProjectGitFileDiff(project.path, parseResult.data.path, {
        untracked: parseResult.data.untracked === "1"
      });
      res.json({
        code: 0,
        data: {
          projectId: project.id,
          file
        },
        message: ""
      });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Git diff read failed"
      });
    }
  });

  router.get("/:id/git-branches", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const projectRepo = new ProjectRepository(db, userId);
    const project = projectRepo.getById(req.params.id);
    if (!project) {
      res.status(404).json({ code: 1, message: "Project not found" });
      return;
    }

    try {
      const git = await getProjectGitBranches(project.path);
      res.json({
        code: 0,
        data: {
          projectId: project.id,
          git
        },
        message: ""
      });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Git branches read failed"
      });
    }
  });

  router.post("/:id/git-checkout", async (req, res) => {
    const parseResult = gitCheckoutSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    const userId = (req as unknown as AuthenticatedRequest).userId;
    const projectRepo = new ProjectRepository(db, userId);
    const project = projectRepo.getById(req.params.id);
    if (!project) {
      res.status(404).json({ code: 1, message: "Project not found" });
      return;
    }

    try {
      const result = await checkoutProjectGitBranch(project.path, parseResult.data.branch, {
        create: parseResult.data.create
      });
      res.json({
        code: 0,
        data: {
          projectId: project.id,
          ...result
        },
        message: ""
      });
    } catch (error) {
      if (error instanceof ProjectGitError) {
        const status = gitCheckoutErrorStatus(error.code);
        res.status(status).json({
          code: 1,
          message: error.message,
          ...(error.details ? { details: error.details } : {})
        });
        return;
      }
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Git checkout failed"
      });
    }
  });

  const handleGitMutation = <TInput>(
    schema: z.ZodType<TInput>,
    fallbackMessage: string,
    execute: (project: { id: string; path: string }, input: TInput, userId: string) => Promise<Record<string, unknown>>
  ) => async (req: Request, res: Response) => {
    const parseResult = schema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    const userId = (req as unknown as AuthenticatedRequest).userId;
    const project = new ProjectRepository(db, userId).getById(req.params.id ?? "");
    if (!project) {
      res.status(404).json({ code: 1, message: "Project not found" });
      return;
    }

    try {
      const data = await execute(project, parseResult.data, userId);
      res.json({
        code: 0,
        data: { projectId: project.id, ...data },
        message: ""
      });
    } catch (error) {
      if (error instanceof ProjectGitError) {
        res.status(gitCheckoutErrorStatus(error.code)).json({
          code: 1,
          message: error.message,
          ...(error.details ? { details: error.details } : {})
        });
        return;
      }
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : fallbackMessage
      });
    }
  };

  router.post("/:id/git-stage", handleGitMutation(
    gitStageSchema,
    "Git stage failed",
    async (project, input) => ({ git: await stageProjectGitFiles(project.path, input) })
  ));

  router.post("/:id/git-unstage", handleGitMutation(
    gitStageSchema,
    "Git unstage failed",
    async (project, input) => ({ git: await unstageProjectGitFiles(project.path, input) })
  ));

  router.post("/:id/git-commit", handleGitMutation(
    gitCommitSchema,
    "Git commit failed",
    async (project, input, userId) => {
      const result = await commitProjectGitChanges(project.path, input.message);
      new AuditLogRepository(db, userId).create({
        action: "project.git.commit",
        resourceType: "project",
        resourceId: project.id,
        details: { hash: result.hash, branch: result.branch }
      });
      return result;
    }
  ));

  router.post("/:id/git-discard", handleGitMutation(
    gitDiscardSchema,
    "Git discard failed",
    async (project, input, userId) => {
      const git = await discardProjectGitFile(project.path, input.path, { untracked: input.untracked });
      new AuditLogRepository(db, userId).create({
        action: "project.git.discard",
        resourceType: "project",
        resourceId: project.id,
        details: { path: input.path, untracked: input.untracked }
      });
      return { git };
    }
  ));

  router.post("/:id/generate-config", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const projectId = req.params.id;
    const parseResult = configPreviewSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    try {
      const { templateId, credentialMode, decisions } = parseResult.data;
      const projectRepo = new ProjectRepository(db, userId);
      const project = projectRepo.getById(projectId);
      if (!project) {
        res.status(404).json({ code: 1, message: "Project not found" });
        return;
      }

      const templateRepo = new TemplateRepository(db, userId);
      const template = templateRepo.getById(templateId);
      if (!template || !template.files) {
        res.status(404).json({ code: 1, message: "Template not found" });
        return;
      }

      const plan = await buildProjectConfigRenderPlan(db, userId, project.id, template.id, credentialMode, false);

      const result = await writeConfigPlan(
        plan,
        decisions === undefined ? {} : { decisions }
      );
      res.json({
        code: 0,
        data: { result },
        message: ""
      });
    } catch (error) {
      if (error instanceof ConfigWriteError) {
        res.status(409).json({
          code: 1,
          data: { conflicts: error.conflicts },
          message: error.message
        });
        return;
      }
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Generation failed"
      });
    }
  });

  return router;
}

export async function prepareCreatedProjectRoot(projectRoot: string): Promise<string> {
  let targetRoot = resolve(projectRoot.trim());
  if (!existsSync(targetRoot)) {
    targetRoot = validateNearestExistingParent(targetRoot);
    await mkdir(targetRoot, { recursive: true });
  }
  const rootPath = validateProjectRoot(targetRoot);
  await assertDirectory(rootPath, "Project root path must be a directory");
  return rootPath;
}

/**
 * Validates an explicitly supplied template id. Projects never get an implicit
 * default template anymore; callers bind one only when the request names it.
 */
export function resolveProjectTemplateId(
  db: Database,
  userId: string,
  templateId: string
): string {
  const template = new TemplateRepository(db, userId).getById(templateId);
  if (!template) {
    throw new Error("Template not found");
  }
  return templateId;
}

export async function prepareImportedProjectRoot(projectRoot: string): Promise<string> {
  const targetRoot = resolve(projectRoot.trim());
  if (!existsSync(targetRoot)) {
    throw new Error("Imported project directory must already exist");
  }
  const rootPath = validateProjectRoot(targetRoot);
  await assertDirectory(rootPath, "Imported project path must be an existing directory");
  return rootPath;
}

function validateNearestExistingParent(targetRoot: string): string {
  let current = dirname(targetRoot);
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) {
      throw new Error("Project parent directory does not exist");
    }
    current = parent;
  }
  const parentRoot = validateProjectRoot(current);
  const canonicalTargetRoot = resolve(parentRoot, relative(current, targetRoot));
  const parentWithSeparator = parentRoot.endsWith(sep) ? parentRoot : `${parentRoot}${sep}`;
  if (canonicalTargetRoot !== parentRoot && !canonicalTargetRoot.startsWith(parentWithSeparator)) {
    throw new Error("Project root escapes approved parent directory");
  }
  return canonicalTargetRoot;
}

async function assertDirectory(pathname: string, message: string): Promise<void> {
  const stats = await stat(pathname);
  if (!stats.isDirectory()) {
    throw new Error(message);
  }
}

function listRootInstructionFiles(projectRoot: string): string[] {
  return rootInstructionFileNames.filter((fileName) => existsSync(resolve(projectRoot, fileName)));
}

export function configWriteOutcomeResponse(outcome: WriteResult["outcome"]): {
  status: 200 | 409 | 500;
  code: 0 | 1;
  message: string;
} {
  if (outcome === "applied") {
    return { status: 200, code: 0, message: "" };
  }
  if (outcome === "rolled_back") {
    return { status: 409, code: 1, message: "Config write rolled_back" };
  }
  return { status: 500, code: 1, message: "Config write rollback_failed" };
}

function buildConfigComplianceSummary(
  plan: ReturnType<typeof createRenderPlan>,
  conflicts: Awaited<ReturnType<typeof detectConfigConflicts>>
) {
  const summary = buildConfigSyncSummary(plan, conflicts);
  return {
    ...summary,
    status: summary.requiresDecision.length > 0 || summary.missingFiles.length > 0
      ? "needs_attention"
      : "compliant",
    staleFiles: summary.modifiedFiles
  };
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) break;
        results[index] = await mapper(items[index]!, index);
      }
    })
  );
  return results;
}
