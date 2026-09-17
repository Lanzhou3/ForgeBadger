/**
 * External MCP (Model Context Protocol) endpoint.
 *
 * Streamable HTTP transport in stateless mode: every POST spins up a fresh
 * McpServer + transport pair, so no session state survives a Gateway restart
 * and no SSE streams are held open. Authentication is a long-lived access
 * token (`fbmcp_…`, see routes/mcp-tokens.ts) presented as a Bearer
 * credential; only the SHA-256 hash is stored, revocation is immediate, and
 * the owning user's status is re-read on every request.
 *
 * This surface intentionally does not use the project API envelope — it
 * speaks MCP/JSON-RPC semantics for external agent clients.
 */
import { Router, type NextFunction, type Request, type Response } from "express";

import {
  StreamableHTTPServerTransport,
  type StreamableHTTPServerTransportOptions
} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { extractBearerToken } from "../auth/middleware.js";
import {
  McpTokenRepository,
  parseMcpTokenScopes,
  type McpTokenScope
} from "../db/repositories/mcp-token-repository.js";
import { UserRepository } from "../db/repositories/user-repository.js";
import type { Database } from "../db/types.js";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { buildMcpServer } from "../services/mcp/mcp-server.js";
import type { ServerDeps } from "../server.js";

interface McpAuthenticatedRequest extends Request {
  mcpAuth?: { userId: string; scopes: McpTokenScope[] };
}

export function createMcpRoutes(deps: Pick<ServerDeps, "db" | "masterKey" | "sessionManager" | "appVersion" | "adapterCommandRunner">): Router {
  const router = Router();
  const authenticateMcp = createMcpAuthenticator(deps.db);
  const rateLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 120,
    keyFn: (req) => {
      const auth = (req as McpAuthenticatedRequest).mcpAuth;
      if (auth) return `mcp-user:${auth.userId}`;
      return `ip:${req.ip ?? req.socket?.remoteAddress ?? "unknown"}`;
    }
  });

  router.post("/", authenticateMcp, rateLimiter, async (req: McpAuthenticatedRequest, res: Response, next: NextFunction) => {
    const auth = req.mcpAuth;
    if (!auth) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const server = buildMcpServer({
      db: deps.db,
      masterKey: deps.masterKey,
      userId: auth.userId,
      scopes: auth.scopes,
      appVersion: deps.appVersion,
      sessionManager: deps.sessionManager,
      adapterCommandRunner: deps.adapterCommandRunner
    });
    // The SDK is compiled without exactOptionalPropertyTypes; its docs
    // prescribe `sessionIdGenerator: undefined` for stateless mode, hence the
    // option/transport assertions below.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    } as unknown as StreamableHTTPServerTransportOptions);
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport as unknown as Transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (!res.headersSent) {
        next(error);
      }
    }
  });

  // Stateless mode keeps no SSE streams and no session state; the MCP spec's
  // GET (server->client stream) and DELETE (session teardown) verbs do not apply.
  const methodNotAllowed = (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed in stateless MCP mode" },
      id: null
    });
  };
  router.get("/", methodNotAllowed);
  router.delete("/", methodNotAllowed);

  return router;
}

function createMcpAuthenticator(db: Database) {
  return (req: McpAuthenticatedRequest, res: Response, next: NextFunction): void => {
    const unauthorized = () => res.status(401).json({ error: "unauthorized" });
    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      unauthorized();
      return;
    }
    const repository = new McpTokenRepository(db);
    const record = repository.findActiveByToken(token);
    if (!record) {
      unauthorized();
      return;
    }
    const user = new UserRepository(db).findById(record.userId);
    if (!user || user.status !== "active") {
      unauthorized();
      return;
    }
    try {
      repository.touchLastUsed(record.id);
    } catch {
      // A failed last-used touch must not block the request.
    }
    req.mcpAuth = { userId: record.userId, scopes: parseMcpTokenScopes(record.scopes) };
    next();
  };
}
