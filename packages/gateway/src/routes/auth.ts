import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { signJwt } from "../auth/jwt.js";
import { authenticate, SESSION_COOKIE_NAME, type AuthenticatedRequest } from "../auth/middleware.js";
import {
  createAuthSession,
  revokeSessionByToken,
  SESSION_ABSOLUTE_TTL_MS
} from "../auth/session-service.js";
import { AuthSessionRepository } from "../db/repositories/auth-session-repository.js";
import { AuthInviteRepository } from "../db/repositories/auth-invite-repository.js";
import type { User, UserRepository } from "../db/repositories/user-repository.js";
import type { Database } from "../db/types.js";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { redactSensitiveErrorMessage } from "../lib/redaction.js";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  inviteCode: z.string().trim().min(6).max(64).optional()
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8)
});

const invalidCredentialsResponse = { code: 1, message: "Invalid credentials" };

export type RegistrationMode = "open" | "off" | "invite";

export interface AuthRouterOptions {
  db?: Database;
  registrationMode?: RegistrationMode;
}

export function createAuthRouter(
  userRepository: UserRepository,
  jwtSecret: string,
  options: AuthRouterOptions = {}
): Router {
  const router = Router();
  const db = options.db;
  const registrationMode: RegistrationMode = options.registrationMode ?? "open";

  // Rate-limit credential-bearing endpoints by remote address: brute force
  // and credential-stuffing protection for login/register, and unbounded
  // account-creation for register. Generous enough for test suites and CI.
  const authLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 60 });

  router.post("/register", authLimiter, async (req, res) => {
    const parseResult = registerSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    const { email, password, inviteCode } = parseResult.data;

    try {
      const isFirstUser = userRepository.count() === 0;
      // The first user bootstraps the instance (and becomes admin) even when
      // registration is otherwise closed - otherwise a fresh install with
      // OPENFORGE_REGISTRATION=off|invite would be permanently locked out.
      if (!isFirstUser && registrationMode === "off") {
        res.status(403).json({ code: 1, message: "Registration is disabled" });
        return;
      }
      const invite = !isFirstUser && registrationMode === "invite" && db
        ? requireValidInvite(db, inviteCode)
        : undefined;

      const existing = userRepository.findByEmail(email);
      if (existing) {
        res.status(409).json({ code: 1, message: "Email already registered" });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const role = isFirstUser ? "admin" : "user";
      const user = userRepository.create(email, passwordHash, { role });
      if (invite && db) {
        new AuthInviteRepository(db).redeem(invite.id, user.id);
      }

      await respondWithCredentials(res, user, jwtSecret, options, req, 201);
    } catch (error) {
      res.status(error instanceof RegistrationGateError ? 403 : 500).json({
        code: 1,
        message: error instanceof Error ? redactSensitiveErrorMessage(error.message) : "Registration failed"
      });
    }
  });

  router.post("/login", authLimiter, async (req, res) => {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    const { email, password } = parseResult.data;
    const user = userRepository.findByEmail(email);

    if (!user) {
      res.status(401).json(invalidCredentialsResponse);
      return;
    }

    if (!(await bcrypt.compare(password, user.passwordHash))) {
      res.status(401).json(invalidCredentialsResponse);
      return;
    }
    if (user.status !== "active") {
      res.status(403).json({ code: 1, message: "User disabled" });
      return;
    }

    await respondWithCredentials(res, user, jwtSecret, options, req, 200);
  });

  router.get("/me", authenticate, (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const user = userRepository.findById(userId);
    if (!user) {
      res.status(404).json({ code: 1, message: "User not found" });
      return;
    }
    if (user.status !== "active") {
      res.status(403).json({ code: 1, message: "User disabled" });
      return;
    }
    res.status(200).json({
      code: 0,
      data: toPublicUser(user),
      message: ""
    });
  });

  router.post("/logout", authenticate, (req, res) => {
    const token = (req as unknown as AuthenticatedRequest).authToken;
    if (db && token) {
      revokeSessionByToken(db, token);
    }
    clearSessionCookie(res);
    res.status(200).json({ code: 0, data: {}, message: "" });
  });

  router.post("/change-password", authLimiter, authenticate, async (req, res) => {
    const parseResult = changePasswordSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }
    if (!db) {
      res.status(500).json({ code: 1, message: "Auth storage unavailable" });
      return;
    }

    const userId = (req as unknown as AuthenticatedRequest).userId;
    const user = userRepository.findById(userId);
    if (!user) {
      res.status(401).json(invalidCredentialsResponse);
      return;
    }
    if (!(await bcrypt.compare(parseResult.data.currentPassword, user.passwordHash))) {
      res.status(401).json({ code: 1, message: "Current password is incorrect" });
      return;
    }

    const passwordHash = await bcrypt.hash(parseResult.data.newPassword, 10);
    userRepository.updatePassword(userId, passwordHash);
    // A password change invalidates every signed-in device.
    new AuthSessionRepository(db).deleteAllByUser(userId);
    clearSessionCookie(res);
    res.status(200).json({ code: 0, data: { revokedSessions: true }, message: "" });
  });

  router.get("/sessions", authenticate, (req, res) => {
    if (!db) {
      res.status(500).json({ code: 1, message: "Auth storage unavailable" });
      return;
    }
    const authReq = req as unknown as AuthenticatedRequest;
    const sessions = new AuthSessionRepository(db).listByUser(authReq.userId);
    res.status(200).json({
      code: 0,
      data: {
        sessions: sessions.map((session) => ({
          id: session.id,
          createdAt: session.createdAt,
          lastSeenAt: session.lastSeenAt,
          expiresAt: session.expiresAt,
          userAgent: session.userAgent,
          current: session.id === authReq.sessionId
        }))
      },
      message: ""
    });
  });

  router.delete("/sessions/:id", authenticate, (req, res) => {
    if (!db) {
      res.status(500).json({ code: 1, message: "Auth storage unavailable" });
      return;
    }
    const authReq = req as unknown as AuthenticatedRequest;
    const revoked = new AuthSessionRepository(db).deleteByIdAndUser(
      req.params.id ?? "",
      authReq.userId
    );
    if (!revoked) {
      res.status(404).json({ code: 1, message: "Session not found" });
      return;
    }
    if (req.params.id === authReq.sessionId) {
      clearSessionCookie(res);
    }
    res.status(200).json({ code: 0, data: { revoked: 1 }, message: "" });
  });

  router.delete("/sessions", authenticate, (req, res) => {
    if (!db) {
      res.status(500).json({ code: 1, message: "Auth storage unavailable" });
      return;
    }
    const authReq = req as unknown as AuthenticatedRequest;
    const repository = new AuthSessionRepository(db);
    const revoked = authReq.sessionId
      ? repository.deleteAllByUserExcept(authReq.userId, authReq.sessionId)
      : repository.deleteAllByUser(authReq.userId);
    res.status(200).json({ code: 0, data: { revoked }, message: "" });
  });

  return router;
}

class RegistrationGateError extends Error {}

function requireValidInvite(db: Database, inviteCode: string | undefined): { id: string } {
  if (!inviteCode) {
    throw new RegistrationGateError("An invite code is required to register");
  }
  const invite = new AuthInviteRepository(db).findByCode(inviteCode);
  if (!invite || invite.usedAt !== null || invite.expiresAt.getTime() <= Date.now()) {
    throw new RegistrationGateError("Invalid or expired invite code");
  }
  return { id: invite.id };
}

/**
 * Issues sign-in credentials: an opaque auth session (plus httpOnly cookie)
 * when session storage is available, or a legacy JWT otherwise (test
 * harnesses without a mounted DB).
 */
async function respondWithCredentials(
  res: Response,
  user: User,
  jwtSecret: string,
  options: AuthRouterOptions,
  req: Request,
  status: number
): Promise<void> {
  let token: string;
  if (options.db) {
    const userAgentHeader = req.headers["user-agent"];
    const userAgent = typeof userAgentHeader === "string" ? userAgentHeader : null;
    const { token: sessionToken } = createAuthSession(options.db, {
      userId: user.id,
      userAgent
    });
    token = sessionToken;
    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      maxAge: SESSION_ABSOLUTE_TTL_MS
    });
  } else {
    token = signJwt({ userId: user.id, email: user.email }, jwtSecret);
  }
  res.status(status).json({
    code: 0,
    data: { token, user: toPublicUser(user) },
    message: ""
  });
}

function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, { httpOnly: true, sameSite: "strict", path: "/" });
}

function toPublicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status
  };
}
