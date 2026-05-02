import { Router } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";

import { signJwt } from "../auth/jwt.js";
import { authenticate } from "../auth/middleware.js";
import type { AuthenticatedRequest } from "../auth/middleware.js";
import type { User, UserRepository } from "../db/repositories/user-repository.js";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export function createAuthRouter(userRepository: UserRepository, jwtSecret: string): Router {
  const router = Router();

  router.post("/register", async (req, res) => {
    const parseResult = registerSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    const { email, password } = parseResult.data;

    try {
      const existing = userRepository.findByEmail(email);
      if (existing) {
        res.status(409).json({ code: 1, message: "Email already registered" });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const role = userRepository.count() === 0 ? "admin" : "user";
      const user = userRepository.create(email, passwordHash, { role });
      const token = signJwt({ userId: user.id, email: user.email }, jwtSecret);

      res.status(201).json({
        code: 0,
        data: { token, user: toPublicUser(user) },
        message: ""
      });
    } catch (error) {
      res.status(500).json({
        code: 1,
        message: error instanceof Error ? error.message : "Registration failed"
      });
    }
  });

  router.post("/login", async (req, res) => {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    const { email, password } = parseResult.data;
    const user = userRepository.findByEmail(email);

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      res.status(401).json({ code: 1, message: "Invalid credentials" });
      return;
    }
    if (user.status !== "active") {
      res.status(403).json({ code: 1, message: "User disabled" });
      return;
    }

    const token = signJwt({ userId: user.id, email: user.email }, jwtSecret);

    res.status(200).json({
      code: 0,
      data: { token, user: toPublicUser(user) },
      message: ""
    });
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

  router.post("/logout", (_req, res) => {
    res.status(200).json({ code: 0, data: {}, message: "" });
  });

  return router;
}

function toPublicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status
  };
}
