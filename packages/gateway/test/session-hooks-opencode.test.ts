import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NotificationRepository } from "../src/db/repositories/notification-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { SessionRepository } from "../src/db/repositories/session-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { ForgeBadgerEventBus, type ForgeBadgerEvent } from "../src/services/event-bus.js";
import { attachNotificationPersistence } from "../src/services/notification-events.js";
import { handleSessionNotificationHook } from "../src/routes/session-hooks.js";

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

function waitForEvent(eventBus: ForgeBadgerEventBus, timeoutMs = 2000): Promise<ForgeBadgerEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for event")), timeoutMs);
    eventBus.once("event", (event: ForgeBadgerEvent) => {
      clearTimeout(timer);
      resolve(event);
    });
  });
}

interface TestSession {
  id: string;
  userId: string;
}

function createOpenCodeSession(db: Database): TestSession {
  const user = new UserRepository(db).create("opencode-hook@example.com", "hash");
  const project = new ProjectRepository(db, user.id).create({
    name: "OpenCode Project",
    path: "/tmp/opencode-project",
    aiTool: "opencode"
  });
  const session = new SessionRepository(db, user.id).create({
    projectId: project.id,
    name: "OpenCode Project",
    aiTool: "opencode",
    workingDir: project.path,
    attachToken: "opencode-session-token",
    runtimeSessionName: "of-opencode-session"
  });
  return { id: session.id, userId: user.id };
}

function openCodePermissionBody(): Record<string, string> {
  return {
    hook_event_name: "PermissionRequest",
    notification_type: "permission_prompt",
    message: "bash /tmp/x.sh",
    tool_name: "OpenCode",
    adapter: "opencode"
  };
}

describe("OpenCode session hook route", () => {
  let db: Database;
  let eventBus: ForgeBadgerEventBus;

  beforeEach(() => {
    db = createTestDb();
    eventBus = new ForgeBadgerEventBus();
  });

  afterEach(() => {
    db.close();
  });

  it("accepts an OpenCode permission.asked notification, emits event and persists adapter", async () => {
    const session = createOpenCodeSession(db);
    attachNotificationPersistence({ db, eventBus });
    const eventPromise = waitForEvent(eventBus);

    const res = handleSessionNotificationHook(
      db,
      eventBus,
      openCodePermissionBody(),
      "opencode-session-token",
      session.id
    );

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { code: 0, data: { accepted: true }, message: "" });

    const event = await eventPromise;
    assert.equal(event.type, "session_notification");
    if (event.type === "session_notification") {
      assert.equal(event.adapter, "opencode");
      assert.equal(event.sessionId, session.id);
      assert.equal(event.hookEventName, "PermissionRequest");
      assert.equal(event.notificationType, "permission_prompt");
      assert.equal(event.message, "bash /tmp/x.sh");
      assert.equal(event.toolName, "OpenCode");
    }

    const notification = new NotificationRepository(db, session.userId).list()[0];
    assert.ok(notification);
    assert.equal(notification.titleKey, "notifications.opencodePermissionRequest");
    const payload = JSON.parse(notification.payload ?? "{}") as Record<string, unknown>;
    assert.equal(payload.adapter, "opencode");
    assert.equal(payload.notification_type, "permission_prompt");
    assert.equal(payload.message, "bash /tmp/x.sh");
  });

  it("redacts credential-shaped hook text before event emission and persistence", async () => {
    const session = createOpenCodeSession(db);
    attachNotificationPersistence({ db, eventBus });
    const marker = "sk-FAKEHOOKSECRET123456";
    const eventPromise = waitForEvent(eventBus);
    const res = handleSessionNotificationHook(db, eventBus, {
      ...openCodePermissionBody(), message: `Permission body ${marker}`,
      title: `Permission title ${marker}`, tool_name: `Bash-${marker}`
    }, "opencode-session-token", session.id);
    assert.equal(res.status, 200);
    const event = await eventPromise;
    assert.equal(JSON.stringify(event).includes(marker), false);
    const notification = new NotificationRepository(db, session.userId).list()[0];
    assert.ok(notification);
    assert.equal(JSON.stringify(notification).includes(marker), false);
    assert.match(notification.message, /\[REDACTED\]/);
  });

  it("filters manual interruption and redacts main failure errors", async () => {
    const session = createOpenCodeSession(db);
    attachNotificationPersistence({ db, eventBus });
    const marker = "sk-FAKEHOOKERROR123456";
    for (const hook of [
      { hook_event_name: "StopFailure", notification_type: "task_failed", error: `Failed ${marker}` }
    ]) {
      const eventPromise = waitForEvent(eventBus);
      const res = handleSessionNotificationHook(db, eventBus, { ...hook, adapter: "opencode" },
        "opencode-session-token", session.id);
      assert.equal(res.status, 200);
      assert.equal(JSON.stringify(await eventPromise).includes(marker), false);
    }
    const notifications = new NotificationRepository(db, session.userId).list();
    assert.equal(notifications.length, 1);
    assert.equal(JSON.stringify(notifications).includes(marker), false);
  });

  it("uses the authenticated session adapter when the request omits the adapter field", async () => {
    const session = createOpenCodeSession(db);
    attachNotificationPersistence({ db, eventBus });
    const eventPromise = waitForEvent(eventBus);

    const body = openCodePermissionBody();
    delete body.adapter;
    const res = handleSessionNotificationHook(
      db,
      eventBus,
      body,
      "opencode-session-token",
      session.id
    );

    assert.equal(res.status, 200);
    const event = await eventPromise;
    assert.equal(event.type, "session_notification");
    if (event.type === "session_notification") {
      assert.equal(event.adapter, "opencode");
    }

    const notification = new NotificationRepository(db, session.userId).list()[0];
    assert.ok(notification);
    assert.equal(notification.titleKey, "notifications.opencodePermissionRequest");
    const payload = JSON.parse(notification.payload ?? "{}") as Record<string, unknown>;
    assert.equal(payload.adapter, "opencode");
  });

  it("rejects opencode notifications with a missing session token", async () => {
    const session = createOpenCodeSession(db);

    const res = handleSessionNotificationHook(
      db,
      eventBus,
      openCodePermissionBody(),
      undefined,
      session.id
    );

    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { code: 1, message: "Missing session token" });
  });

  it("rejects opencode notifications with an invalid session token", async () => {
    const session = createOpenCodeSession(db);

    const res = handleSessionNotificationHook(
      db,
      eventBus,
      openCodePermissionBody(),
      "wrong-token",
      session.id
    );

    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { code: 1, message: "Invalid session token" });
  });

  it("rejects an invalid opencode notification body", async () => {
    const res = handleSessionNotificationHook(db, eventBus, { sessionId: "", event: {} }, "token", undefined);

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { code: 1, message: "Invalid input" });
  });
});
