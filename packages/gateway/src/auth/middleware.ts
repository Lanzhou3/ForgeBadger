import type { NextFunction, Request, Response } from "express";

import { verifyJwt } from "./jwt.js";
import { verifyAuthSession } from "./session-service.js";
import { loadEnv } from "../config/env.js";
import type { Database } from "../db/types.js";
import { UserRepository } from "../db/repositories/user-repository.js";

export interface AuthenticatedRequest extends Request {
  userId: string;
  /** Present when the request authenticated via an auth session (not legacy JWT). */
  sessionId?: string;
  /** The raw credential as presented (session token or JWT). */
  authToken?: string;
}

export const SESSION_COOKIE_NAME = "openforge_session";

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const token = extractRequestToken(req);
  if (!token) {
    res.status(401).json({ code: 1, message: "Unauthorized" });
    return;
  }

  const db = req.app?.locals?.db as Database | undefined;

  // Opaque session token first: sha256 lookup is indexed and cheap. Legacy
  // JWTs (24h access tokens) stay valid for a transition window so already
  // signed-in consoles and CLIs migrate without a forced re-login.
  if (db) {
    const session = verifyAuthSession(db, token);
    if (session) {
      if (!userIsActive(db, session.userId)) {
        res.status(401).json({ code: 1, message: "Unauthorized" });
        return;
      }
      (req as AuthenticatedRequest).userId = session.userId;
      (req as AuthenticatedRequest).sessionId = session.sessionId;
      (req as AuthenticatedRequest).authToken = token;
      next();
      return;
    }
  }

  let payload: { userId: string };
  try {
    payload = verifyJwt(token, resolveJwtSecret(req));
  } catch {
    res.status(401).json({ code: 1, message: "Unauthorized" });
    return;
  }

  // Revoke access for users that no longer exist or have been disabled so a
  // JWT issued before a status change does not survive the disable. Skipped
  // only when no DB is mounted (unit-test harnesses); production always has one.
  if (db && !userIsActive(db, payload.userId)) {
    res.status(401).json({ code: 1, message: "Unauthorized" });
    return;
  }

  (req as AuthenticatedRequest).userId = payload.userId;
  (req as AuthenticatedRequest).authToken = token;
  next();
}

function userIsActive(db: Database, userId: string): boolean {
  const user = new UserRepository(db).findById(userId);
  return user !== undefined && user.status === "active";
}

export function extractRequestToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return bearer;
  }
  return extractCookieValue(req.headers.cookie, SESSION_COOKIE_NAME);
}

export function extractCookieValue(
  cookieHeader: string | undefined,
  name: string
): string | undefined {
  if (typeof cookieHeader !== "string" || cookieHeader.length === 0) return undefined;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      const value = part.slice(separator + 1).trim();
      return value.length > 0 ? decodeURIComponent(value) : undefined;
    }
  }
  return undefined;
}

export function requireAuth() {
  return authenticate;
}

export function extractBearerToken(authorization: string | string[] | undefined): string | undefined {
  if (typeof authorization !== "string") {
    return undefined;
  }
  const match = /^Bearer (?<token>.+)$/iu.exec(authorization);
  return match?.groups?.token;
}

function resolveJwtSecret(req: Request): string {
  const jwtSecret = req.app?.locals?.jwtSecret;
  if (typeof jwtSecret === "string" && jwtSecret.length > 0) {
    return jwtSecret;
  }

  return loadEnv().OPENFORGE_JWT_SECRET;
}
