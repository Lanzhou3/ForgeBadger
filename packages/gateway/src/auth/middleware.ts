import type { NextFunction, Request, Response } from "express";

import { verifyJwt } from "./jwt.js";
import { loadEnv } from "../config/env.js";
import type { Database } from "../db/types.js";
import { UserRepository } from "../db/repositories/user-repository.js";

export interface AuthenticatedRequest extends Request {
  userId: string;
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ code: 1, message: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);
  let payload: { userId: string };
  try {
    payload = verifyJwt(token, resolveJwtSecret(req));
  } catch {
    res.status(401).json({ code: 1, message: "Unauthorized" });
    return;
  }

  // Revoke access for users that no longer exist or have been disabled so a
  // JWT issued before a status change does not survive the disable.
  const db = req.app?.locals?.db as Database | undefined;
  if (db) {
    const user = new UserRepository(db).findById(payload.userId);
    if (!user || user.status !== "active") {
      res.status(401).json({ code: 1, message: "Unauthorized" });
      return;
    }
  }

  (req as AuthenticatedRequest).userId = payload.userId;
  next();
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
