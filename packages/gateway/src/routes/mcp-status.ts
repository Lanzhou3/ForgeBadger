/**
 * MCP integration status route.
 *
 * Mounted unconditionally (unlike the /mcp endpoint and the token routes,
 * which only exist when FORGEBADGER_MCP_ENABLED=true) so the Web console can
 * always show the service state and endpoint URL, and degrade gracefully with
 * an actionable hint instead of a bare 404 when the feature is off.
 */
import { Router } from "express";

import { authenticate } from "../auth/middleware.js";
import { loadEnv } from "../config/env.js";

export interface McpStatusRouteDeps {
  mcpEnabled?: boolean | undefined;
  /** Test seam: overrides the endpoint derived from the gateway env. */
  endpoint?: string | undefined;
}

export function createMcpStatusRoutes(deps: McpStatusRouteDeps = {}): Router {
  const router = Router();
  router.use(authenticate);

  router.get("/", (_req, res) => {
    const env = loadEnv();
    const endpoint = deps.endpoint ?? `http://${env.FORGEBADGER_HOST}:${env.FORGEBADGER_PORT}/mcp`;
    res.json({
      code: 0,
      data: {
        enabled: deps.mcpEnabled === true,
        endpoint
      },
      message: ""
    });
  });

  return router;
}
