import { Router } from "express";
import { z } from "zod";
import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import type { Database } from "../db/types.js";
import { CopilotGrantRepository } from "../db/repositories/copilot-grant-repository.js";
import { managementPatchSchema, projectManagementOverview } from "../services/project-manager/management.js";

type ExecuteOwner = (userId: string, commandId: string, input: unknown) => Promise<unknown>;
const overviewQuery = z.object({ grantId: z.string().min(1).max(128).optional() }).strict();

/** Mount at /api/v1; command execution is supplied by the shared action service. */
export function createProjectManagementRoutes(db: Database, executeOwner: ExecuteOwner): Router {
  const router = Router();
  router.use(authenticate);
  router.get("/project-manager/overview", (req, res) => {
    try {
      const userId = (req as AuthenticatedRequest).userId;
      const { grantId } = overviewQuery.parse(req.query);
      const grant = grantId ? new CopilotGrantRepository(db, userId).get(grantId) : undefined;
      if (grantId && (!grant || grant.status !== "active" || grant.expiresAt <= Date.now() || grant.actorUserId !== userId)) {
        res.status(403).json({ code: 1, message: "Grant unavailable, expired or revoked" }); return;
      }
      res.json({ code: 0, data: projectManagementOverview({ db, userId }, grant?.scope.projectIds), message: "" });
    } catch (error) {
      res.status(400).json({ code: 1, message: error instanceof Error ? error.message : "Invalid overview request" });
    }
  });
  router.patch("/projects/:id/project-manager/management", async (req, res, next) => {
    try {
      const body = managementPatchSchema.safeParse(req.body);
      if (!body.success) { res.status(400).json({ code: 1, message: "Invalid management update", details: body.error.flatten() }); return; }
      const projectId = z.string().min(1).max(128).parse(req.params.id);
      const management = await executeOwner((req as unknown as AuthenticatedRequest).userId, "pm.management.update", { ...body.data, projectId });
      res.json({ code: 0, data: { management }, message: "" });
    } catch (error) { next(error); }
  });
  return router;
}
