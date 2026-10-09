import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { notifications, sessions } from "../schema.js";
import { sqliteTimestampSeconds } from "../sqlite-time.js";
import type { Database } from "../types.js";

export interface Notification {
  id: string;
  userId: string;
  type: string;
  category: string;
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
  category?: string | undefined;
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
        ...(input.category !== undefined ? { category: input.category } : {}),
        sessionId: input.sessionId ?? null,
        payload: input.payload === undefined ? null : JSON.stringify(input.payload),
        isRead: false
      })
      .returning()
      .get();
    return result as Notification;
  }

  list(limit = 100, category?: string): Notification[] {
    const filters = [eq(notifications.userId, this.userId)];
    if (category) filters.push(eq(notifications.category, category));
    return this.drizzle
      .select()
      .from(notifications)
      .where(and(...filters))
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .all() as Notification[];
  }

  get(id: string): Notification | undefined {
    return this.drizzle.select().from(notifications)
      .where(and(eq(notifications.userId, this.userId), eq(notifications.id, id))).get() as Notification | undefined;
  }

  /** Filter before limiting. Payload IDs are display data, never authorization. */
  recentSessionEvents(projectIds: string[], since: Date): Notification[] {
    if (!projectIds.length) return [];
    return this.drizzle.select({ notification: notifications }).from(notifications)
      .innerJoin(sessions, and(eq(sessions.id, notifications.sessionId), eq(sessions.userId, notifications.userId)))
      .where(and(eq(notifications.userId, this.userId), eq(notifications.type, 'session_notification'),
        inArray(sessions.projectId, projectIds), gte(notifications.createdAt, since),
        sql`json_extract(CASE WHEN json_valid(${notifications.payload}) THEN ${notifications.payload} ELSE '{}' END,'$.project_id') = ${sessions.projectId}`,
        sql`${notifications}.rowid IN (SELECT MAX(n.rowid) FROM notifications n WHERE n.user_id=${this.userId} AND n.type='session_notification' GROUP BY n.session_id)`))
      .orderBy(desc(notifications.createdAt), sql`${notifications}.rowid DESC`).limit(8).all()
      .map(row => row.notification as Notification);
  }

  conversationProjectIds(conversationId: string): string[] {
    const rows = this.db.prepare(`SELECT DISTINCT json_extract(CASE WHEN json_valid(s.input_json) THEN s.input_json ELSE '{}' END,'$.projectId') AS projectId
      FROM copilot_run_steps s JOIN copilot_runs r ON r.id=s.run_id AND r.user_id=s.user_id
      WHERE s.user_id=? AND r.conversation_id=? AND s.kind='tool'
      AND json_type(CASE WHEN json_valid(s.input_json) THEN s.input_json ELSE '{}' END,'$.projectId')='text' LIMIT 20`)
      .all(this.userId, conversationId) as { projectId: string }[];
    return rows.map(row => row.projectId);
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
