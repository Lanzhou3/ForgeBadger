import { Router } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { ActivityRepository, type SessionActivity } from "../db/repositories/activity-repository.js";
import type { Database } from "../db/types.js";

const listActivitiesSchema = z.object({
  sessionId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
});

export function createActivityRoutes(db: Database): Router {
  const router = Router();
  router.use(authenticate);

  router.get("/", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = listActivitiesSchema.safeParse(req.query);
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    const activities = new ActivityRepository(db, userId)
      .list(parseResult.data)
      .map(toActivityPayload);
    res.json({
      code: 0,
      data: { activities },
      message: ""
    });
  });

  return router;
}

function toActivityPayload(activity: SessionActivity) {
  return {
    id: activity.id,
    sessionId: activity.sessionId,
    projectId: activity.projectId,
    type: activity.type,
    status: activity.status,
    message: activity.message,
    metadata: parseMetadata(activity.metadata),
    createdAt: activity.createdAt.toISOString()
  };
}

function parseMetadata(metadata: string | null): unknown {
  if (!metadata) return null;
  try {
    return JSON.parse(metadata);
  } catch {
    return null;
  }
}
