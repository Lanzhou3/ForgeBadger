import { Router } from "express";

import { authenticate } from "../auth/middleware.js";
import { discoverAdapters } from "../services/adapter-discovery.js";
import type { InMemorySessionManager } from "../services/session-manager.js";

export function createAdapterRoutes(sessionManager?: InMemorySessionManager): Router {
  const router = Router();
  router.use(authenticate);

  router.get("/discovery", async (_req, res) => {
    const adapters = await discoverAdapters(undefined, sessionManager?.terminalBackendHealth());
    res.json({
      code: 0,
      data: { adapters },
      message: ""
    });
  });

  return router;
}
