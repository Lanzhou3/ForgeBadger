import { randomBytes, randomUUID } from "node:crypto";

import type { Database } from "../types.js";
import { hashToken } from "./auth-session-repository.js";

export const HUB_NODE_TOKEN_PREFIX = "fbnode_";

export interface HubNodeToken {
  id: string;
  userId: string;
  projectId: string;
  name: string;
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

const COLUMNS = `id,user_id AS userId,project_id AS projectId,name,created_at AS createdAt,
  expires_at AS expiresAt,last_used_at AS lastUsedAt,revoked_at AS revokedAt`;

/**
 * Node credentials for the team hub. Like MCP tokens, the hash lookup is not
 * user-scoped because the hash identifies the holder; listing and revocation
 * are always scoped to the holder. A token grants no authority by itself:
 * callers must re-check project capabilities for `userId` on every request.
 */
export class HubNodeTokenRepository {
  constructor(private readonly db: Database) {}

  create(input: { userId: string; projectId: string; name: string; expiresAt: number }): { record: HubNodeToken; token: string } {
    const token = `${HUB_NODE_TOKEN_PREFIX}${randomBytes(32).toString("hex")}`;
    const id = randomUUID();
    this.db.prepare(
      "INSERT INTO hub_node_tokens(id,user_id,project_id,name,token_hash,created_at,expires_at) VALUES(?,?,?,?,?,?,?)"
    ).run(id, input.userId, input.projectId, input.name, hashToken(token), Date.now(), input.expiresAt);
    return { record: this.getOwned(input.userId, id)!, token };
  }

  listForUser(userId: string): HubNodeToken[] {
    return this.db.prepare(
      `SELECT ${COLUMNS} FROM hub_node_tokens WHERE user_id=? ORDER BY created_at DESC,id`
    ).all(userId) as HubNodeToken[];
  }

  /** Idempotent: revoking an unknown or already revoked token reports false. */
  revoke(userId: string, id: string): boolean {
    const result = this.db.prepare(
      "UPDATE hub_node_tokens SET revoked_at=? WHERE user_id=? AND id=? AND revoked_at IS NULL"
    ).run(Date.now(), userId, id);
    return result.changes > 0;
  }

  findActiveByToken(token: string, now = Date.now()): HubNodeToken | undefined {
    if (!token.startsWith(HUB_NODE_TOKEN_PREFIX)) return undefined;
    return this.db.prepare(
      `SELECT ${COLUMNS} FROM hub_node_tokens WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?`
    ).get(hashToken(token), now) as HubNodeToken | undefined;
  }

  touch(id: string, now = Date.now()): void {
    this.db.prepare("UPDATE hub_node_tokens SET last_used_at=? WHERE id=?").run(now, id);
  }

  private getOwned(userId: string, id: string): HubNodeToken | undefined {
    return this.db.prepare(
      `SELECT ${COLUMNS} FROM hub_node_tokens WHERE user_id=? AND id=?`
    ).get(userId, id) as HubNodeToken | undefined;
  }
}
