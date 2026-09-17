import { Router } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { NotificationRepository, type Notification } from "../db/repositories/notification-repository.js";
import { SessionRepository, type Session } from "../db/repositories/session-repository.js";
import type { Database } from "../db/types.js";

const listQuerySchema = z.object({
  category: z.enum(["session_event", "app_action"]).optional()
}).strict();

export function createNotificationRoutes(db: Database): Router {
  const router = Router();
  router.use(authenticate);

  router.get("/", (req, res) => {
    const query = listQuerySchema.safeParse(req.query ?? {});
    if (!query.success) {
      res.status(400).json({ code: 1, message: "Invalid notification category filter" });
      return;
    }
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new NotificationRepository(db, userId);
    const sessionsById = new Map(
      new SessionRepository(db, userId).list().map((session) => [session.id, session])
    );
    const notifications = repo.list(100, query.data.category).map((notification) =>
      toNotificationPayload(notification, notification.sessionId ? sessionsById.get(notification.sessionId) : undefined)
    );
    res.json({
      code: 0,
      data: {
        notifications,
        unreadCount: repo.unreadCount()
      },
      message: ""
    });
  });

  router.post("/:id/read", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const notification = new NotificationRepository(db, userId).markRead(req.params.id);
    if (!notification) {
      res.status(404).json({ code: 1, message: "Notification not found" });
      return;
    }
    res.json({
      code: 0,
      data: {
        notification: toNotificationPayload(
          notification,
          notification.sessionId
            ? new SessionRepository(db, userId).getById(notification.sessionId)
            : undefined
        )
      },
      message: ""
    });
  });

  router.post("/read-all", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const updated = new NotificationRepository(db, userId).markAllRead();
    res.json({
      code: 0,
      data: { updated },
      message: ""
    });
  });

  router.delete("/", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const deleted = new NotificationRepository(db, userId).clearAll();
    res.json({
      code: 0,
      data: { deleted },
      message: ""
    });
  });

  return router;
}

function toNotificationPayload(notification: Notification, session?: Session) {
  const payload = parsePayload(notification.payload);
  return {
    id: notification.id,
    type: notification.type,
    category: notification.category,
    titleKey: notification.titleKey,
    message: notification.message,
    href: notification.href,
    sessionId: notification.sessionId,
    payload,
    projectId: getPayloadString(payload, "project_id") ?? session?.projectId,
    projectName: getPayloadString(payload, "project_name") ?? session?.projectName ?? undefined,
    sessionName: getPayloadString(payload, "session_name") ?? session?.name,
    adapter: getPayloadString(payload, "adapter") ?? session?.aiTool,
    notificationType: getPayloadString(payload, "notification_type"),
    read: notification.isRead,
    createdAt: notification.createdAt.toISOString(),
    updatedAt: notification.updatedAt.toISOString()
  };
}

function parsePayload(payload: string | null): Record<string, unknown> | null {
  if (!payload) return null;
  try {
    const parsed: unknown = JSON.parse(payload);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getPayloadString(payload: Record<string, unknown> | null, key: string): string | undefined {
  const value = payload?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
