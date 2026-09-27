import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { mcpAccessTokens } from "../schema.js";
import type { Database } from "../types.js";
import { hashToken } from "./auth-session-repository.js";

export type McpTokenScope = "read" | "operate" | "cli_dispatch";

export interface McpAccessToken {
  id: string;
  userId: string;
  name: string;
  tokenHash: string;
  scopes: string;
  allowedRoot: string | null;
  allowedProjects: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export interface McpAllowedProject { id: string; root: string }

/** NULL alone denotes a legacy token; malformed restrictions must fail closed. */
export function parseMcpAllowedProjects(raw: string | null): McpAllowedProject[] | null {
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.length === 0 || value.length > 200 || value.some(
    row => !row || typeof row !== "object" || typeof row.id !== "string" || !row.id || typeof row.root !== "string" || !row.root
  )) throw new Error("Invalid MCP project authorization");
  return value as McpAllowedProject[];
}

export const MCP_TOKEN_PREFIX = "fbmcp_";

export function generateMcpToken(): string {
  return `${MCP_TOKEN_PREFIX}${randomBytes(24).toString("hex")}`;
}

export function parseMcpTokenScopes(raw: string): McpTokenScope[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return ["read"];
    return parsed.filter((scope): scope is McpTokenScope => scope === "read" || scope === "operate" || scope === "cli_dispatch");
  } catch {
    return ["read"];
  }
}

/**
 * Like the auth-session repository, the hash lookup is intentionally NOT
 * scoped to a user id: the token hash identifies the user for every MCP
 * request. Listing/revocation stays per-user at the call site.
 */
export class McpTokenRepository {
  private readonly drizzle;

  constructor(private readonly db: Database) {
    this.drizzle = drizzle(db);
  }

  create(input: { userId: string; name: string; scopes: McpTokenScope[]; allowedRoot?: string; allowedProjects?: McpAllowedProject[]; expiresAt?: Date }): { record: McpAccessToken; token: string } {
    const token = generateMcpToken();
    const result = this.drizzle
      .insert(mcpAccessTokens)
      .values({
        userId: input.userId,
        name: input.name,
        tokenHash: hashToken(token),
        scopes: JSON.stringify(input.scopes),
        allowedRoot: input.allowedRoot ?? null,
        allowedProjects: input.allowedProjects ? JSON.stringify(input.allowedProjects) : null,
        expiresAt: input.expiresAt ?? null
      })
      .returning()
      .get();
    return { record: result as McpAccessToken, token };
  }

  listByUser(userId: string): McpAccessToken[] {
    return this.drizzle
      .select()
      .from(mcpAccessTokens)
      .where(eq(mcpAccessTokens.userId, userId))
      .orderBy(desc(mcpAccessTokens.createdAt))
      .all() as McpAccessToken[];
  }

  findActiveByToken(token: string): McpAccessToken | undefined {
    if (!token.startsWith(MCP_TOKEN_PREFIX)) return undefined;
    return this.drizzle
      .select()
      .from(mcpAccessTokens)
      .where(and(eq(mcpAccessTokens.tokenHash, hashToken(token)), isNull(mcpAccessTokens.revokedAt), or(isNull(mcpAccessTokens.expiresAt), gt(mcpAccessTokens.expiresAt, new Date()))))
      .get() as McpAccessToken | undefined;
  }

  findActiveById(id: string, userId: string): McpAccessToken | undefined {
    return this.drizzle.select().from(mcpAccessTokens).where(and(
      eq(mcpAccessTokens.id, id), eq(mcpAccessTokens.userId, userId),
      isNull(mcpAccessTokens.revokedAt),
      or(isNull(mcpAccessTokens.expiresAt), gt(mcpAccessTokens.expiresAt, new Date()))
    )).get() as McpAccessToken | undefined;
  }

  revokeByIdAndUser(id: string, userId: string): boolean {
    return this.drizzle
      .update(mcpAccessTokens)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(mcpAccessTokens.id, id),
        eq(mcpAccessTokens.userId, userId),
        isNull(mcpAccessTokens.revokedAt)
      ))
      .run().changes > 0;
  }

  touchLastUsed(id: string): void {
    this.drizzle
      .update(mcpAccessTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(mcpAccessTokens.id, id))
      .run();
  }
}
