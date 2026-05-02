import { Router } from "express";

export function createHealthRoutes(): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({
      code: 0,
      data: { status: "ok" },
      message: ""
    });
  });

  return router;
}
