import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { notifications } from "../schema.js";
import { sqliteTimestampSeconds } from "../sqlite-time.js";
import type { Database } from "../types.js";

export interface Notification {
  id: string;
  userId: string;
  type: string;
  titleKey: string;
  message: string;
  href: string;
  sessionId: string | null;
  payload: string | null;
  isRead: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateNotificationInput {
  type: string;
  titleKey: string;
  message: string;
  href: string;
  sessionId?: string | undefined;
  payload?: unknown;
}

export class NotificationRepository {
  private readonly drizzle;

  constructor(
    private readonly db: Database,
    private readonly userId: string
  ) {
    this.drizzle = drizzle(db);
  }

  create(input: CreateNotificationInput): Notification {
    const result = this.drizzle
      .insert(notifications)
      .values({
        userId: this.userId,
        type: input.type,
        titleKey: input.titleKey,
        message: input.message,
        href: input.href,
        sessionId: input.sessionId ?? null,
        payload: input.payload === undefined ? null : JSON.stringify(input.payload),
        isRead: false
      })
      .returning()
      .get();
    return result as Notification;
  }

  list(limit = 100): Notification[] {
    return this.drizzle
      .select()
      .from(notifications)
      .where(eq(notifications.userId, this.userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .all() as Notification[];
  }

  unreadCount(): number {
    // Count in SQL so the result is exact regardless of list truncation (the
    // previous `list(500).filter(...)` returned a wrong value once unread
    // notifications exceeded the 500-row cap).
    const result = this.db
      .prepare("SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0")
      .get(this.userId) as { count: number };
    return result.count;
  }

  markRead(id: string): Notification | undefined {
    return this.drizzle
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.id, id), eq(notifications.userId, this.userId)))
      .returning()
      .get() as Notification | undefined;
  }

  markAllRead(): number {
    const result = this.db
      .prepare("UPDATE notifications SET is_read = 1, updated_at = ? WHERE user_id = ? AND is_read = 0")
      .run(sqliteTimestampSeconds(), this.userId);
    return result.changes;
  }

  clearAll(): number {
    const result = this.db
      .prepare("DELETE FROM notifications WHERE user_id = ?")
      .run(this.userId);
    return result.changes;
  }
}
