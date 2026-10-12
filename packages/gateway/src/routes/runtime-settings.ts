import { Router } from "express";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { UserRepository } from "../db/repositories/user-repository.js";
import type { Database } from "../db/types.js";
import type { RuntimeSettingsStore } from "../services/runtime-settings.js";
import { RuntimeSettingsError } from "../services/runtime-settings.js";

export function createRuntimeSettingsRoutes(db: Database, store?: RuntimeSettingsStore): Router {
  const router = Router();
  router.use(authenticate);
  router.use((req, res, next) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const currentUser = new UserRepository(db).findById(userId);
    if (!currentUser || currentUser.status !== "active" || currentUser.role !== "admin") {
      res.status(403).json({ code: 1, message: "Admin access required" });
      return;
    }
    next();
  });

  router.get("/", (_req, res) => {
    if (!store) {
      res.status(503).json({ code: 1, message: "Runtime settings are not available on this Gateway" });
      return;
    }
    res.json({
      code: 0,
      data: { settings: store.views(), readonly: store.effective().readonly },
      message: ""
    });
  });

  router.put("/", (req, res) => {
    if (!store) {
      res.status(503).json({ code: 1, message: "Runtime settings are not available on this Gateway" });
      return;
    }
    const userId = (req as unknown as AuthenticatedRequest).userId;
    try {
      const settings = store.update(userId, (req.body ?? {}) as Record<string, unknown>, req.ip);
      res.json({ code: 0, data: { settings, readonly: store.effective().readonly }, message: "" });
    } catch (error) {
      if (error instanceof RuntimeSettingsError) {
        res.status(error.status).json({ code: 1, message: error.message });
        return;
      }
      console.error("[runtime-settings] update failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      res.status(500).json({ code: 1, message: "Failed to update runtime settings" });
    }
  });

  return router;
}
