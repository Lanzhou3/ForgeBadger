import { Router } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { SkillRepository } from "../db/repositories/skill-repository.js";
import { ProjectRepository } from "../db/repositories/project-repository.js";
import { ProjectSkillRepository } from "../db/repositories/project-skill-repository.js";
import {
  buildSkillInstallContent,
  getSkillSource,
  listSkillSources,
  validateSkillName
} from "../services/skill-sources.js";
import {
  listSkillFiles,
  parseGitHubSkillLocator,
  resolveGitHubRef,
  type GitHubRequestOptions
} from "../services/github-skill-source.js";
import { createSkillRegistryRoutes } from './skill-registry.js';
import { skillInstallService } from '../services/skill-install-service.js';
import { listSkillTemplates } from "../services/skill-templates.js";
import { syncLocalSkills } from "../services/local-skills.js";
import { seedBuiltinSkills } from "../services/builtin-skills.js";
import type { Database } from "../db/types.js";

const createSkillSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  source: z.string().optional(),
  content: z.string().min(1),
  version: z.string().optional(),
  visibility: z.enum(["private", "shared", "admin"]).optional()
});

const updateSkillSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  source: z.string().optional(),
  content: z.string().optional(),
  version: z.string().optional(),
  visibility: z.enum(["private", "shared", "admin"]).optional()
});

const installSkillSchema = z.object({
  sourceId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  content: z.string().optional(),
  version: z.string().optional(),
  url: z.string().url().optional(),
  skillId: z.string().optional(),
  enable: z.boolean().optional()
});

const githubPreviewSchema = z.object({
  repo: z.string().min(1),
  ref: z.string().optional(),
  timeoutMs: z.number().int().min(100).max(30000).optional()
});

export function createSkillRoutes(db: Database, remoteOptions: GitHubRequestOptions = {}): Router {
  const router = Router();
  router.use(authenticate);
  router.use(createSkillRegistryRoutes(db, remoteOptions));
  const installer = skillInstallService(db, remoteOptions);
  const previewRequired = (_req: unknown, res: import('express').Response) => {
    res.status(409).json({ code: 1, message: 'Preview and review the package before installing', details: { reason: 'PREVIEW_REQUIRED', endpoint: '/api/v1/skills/registry/preview' } });
  };

  router.get("/skills", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new SkillRepository(db, userId);
    seedBuiltinSkills(repo);
    const discovery = syncLocalSkills(repo);
    const skills = repo.list();
    res.json({
      code: 0,
      data: { skills, discovery },
      message: ""
    });
  });

  router.post("/skills/local-sync", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new SkillRepository(db, userId);
    const discovery = syncLocalSkills(repo);
    const skills = repo.list();
    res.json({
      code: 0,
      data: { skills, discovery },
      message: ""
    });
  });

  router.post("/skills", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = createSkillSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }
    const repo = new SkillRepository(db, userId);
    const skill = repo.create(parseResult.data);
    res.status(201).json({
      code: 0,
      data: { skill },
      message: ""
    });
  });

  router.get("/skills/sources", (_req, res) => {
    res.json({
      code: 0,
      data: { sources: listSkillSources() },
      message: ""
    });
  });

  router.get("/skills/templates", (_req, res) => {
    res.json({
      code: 0,
      data: { templates: listSkillTemplates() },
      message: ""
    });
  });

  router.post("/skills/install/preview", previewRequired);

  router.post("/skills/install", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = installSkillSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }
    const source = getSkillSource(parseResult.data.sourceId);
    if (!source) {
      res.status(400).json({ code: 1, message: "Unknown skill source" });
      return;
    }
    try {
      validateSkillName(parseResult.data.name);
      const repo = new SkillRepository(db, userId);
      if (parseResult.data.url || source.id !== 'local') {
        previewRequired(req, res);
        return;
      }

      const skill = repo.create({
        name: parseResult.data.name,
        description: parseResult.data.description,
        source: source.id,
        content: buildSkillInstallContent(source, parseResult.data),
        version: parseResult.data.version ?? source.defaultVersion,
        isEnabled: parseResult.data.enable ?? false
      });
      res.status(201).json({
        code: 0,
        data: { skill, source },
        message: ""
      });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Skill install failed"
      });
    }
  });

  router.post("/skills/install/github/preview", async (req, res) => {
    const parseResult = githubPreviewSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }
    try {
      const locator = parseGitHubSkillLocator(parseResult.data.repo);
      const ref = parseResult.data.ref ?? locator.ref;
      const resolved = await resolveGitHubRef({
        owner: locator.owner,
        repo: locator.repo,
        ...(ref ? { ref } : {}),
        ...remoteOptions
      });
      const discovered = await listSkillFiles({
        owner: locator.owner,
        repo: locator.repo,
        sha: resolved.sha,
        ...(locator.subpath ? { subpath: locator.subpath } : {}),
        ...remoteOptions
      });
      res.json({
        code: 0,
        data: {
          sha: resolved.sha,
          ref: resolved.ref,
          repo: `${locator.owner}/${locator.repo}`,
          skills: discovered.files
        },
        message: ""
      });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "GitHub Skill preview failed"
      });
    }
  });

  router.post("/skills/install/github", previewRequired);

  router.post("/skills/check-updates", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new SkillRepository(db, userId);
    const remoteSkills = repo.listOwned().filter((skill) => skill.remoteProvenance);
    const results = [];
    for (const skill of remoteSkills) {
      try {
        results.push(await installer.checkUpdate(userId, skill.id));
      } catch (error) {
        results.push({
          skillId: skill.id,
          name: skill.name,
          kind: "github" as const,
          currentSha: "",
          latestSha: "",
          updateAvailable: false,
          checkedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : "Update check failed"
        });
      }
    }
    res.json({
      code: 0,
      data: { results },
      message: ""
    });
  });

  router.post("/skills/:id/check-update", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new SkillRepository(db, userId);
    const skill = repo.getOwnedById(req.params.id);
    if (!skill) {
      res.status(404).json({ code: 1, message: "Skill not found" });
      return;
    }
    try {
      const check = await installer.checkUpdate(userId, skill.id);
      res.json({
        code: 0,
        data: check,
        message: ""
      });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Update check failed"
      });
    }
  });

  router.post("/skills/:id/update", previewRequired);

  router.get("/skills/:id", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new SkillRepository(db, userId);
    const skill = repo.getById(req.params.id);
    if (!skill) {
      res.status(404).json({ code: 1, message: "Skill not found" });
      return;
    }
    res.json({
      code: 0,
      data: { skill },
      message: ""
    });
  });

  router.put("/skills/:id", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = updateSkillSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }
    const repo = new SkillRepository(db, userId);
    const skill = repo.update(req.params.id, parseResult.data);
    if (!skill) {
      res.status(404).json({ code: 1, message: "Skill not found" });
      return;
    }
    res.json({
      code: 0,
      data: { skill },
      message: ""
    });
  });

  router.delete("/skills/:id", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new SkillRepository(db, userId);
    const skill = repo.getOwnedById(req.params.id);
    if (!skill) {
      res.status(404).json({ code: 1, message: "Skill not found" });
      return;
    }
    repo.delete(req.params.id);
    res.json({
      code: 0,
      data: {},
      message: ""
    });
  });

  router.post("/skills/:id/toggle", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new SkillRepository(db, userId);
    const skill = repo.getOwnedById(req.params.id);
    if (!skill) {
      res.status(404).json({ code: 1, message: "Skill not found" });
      return;
    }
    const enabled = req.body?.enabled;
    if (typeof enabled !== "boolean") {
      res.status(400).json({ code: 1, message: "enabled must be a boolean" });
      return;
    }
    const updated = repo.toggle(req.params.id, enabled);
    res.json({
      code: 0,
      data: { skill: updated },
      message: ""
    });
  });

  router.get("/projects/:id/skills", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const projectRepo = new ProjectRepository(db, userId);
    const project = projectRepo.getById(req.params.id);
    if (!project) {
      res.status(404).json({ code: 1, message: "Project not found" });
      return;
    }
    const projectSkillRepo = new ProjectSkillRepository(db, userId);
    const skills = projectSkillRepo.listByProject(req.params.id);
    res.json({
      code: 0,
      data: { skills },
      message: ""
    });
  });

  router.post("/projects/:id/skills/:skillId", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const projectRepo = new ProjectRepository(db, userId);
    const project = projectRepo.getById(req.params.id);
    if (!project) {
      res.status(404).json({ code: 1, message: "Project not found" });
      return;
    }
    const skillRepo = new SkillRepository(db, userId);
    const skill = skillRepo.getById(req.params.skillId);
    if (!skill) {
      res.status(404).json({ code: 1, message: "Skill not found" });
      return;
    }
    const enabled = req.body?.enabled;
    if (typeof enabled !== "boolean") {
      res.status(400).json({ code: 1, message: "enabled must be a boolean" });
      return;
    }
    const projectSkillRepo = new ProjectSkillRepository(db, userId);
    const updated = projectSkillRepo.setSkill(req.params.id, req.params.skillId, enabled);
    res.json({
      code: 0,
      data: { projectSkill: updated },
      message: ""
    });
  });

  return router;
}
