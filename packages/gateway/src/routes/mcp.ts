/**
 * External MCP (Model Context Protocol) endpoint.
 *
 * Streamable HTTP transport in stateless mode: every POST spins up a fresh
 * McpServer + transport pair, so no session state survives a Gateway restart
 * and no SSE streams are held open. Authentication is a long-lived access
 * token (`fbmcp_…`, see routes/mcp-tokens.ts) presented as a Bearer
 * credential; only the SHA-256 hash is stored, revocation is immediate, CLI
 * dispatch tokens expire on schedule, and
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
  mcpAuth?: { userId: string; tokenId: string; scopes: McpTokenScope[] };
}

/**
 * Streamable HTTP security warning (MCP spec): servers MUST validate the
 * `Origin` header on all incoming connections to prevent DNS rebinding
 * attacks, and answer 403 when it is present and invalid. Non-browser MCP
 * clients (Claude Code, Copilot CLI, curl) send no Origin header at all;
 * only pages served from a loopback host carry an acceptable Origin, so the
 * allowlist is loopback hostnames on http/https. A rebinding attacker's page
 * always presents its own (non-loopback) origin and is rejected.
 */
const MCP_LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function isAllowedMcpOrigin(origin: string | string[] | undefined): boolean {
  if (origin === undefined) return true;
  if (typeof origin !== "string") return false;
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") && MCP_LOOPBACK_HOSTNAMES.has(url.hostname);
  } catch {
    return false;
  }
}

function mcpJsonRpcError(res: Response, status: number, code: number, message: string): void {
  res.status(status).json({
    jsonrpc: "2.0",
    id: null,
    error: { code, message }
  });
}

export function createMcpRoutes(deps: Pick<ServerDeps, "db" | "masterKey" | "sessionManager" | "appVersion" | "adapterCommandRunner">): Router {
  const router = Router();
  // Origin validation runs before auth and before method dispatch (GET/405
  // included): the spec mandates it for every incoming connection.
  router.use((req: Request, res: Response, next: NextFunction) => {
    if (!isAllowedMcpOrigin(req.headers.origin)) {
      mcpJsonRpcError(res, 403, -32000, "Origin not allowed");
      return;
    }
    next();
  });
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

  const unauthorized = (res: Response): void => {
    // RFC 6750 challenge so standard MCP clients can identify the scheme;
    // the body keeps the JSON-RPC envelope used by every other error here.
    res.setHeader("WWW-Authenticate", 'Bearer realm="forgebadger-mcp"');
    mcpJsonRpcError(res, 401, -32000, "Unauthorized");
  };

  router.post("/", authenticateMcp, rateLimiter, async (req: McpAuthenticatedRequest, res: Response) => {
    const auth = req.mcpAuth;
    if (!auth) {
      unauthorized(res);
      return;
    }
    const server = buildMcpServer({
      db: deps.db,
      masterKey: deps.masterKey,
      userId: auth.userId,
      tokenId: auth.tokenId,
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
    } catch {
      // MCP clients expect a JSON-RPC error envelope, not the project's REST
      // envelope — never delegate to the shared errorHandler from here.
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal error" },
          id: null
        });
        return;
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
    const unauthorized = (): void => {
      res.setHeader("WWW-Authenticate", 'Bearer realm="forgebadger-mcp"');
      mcpJsonRpcError(res, 401, -32000, "Unauthorized");
    };
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
    req.mcpAuth = { userId: record.userId, tokenId: record.id, scopes: parseMcpTokenScopes(record.scopes) };
    next();
  };
}
