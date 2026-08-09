import { Router } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { UserRepository, type User } from "../db/repositories/user-repository.js";
import type { Database } from "../db/types.js";

const updateUserSchema = z.object({
  role: z.enum(["admin", "user"]).optional(),
  status: z.enum(["active", "disabled"]).optional()
}).refine((value) => value.role !== undefined || value.status !== undefined, {
  message: "role or status is required"
});

export function createAdminUserRoutes(db: Database): Router {
  const router = Router();
  router.use(authenticate);
  router.use((req, res, next) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const currentUser = new UserRepository(db).findById(userId);
    if (!currentUser || currentUser.status !== "active" || currentUser.role !== "admin") {
      res.status(403).json({ code: 1, message: "Admin access required" });
      return;
    }
    next();
  });

  router.get("/", (_req, res) => {
    const users = new UserRepository(db).list().map(toAdminUserPayload);
    res.json({
      code: 0,
      data: { users },
      message: ""
    });
  });

  router.patch("/:id", (req, res) => {
    const parseResult = updateUserSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    const currentUserId = (req as unknown as AuthenticatedRequest).userId;
    if (req.params.id === currentUserId && wouldRemoveOwnAdminAccess(parseResult.data)) {
      res.status(409).json({ code: 1, message: "Cannot remove your own admin access" });
      return;
    }

    const repo = new UserRepository(db);
    const target = repo.findById(req.params.id);
    if (!target) {
      res.status(404).json({ code: 1, message: "User not found" });
      return;
    }

    // Preserve the last active admin invariant: never allow a change that would
    // demote or disable the only remaining active administrator.
    if (wouldRemoveAdminAccess(target, parseResult.data) && countActiveAdmins(repo) <= 1) {
      res.status(409).json({ code: 1, message: "Cannot remove the last active administrator" });
      return;
    }

    const user = repo.update(req.params.id, parseResult.data);
    if (!user) {
      res.status(404).json({ code: 1, message: "User not found" });
      return;
    }

    res.json({
      code: 0,
      data: { user: toAdminUserPayload(user) },
      message: ""
    });
  });

  return router;
}

function wouldRemoveOwnAdminAccess(input: z.infer<typeof updateUserSchema>): boolean {
  return input.role === "user" || input.status === "disabled";
}

function wouldRemoveAdminAccess(
  user: User,
  input: z.infer<typeof updateUserSchema>
): boolean {
  if (user.role !== "admin" || user.status !== "active") {
    return false;
  }
  return input.role === "user" || input.status === "disabled";
}

function countActiveAdmins(repo: UserRepository): number {
  return repo
    .list()
    .filter((user) => user.role === "admin" && user.status === "active").length;
}

function toAdminUserPayload(user: User) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString()
  };
}
