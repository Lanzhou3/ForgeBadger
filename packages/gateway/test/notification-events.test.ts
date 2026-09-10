import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NotificationRepository } from "../src/db/repositories/notification-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { ForgeBadgerEventBus } from "../src/services/event-bus.js";
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
  it("does not persist session lifecycle events as notifications", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("event-notify@example.com", "hash");
    const eventBus = new ForgeBadgerEventBus();
    attachNotificationPersistence({ db, eventBus });

    eventBus.emitEvent({
      type: "session_created" as const,
      userId: user.id,
      sessionId: "session-1",
      projectId: "project-1",
      name: "Session 1"
    });
    eventBus.emitEvent({
      type: "session_status_changed" as const,
      userId: user.id,
      sessionId: "session-1",
      oldStatus: "starting",
      newStatus: "running"
    });

    const notifications = new NotificationRepository(db, user.id).list();
    assert.equal(notifications.length, 0);
    db.close();
  });

  it("does not persist CLI notifications outside the allowlist", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("filtered-notify@example.com", "hash");
    const eventBus = new ForgeBadgerEventBus();
    attachNotificationPersistence({ db, eventBus });

    for (const notificationType of ["status", "elicitation_dialog", "auth_status"]) {
      eventBus.emitEvent({
        type: "claude_notification",
        userId: user.id,
        sessionId: "session-9",
        hookEventName: "Notification",
        notificationType,
        message: "filtered out"
      });
    }

    const notifications = new NotificationRepository(db, user.id).list();
    assert.equal(notifications.length, 0);
    db.close();
  });

  it("persists Claude permission notifications with permission title key", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("claude-notify@example.com", "hash");
    const eventBus = new ForgeBadgerEventBus();
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
    const eventBus = new ForgeBadgerEventBus();
    attachNotificationPersistence({ db, eventBus });

    eventBus.emitEvent({
      type: "claude_notification",
      userId: user.id,
      sessionId: "session-3",
      projectId: "project-3",
      projectName: "ForgeBadger",
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
      project_name: "ForgeBadger",
      session_name: "Repair notifications",
      hook_event_name: "Interrupt",
      notification_type: "task_interrupted",
      message: "Kimi Code task was interrupted",
      adapter: "kimi"
    });
    db.close();
  });

  it("persists newly allowlisted CLI notifications with mapped title keys", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("extended-notify@example.com", "hash");
    const eventBus = new ForgeBadgerEventBus();
    attachNotificationPersistence({ db, eventBus });

    const cases: Array<{ notificationType: string; adapter?: string; titleKey: string }> = [
      { notificationType: "permission_denied", titleKey: "notifications.claudePermissionDenied" },
      { notificationType: "permission_denied", adapter: "codex", titleKey: "notifications.codexPermissionDenied" },
      { notificationType: "permission_denied", adapter: "opencode", titleKey: "notifications.opencodePermissionDenied" },
      { notificationType: "permission_denied", adapter: "kimi", titleKey: "notifications.kimiPermissionDenied" },
      { notificationType: "task_failed", titleKey: "notifications.taskFailed" },
      { notificationType: "session_ended", titleKey: "notifications.sessionEnded" }
    ];
    for (const testCase of cases) {
      eventBus.emitEvent({
        type: "claude_notification",
        userId: user.id,
        sessionId: "session-4",
        hookEventName: "Notification",
        notificationType: testCase.notificationType,
        message: "lifecycle event",
        ...(testCase.adapter ? { adapter: testCase.adapter } : {})
      });
    }

    const notifications = new NotificationRepository(db, user.id).list();
    assert.equal(notifications.length, cases.length);
    const titleKeys = notifications.map((notification) => notification.titleKey).sort();
    assert.deepEqual(titleKeys, cases.map((testCase) => testCase.titleKey).sort());
    for (const notification of notifications) {
      assert.equal(notification.category, "session_event");
    }
    db.close();
  });

  it("persists app action notifications with the app_action category and tags the event", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("app-action-notify@example.com", "hash");
    const eventBus = new ForgeBadgerEventBus();
    attachNotificationPersistence({ db, eventBus });

    const event = {
      type: "app_action_notification" as const,
      userId: user.id,
      action: "apply_provider" as const,
      status: "success" as const,
      titleKey: "notifications.applyProviderSucceeded",
      message: "Provider applied to claude (DeepSeek -> claude)",
      adapter: "claude",
      providerId: "provider-1",
      providerName: "DeepSeek"
    };
    eventBus.emitEvent(event);

    const notifications = new NotificationRepository(db, user.id).list();
    assert.equal(notifications.length, 1);
    const notification = notifications[0];
    assert.ok(notification);
    assert.equal(notification.type, "app_action_notification");
    assert.equal(notification.category, "app_action");
    assert.equal(notification.sessionId, null);
    assert.equal(notification.href, "/models");
    assert.equal(notification.titleKey, "notifications.applyProviderSucceeded");
    assert.deepEqual(JSON.parse(notification.payload ?? "{}"), {
      action: "apply_provider",
      status: "success",
      message: "Provider applied to claude (DeepSeek -> claude)",
      adapter: "claude",
      provider_id: "provider-1",
      provider_name: "DeepSeek"
    });
    assert.equal(event.notificationId, notification.id);
    assert.ok(event.notificationCreatedAt instanceof Date);
    db.close();
  });

  it("keeps app action notifications tenant scoped", () => {
    const db = createTestDb();
    const owner = new UserRepository(db).create("app-action-owner@example.com", "hash");
    const stranger = new UserRepository(db).create("app-action-stranger@example.com", "hash");
    const eventBus = new ForgeBadgerEventBus();
    attachNotificationPersistence({ db, eventBus });

    eventBus.emitEvent({
      type: "app_action_notification",
      userId: owner.id,
      action: "model_sync",
      status: "error",
      titleKey: "notifications.modelSyncFailed",
      message: "Failed to sync provider models (DeepSeek)",
      providerId: "provider-1",
      providerName: "DeepSeek"
    });

    assert.equal(new NotificationRepository(db, owner.id).list().length, 1);
    assert.equal(new NotificationRepository(db, stranger.id).list().length, 0);
    db.close();
  });
});
