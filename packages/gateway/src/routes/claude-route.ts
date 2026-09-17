import { Router, type Request, type Response } from "express";

import type { Database } from "../db/types.js";
import type { OutboundHostResolver } from "../services/network-policy.js";
import {
  ClaudeRouteError,
  forwardClaudeCountTokens,
  forwardClaudeMessages,
  listClaudeRouteModels
} from "../services/claude-route/forwarder.js";

export interface ClaudeRouteRouteOptions {
  /** Test seam: DNS resolver for the outbound SSRF check. */
  resolveHost?: OutboundHostResolver | undefined;
  /** Test seam: upstream HTTP client. */
  fetchImpl?: typeof fetch | undefined;
}

/**
 * Data plane: the Anthropic-compatible endpoint Claude Code talks to when a
 * provider is applied through the Gateway route (ANTHROPIC_BASE_URL).
 * Auth is the per-user loopback route token (Bearer or x-api-key), NOT the
 * management JWT — this router is deliberately mounted outside /api/v1.
 */
export function createClaudeRouteRoutes(
  db: Database,
  masterKey: string,
  options: ClaudeRouteRouteOptions = {}
): Router {
  const router = Router();
  const deps = {
    db,
    masterKey,
    ...(options.resolveHost ? { resolveHost: options.resolveHost } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
  };

  router.post("/messages", async (req, res) => {
    await safeForward(deps, res, async () => {
      await forwardClaudeMessages(deps, res, routeToken(req), req.body ?? {}, headerSubset(req));
    });
  });

  router.post("/messages/count_tokens", async (req, res) => {
    await safeForward(deps, res, async () => {
      await forwardClaudeCountTokens(deps, res, routeToken(req), req.body ?? {}, headerSubset(req));
    });
  });

  router.get("/models", (req, res) => {
    safeForward(deps, res, async () => {
      res.json(listClaudeRouteModels(deps.db, deps.masterKey, routeToken(req)));
    });
  });

  return router;
}

async function safeForward(
  deps: { db: Database; masterKey: string },
  res: Response,
  action: () => Promise<void>
): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof ClaudeRouteError) {
      // Headers are already sent once streaming starts; only a well-formed
      // error body can still be delivered, so stop there.
      if (res.headersSent) {
        res.end();
        return;
      }
      res.status(error.status).json({ type: "error", error: { type: error.code, message: error.message } });
      return;
    }
    console.warn("[claude-route] request failed", {
      code: "ROUTE_REQUEST_FAILED",
      message: error instanceof Error ? error.message : String(error)
    });
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(500).json({ type: "error", error: { type: "api_error", message: "Claude route request failed" } });
  }
}

/** Claude Code sends the token as `Authorization: Bearer <token>` (ANTHROPIC_AUTH_TOKEN)
 * or `x-api-key: <token>` (ANTHROPIC_API_KEY). */
function routeToken(req: Request): string | undefined {
  const authorization = req.headers.authorization;
  if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    if (token) return token;
  }
  const apiKey = req.headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey.trim()) return apiKey.trim();
  return undefined;
}

function headerSubset(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (name === "authorization" || name === "x-api-key") continue;
    out[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}
