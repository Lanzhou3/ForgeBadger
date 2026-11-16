/**
 * Team hub insights (module ownership, scope and conflict analysis of the
 * hub's mirror clone). Session-authenticated only; mounted at
 * `/api/v1/hub-console`.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import type { Database } from "../db/types.js";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { CollaborationError } from "../services/collaboration/types.js";
import { HubInsights } from "../services/hub/insights.js";

const id = z.string().uuid();
const moduleBody = z.object({ pattern: z.string().min(1).max(300).nullable() }).strict();
const emptyBody = z.object({}).strict();

function sendError(req: Request, res: Response, error: unknown): void {
  const invalid = error instanceof z.ZodError;
  const known = error instanceof CollaborationError;
  const code = known ? error.code : invalid ? "INVALID_INPUT" : "HUB_OPERATION_FAILED";
  if (!known && !invalid) {
    console.error("[hub-insights] request failed", { action: `${req.method} ${req.route?.path ?? ""}`, code, timestamp: Date.now() });
  }
  res.status(known ? error.status : invalid ? 400 : 500).json({ code: 1, message: code, details: { code } });
}

function handle(fn: (req: Request) => unknown | Promise<unknown>) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(200).json({ code: 0, data: await fn(req), message: "" });
    } catch (error) {
      sendError(req, res, error);
    }
  };
}

export function createHubInsightRoutes(db: Database): Router {
  const router = Router();
  router.use(authenticate);
  const insights = (req: Request) => new HubInsights(db, (req as unknown as AuthenticatedRequest).userId);
  const project = (req: Request) => id.parse(req.params.projectId);

  router.get("/projects/:projectId/insights", handle(req => insights(req).insights(project(req))));
  router.put("/projects/:projectId/tasks/:taskId/module", handle(async req => ({
    taskModules: await insights(req).setTaskModule(project(req), id.parse(req.params.taskId), moduleBody.parse(req.body).pattern)
  })));
  const refreshLimit = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 6,
    keyFn: req => `hub-mirror-refresh:${(req as unknown as AuthenticatedRequest).userId}`
  });
  router.post("/projects/:projectId/mirror/refresh", refreshLimit, handle(req => {
    emptyBody.parse(req.body ?? {});
    return insights(req).refreshMirror(project(req));
  }));
  return router;
}
