import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, it } from "node:test";

import { signJwt } from "../src/auth/jwt.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { createNotificationRoutes } from "../src/routes/notifications.js";
import { ForgeBadgerEventBus } from "../src/services/event-bus.js";
import { attachNotificationPersistence } from "../src/services/notification-events.js";

const secret = "0123456789abcdef0123456789abcdef";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
  return db;
}

interface ListBody {
  code: number;
  message?: string;
  data?: {
    notifications: Array<{
      id: string;
      type: string;
      category: string;
      titleKey: string;
      sessionId: string | null;
      sessionName?: string;
      adapter?: string;
      notificationType?: string;
      href: string;
    }>;
    unreadCount: number;
  };
}

describe("notification routes", () => {
  let db: Database.Database;
  let app: express.Express;
  let eventBus: ForgeBadgerEventBus;
  let userId: string;
  let strangerId: string;
  let token: string;
  let strangerToken: string;

  beforeEach(() => {
    db = createTestDb();
    const user = new UserRepository(db).create("notify-routes@example.com", "hash");
    const stranger = new UserRepository(db).create("notify-stranger@example.com", "hash");
    userId = user.id;
    strangerId = stranger.id;
    token = signJwt({ userId: user.id, email: user.email }, secret);
    strangerToken = signJwt({ userId: stranger.id, email: stranger.email }, secret);
    eventBus = new ForgeBadgerEventBus();
    attachNotificationPersistence({ db, eventBus });
    app = express();
    app.locals.jwtSecret = secret;
    app.use(express.json());
    app.use("/api/v1/notifications", createNotificationRoutes(db));
  });

  function seedNotifications(targetUserId: string): void {
    eventBus.emitEvent({
      type: "claude_notification",
      userId: targetUserId,
      sessionId: "session-1",
      hookEventName: "Notification",
      notificationType: "permission_prompt",
      message: "Claude needs your permission",
      toolName: "Bash"
    });
    eventBus.emitEvent({
      type: "app_action_notification",
      userId: targetUserId,
      action: "apply_provider",
      status: "success",
      titleKey: "notifications.applyProviderSucceeded",
      message: "Provider applied to claude (DeepSeek -> claude)",
      adapter: "claude",
      providerId: "provider-1",
      providerName: "DeepSeek"
    });
  }

  it("returns all notifications when no category filter is given", async () => {
    seedNotifications(userId);

    const res = await makeRequest(app, "GET", "/api/v1/notifications", undefined, authHeaders(token));

    assert.equal(res.status, 200);
    const body = res.body as ListBody;
    assert.equal(body.data?.notifications.length, 2);
    assert.equal(body.data?.unreadCount, 2);
    const categories = body.data?.notifications.map((notification) => notification.category).sort();
    assert.deepEqual(categories, ["app_action", "session_event"]);
  });

  it("filters notifications by the app_action category", async () => {
    seedNotifications(userId);

    const res = await makeRequest(app, "GET", "/api/v1/notifications?category=app_action", undefined, authHeaders(token));

    assert.equal(res.status, 200);
    const body = res.body as ListBody;
    assert.equal(body.data?.notifications.length, 1);
    const notification = body.data?.notifications[0];
    assert.ok(notification);
    assert.equal(notification.category, "app_action");
    assert.equal(notification.type, "app_action_notification");
    assert.equal(notification.titleKey, "notifications.applyProviderSucceeded");
    // App action rows have no session; session context degrades to payload values.
    assert.equal(notification.sessionId, null);
    assert.equal(notification.sessionName, undefined);
    assert.equal(notification.adapter, "claude");
    assert.equal(notification.notificationType, undefined);
    assert.equal(notification.href, "/models");
    // Unread count is not narrowed by the filter.
    assert.equal(body.data?.unreadCount, 2);
  });

  it("filters notifications by the session_event category", async () => {
    seedNotifications(userId);

    const res = await makeRequest(app, "GET", "/api/v1/notifications?category=session_event", undefined, authHeaders(token));

    assert.equal(res.status, 200);
    const body = res.body as ListBody;
    assert.equal(body.data?.notifications.length, 1);
    assert.equal(body.data?.notifications[0]?.category, "session_event");
    assert.equal(body.data?.notifications[0]?.type, "claude_notification");
  });

  it("rejects an unknown category filter", async () => {
    const res = await makeRequest(app, "GET", "/api/v1/notifications?category=bogus", undefined, authHeaders(token));

    assert.equal(res.status, 400);
    assert.equal((res.body as ListBody).code, 1);
  });

  it("does not leak another user's app action notifications", async () => {
    seedNotifications(userId);

    const res = await makeRequest(app, "GET", "/api/v1/notifications?category=app_action", undefined, authHeaders(strangerToken));

    assert.equal(res.status, 200);
    const body = res.body as ListBody;
    assert.equal(body.data?.notifications.length, 0);
    assert.equal(body.data?.unreadCount, 0);
  });

  function authHeaders(jwt: string): Record<string, string> {
    return { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` };
  }
});

async function makeRequest(
  app: express.Express,
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    const response = await fetch(`http://127.0.0.1:${port}${url}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
