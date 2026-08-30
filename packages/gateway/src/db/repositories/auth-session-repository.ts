import { and, desc, eq, lt, ne } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { authSessions } from "../schema.js";
import type { Database } from "../types.js";

export interface AuthSession {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  userAgent: string | null;
}

/**
 * Unlike the business repositories, the auth-session lookup is NOT scoped to a
 * user id up front: the token hash identifies the session (and therefore the
 * user) for every request. Listing/revocation is always additionally filtered
 * by user id at the call site.
 */
export class AuthSessionRepository {
  private readonly drizzle;

  constructor(private readonly db: Database) {
    this.drizzle = drizzle(db);
  }

  create(input: {
    userId: string;
    expiresAt: Date;
    absoluteExpiresAt: Date;
    userAgent?: string | null;
  }): { session: AuthSession; token: string } {
    const token = randomBytes(32).toString("base64url");
    const result = this.drizzle
      .insert(authSessions)
      .values({
        userId: input.userId,
        tokenHash: hashToken(token),
        expiresAt: input.expiresAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
        userAgent: input.userAgent?.slice(0, 512) ?? null
      })
      .returning()
      .get();
    return { session: result as AuthSession, token };
  }

  findByToken(token: string): AuthSession | undefined {
    return this.drizzle
      .select()
      .from(authSessions)
      .where(eq(authSessions.tokenHash, hashToken(token)))
      .get() as AuthSession | undefined;
  }

  findByIdAndUser(id: string, userId: string): AuthSession | undefined {
    return this.drizzle
      .select()
      .from(authSessions)
      .where(and(eq(authSessions.id, id), eq(authSessions.userId, userId)))
      .get() as AuthSession | undefined;
  }

  listByUser(userId: string): AuthSession[] {
    return this.drizzle
      .select()
      .from(authSessions)
      .where(eq(authSessions.userId, userId))
      .orderBy(desc(authSessions.lastSeenAt))
      .all() as AuthSession[];
  }

  touch(id: string, expiresAt: Date): void {
    const now = new Date();
    this.drizzle
      .update(authSessions)
      .set({ lastSeenAt: now, expiresAt })
      .where(eq(authSessions.id, id))
      .run();
  }

  deleteByIdAndUser(id: string, userId: string): boolean {
    return this.drizzle
      .delete(authSessions)
      .where(and(eq(authSessions.id, id), eq(authSessions.userId, userId)))
      .run().changes > 0;
  }

  deleteByToken(token: string): boolean {
    return this.drizzle
      .delete(authSessions)
      .where(eq(authSessions.tokenHash, hashToken(token)))
      .run().changes > 0;
  }

  deleteAllByUser(userId: string): number {
    return this.drizzle
      .delete(authSessions)
      .where(eq(authSessions.userId, userId))
      .run().changes;
  }

  deleteAllByUserExcept(userId: string, keepSessionId: string): number {
    return this.drizzle
      .delete(authSessions)
      .where(and(eq(authSessions.userId, userId), ne(authSessions.id, keepSessionId)))
      .run().changes;
  }

  deleteExpired(now: Date = new Date()): number {
    return this.drizzle
      .delete(authSessions)
      .where(lt(authSessions.expiresAt, now))
      .run().changes;
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
