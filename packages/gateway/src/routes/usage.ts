import { Router } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { ModelProviderRepository } from "../db/repositories/model-provider-repository.js";
import { TokenUsageRepository } from "../db/repositories/token-usage-repository.js";
import { UsageRepository } from "../db/repositories/usage-repository.js";
import { createUsageTokenSyncer } from "../services/usage/usage-token-syncer.js";
import type { Database } from "../db/types.js";

const rateSchema = z.object({
  hourlyRateUsd: z.number().min(0)
});

const dateParam = (value: unknown): Date | undefined => {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms) : undefined;
};

export function createUsageRoutes(db: Database, masterKey: string): Router {
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

  // Token usage stats (real CLI token counts, no cost).
  router.get("/token-summary", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const from = dateParam(req.query.from);
    const to = dateParam(req.query.to);
    res.json({
      code: 0,
      data: { summary: new TokenUsageRepository(db, userId).getSummary(from, to) },
      message: ""
    });
  });

  router.get("/project-activity", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const from = dateParam(req.query.from);
    const to = dateParam(req.query.to);
    const options: Parameters<TokenUsageRepository["getDailySeries"]>[0] = {
      groupBy: "project"
    };
    if (from) options.from = from;
    if (to) options.to = to;
    res.json({
      code: 0,
      data: {
        series: new TokenUsageRepository(db, userId).getDailySeries(options)
      },
      message: ""
    });
  });

  router.post("/sync", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const syncer = createUsageTokenSyncer(db);
    const result = syncer.syncAllForUser(userId);
    res.json({ code: 0, data: { result }, message: "" });
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
    if (!new ModelProviderRepository(db, userId, masterKey).getModelProfile(req.params.modelId)) {
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
