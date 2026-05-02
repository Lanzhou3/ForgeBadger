import { Router } from "express";
import { checkGateADependencies } from "../lib/dependency-check.js";

export function createDependencyRoutes(): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    const dependencies = await checkGateADependencies();
    res.json({
      code: 0,
      data: { dependencies },
      message: ""
    });
  });

  return router;
}
