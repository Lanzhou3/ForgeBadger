import { Router } from "express";
import { z } from "zod";
import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import type { Database } from "../db/types.js";
import { ProjectRepository } from "../db/repositories/project-repository.js";
import { managementPatchSchema, projectManagementOverview } from "../services/project-manager/management.js";

type ExecuteOwner = (userId: string, commandId: string, input: unknown) => Promise<unknown>;
const copilotAutonomyPatch = z.object({ enabled: z.boolean() }).strict();

/** Mount at /api/v1; command execution is supplied by the shared action service. */
export function createProjectManagementRoutes(db: Database, executeOwner: ExecuteOwner): Router {
  const router = Router();
  router.use(authenticate);
  router.get("/project-manager/overview", (req, res) => {
    try {
      const userId = (req as AuthenticatedRequest).userId;
      res.json({ code: 0, data: projectManagementOverview({ db, userId }), message: "" });
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
  router.patch("/projects/:id/copilot-autonomy", (req, res, next) => {
    try {
      const body = copilotAutonomyPatch.safeParse(req.body);
      if (!body.success) { res.status(400).json({ code: 1, message: "Invalid copilot autonomy update", details: body.error.flatten() }); return; }
      const projectId = z.string().min(1).max(128).parse(req.params.id);
      const project = new ProjectRepository(db, (req as unknown as AuthenticatedRequest).userId).setCopilotAutonomy(projectId, body.data.enabled);
      if (!project) { res.status(404).json({ code: 1, message: "Project not found" }); return; }
      res.json({ code: 0, data: { projectId: project.id, copilotAutonomy: project.copilotAutonomy }, message: "" });
    } catch (error) { next(error); }
  });
  return router;
}
