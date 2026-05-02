import { Router } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { ModelRepository } from "../db/repositories/model-repository.js";
import type { Database } from "../db/types.js";
import { checkModelEndpoint } from "../services/model-endpoint-health.js";
import { getModelPresets, groupModelsByProvider } from "../services/model-catalog.js";
import { buildModelHealth } from "../services/model-health.js";

const createModelSchema = z.object({
  name: z.string().min(1),
  provider: z.string().min(1),
  modelId: z.string().min(1),
  endpoint: z.string().optional()
});

const updateModelSchema = z.object({
  name: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  endpoint: z.string().optional()
});

const endpointCheckSchema = z.object({
  timeoutMs: z.number().int().min(100).max(15000).optional()
});

export function createModelRoutes(db: Database): Router {
  const router = Router();
  router.use(authenticate);

  router.get("/", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new ModelRepository(db, userId);
    const models = repo.list();
    res.json({
      code: 0,
      data: { models },
      message: ""
    });
  });

  router.post("/", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = createModelSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }
    const repo = new ModelRepository(db, userId);
    const model = repo.create(parseResult.data);
    res.status(201).json({
      code: 0,
      data: { model },
      message: ""
    });
  });

  router.get("/presets", (_req, res) => {
    res.json({
      code: 0,
      data: { presets: getModelPresets() },
      message: ""
    });
  });

  router.get("/groups", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new ModelRepository(db, userId);
    res.json({
      code: 0,
      data: { groups: groupModelsByProvider(repo.list()) },
      message: ""
    });
  });

  router.get("/:id", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new ModelRepository(db, userId);
    const model = repo.getById(req.params.id);
    if (!model) {
      res.status(404).json({ code: 1, message: "Model not found" });
      return;
    }
    res.json({
      code: 0,
      data: { model },
      message: ""
    });
  });

  router.put("/:id", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = updateModelSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }
    const repo = new ModelRepository(db, userId);
    const model = repo.update(req.params.id, parseResult.data);
    if (!model) {
      res.status(404).json({ code: 1, message: "Model not found" });
      return;
    }
    res.json({
      code: 0,
      data: { model },
      message: ""
    });
  });

  router.delete("/:id", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new ModelRepository(db, userId);
    const model = repo.getById(req.params.id);
    if (!model) {
      res.status(404).json({ code: 1, message: "Model not found" });
      return;
    }
    repo.delete(req.params.id);
    res.json({
      code: 0,
      data: {},
      message: ""
    });
  });

  router.post("/:id/set-default", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new ModelRepository(db, userId);
    const model = repo.setDefault(req.params.id);
    if (!model) {
      res.status(404).json({ code: 1, message: "Model not found" });
      return;
    }
    res.json({
      code: 0,
      data: { model },
      message: ""
    });
  });

  router.post("/:id/check", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new ModelRepository(db, userId);
    const model = repo.getById(req.params.id);
    if (!model) {
      res.status(404).json({ code: 1, message: "Model not found" });
      return;
    }

    res.json({
      code: 0,
      data: {
        health: buildModelHealth(model)
      },
      message: ""
    });
  });

  router.post("/:id/check-endpoint", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = endpointCheckSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    const repo = new ModelRepository(db, userId);
    const model = repo.getById(req.params.id);
    if (!model) {
      res.status(404).json({ code: 1, message: "Model not found" });
      return;
    }
    if (!model.endpoint?.trim()) {
      res.status(400).json({ code: 1, message: "Model endpoint is required" });
      return;
    }

    const health = await checkModelEndpoint({
      endpoint: model.endpoint,
      ...(parseResult.data.timeoutMs !== undefined ? { timeoutMs: parseResult.data.timeoutMs } : {})
    });
    res.json({
      code: 0,
      data: { health },
      message: ""
    });
  });

  return router;
}
