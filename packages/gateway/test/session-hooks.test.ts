import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import http from "node:http";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { UserRepository } from "../src/db/repositories/user-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { SessionRepository } from "../src/db/repositories/session-repository.js";
import { ForgeBadgerEventBus, type ForgeBadgerEvent } from "../src/services/event-bus.js";
import { createSessionHookRoutes, handleClaudeNotificationHook } from "../src/routes/session-hooks.js";

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

describe("Claude Code session hook route", () => {
  let db: Database;
  let eventBus: ForgeBadgerEventBus;

  beforeEach(() => {
    db = createTestDb();
    eventBus = new ForgeBadgerEventBus();
  });

  afterEach(() => {
    db.close();
  });

  it("accepts a valid session token and emits a user-scoped Claude notification", async () => {
    const user = new UserRepository(db).create("hook@example.com", "hash");
    const project = new ProjectRepository(db, user.id).create({
      name: "Hook Project",
      path: "/tmp/hook-project",
      aiTool: "claude"
    });
    const session = new SessionRepository(db, user.id).create({
      projectId: project.id,
      name: "Hook Project",
      aiTool: "claude",
      workingDir: project.path,
      attachToken: "session-token",
      runtimeSessionName: "of-hook-session"
    });
    const eventPromise = waitForEvent(eventBus);

    const res = handleClaudeNotificationHook(
      db,
      eventBus,
      {
        sessionId: session.id,
        event: {
          hook_event_name: "Notification",
          notification_type: "permission_prompt",
          message: "Claude needs your permission to use Bash",
          tool_name: "Bash"
        }
      },
      "session-token"
    );

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { code: 0, data: { accepted: true }, message: "" });
    const event = await eventPromise;
    assert.equal(event.type, "claude_notification");
    if (event.type === "claude_notification") {
      assert.equal(event.sessionId, session.id);
      assert.equal(event.notificationType, "permission_prompt");
      assert.equal(event.toolName, "Bash");
    }
  });

  it("accepts Claude Code raw PermissionRequest hook payloads from HTTP hooks", async () => {
    const user = new UserRepository(db).create("hook-http@example.com", "hash");
    const project = new ProjectRepository(db, user.id).create({
      name: "HTTP Hook Project",
      path: "/tmp/http-hook-project",
      aiTool: "claude"
    });
    const session = new SessionRepository(db, user.id).create({
      projectId: project.id,
      name: "HTTP Hook Project",
      aiTool: "claude",
      workingDir: project.path,
      attachToken: "http-session-token",
      runtimeSessionName: "of-http-hook-session"
    });
    const eventPromise = waitForEvent(eventBus);

    const res = handleClaudeNotificationHook(
      db,
      eventBus,
      {
        hook_event_name: "PermissionRequest",
        tool_name: "Bash",
        tool_input: {
          command: "pnpm test",
          description: "Run tests"
        }
      },
      "http-session-token",
      session.id
    );

    assert.equal(res.status, 200);
    const event = await eventPromise;
    assert.equal(event.type, "claude_notification");
    if (event.type === "claude_notification") {
      assert.equal(event.sessionId, session.id);
      assert.equal(event.hookEventName, "PermissionRequest");
      assert.equal(event.notificationType, "permission_prompt");
      assert.equal(event.toolName, "Bash");
      assert.match(event.message, /permission/i);
    }
  });

  it("accepts Claude Code permission prompt Notification payloads from hook forwarding", async () => {
    const user = new UserRepository(db).create("hook-notification@example.com", "hash");
    const project = new ProjectRepository(db, user.id).create({
      name: "Notification Hook Project",
      path: "/tmp/notification-hook-project",
      aiTool: "claude"
    });
    const session = new SessionRepository(db, user.id).create({
      projectId: project.id,
      name: "Notification Hook Project",
      aiTool: "claude",
      workingDir: project.path,
      attachToken: "notification-session-token",
      runtimeSessionName: "of-notification-hook-session"
    });
    const eventPromise = waitForEvent(eventBus);

    const res = handleClaudeNotificationHook(
      db,
      eventBus,
      {
        hook_event_name: "Notification",
        notification_type: "permission_prompt",
        message: "Claude needs your permission to use Bash",
        title: "Permission needed"
      },
      "notification-session-token",
      session.id
    );

    assert.equal(res.status, 200);
    const event = await eventPromise;
    assert.equal(event.type, "claude_notification");
    if (event.type === "claude_notification") {
      assert.equal(event.sessionId, session.id);
      assert.equal(event.hookEventName, "Notification");
      assert.equal(event.notificationType, "permission_prompt");
      assert.equal(event.title, "Permission needed");
      assert.match(event.message, /permission/i);
    }
  });

  it("accepts session id from the hook route path when Claude forwards raw stdin", async () => {
    const user = new UserRepository(db).create("hook-path@example.com", "hash");
    const project = new ProjectRepository(db, user.id).create({
      name: "Path Hook Project",
      path: "/tmp/path-hook-project",
      aiTool: "claude"
    });
    const session = new SessionRepository(db, user.id).create({
      projectId: project.id,
      name: "Path Hook Project",
      aiTool: "claude",
      workingDir: project.path,
      attachToken: "path-session-token",
      runtimeSessionName: "of-path-hook-session"
    });
    const eventPromise = waitForEvent(eventBus);

    const res = handleClaudeNotificationHook(
      db,
      eventBus,
      {
        hook_event_name: "Notification",
        notification_type: "permission_prompt",
        message: "Claude needs your permission to use Edit"
      },
      "path-session-token",
      session.id
    );

    assert.equal(res.status, 200);
    const event = await eventPromise;
    assert.equal(event.type, "claude_notification");
    if (event.type === "claude_notification") {
      assert.equal(event.sessionId, session.id);
      assert.equal(event.notificationType, "permission_prompt");
    }
  });

  it("infers permission prompt notifications from Claude Code message-only hook payloads", async () => {
    const user = new UserRepository(db).create("hook-notification-message@example.com", "hash");
    const project = new ProjectRepository(db, user.id).create({
      name: "Message Hook Project",
      path: "/tmp/message-hook-project",
      aiTool: "claude"
    });
    const session = new SessionRepository(db, user.id).create({
      projectId: project.id,
      name: "Message Hook Project",
      aiTool: "claude",
      workingDir: project.path,
      attachToken: "message-session-token",
      runtimeSessionName: "of-message-hook-session"
    });
    const eventPromise = waitForEvent(eventBus);

    const res = handleClaudeNotificationHook(
      db,
      eventBus,
      {
        hook_event_name: "Notification",
        message: "Claude needs your permission to use Bash"
      },
      "message-session-token",
      session.id
    );

    assert.equal(res.status, 200);
    const event = await eventPromise;
    assert.equal(event.type, "claude_notification");
    if (event.type === "claude_notification") {
      assert.equal(event.notificationType, "permission_prompt");
      assert.equal(event.toolName, "Bash");
      assert.match(event.message, /permission/i);
    }
  });

  it("accepts Claude Code raw PermissionDenied hook payloads from HTTP hooks", async () => {
    const user = new UserRepository(db).create("hook-denied@example.com", "hash");
    const project = new ProjectRepository(db, user.id).create({
      name: "Denied Hook Project",
      path: "/tmp/denied-hook-project",
      aiTool: "claude"
    });
    const session = new SessionRepository(db, user.id).create({
      projectId: project.id,
      name: "Denied Hook Project",
      aiTool: "claude",
      workingDir: project.path,
      attachToken: "denied-session-token",
      runtimeSessionName: "of-denied-hook-session"
    });
    const eventPromise = waitForEvent(eventBus);

    const res = handleClaudeNotificationHook(
      db,
      eventBus,
      {
        hook_event_name: "PermissionDenied",
        tool_name: "Bash",
        reason: "Auto mode denied"
      },
      "denied-session-token",
      session.id
    );

    assert.equal(res.status, 200);
    const event = await eventPromise;
    assert.equal(event.type, "claude_notification");
    if (event.type === "claude_notification") {
      assert.equal(event.sessionId, session.id);
      assert.equal(event.hookEventName, "PermissionDenied");
      assert.equal(event.notificationType, "permission_denied");
      assert.equal(event.toolName, "Bash");
      assert.match(event.message, /denied/i);
    }
  });

  it("rejects hook events with an invalid session token", async () => {
    const res = handleClaudeNotificationHook(
      db,
      eventBus,
      { sessionId: "missing", event: { hook_event_name: "Notification" } },
      "wrong"
    );

    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { code: 1, message: "Invalid session token" });
  });

  it("normalizes completion, interruption, failure, and end events across adapters", async () => {
    const user = new UserRepository(db).create("hook-lifecycle@example.com", "hash");
    const project = new ProjectRepository(db, user.id).create({
      name: "Lifecycle Project",
      path: "/tmp/lifecycle-project",
      aiTool: "kimi"
    });
    const session = new SessionRepository(db, user.id).create({
      projectId: project.id,
      name: "Fix notification flow",
      aiTool: "kimi",
      workingDir: project.path,
      attachToken: "lifecycle-token",
      runtimeSessionName: "of-lifecycle-session"
    });

    const cases = [
      ["Stop", "task_completed"],
      ["Interrupt", "task_interrupted"],
      ["StopFailure", "task_failed"],
      ["SessionEnd", "session_ended"]
    ] as const;

    for (const [hookEventName, notificationType] of cases) {
      const eventPromise = waitForEvent(eventBus);
      const res = handleClaudeNotificationHook(
        db,
        eventBus,
        { hook_event_name: hookEventName, adapter: "kimi" },
        "lifecycle-token",
        session.id
      );

      assert.equal(res.status, 200);
      const event = await eventPromise;
      assert.equal(event.type, "claude_notification");
      if (event.type === "claude_notification") {
        assert.equal(event.notificationType, notificationType);
        assert.equal(event.adapter, "kimi");
        assert.equal(event.projectId, project.id);
        assert.equal(event.projectName, "Lifecycle Project");
        assert.equal(event.sessionName, "Fix notification flow");
      }
    }

    const backgroundEventPromise = waitForEvent(eventBus);
    handleClaudeNotificationHook(
      db,
      eventBus,
      {
        hook_event_name: "Notification",
        notification_type: "task.completed",
        adapter: "kimi"
      },
      "lifecycle-token",
      session.id
    );
    const backgroundEvent = await backgroundEventPromise;
    assert.equal(backgroundEvent.type, "claude_notification");
    if (backgroundEvent.type === "claude_notification") {
      assert.equal(backgroundEvent.notificationType, "task_completed");
    }
  });

  it("accepts PI extension payloads and labels them as PI", async () => {
    const user = new UserRepository(db).create("pi-hooks@example.com", "hash");
    const project = new ProjectRepository(db, user.id).create({
      name: "PI Project",
      path: "/tmp/pi-project",
      aiTool: "pi"
    });
    const session = new SessionRepository(db, user.id).create({
      projectId: project.id,
      name: "PI session",
      aiTool: "pi",
      workingDir: project.path,
      attachToken: "pi-token",
      runtimeSessionName: "of-pi-session"
    });

    // agent_settled -> Stop
    let eventPromise = waitForEvent(eventBus);
    let res = handleClaudeNotificationHook(
      db,
      eventBus,
      { hook_event_name: "Stop", adapter: "pi" },
      "pi-token",
      session.id
    );
    assert.equal(res.status, 200);
    let event = await eventPromise;
    assert.equal(event.type, "claude_notification");
    if (event.type === "claude_notification") {
      assert.equal(event.notificationType, "task_completed");
      assert.equal(event.adapter, "pi");
      assert.equal(event.message, "PI task completed");
    }

    // ui_prompt_start -> PermissionRequest (with the extension's waiting message)
    eventPromise = waitForEvent(eventBus);
    res = handleClaudeNotificationHook(
      db,
      eventBus,
      {
        hook_event_name: "PermissionRequest",
        message: "PI is waiting for your confirm: Run bash command",
        adapter: "pi"
      },
      "pi-token",
      session.id
    );
    assert.equal(res.status, 200);
    event = await eventPromise;
    assert.equal(event.type, "claude_notification");
    if (event.type === "claude_notification") {
      assert.equal(event.notificationType, "permission_prompt");
      assert.equal(event.adapter, "pi");
      assert.equal(event.message, "PI is waiting for your confirm: Run bash command");
    }

    // session_shutdown -> SessionEnd
    eventPromise = waitForEvent(eventBus);
    res = handleClaudeNotificationHook(
      db,
      eventBus,
      { hook_event_name: "SessionEnd", adapter: "pi" },
      "pi-token",
      session.id
    );
    assert.equal(res.status, 200);
    event = await eventPromise;
    assert.equal(event.type, "claude_notification");
    if (event.type === "claude_notification") {
      assert.equal(event.notificationType, "session_ended");
      assert.equal(event.message, "PI session ended");
    }
  });
});

describe("Claude Code session hook route: session identity precedence", () => {
  let db: Database;
  let eventBus: ForgeBadgerEventBus;

  beforeEach(() => {
    db = createTestDb();
    eventBus = new ForgeBadgerEventBus();
  });

  afterEach(() => {
    db.close();
  });

  it("trusts the x-forgebadger-session-id header over a stale session in the URL path", async () => {
    const user = new UserRepository(db).create("hook-precedence@example.com", "hash");
    const project = new ProjectRepository(db, user.id).create({
      name: "Precedence Project",
      path: "/tmp/precedence-project",
      aiTool: "claude"
    });
    const staleSession = new SessionRepository(db, user.id).create({
      projectId: project.id,
      name: "Precedence Project",
      aiTool: "claude",
      workingDir: project.path,
      attachToken: "stale-token",
      runtimeSessionName: "of-stale-session"
    });
    const currentSession = new SessionRepository(db, user.id).create({
      projectId: project.id,
      name: "Precedence Project",
      aiTool: "claude",
      workingDir: project.path,
      attachToken: "current-token",
      runtimeSessionName: "of-current-session"
    });
    const eventPromise = waitForEvent(eventBus);

    const app = express();
    app.use(express.json());
    app.use("/api/v1/session-hooks", createSessionHookRoutes(db, eventBus));

    // A stale project-level settings file still carries the old session id in
    // the URL path, but the worker sends its own session via the header.
    const res = await makeRequest(
      app,
      `/api/v1/session-hooks/claude-notification/${staleSession.id}`,
      { hook_event_name: "Stop" },
      {
        "x-forgebadger-session-id": currentSession.id,
        "x-forgebadger-session-token": "current-token"
      }
    );

    assert.equal(res.status, 200);
    const event = await eventPromise;
    assert.equal(event.type, "claude_notification");
    if (event.type === "claude_notification") {
      assert.equal(event.sessionId, currentSession.id);
    }
  });

  it("still rejects when the token does not match the session named by the header", async () => {
    const user = new UserRepository(db).create("hook-precedence-2@example.com", "hash");
    const project = new ProjectRepository(db, user.id).create({
      name: "Precedence Project 2",
      path: "/tmp/precedence-project-2",
      aiTool: "claude"
    });
    new SessionRepository(db, user.id).create({
      projectId: project.id,
      name: "Precedence Project 2",
      aiTool: "claude",
      workingDir: project.path,
      attachToken: "current-token",
      runtimeSessionName: "of-current-session-2"
    });

    const app = express();
    app.use(express.json());
    app.use("/api/v1/session-hooks", createSessionHookRoutes(db, eventBus));

    const res = await makeRequest(
      app,
      "/api/v1/session-hooks/claude-notification",
      { hook_event_name: "Stop" },
      {
        "x-forgebadger-session-id": "nonexistent-session",
        "x-forgebadger-session-token": "current-token"
      }
    );

    assert.equal(res.status, 401);
  });
});

async function makeRequest(
  app: express.Express,
  requestPath: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Test server did not expose a TCP port"));
        return;
      }
      const payload = JSON.stringify(body);
      const request = http.request({
        hostname: "127.0.0.1",
        port: address.port,
        path: requestPath,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
          ...headers
        }
      }, (response) => {
        let raw = "";
        response.on("data", (chunk) => { raw += chunk; });
        response.on("end", () => {
          server.close();
          let parsed: any = raw;
          try { parsed = raw ? JSON.parse(raw) : {}; } catch { /* keep raw */ }
          resolve({ status: response.statusCode ?? 0, body: parsed });
        });
      });
      request.on("error", (error) => {
        server.close();
        reject(error);
      });
      request.end(payload);
    });
  });
}
