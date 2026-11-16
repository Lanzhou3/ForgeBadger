import { Router } from "express";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { UserRepository } from "../db/repositories/user-repository.js";
import type { Database } from "../db/types.js";
import type { RuntimeSettingsStore } from "../services/runtime-settings.js";
import { RuntimeSettingsError } from "../services/runtime-settings.js";
import { adapterIds } from "../lib/adapter-ids.js";
import { PROGRAMMATIC_SUBMIT_ADAPTERS } from "../services/programmatic-terminal-submit.js";
import { goalCheckSandboxCapability } from "../services/agent/command-sandbox.js";

/** Host facts the settings page needs to render switches it cannot honor. */
function hostCapabilities() {
  const programmaticDispatch = Object.fromEntries(
    adapterIds.map((id) => [id, (PROGRAMMATIC_SUBMIT_ADAPTERS as readonly string[]).includes(id)])
  );
  return { goalCheckSandbox: goalCheckSandboxCapability(), programmaticDispatch };
}

function enablesGoalCheckSandbox(body: Record<string, unknown>): boolean {
  return body.goal_check_sandbox === true || body.goal_check_sandbox === "true";
}

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
      data: { settings: store.views(), readonly: store.effective().readonly, capabilities: hostCapabilities() },
      message: ""
    });
  });

  router.put("/", (req, res) => {
    if (!store) {
      res.status(503).json({ code: 1, message: "Runtime settings are not available on this Gateway" });
      return;
    }
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const body = (req.body ?? {}) as Record<string, unknown>;
    // Isolation never falls back, so turning it on where it cannot work would
    // make every goal check need an unsandboxed approval.
    const sandbox = enablesGoalCheckSandbox(body) ? goalCheckSandboxCapability() : null;
    if (sandbox && !sandbox.available) {
      res.status(409).json({
        code: 1,
        message: `Goal check isolation is not available on this host: ${sandbox.reason}`,
        details: { code: "GOAL_CHECK_SANDBOX_UNAVAILABLE" }
      });
      return;
    }
    try {
      const settings = store.update(userId, body, req.ip);
      res.json({ code: 0, data: { settings, readonly: store.effective().readonly, capabilities: hostCapabilities() }, message: "" });
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
