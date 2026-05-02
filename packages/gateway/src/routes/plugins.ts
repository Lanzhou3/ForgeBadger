import { Router } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { AuditLogRepository } from "../db/repositories/audit-log-repository.js";
import { PluginRepository } from "../db/repositories/plugin-repository.js";
import type { Database } from "../db/types.js";

const togglePluginSchema = z.object({
  enabled: z.boolean()
});

export function createPluginRoutes(db: Database): Router {
  const router = Router();
  router.use(authenticate);

  router.get("/", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new PluginRepository(db, userId);
    res.json({
      code: 0,
      data: { plugins: repo.list() },
      message: ""
    });
  });

  router.post("/:id/toggle", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = togglePluginSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }
    const repo = new PluginRepository(db, userId);
    if (!repo.getByPluginId(req.params.id)) {
      res.status(404).json({ code: 1, message: "Plugin not found" });
      return;
    }
    const plugin = repo.setEnabled(req.params.id, parseResult.data.enabled);
    new AuditLogRepository(db, userId).create({
      action: parseResult.data.enabled ? "plugin.enable" : "plugin.disable",
      resourceType: "plugin",
      resourceId: req.params.id,
      details: {
        pluginId: req.params.id,
        enabled: parseResult.data.enabled,
        status: plugin?.status
      },
      ipAddress: req.ip
    });
    res.json({
      code: 0,
      data: { plugin },
      message: ""
    });
  });

  return router;
}
