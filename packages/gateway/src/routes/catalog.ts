import { Router } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { CatalogRepository } from "../db/repositories/catalog-repository.js";
import { SkillRepository } from "../db/repositories/skill-repository.js";
import { TemplateRepository } from "../db/repositories/template-repository.js";
import type { Database } from "../db/types.js";
import { refreshRemoteCatalog } from "../services/catalog-sync.js";

const refreshCatalogSchema = z.object({
  type: z.enum(["skill", "template"]),
  sourceId: z.string().min(1),
  label: z.string().min(1),
  url: z.string().url(),
  timeoutMs: z.number().int().min(100).max(30000).optional()
});

const templatePackageSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  version: z.string().min(1),
  files: z.array(z.object({
    filePath: z.string().min(1),
    content: z.string(),
    fileType: z.string().optional()
  })).min(1),
  exportedAt: z.string().optional()
});

const templateCatalogMetadataSchema = z.object({
  templatePackage: templatePackageSchema
});

const skillCatalogMetadataSchema = z.object({
  skillPackage: z.object({
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    version: z.string().min(1).default("1.0.0"),
    content: z.string().min(1)
  })
});

export function createCatalogRoutes(db: Database): Router {
  const router = Router();
  router.use(authenticate);

  router.get("/sources", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    res.json({
      code: 0,
      data: { sources: new CatalogRepository(db, userId).listSources() },
      message: ""
    });
  });

  router.get("/items", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const items = new CatalogRepository(db, userId)
      .listItems()
      // Defensive: DB rows predating the plugin module retirement may still
      // carry itemType "plugin"; hide them even though new writes cannot.
      .filter((item) => (item.itemType as string) !== "plugin");
    res.json({
      code: 0,
      data: { items },
      message: ""
    });
  });

  router.post("/refresh", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = refreshCatalogSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    try {
      const result = await refreshRemoteCatalog({
        db,
        userId,
        ...parseResult.data
      });
      res.json({
        code: 0,
        data: result,
        message: ""
      });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Catalog refresh failed"
      });
    }
  });

  router.post("/items/:id/install", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const catalogRepo = new CatalogRepository(db, userId);
    const item = catalogRepo.getItemById(req.params.id);
    if (!item) {
      res.status(404).json({ code: 1, message: "Catalog item not found" });
      return;
    }
    try {
      const metadata = item.metadata ? JSON.parse(item.metadata) : {};
      const catalogItem = {
        id: item.id,
        externalId: item.externalId,
        sourceId: item.sourceId
      };

      if (item.itemType === "template") {
        const parsed = templateCatalogMetadataSchema.parse(metadata);
        const template = new TemplateRepository(db, userId).importPackage({
          name: parsed.templatePackage.name,
          description: parsed.templatePackage.description ?? null,
          version: parsed.templatePackage.version,
          files: parsed.templatePackage.files.map((file) => ({
            filePath: file.filePath,
            content: file.content,
            fileType: file.fileType ?? "markdown"
          })),
          exportedAt: parsed.templatePackage.exportedAt ?? new Date().toISOString()
        });

        res.status(201).json({
          code: 0,
          data: { template, catalogItem },
          message: ""
        });
        return;
      }

      if (item.itemType === "skill") {
        const parsed = skillCatalogMetadataSchema.parse(metadata);
        const skill = new SkillRepository(db, userId).create({
          name: parsed.skillPackage.name,
          description: parsed.skillPackage.description ?? item.description ?? undefined,
          version: parsed.skillPackage.version,
          content: parsed.skillPackage.content,
          source: `catalog:${item.sourceId}`,
          isEnabled: false
        });

        res.status(201).json({
          code: 0,
          data: { skill, catalogItem },
          message: ""
        });
        return;
      }

      res.status(409).json({ code: 1, message: "Unsupported catalog item type" });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Catalog install failed"
      });
    }
  });

  return router;
}
