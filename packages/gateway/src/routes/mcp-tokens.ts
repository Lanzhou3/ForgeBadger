import { Router } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import {
  McpTokenRepository,
  parseMcpAllowedProjects,
  parseMcpTokenScopes,
  type McpAccessToken
} from "../db/repositories/mcp-token-repository.js";
import type { Database } from "../db/types.js";
import { snapshotMcpProjects, validateMcpAllowedRoot } from "../services/mcp/token-authority.js";

const createTokenSchema = z.object({
  name: z.string().trim().min(1).max(64),
  scopes: z.array(z.enum(["read", "operate", "cli_dispatch"])).min(1).max(3).default(["read"]),
  allowedRoot: z.string().min(1).max(1024).optional(),
  projectIds: z.array(z.string().min(1).max(128)).min(1).max(200).optional(),
  expiresInHours: z.number().int().min(1).max(87600).nullable().optional()
}).strict();

export function createMcpTokenRoutes(db: Database): Router {
  const router = Router();
  router.use(authenticate);

  router.post("/", (req, res) => {
    const parsed = createTokenSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ code: 1, message: "Invalid MCP token payload" });
      return;
    }
    const userId = (req as AuthenticatedRequest).userId;
    const scopes = [...new Set(parsed.data.scopes)];
    const cliDispatch = scopes.includes("cli_dispatch");
    const { projectIds, expiresInHours } = parsed.data;
    if (cliDispatch && !scopes.includes("operate")) {
      res.status(400).json({ code: 1, message: "CLI dispatch requires operate scope" });
      return;
    }
    // New project selections and legacy directory restrictions cannot be mixed.
    if (projectIds && (parsed.data.allowedRoot !== undefined || expiresInHours === undefined)) {
      res.status(400).json({ code: 1, message: "Select projects and an explicit lifetime; do not include allowedRoot" });
      return;
    }
    if (!projectIds && ((cliDispatch && (!parsed.data.allowedRoot || !expiresInHours || expiresInHours > 168)) ||
      (!cliDispatch && (parsed.data.allowedRoot !== undefined || expiresInHours !== undefined)))) {
      res.status(400).json({ code: 1, message: "Legacy CLI tokens require an allowed root and 1–168 hour expiry" });
      return;
    }
    let restrictions: { allowedRoot?: string; allowedProjects?: import("../db/repositories/mcp-token-repository.js").McpAllowedProject[] };
    try {
      restrictions = projectIds ? { allowedProjects: snapshotMcpProjects(db, userId, projectIds) }
        : cliDispatch ? { allowedRoot: validateMcpAllowedRoot(parsed.data.allowedRoot!) } : {};
    } catch (error) {
      res.status(400).json({ code: 1, message: error instanceof Error ? error.message : "Invalid project authorization" });
      return;
    }
    const { record, token } = new McpTokenRepository(db).create({
      userId, name: parsed.data.name, scopes, ...restrictions,
      ...(typeof expiresInHours === "number" ? { expiresAt: new Date(Date.now() + expiresInHours * 3_600_000) } : {})
    });
    // The plaintext token is returned exactly once; only its hash is stored.
    res.status(201).json({
      code: 0,
      data: { token: toTokenPayload(record, scopes), plaintext: token },
      message: ""
    });
  });

  router.get("/", (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const tokens = new McpTokenRepository(db)
      .listByUser(userId)
      .map((record) => toTokenPayload(record));
    res.json({ code: 0, data: { tokens }, message: "" });
  });

  router.delete("/:id", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const revoked = new McpTokenRepository(db).revokeByIdAndUser(req.params.id, userId);
    if (!revoked) {
      res.status(404).json({ code: 1, message: "MCP token not found" });
      return;
    }
    res.json({ code: 0, data: { revoked: true }, message: "" });
  });

  return router;
}

function toTokenPayload(record: McpAccessToken, scopes?: string[]) {
  return {
    id: record.id,
    name: record.name,
    scopes: scopes ?? parseMcpTokenScopes(record.scopes),
    allowedRoot: record.allowedRoot,
    projectIds: parseMcpAllowedProjects(record.allowedProjects)?.map(project => project.id) ?? null,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
    revoked: record.revokedAt !== null
  };
}
