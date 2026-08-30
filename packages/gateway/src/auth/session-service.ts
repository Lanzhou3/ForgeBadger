import type { Database } from "../db/types.js";
import { AuthSessionRepository, hashToken, type AuthSession } from "../db/repositories/auth-session-repository.js";

/** Idle window: refreshed on activity so working users never get bounced. */
export const SESSION_IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Hard cap from sign-in so a stolen token dies even under continuous use. */
export const SESSION_ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** DB write throttle: touching every request would hammer SQLite for nothing. */
const TOUCH_INTERVAL_MS = 60 * 1000;

export interface VerifiedSession {
  userId: string;
  sessionId: string;
  expiresAt: Date;
}

/** A token is a session token candidate only when it has JWT structure. */
export function looksLikeJwt(token: string): boolean {
  return token.split(".").length === 3;
}

export function createAuthSession(
  db: Database,
  input: { userId: string; userAgent?: string | null }
): { session: AuthSession; token: string } {
  const repository = new AuthSessionRepository(db);
  const now = Date.now();
  return repository.create({
    userId: input.userId,
    expiresAt: new Date(now + SESSION_IDLE_TTL_MS),
    absoluteExpiresAt: new Date(now + SESSION_ABSOLUTE_TTL_MS),
    userAgent: input.userAgent ?? null
  });
}

/**
 * Validates an opaque session token: looks up the SHA-256, enforces both the
 * sliding and absolute expiries, and (throttled) slides the idle window
 * forward. Returns undefined for unknown/expired/revoked tokens.
 */
export function verifyAuthSession(db: Database, token: string): VerifiedSession | undefined {
  const repository = new AuthSessionRepository(db);
  const session = repository.findByToken(token);
  if (!session) return undefined;

  const now = Date.now();
  const idleDeadline = session.expiresAt.getTime();
  const absoluteDeadline = session.absoluteExpiresAt.getTime();
  if (idleDeadline <= now || absoluteDeadline <= now) {
    repository.deleteExpired(new Date(now));
    return undefined;
  }

  if (now - session.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
    const nextIdle = Math.min(now + SESSION_IDLE_TTL_MS, absoluteDeadline);
    repository.touch(session.id, new Date(nextIdle));
  }

  return { userId: session.userId, sessionId: session.id, expiresAt: session.expiresAt };
}

export function findSessionByToken(db: Database, token: string): AuthSession | undefined {
  return new AuthSessionRepository(db).findByToken(token);
}

export function revokeSessionByToken(db: Database, token: string): boolean {
  return new AuthSessionRepository(db).deleteByToken(token);
}

export { hashToken };
