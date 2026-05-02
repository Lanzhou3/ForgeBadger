import { Router } from "express";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { getDashboardSummary } from "../services/dashboard-summary.js";
import type { Database } from "../db/types.js";

export function createDashboardRoutes(db: Database, masterKey: string): Router {
  const router = Router();
  router.use(authenticate);

  router.get("/summary", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const summary = getDashboardSummary(db, userId, masterKey);
    res.json({
      code: 0,
      data: summary,
      message: ""
    });
  });

  router.get("/stats", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const summary = getDashboardSummary(db, userId, masterKey);
    res.json({
      code: 0,
      data: { stats: summary.stats },
      message: ""
    });
  });

  router.get("/health", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const summary = getDashboardSummary(db, userId, masterKey);
    res.json({
      code: 0,
      data: { health: summary.health },
      message: ""
    });
  });

  return router;
}
