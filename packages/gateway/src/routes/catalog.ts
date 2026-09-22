import { Router } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { CatalogRepository } from "../db/repositories/catalog-repository.js";
import { SkillRepository } from "../db/repositories/skill-repository.js";
import { TemplateRepository } from "../db/repositories/template-repository.js";
import type { Database } from "../db/types.js";
import { refreshRemoteCatalog } from "../services/catalog-sync.js";
import {
  listSkillFiles,
  parseGitHubSkillLocator,
  resolveGitHubRef,
  type GitHubRequestOptions
} from "../services/github-skill-source.js";
import {
  installRemoteSkill,
  SkillInstallConflictError
} from "../services/skill-remote-install.js";
import { refreshGitHubMarketplace } from "../services/skill-marketplaces.js";

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

const marketplaceMetadataSchema = z.object({
  repo: z.string().min(1),
  sha: z.string().optional(),
  ref: z.string().optional(),
  pluginName: z.string().optional(),
  skillPath: z.string().optional()
});

const marketplaceRefreshSchema = z.object({
  repo: z.string().min(1),
  label: z.string().optional(),
  timeoutMs: z.number().int().min(100).max(30000).optional()
});

export function createCatalogRoutes(db: Database, remoteOptions: GitHubRequestOptions = {}): Router {
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

  router.post("/marketplace-refresh", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = marketplaceRefreshSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }
    try {
      const result = await refreshGitHubMarketplace({
        db,
        userId,
        ...parseResult.data,
        ...remoteOptions
      });
      res.json({
        code: 0,
        data: {
          source: result.source,
          items: result.items,
          skipped: result.skipped,
          sha: result.sha,
          marketplaceName: result.marketplaceName ?? null
        },
        message: ""
      });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Marketplace refresh failed"
      });
    }
  });

  router.post("/items/:id/install", async (req, res) => {
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
        const marketplace = marketplaceMetadataSchema.safeParse(
          (metadata as Record<string, unknown>).marketplace
        );
        if (marketplace.success) {
          const locator = parseGitHubSkillLocator(marketplace.data.repo);
          let sha = marketplace.data.sha;
          if (!sha) {
            const resolved = await resolveGitHubRef({
              owner: locator.owner,
              repo: locator.repo,
              ...(marketplace.data.ref ? { ref: marketplace.data.ref } : {}),
              ...remoteOptions
            });
            sha = resolved.sha;
          }
          let skillPath = marketplace.data.skillPath;
          if (!skillPath) {
            const discovered = await listSkillFiles({
              owner: locator.owner,
              repo: locator.repo,
              sha,
              ...remoteOptions
            });
            if (discovered.files.length !== 1) {
              throw new Error(
                "Marketplace plugin does not declare a Skill path and its repository contains multiple Skills; install it from the GitHub repo instead"
              );
            }
            const only = discovered.files[0];
            skillPath = only ? only.path.replace(/\/SKILL\.md$/u, "") : "";
          }
          const result = await installRemoteSkill({
            db,
            userId,
            repo: `${locator.owner}/${locator.repo}`,
            path: skillPath,
            sha,
            kind: "marketplace",
            source: `catalog:${item.sourceId}`,
            marketplaceSourceId: item.sourceId,
            pluginName: marketplace.data.pluginName ?? item.name,
            ...remoteOptions
          });

          res.status(201).json({
            code: 0,
            data: { skill: result.skill, catalogItem },
            message: ""
          });
          return;
        }

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
      if (error instanceof SkillInstallConflictError) {
        res.status(409).json({ code: 1, message: error.message });
        return;
      }
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Catalog install failed"
      });
    }
  });

  return router;
}
