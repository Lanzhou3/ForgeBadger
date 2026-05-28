import { Router } from "express";
import { existsSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
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
import { ProjectAgentSequenceRepository } from "../db/repositories/project-agent-sequence-repository.js";
import { SessionRepository } from "../db/repositories/session-repository.js";
import { TemplateRepository } from "../db/repositories/template-repository.js";
import { AgentRepository } from "../db/repositories/agent-repository.js";
import { ProjectSkillRepository } from "../db/repositories/project-skill-repository.js";
import type { Database } from "../db/types.js";
import type { InMemorySessionManager } from "../services/session-manager.js";
import type { OpenForgeEventBus } from "../services/event-bus.js";
import type { CredentialMode } from "../config-generation/types.js";
import { buildProjectConfigFiles } from "../services/project-config-files.js";
import { readGlobalAiConfig, readProjectAiConfig, writeProjectAiConfigFile } from "../services/project-ai-config.js";
import { listWorkspaceTree, readWorkspaceFile } from "../services/workspace-context.js";
import { recordActivity } from "../services/activity-events.js";
import { createDefaultAgentPack } from "../services/default-agent-pack.js";

const aiToolSchema = z.enum(["claude", "opencode", "codex"]);

const createProjectSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  description: z.string().optional(),
  techStack: z.string().optional(),
  aiTool: aiToolSchema.optional(),
  templateId: z.string().optional()
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
  content: z.string().max(128 * 1024)
});

const workspaceTreeQuerySchema = z.object({
  path: z.string().max(512).optional(),
  depth: z.coerce.number().int().min(1).max(3).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional()
}).strict();

const workspaceFileQuerySchema = z.object({
  path: z.string().min(1).max(512)
}).strict();

const agentSequenceSchema = z.object({
  agentIds: z.array(z.string().min(1)).max(50)
});

const defaultTemplateId = "builtin-claude-code";
const legacyProjectConfigHint = "claude";
const defaultTemplateIdsByAiTool: Record<z.infer<typeof aiToolSchema>, string> = {
  claude: defaultTemplateId,
  opencode: "builtin-opencode",
  codex: "builtin-codex"
};
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
      const { name, path: rawPath, description, techStack, templateId } = parseResult.data;
      const projectConfigHint = parseResult.data.aiTool ?? legacyProjectConfigHint;
      const rootPath = await prepareCreatedProjectRoot(rawPath);
      const resolvedTemplateId = resolveProjectTemplateId(db, userId, projectConfigHint, templateId);
      const repo = new ProjectRepository(db, userId);
      const project = repo.create({
        name,
        path: rootPath,
        description,
        techStack,
        aiTool: projectConfigHint,
        templateId: resolvedTemplateId
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

  router.get("/:id/agent-sequence", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const projectRepo = new ProjectRepository(db, userId);
    const project = projectRepo.getById(req.params.id);
    if (!project) {
      res.status(404).json({ code: 1, message: "Project not found" });
      return;
    }

    const sequence = new ProjectAgentSequenceRepository(db, userId).list(project.id);
    res.json({
      code: 0,
      data: { sequence },
      message: ""
    });
  });

  router.put("/:id/agent-sequence", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = agentSequenceSchema.safeParse(req.body ?? {});
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
      const sequence = new ProjectAgentSequenceRepository(db, userId).replace(
        project.id,
        parseResult.data.agentIds
      );
      res.json({
        code: 0,
        data: { sequence },
        message: ""
      });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Agent sequence update failed"
      });
    }
  });

  router.post("/:id/agents/default-pack", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    try {
      const result = createDefaultAgentPack(db, userId, req.params.id);
      if (!result) {
        res.status(404).json({ code: 1, message: "Project not found" });
        return;
      }

      res.status(result.created.length > 0 ? 201 : 200).json({
        code: 0,
        data: result,
        message: ""
      });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Default Agent pack creation failed"
      });
    }
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
      const { name, path: rawPath, description, techStack, templateId } = parseResult.data;
      const projectConfigHint = parseResult.data.aiTool ?? legacyProjectConfigHint;
      const rootPath = await prepareImportedProjectRoot(rawPath);
      const resolvedTemplateId = resolveProjectTemplateId(db, userId, projectConfigHint, templateId);
      const repo = new ProjectRepository(db, userId);
      const project = repo.import({
        name,
        path: rootPath,
        description,
        techStack,
        aiTool: projectConfigHint,
        templateId: resolvedTemplateId
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
    res.json({
      code: 0,
      data: {},
      message: ""
    });
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
      recordActivity({
        db,
        eventBus,
        userId,
        projectId: project.id,
        type: "config_write",
        status: "success",
        message: `Config written for ${project.name}`,
        metadata: {
          templateId,
          writtenFiles: result.writtenFiles,
          skippedFiles: result.skippedFiles
        }
      });
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

      const templateId = parseResult.data.templateId ?? project.templateId ?? defaultTemplateIdForAiTool(project.aiTool);
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

      const templateId = parseResult.data.templateId ?? project.templateId ?? defaultTemplateIdForAiTool(project.aiTool);
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
      recordActivity({
        db,
        eventBus,
        userId,
        projectId: project.id,
        type: "config_sync",
        status: "success",
        message: `Config synced for ${project.name}`,
        metadata: {
          templateId,
          writtenFiles: result.writtenFiles,
          skippedFiles: result.skippedFiles
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
          decisionRequired: summary.requiresDecision.length
        },
        ipAddress: req.ip
      });

      res.json({
        code: 0,
        data: { result, summary },
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

      const templateId = parseResult.data.templateId ?? project.templateId ?? defaultTemplateIdForAiTool(project.aiTool);
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

    try {
      const config = await readProjectAiConfig(project.path, aiToolSchema.parse(project.aiTool));
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

    try {
      const config = await readGlobalAiConfig(aiToolSchema.parse(project.aiTool));
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
      const config = await writeProjectAiConfigFile(
        project.path,
        parseResult.data.relativePath,
        parseResult.data.content,
        aiToolSchema.parse(project.aiTool)
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
  const targetRoot = resolve(projectRoot.trim());
  if (!existsSync(targetRoot)) {
    validateNearestExistingParent(targetRoot);
    await mkdir(targetRoot, { recursive: true });
  }
  const rootPath = validateProjectRoot(targetRoot);
  await assertDirectory(rootPath, "Project root path must be a directory");
  return rootPath;
}

function defaultTemplateIdForAiTool(aiTool: string | null | undefined): string {
  const parsed = aiToolSchema.safeParse(aiTool);
  return parsed.success ? defaultTemplateIdsByAiTool[parsed.data] : defaultTemplateId;
}

export function resolveProjectTemplateId(
  db: Database,
  userId: string,
  aiTool: string,
  templateId: string | undefined
): string {
  const resolvedTemplateId = templateId ?? defaultTemplateIdForAiTool(aiTool);
  const template = new TemplateRepository(db, userId).getById(resolvedTemplateId);
  if (!template) {
    throw new Error("Template not found");
  }
  return resolvedTemplateId;
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

function validateNearestExistingParent(targetRoot: string): void {
  let current = dirname(targetRoot);
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) {
      throw new Error("Project parent directory does not exist");
    }
    current = parent;
  }
  const parentRoot = validateProjectRoot(current);
  const parentWithSeparator = parentRoot.endsWith(sep) ? parentRoot : `${parentRoot}${sep}`;
  if (targetRoot !== parentRoot && !targetRoot.startsWith(parentWithSeparator)) {
    throw new Error("Project root escapes approved parent directory");
  }
}

async function assertDirectory(pathname: string, message: string): Promise<void> {
  const stats = await stat(pathname);
  if (!stats.isDirectory()) {
    throw new Error(message);
  }
}

export async function buildProjectConfigRenderPlan(
  db: Database,
  userId: string,
  projectId: string,
  templateId: string,
  credentialMode: CredentialMode,
  dryRun: boolean
) {
  const projectRepo = new ProjectRepository(db, userId);
  const project = projectRepo.getById(projectId);
  if (!project) {
    throw new Error("Project not found");
  }

  const templateRepo = new TemplateRepository(db, userId);
  const template = templateRepo.getById(templateId);
  if (!template || !template.files) {
    throw new Error("Template not found");
  }

  const agentRepo = new AgentRepository(db, userId);
  const skillRepo = new ProjectSkillRepository(db, userId);

  return createRenderPlan({
    projectId: project.id,
    targetRoot: project.path,
    templateId: template.id,
    variables: {
      projectName: project.name,
      projectRoot: project.path,
      gatewayUrl: getGatewayUrl()
    },
    templateFiles: buildProjectConfigFiles({
      adapter: aiToolSchema.parse(project.aiTool),
      templateFiles: normalizeTemplateFilesForProject(project, template.files.map((file) => ({
        id: String(file.id),
        relativePath: file.filePath,
        content: file.content
      }))),
      agents: agentRepo.list().filter((agent) => agent.projectId === project.id),
      skills: skillRepo.listByProject(project.id)
    }),
    credentialMode,
    dryRun
  });
}

function normalizeTemplateFilesForProject(
  project: { aiTool: string; isImported: boolean; path: string },
  files: Array<{ id: string; relativePath: string; content: string }>
): Array<{ id: string; relativePath: string; content: string }> {
  if (project.aiTool !== "claude" || !project.isImported) {
    return files;
  }

  const hasRootClaude = existsSync(resolve(project.path, "CLAUDE.md"));
  return files.flatMap((file) => {
    if (file.relativePath === ".claude/settings.json") {
      return [];
    }
    if (file.relativePath === ".claude/CLAUDE.md" && hasRootClaude) {
      return [{ ...file, relativePath: "CLAUDE.md" }];
    }
    return [file];
  });
}

function listRootInstructionFiles(projectRoot: string): string[] {
  return rootInstructionFileNames.filter((fileName) => existsSync(resolve(projectRoot, fileName)));
}

function getGatewayUrl(): string {
  return (
    process.env.OPENFORGE_GATEWAY_URL ||
    process.env.NEXT_PUBLIC_GATEWAY_URL ||
    `http://${process.env.OPENFORGE_HOST || "127.0.0.1"}:${process.env.OPENFORGE_PORT || "3000"}`
  );
}

export function buildConfigSyncSummary(
  plan: ReturnType<typeof createRenderPlan>,
  conflicts: Awaited<ReturnType<typeof detectConfigConflicts>>
) {
  const conflictByPath = new Map(conflicts.map((conflict) => [conflict.relativePath, conflict]));
  const missingFiles = plan.files
    .filter((file) => !conflictByPath.has(file.relativePath))
    .map((file) => file.relativePath);
  const identicalFiles = conflicts
    .filter((conflict) => conflict.conflictType === "exists")
    .map((conflict) => conflict.relativePath);
  const modifiedFiles = conflicts
    .filter((conflict) => conflict.conflictType === "modified")
    .map((conflict) => conflict.relativePath);
  const unsafeFiles = conflicts
    .filter((conflict) => conflict.conflictType === "unsafe_path")
    .map((conflict) => conflict.relativePath);

  return {
    templateId: plan.templateId,
    totalFiles: plan.files.length,
    missingFiles,
    identicalFiles,
    modifiedFiles,
    unsafeFiles,
    requiresDecision: [...modifiedFiles, ...unsafeFiles]
  };
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
