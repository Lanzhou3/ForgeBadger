import { Router } from "express";
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
import type { OpenForgeEventBus } from "../services/event-bus.js";
import type { CredentialMode, WriteResult } from "../config-generation/types.js";
import { readGlobalAiConfig, readProjectAiConfig, writeProjectAiConfigFile } from "../services/project-ai-config.js";
import { listWorkspaceTree, readWorkspaceFile } from "../services/workspace-context.js";
import { getProjectGitChanges, getProjectGitFileDiff } from "../services/project-git.js";
import { recordActivity } from "../services/activity-events.js";
import { buildConfigSyncSummary, buildProjectConfigRenderPlan } from "../services/project-config-render.js";
export {
  buildConfigSyncSummary,
  buildProjectConfigRenderPlan
} from "../services/project-config-render.js";

const aiToolSchema = z.enum(["claude", "opencode", "codex", "kimi"]);

const createProjectSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  description: z.string().optional(),
  techStack: z.string().optional()
});

const updateProjectTemplateSchema = z.object({
  templateId: z.string().min(1).nullable().optional()
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
  aiTool: z.enum(["claude", "opencode", "codex", "kimi"]).optional()
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

const gitDiffQuerySchema = z.object({
  path: z.string().min(1).max(512),
  untracked: z.enum(["0", "1"]).optional()
}).strict();

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
  sessionManager?: InMemorySessionManager,
  eventBus?: OpenForgeEventBus
): Router {
  const router = Router();
  router.use(authenticate);

  router.post("/", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = createProjectSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    try {
      const { name, path: rawPath, description, techStack } = parseResult.data;
      const rootPath = await prepareCreatedProjectRoot(rawPath);
      const repo = new ProjectRepository(db, userId);
      const project = repo.create({
        name,
        path: rootPath,
        description,
        techStack,
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
      res.json({
        code: 0,
        data: {
          path: resolved,
          exists: true,
          isDirectory: true,
          instructionFiles: listRootInstructionFiles(resolved)
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

    try {
      const { name, path: rawPath, description, techStack } = parseResult.data;
      const rootPath = await prepareImportedProjectRoot(rawPath);
      const repo = new ProjectRepository(db, userId);
      const project = repo.import({
        name,
        path: rootPath,
        description,
        techStack,
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
    if (sessionManager) {
      const sessionRepo = new SessionRepository(db, userId);
      const projectSessions = sessionRepo
        .list()
        .filter((session) => session.projectId === project.id && session.status === "running");
      for (const session of projectSessions) {
        if (!session.tmuxSession) {
          continue;
        }
        try {
          await sessionManager.stopSession(session.id, session.tmuxSession, userId);
        } catch {
          // The project record can still be removed when an already-dead tmux pane is referenced.
        }
      }
    }
    repo.delete(req.params.id);
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
    const parseResult = updateProjectTemplateSchema.safeParse(req.body ?? {});
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

    const { templateId } = parseResult.data;

    // 缺省:绑定关系保持不变
    if (templateId === undefined) {
      res.json({ code: 0, data: { project }, message: "" });
      return;
    }

    // 切换模板:校验模板存在且属于当前用户
    if (templateId !== null) {
      const template = new TemplateRepository(db, userId).getById(templateId);
      if (!template) {
        res.status(404).json({ code: 1, message: "Template not found" });
        return;
      }
    }

    const updated = repo.updateTemplateId(project.id, templateId);
    new AuditLogRepository(db, userId).create({
      action: templateId === null ? "project.template.unbind" : "project.template.bind",
      resourceType: "project",
      resourceId: project.id,
      details: { name: project.name, templateId }
    });
    res.json({ code: 0, data: { project: updated ?? project }, message: "" });
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

  router.get("/:id/git-changes", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const projectRepo = new ProjectRepository(db, userId);
    const project = projectRepo.getById(req.params.id);
    if (!project) {
      res.status(404).json({ code: 1, message: "Project not found" });
      return;
    }

    try {
      const git = await getProjectGitChanges(project.path);
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
