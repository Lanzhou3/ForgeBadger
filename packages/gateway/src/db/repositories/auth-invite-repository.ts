import { and, desc, eq, isNull } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { authInvites } from "../schema.js";
import type { Database } from "../types.js";

export interface AuthInvite {
  id: string;
  code: string;
  createdByUserId: string | null;
  createdAt: Date;
  expiresAt: Date;
  usedByUserId: string | null;
  usedAt: Date | null;
}

export const DEFAULT_INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export class AuthInviteRepository {
  private readonly drizzle;

  constructor(private readonly db: Database) {
    this.drizzle = drizzle(db);
  }

  create(input: { createdByUserId: string; ttlMs?: number }): AuthInvite {
    const now = new Date();
    const result = this.drizzle
      .insert(authInvites)
      .values({
        code: generateInviteCode(),
        createdByUserId: input.createdByUserId,
        expiresAt: new Date(now.getTime() + (input.ttlMs ?? DEFAULT_INVITE_TTL_MS))
      })
      .returning()
      .get();
    return result as AuthInvite;
  }

  list(): AuthInvite[] {
    return this.drizzle
      .select()
      .from(authInvites)
      .orderBy(desc(authInvites.createdAt))
      .limit(200)
      .all() as AuthInvite[];
  }

  findByCode(code: string): AuthInvite | undefined {
    return this.drizzle
      .select()
      .from(authInvites)
      .where(eq(authInvites.code, code))
      .get() as AuthInvite | undefined;
  }

  /** Atomically marks an invite as used; returns false when already redeemed. */
  redeem(id: string, usedByUserId: string): boolean {
    return this.drizzle
      .update(authInvites)
      .set({ usedByUserId, usedAt: new Date() })
      .where(and(eq(authInvites.id, id), isNull(authInvites.usedAt)))
      .run().changes > 0;
  }

  deleteById(id: string): boolean {
    return this.drizzle.delete(authInvites).where(eq(authInvites.id, id)).run().changes > 0;
  }
}

function generateInviteCode(): string {
  // Readable 12-char code: 72 bits of entropy in a URL-safe alphabet.
  return randomBytes(9).toString("base64url").replace(/[-_]/g, "k").toUpperCase();
}
