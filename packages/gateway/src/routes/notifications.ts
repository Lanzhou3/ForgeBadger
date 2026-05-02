import { Router } from "express";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { NotificationRepository, type Notification } from "../db/repositories/notification-repository.js";
import type { Database } from "../db/types.js";

export function createNotificationRoutes(db: Database): Router {
  const router = Router();
  router.use(authenticate);

  router.get("/", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new NotificationRepository(db, userId);
    const notifications = repo.list().map(toNotificationPayload);
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
      data: { notification: toNotificationPayload(notification) },
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

function toNotificationPayload(notification: Notification) {
  return {
    id: notification.id,
    type: notification.type,
    titleKey: notification.titleKey,
    message: notification.message,
    href: notification.href,
    sessionId: notification.sessionId,
    payload: parsePayload(notification.payload),
    read: notification.isRead,
    createdAt: notification.createdAt.toISOString(),
    updatedAt: notification.updatedAt.toISOString()
  };
}

function parsePayload(payload: string | null): unknown {
  if (!payload) return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}
