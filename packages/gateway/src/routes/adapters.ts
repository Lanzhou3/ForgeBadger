import { Router } from "express";

import { authenticate } from "../auth/middleware.js";
import { extractBearerToken, userIsInstanceAdmin, type AuthenticatedRequest } from "../auth/middleware.js";
import type { Database } from "../db/types.js";
import { discoverAdapters, isAdapterId } from "../services/adapter-discovery.js";
import {
  AdapterUpdateError,
  checkAdapterUpdates,
  installAdapter,
  updateAdapter,
  type AdapterUpdateDependencies,
  type AdapterUpdateStatus
} from "../services/adapter-updates.js";
import type { InMemorySessionManager } from "../services/session-manager.js";

export function createAdapterRoutes(
  sessionManager?: InMemorySessionManager,
  updateDependencies: AdapterUpdateDependencies = {}
): Router {
  const router = Router();
  router.use(authenticate);
  let cache: { updates: AdapterUpdateStatus[]; expiresAt: number } | undefined;
  let inFlight: Promise<AdapterUpdateStatus[]> | undefined;
  let cacheGeneration = 0;

  async function readUpdates(refresh: boolean): Promise<AdapterUpdateStatus[]> {
    if (inFlight) return inFlight;
    if (!refresh && cache && cache.expiresAt > Date.now()) return cache.updates;
    const generation = cacheGeneration;
    const pending = checkAdapterUpdates(updateDependencies);
    inFlight = pending;
    try {
      const updates = await pending;
      if (generation === cacheGeneration) cache = { updates, expiresAt: Date.now() + 60_000 };
      return updates;
    } finally {
      if (inFlight === pending) inFlight = undefined;
    }
  }

  function invalidateUpdates(): void {
    cacheGeneration += 1;
    cache = undefined;
    inFlight = undefined;
  }

  router.get("/discovery", async (_req, res) => {
    const adapters = await discoverAdapters(undefined, sessionManager?.terminalBackendHealth());
    res.json({
      code: 0,
      data: { adapters },
      message: ""
    });
  });

  router.get("/updates", async (req, res) => {
    const db = req.app.locals.db as Database | undefined;
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const canUpdate = !!db && userIsInstanceAdmin(db, userId);
    const updates = await readUpdates(canUpdate && req.query.refresh === "true");
    res.json({ code: 0, data: { updates, canUpdate, canInstall: canUpdate }, message: "" });
  });

  router.post("/:adapterId/update", async (req, res) => {
    const bearerToken = extractBearerToken(req.headers.authorization)?.trim();
    if (!bearerToken || (req as unknown as AuthenticatedRequest).authToken !== bearerToken) {
      res.status(403).json({ code: 1, message: "Bearer authorization required" });
      return;
    }
    const db = req.app.locals.db as Database | undefined;
    const userId = (req as unknown as AuthenticatedRequest).userId;
    if (!db || !userIsInstanceAdmin(db, userId)) {
      res.status(403).json({ code: 1, message: "Instance admin access required" });
      return;
    }
    const adapterId = req.params.adapterId;
    if (!adapterId || !isAdapterId(adapterId)) {
      res.status(400).json({ code: 1, message: "Unknown adapter" });
      return;
    }
    try {
      const result = await updateAdapter(adapterId, updateDependencies);
      invalidateUpdates();
      res.json({ code: 0, data: result, message: "" });
    } catch (error) {
      const status = error instanceof AdapterUpdateError ? error.statusCode : 500;
      const message = error instanceof AdapterUpdateError ? error.message : "CLI update failed";
      res.status(status).json({ code: 1, message });
    }
  });

  router.post("/:adapterId/install", async (req, res) => {
    const bearerToken = extractBearerToken(req.headers.authorization)?.trim();
    if (!bearerToken || (req as unknown as AuthenticatedRequest).authToken !== bearerToken) {
      res.status(403).json({ code: 1, message: "Bearer authorization required" });
      return;
    }
    const db = req.app.locals.db as Database | undefined;
    const userId = (req as unknown as AuthenticatedRequest).userId;
    if (!db || !userIsInstanceAdmin(db, userId)) {
      res.status(403).json({ code: 1, message: "Instance admin access required" });
      return;
    }
    const adapterId = req.params.adapterId;
    if (!adapterId || !isAdapterId(adapterId)) {
      res.status(400).json({ code: 1, message: "Unknown adapter" });
      return;
    }
    try {
      const result = await installAdapter(adapterId, updateDependencies);
      invalidateUpdates();
      res.json({ code: 0, data: result, message: "" });
    } catch (error) {
      const status = error instanceof AdapterUpdateError ? error.statusCode : 500;
      const message = error instanceof AdapterUpdateError ? error.message : "CLI install failed";
      res.status(status).json({ code: 1, message });
    }
  });

  return router;
}
