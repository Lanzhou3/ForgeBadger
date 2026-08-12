import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NotificationRepository } from "../src/db/repositories/notification-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { OpenForgeEventBus } from "../src/services/event-bus.js";
import { attachNotificationPersistence } from "../src/services/notification-events.js";

function createTestDb(): Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  const drizzleDb = drizzle(db);
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/db/migrations"
  );
  migrate(drizzleDb, { migrationsFolder });
  return db;
}

describe("notification event persistence", () => {
  it("persists session events and annotates the emitted event with notification metadata", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("event-notify@example.com", "hash");
    const eventBus = new OpenForgeEventBus();
    attachNotificationPersistence({ db, eventBus });

    const event = {
      type: "session_created" as const,
      userId: user.id,
      sessionId: "session-1",
      projectId: "project-1",
      name: "Session 1"
    };
    eventBus.emitEvent(event);

    const notifications = new NotificationRepository(db, user.id).list();
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]!.type, "session_created");
    assert.equal(notifications[0]!.message, "Session 1");
    assert.equal(event.notificationId, notifications[0]!.id);
    assert.ok(event.notificationCreatedAt);
    db.close();
  });

  it("persists Claude permission notifications with permission title key", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("claude-notify@example.com", "hash");
    const eventBus = new OpenForgeEventBus();
    attachNotificationPersistence({ db, eventBus });

    eventBus.emitEvent({
      type: "claude_notification",
      userId: user.id,
      sessionId: "session-2",
      hookEventName: "Notification",
      notificationType: "permission_prompt",
      message: "Claude needs your permission to use Bash",
      toolName: "Bash"
    });

    const notification = new NotificationRepository(db, user.id).list()[0];
    assert.ok(notification);
    assert.equal(notification.titleKey, "notifications.claudePermissionRequest");
    assert.equal(notification.message, "Bash: Claude needs your permission to use Bash");
    db.close();
  });

  it("persists adapter lifecycle notifications with project and session context", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("lifecycle-notify@example.com", "hash");
    const eventBus = new OpenForgeEventBus();
    attachNotificationPersistence({ db, eventBus });

    eventBus.emitEvent({
      type: "claude_notification",
      userId: user.id,
      sessionId: "session-3",
      projectId: "project-3",
      projectName: "OpenForge",
      sessionName: "Repair notifications",
      hookEventName: "Interrupt",
      notificationType: "task_interrupted",
      message: "Kimi Code task was interrupted",
      adapter: "kimi"
    });

    const notification = new NotificationRepository(db, user.id).list()[0];
    assert.ok(notification);
    assert.equal(notification.titleKey, "notifications.taskInterrupted");
    assert.deepEqual(JSON.parse(notification.payload ?? "{}"), {
      session_id: "session-3",
      project_id: "project-3",
      project_name: "OpenForge",
      session_name: "Repair notifications",
      hook_event_name: "Interrupt",
      notification_type: "task_interrupted",
      message: "Kimi Code task was interrupted",
      adapter: "kimi"
    });
    db.close();
  });
});
