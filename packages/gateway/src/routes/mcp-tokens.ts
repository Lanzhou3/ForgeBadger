import { Router } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import {
  McpTokenRepository,
  parseMcpTokenScopes,
  type McpAccessToken
} from "../db/repositories/mcp-token-repository.js";
import type { Database } from "../db/types.js";

const createTokenSchema = z.object({
  name: z.string().trim().min(1).max(64),
  scopes: z.array(z.enum(["read", "operate"])).min(1).max(2).default(["read"])
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
    const { record, token } = new McpTokenRepository(db).create({
      userId,
      name: parsed.data.name,
      scopes
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
    createdAt: record.createdAt.toISOString(),
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
    revoked: record.revokedAt !== null
  };
}
