import { Router } from "express";

import { authenticate } from "../auth/middleware.js";
import { checkForgeBadgerRuntimeDependencies } from "../lib/dependency-check.js";
import type { InMemorySessionManager } from "../services/session-manager.js";

export function createDependencyRoutes(sessionManager?: InMemorySessionManager): Router {
  const router = Router();

  router.use(authenticate);

  router.get("/", async (_req, res) => {
    const report = await checkForgeBadgerRuntimeDependencies(
      undefined,
      sessionManager?.terminalBackendHealth()
    );
    res.json({
      code: 0,
      data: report,
      message: ""
    });
  });

  return router;
}
