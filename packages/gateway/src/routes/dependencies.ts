import { Router } from "express";
import { checkOpenForgeDependencies } from "../lib/dependency-check.js";

export function createDependencyRoutes(): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    const dependencies = await checkOpenForgeDependencies();
    res.json({
      code: 0,
      data: { dependencies },
      message: ""
    });
  });

  return router;
}
