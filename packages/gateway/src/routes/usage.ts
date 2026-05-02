import { Router } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { ModelRepository } from "../db/repositories/model-repository.js";
import { UsageRepository } from "../db/repositories/usage-repository.js";
import type { Database } from "../db/types.js";

const rateSchema = z.object({
  hourlyRateUsd: z.number().min(0)
});

export function createUsageRoutes(db: Database): Router {
  const router = Router();
  router.use(authenticate);

  router.get("/summary", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    res.json({
      code: 0,
      data: { summary: new UsageRepository(db, userId).getSummary() },
      message: ""
    });
  });

  router.get("/rates", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    res.json({
      code: 0,
      data: { rates: new UsageRepository(db, userId).listModelRates() },
      message: ""
    });
  });

  router.put("/rates/:modelId", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = rateSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }
    if (!new ModelRepository(db, userId).getById(req.params.modelId)) {
      res.status(404).json({ code: 1, message: "Model not found" });
      return;
    }
    const rate = new UsageRepository(db, userId).setModelRate(
      req.params.modelId,
      parseResult.data.hourlyRateUsd
    );
    res.json({
      code: 0,
      data: { rate },
      message: ""
    });
  });

  return router;
}
