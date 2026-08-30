import { verifyJwt } from "./jwt.js";
import { verifyAuthSession } from "./session-service.js";
import type { Database } from "../db/types.js";
import { UserRepository } from "../db/repositories/user-repository.js";

/**
 * Resolves a presented credential (opaque auth-session token or legacy JWT)
 * to an active user id. Shared by the WebSocket upgrade paths so terminal and
 * events sockets accept the same credentials as the HTTP API.
 */
export function resolveTokenUserId(
  db: Database,
  token: string,
  jwtSecret: string
): string | undefined {
  const session = verifyAuthSession(db, token);
  if (session) {
    return userIsActive(db, session.userId) ? session.userId : undefined;
  }
  try {
    const claims = verifyJwt(token, jwtSecret);
    return userIsActive(db, claims.userId) ? claims.userId : undefined;
  } catch {
    return undefined;
  }
}

function userIsActive(db: Database, userId: string): boolean {
  const user = new UserRepository(db).findById(userId);
  return user !== undefined && user.status === "active";
}
