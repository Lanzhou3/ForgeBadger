import type { NextFunction, Request, Response } from "express";

import { verifyJwt } from "./jwt.js";
import { loadEnv } from "../config/env.js";

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
  try {
    const payload = verifyJwt(token, resolveJwtSecret(req));
    (req as AuthenticatedRequest).userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ code: 1, message: "Unauthorized" });
  }
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
