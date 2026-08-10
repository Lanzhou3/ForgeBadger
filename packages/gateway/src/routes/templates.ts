import { Router } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { TemplateRepository } from "../db/repositories/template-repository.js";
import { ProjectRepository } from "../db/repositories/project-repository.js";
import { extractProjectTemplateFiles } from "../services/template-from-project.js";
import type { OpenForgeEventBus } from "../services/event-bus.js";
import {
  applyTemplateSync,
  buildTemplateUsage,
  previewTemplateSync,
  TemplateSyncError
} from "../services/template-sync.js";
import type { Database } from "../db/types.js";

const templateFileSchema = z.object({
  filePath: z.string().min(1),
  content: z.string(),
  fileType: z.string().optional()
});

const createTemplateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().optional(),
  visibility: z.enum(["private", "shared", "admin"]).optional(),
  files: z.array(templateFileSchema).optional()
});

const updateTemplateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  version: z.string().optional(),
  visibility: z.enum(["private", "shared", "admin"]).optional(),
  status: z.string().optional()
});

const cloneTemplateSchema = z.object({
  name: z.string().min(1)
});

const templatePackageSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  version: z.string().min(1),
  files: z.array(templateFileSchema).min(1),
  exportedAt: z.string().optional()
});

const importTemplateSchema = z.object({
  templatePackage: templatePackageSchema
});

const fromProjectPreviewSchema = z.object({
  projectId: z.string().min(1),
  filePaths: z.array(z.string().min(1)).optional()
});

const fromProjectCreateSchema = fromProjectPreviewSchema.extend({
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().optional(),
  visibility: z.enum(["private", "shared", "admin"]).optional()
});

const templateUsageQuerySchema = z.object({
  projectIds: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      if (value === undefined) {
        return undefined;
      }
      return typeof value === "string"
        ? value.split(",").map((part) => part.trim()).filter(Boolean)
        : value;
    })
    .pipe(z.array(z.string().min(1)).max(20).optional())
});

const templateSyncSchema = z.object({
  projectIds: z.array(z.string().min(1)).min(1).max(20).optional(),
  credentialMode: z.enum(["host_environment", "stored_encrypted_key"]).optional(),
  decisions: z
    .record(z.string().min(1), z.record(z.string().min(1), z.enum(["skip", "overwrite"])))
    .optional()
});

export function createTemplateRoutes(db: Database, eventBus?: OpenForgeEventBus): Router {
  const router = Router();
  router.use(authenticate);

  router.get("/", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new TemplateRepository(db, userId);
    const builtIns = repo.listBuiltIn();
    const userTemplates = repo.list();
    res.json({
      code: 0,
      data: { templates: [...builtIns, ...userTemplates] },
      message: ""
    });
  });

  router.get("/builtins", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new TemplateRepository(db, userId);
    const templates = repo.listBuiltIn();
    res.json({
      code: 0,
      data: { templates },
      message: ""
    });
  });

  router.post("/", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = createTemplateSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    const repo = new TemplateRepository(db, userId);
    const template = repo.create(parseResult.data);
    res.status(201).json({
      code: 0,
      data: { template },
      message: ""
    });
  });

  router.post("/from-project/preview", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = fromProjectPreviewSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    const project = new ProjectRepository(db, userId).getById(parseResult.data.projectId);
    if (!project) {
      res.status(404).json({ code: 1, message: "Project not found" });
      return;
    }

    try {
      const files = await extractProjectTemplateFiles(project.path, {
        filePaths: parseResult.data.filePaths
      });
      res.json({
        code: 0,
        data: {
          project: { id: project.id, name: project.name, path: project.path },
          files,
          totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0)
        },
        message: ""
      });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Failed to extract project config"
      });
    }
  });

  router.post("/from-project", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = fromProjectCreateSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    const project = new ProjectRepository(db, userId).getById(parseResult.data.projectId);
    if (!project) {
      res.status(404).json({ code: 1, message: "Project not found" });
      return;
    }

    try {
      const files = await extractProjectTemplateFiles(project.path, {
        filePaths: parseResult.data.filePaths
      });
      const repo = new TemplateRepository(db, userId);
      const template = repo.create({
        name: parseResult.data.name,
        description: parseResult.data.description,
        version: parseResult.data.version,
        visibility: parseResult.data.visibility,
        files: files.map((file) => ({
          filePath: file.filePath,
          content: file.content,
          fileType: file.fileType
        }))
      });

      res.status(201).json({
        code: 0,
        data: { template: repo.getById(template.id) ?? template },
        message: ""
      });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Failed to create template from project"
      });
    }
  });

  router.post("/:id/clone", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = cloneTemplateSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    try {
      const repo = new TemplateRepository(db, userId);
      const template = repo.clone(req.params.id, parseResult.data.name);
      res.status(201).json({
        code: 0,
        data: { template },
        message: ""
      });
    } catch (error) {
      res.status(404).json({
        code: 1,
        message: error instanceof Error ? error.message : "Template not found"
      });
    }
  });

  router.post("/import", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = importTemplateSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    const repo = new TemplateRepository(db, userId);
    const incoming = parseResult.data.templatePackage;
    const template = repo.importPackage({
      name: incoming.name,
      ...(incoming.description !== undefined ? { description: incoming.description } : {}),
      version: incoming.version,
      files: incoming.files.map((file) => ({
        filePath: file.filePath,
        content: file.content,
        fileType: file.fileType ?? "markdown"
      })),
      exportedAt: incoming.exportedAt ?? new Date().toISOString()
    });
    res.status(201).json({
      code: 0,
      data: { template },
      message: ""
    });
  });

  router.get("/:id/export", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new TemplateRepository(db, userId);
    try {
      const templatePackage = repo.exportPackage(req.params.id);
      res.json({
        code: 0,
        data: { templatePackage },
        message: ""
      });
    } catch (error) {
      res.status(404).json({
        code: 1,
        message: error instanceof Error ? error.message : "Template not found"
      });
    }
  });

  router.get("/:id/versions", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new TemplateRepository(db, userId);
    const template = repo.getById(req.params.id);
    if (!template) {
      res.status(404).json({ code: 1, message: "Template not found" });
      return;
    }

    res.json({
      code: 0,
      data: { versions: repo.listVersions(req.params.id) },
      message: ""
    });
  });

  router.post("/:id/versions/:versionId/restore", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new TemplateRepository(db, userId);
    const versionId = Number(req.params.versionId);
    if (!Number.isSafeInteger(versionId) || versionId <= 0) {
      res.status(400).json({ code: 1, message: "Invalid version id" });
      return;
    }

    const existing = repo.getById(req.params.id);
    if (!existing) {
      res.status(404).json({ code: 1, message: "Template not found" });
      return;
    }
    if (existing.isBuiltin) {
      res.status(409).json({ code: 1, message: "Built-in templates are read-only" });
      return;
    }

    const template = repo.restoreVersion(req.params.id, versionId);
    if (!template) {
      res.status(404).json({ code: 1, message: "Template version not found" });
      return;
    }

    res.json({
      code: 0,
      data: { template },
      message: ""
    });
  });

  router.get("/:id", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new TemplateRepository(db, userId);
    const template = repo.getById(req.params.id);
    if (!template) {
      res.status(404).json({ code: 1, message: "Template not found" });
      return;
    }
    res.json({
      code: 0,
      data: { template },
      message: ""
    });
  });

  router.put("/:id", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = updateTemplateSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    const repo = new TemplateRepository(db, userId);
    const existing = repo.getById(req.params.id);
    if (!existing) {
      res.status(404).json({ code: 1, message: "Template not found" });
      return;
    }
    if (existing.isBuiltin) {
      res.status(409).json({ code: 1, message: "Built-in templates are read-only" });
      return;
    }

    const template = repo.update(req.params.id, parseResult.data);
    res.json({
      code: 0,
      data: { template },
      message: ""
    });
  });

  router.put("/:id/files/*", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const templateId = req.params.id;
    const filePath = (req.params as Record<string, string>)['0'] ?? '';
    const content: unknown = req.body?.content;

    if (typeof content !== "string") {
      res.status(400).json({ code: 1, message: "Content is required" });
      return;
    }
    const contentStr = content;

    const repo = new TemplateRepository(db, userId);
    const template = repo.getById(templateId);
    if (!template) {
      res.status(404).json({ code: 1, message: "Template not found" });
      return;
    }
    if (template.isBuiltin) {
      res.status(409).json({ code: 1, message: "Built-in templates are read-only" });
      return;
    }

    const updatedFile = repo.updateFile(templateId, filePath, contentStr);
    if (!updatedFile) {
      res.status(404).json({ code: 1, message: "File not found" });
      return;
    }

    res.json({
      code: 0,
      data: { file: updatedFile },
      message: ""
    });
  });

  router.delete("/:id", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new TemplateRepository(db, userId);
    const existing = repo.getById(req.params.id);
    if (!existing) {
      res.status(404).json({ code: 1, message: "Template not found" });
      return;
    }
    if (existing.isBuiltin) {
      res.status(409).json({ code: 1, message: "Built-in templates are read-only" });
      return;
    }

    repo.delete(req.params.id);
    res.json({
      code: 0,
      data: {},
      message: ""
    });
  });

  router.get("/:id/usage", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = templateUsageQuerySchema.safeParse(req.query ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    try {
      const usage = await buildTemplateUsage(db, userId, req.params.id, parseResult.data.projectIds);
      res.json({
        code: 0,
        data: usage,
        message: ""
      });
    } catch (error) {
      res.status(error instanceof TemplateSyncError ? error.status : 400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Failed to load template usage"
      });
    }
  });

  router.post("/:id/sync/preview", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = templateSyncSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    try {
      const preview = await previewTemplateSync(db, userId, req.params.id, {
        ...(parseResult.data.projectIds !== undefined ? { projectIds: parseResult.data.projectIds } : {}),
        ...(parseResult.data.credentialMode !== undefined ? { credentialMode: parseResult.data.credentialMode } : {})
      });
      res.json({
        code: 0,
        data: preview,
        message: ""
      });
    } catch (error) {
      res.status(error instanceof TemplateSyncError ? error.status : 400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Failed to preview template sync"
      });
    }
  });

  router.post("/:id/sync/apply", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = templateSyncSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    try {
      const result = await applyTemplateSync(db, userId, req.params.id, {
        ...(parseResult.data.projectIds !== undefined ? { projectIds: parseResult.data.projectIds } : {}),
        ...(parseResult.data.credentialMode !== undefined ? { credentialMode: parseResult.data.credentialMode } : {}),
        ...(parseResult.data.decisions !== undefined ? { decisions: parseResult.data.decisions } : {}),
        ...(eventBus !== undefined ? { eventBus } : {}),
        ...(req.ip !== undefined ? { ipAddress: req.ip } : {})
      });
      res.json({
        code: 0,
        data: result,
        message: ""
      });
    } catch (error) {
      res.status(error instanceof TemplateSyncError ? error.status : 400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Failed to sync template"
      });
    }
  });

  return router;
}
