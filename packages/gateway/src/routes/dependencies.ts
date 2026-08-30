import { Router } from "express";

import { authenticate } from "../auth/middleware.js";
import { checkForgeBadgerRuntimeDependencies } from "../lib/dependency-check.js";

export function createDependencyRoutes(): Router {
  const router = Router();

  router.use(authenticate);

  router.get("/", async (_req, res) => {
    const report = await checkForgeBadgerRuntimeDependencies();
    res.json({
      code: 0,
      data: report,
      message: ""
    });
  });

  return router;
}
