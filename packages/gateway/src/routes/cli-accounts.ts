import { Router, type Response } from "express";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { redactSensitiveErrorMessage } from "../lib/redaction.js";
import {
  buildCliAccountOverview,
  cliAccountAdapters,
  isCliAccountAdapter,
  CliProbeLimitError,
  type CliAccountAdapter,
  type CliAccountOverview,
  type CliAccountProbeOptions
} from "../services/cli-account/index.js";
import type { CliProbeRunner } from "../services/cli-account/probe-runner.js";

export interface CliAccountRouteOptions {
  /** Test seam: inject the CLI subprocess runner. */
  run?: CliProbeRunner;
  /** Test seam: inject the HTTPS fetcher. */
  fetchImpl?: typeof fetch;
  /** Test seam: override the environment used to resolve CLI config roots. */
  env?: NodeJS.ProcessEnv;
  /** Test seam: override the home directory used to resolve CLI config roots. */
  homeDir?: string;
}

export function createCliAccountRoutes(options: CliAccountRouteOptions = {}): Router {
  const router = Router();
  router.use(authenticate);

  // Refresh triggers real outbound requests to provider endpoints, so a
  // stolen JWT must not be usable to spray them.
  const probeLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 30 });
  router.use("/:adapter/quota/refresh", probeLimiter);

  // Sidebar polling would otherwise spray quota endpoints; cache reads
  // briefly and let POST /:adapter/quota/refresh act as the explicit refresh.
  const quotaCacheTtlMs = 60_000;
  const quotaCache = new Map<string, { overview: CliAccountOverview; expiresAt: number }>();

  const probeOptions = (): CliAccountProbeOptions => ({
    ...(options.run ? { run: options.run } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.env ? { env: options.env } : {}),
    ...(options.homeDir ? { homeDir: options.homeDir } : {})
  });

  const readOverview = async (
    userId: string,
    adapter: CliAccountAdapter,
    bypassCache: boolean
  ): Promise<CliAccountOverview> => {
    const cacheKey = `${userId}:${adapter}`;
    if (!bypassCache) {
      const cached = quotaCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached.overview;
    }
    quotaCache.delete(cacheKey);
    // Adapters degrade to unknown/unsupported states instead of throwing;
    // only the global concurrency guard surfaces here.
    const overview = await buildCliAccountOverview(adapter, userId, probeOptions());
    quotaCache.set(cacheKey, { overview, expiresAt: Date.now() + quotaCacheTtlMs });
    return overview;
  };

  router.get("/", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    try {
      const accounts = await Promise.all(
        cliAccountAdapters.map((adapter) => readOverview(userId, adapter, false))
      );
      res.json({ code: 0, data: { accounts }, message: "" });
    } catch (error) {
      respondProbeError(res, error);
    }
  });

  router.get("/:adapter", async (req, res) => {
    const adapter = req.params.adapter;
    if (!isCliAccountAdapter(adapter)) {
      res.status(400).json({ code: 1, message: "Unsupported CLI account adapter" });
      return;
    }
    const userId = (req as unknown as AuthenticatedRequest).userId;
    try {
      const overview = await readOverview(userId, adapter, false);
      res.json({ code: 0, data: { overview }, message: "" });
    } catch (error) {
      respondProbeError(res, error);
    }
  });

  router.post("/:adapter/quota/refresh", async (req, res) => {
    const adapter = req.params.adapter;
    if (!isCliAccountAdapter(adapter)) {
      res.status(400).json({ code: 1, message: "Unsupported CLI account adapter" });
      return;
    }
    const userId = (req as unknown as AuthenticatedRequest).userId;
    try {
      const overview = await readOverview(userId, adapter, true);
      res.json({ code: 0, data: { overview }, message: "" });
    } catch (error) {
      respondProbeError(res, error);
    }
  });

  return router;
}

function respondProbeError(res: Response, error: unknown): void {
  if (error instanceof CliProbeLimitError) {
    res.status(503).json({ code: 1, message: "CLI account probe is busy" });
    return;
  }
  res.status(500).json({
    code: 1,
    message: redactSensitiveErrorMessage(error instanceof Error ? error.message : "Failed to probe CLI account")
  });
}
