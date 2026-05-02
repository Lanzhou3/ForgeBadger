import { Router } from "express";

import { authenticate } from "../auth/middleware.js";
import { discoverAdapters } from "../services/adapter-discovery.js";

export function createAdapterRoutes(): Router {
  const router = Router();
  router.use(authenticate);

  router.get("/discovery", async (_req, res) => {
    const adapters = await discoverAdapters();
    res.json({
      code: 0,
      data: { adapters },
      message: ""
    });
  });

  return router;
}
