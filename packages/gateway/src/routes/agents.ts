import { Router } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { AgentRepository } from "../db/repositories/agent-repository.js";
import type { Database } from "../db/types.js";
import { listAgentTemplates } from "../services/agent-templates.js";

const createAgentSchema = z.object({
  projectId: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  modelId: z.string().optional(),
  tools: z.string().optional(),
  allowedDirs: z.string().optional(),
  customPrompt: z.string().optional()
});

const updateAgentSchema = z.object({
  projectId: z.string().optional(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  modelId: z.string().optional(),
  tools: z.string().optional(),
  allowedDirs: z.string().optional(),
  customPrompt: z.string().optional(),
  status: z.string().optional()
});

export function createAgentRoutes(db: Database): Router {
  const router = Router();
  router.use(authenticate);

  router.get("/", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new AgentRepository(db, userId);
    const projectId = req.query.project_id as string | undefined;
    let agents = repo.list();
    if (projectId) {
      agents = agents.filter((a) => a.projectId === projectId);
    }
    res.json({
      code: 0,
      data: { agents },
      message: ""
    });
  });

  router.get("/templates", (_req, res) => {
    res.json({
      code: 0,
      data: { templates: listAgentTemplates() },
      message: ""
    });
  });

  router.post("/", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = createAgentSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }
    const repo = new AgentRepository(db, userId);
    const agent = repo.create(parseResult.data);
    res.status(201).json({
      code: 0,
      data: { agent },
      message: ""
    });
  });

  router.get("/:id", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new AgentRepository(db, userId);
    const agent = repo.getById(req.params.id);
    if (!agent) {
      res.status(404).json({ code: 1, message: "Agent not found" });
      return;
    }
    res.json({
      code: 0,
      data: { agent },
      message: ""
    });
  });

  router.put("/:id", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = updateAgentSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }
    const repo = new AgentRepository(db, userId);
    const agent = repo.update(req.params.id, parseResult.data);
    if (!agent) {
      res.status(404).json({ code: 1, message: "Agent not found" });
      return;
    }
    res.json({
      code: 0,
      data: { agent },
      message: ""
    });
  });

  router.delete("/:id", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new AgentRepository(db, userId);
    const agent = repo.getById(req.params.id);
    if (!agent) {
      res.status(404).json({ code: 1, message: "Agent not found" });
      return;
    }
    repo.delete(req.params.id);
    res.json({
      code: 0,
      data: {},
      message: ""
    });
  });

  return router;
}
