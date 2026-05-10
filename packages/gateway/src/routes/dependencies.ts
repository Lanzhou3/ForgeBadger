import { Router } from "express";
import { checkOpenForgeRuntimeDependencies } from "../lib/dependency-check.js";

export function createDependencyRoutes(): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    const report = await checkOpenForgeRuntimeDependencies();
    res.json({
      code: 0,
      data: report,
      message: ""
    });
  });

  return router;
}
