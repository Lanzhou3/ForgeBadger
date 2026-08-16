import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { UserRepository } from "../src/db/repositories/user-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { SessionRepository } from "../src/db/repositories/session-repository.js";
import { OpenForgeEventBus, type OpenForgeEvent } from "../src/services/event-bus.js";
import {
  handleClaudeNotificationHook,
  handleClaudePortfolioWorkerSessionStart
} from "../src/routes/session-hooks.js";
import type { ClaudePortfolioWorker } from "../src/services/portfolio/claude-portfolio-worker.js";

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

function waitForEvent(eventBus: OpenForgeEventBus, timeoutMs = 2000): Promise<OpenForgeEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for event")), timeoutMs);
    eventBus.once("event", (event: OpenForgeEvent) => {
      clearTimeout(timer);
      resolve(event);
    });
  });
}

describe("Claude Code session hook route", () => {
  let db: Database;
  let eventBus: OpenForgeEventBus;

  beforeEach(() => {
    db = createTestDb();
    eventBus = new OpenForgeEventBus();
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
      tmuxSession: "of-hook-session"
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

  it("isolates worker ACK from the ordinary attach-token notification hook", () => {
    // Arrange
    const user = new UserRepository(db).create("hook-portfolio-worker@example.com", "hash");
    const project = new ProjectRepository(db, user.id).create({
      name: "Portfolio worker hook project",
      path: "/tmp/portfolio-worker-hook-project",
      aiTool: "claude"
    });
    const session = new SessionRepository(db, user.id).create({
      projectId: project.id,
      name: "Portfolio worker hook session",
      aiTool: "claude",
      workingDir: project.path,
      attachToken: "valid-attach-token-is-not-worker-capability",
      tmuxSession: "of-portfolio-worker-hook"
    });
    const expectedCapability = "worker-ack-capability-only";
    const acknowledged: Array<{ userId: string; sessionId: string; workerAckCapability: string }> = [];
    const worker = {
      forwardSessionStart(input: { userId: string; sessionId: string; workerAckCapability: string }) {
        if (input.workerAckCapability !== expectedCapability) return { status: "rejected" };
        acknowledged.push(input);
        return { status: "acknowledged" };
      }
    } as unknown as ClaudePortfolioWorker;

    // Act
    const normalNotification = handleClaudeNotificationHook(
      db,
      eventBus,
      { hook_event_name: "SessionStart", adapter: "claude" },
      session.attachToken ?? undefined,
      session.id
    );
    const missing = handleClaudePortfolioWorkerSessionStart(
      db,
      session.id,
      { hook_event_name: "SessionStart" },
      undefined,
      worker
    );
    const wrongAttachToken = handleClaudePortfolioWorkerSessionStart(
      db,
      session.id,
      { hook_event_name: "SessionStart" },
      session.attachToken ?? undefined,
      worker
    );
    const wrongEvent = handleClaudePortfolioWorkerSessionStart(
      db,
      session.id,
      { hook_event_name: "Notification" },
      expectedCapability,
      worker
    );
    const extraWorkerKey = handleClaudePortfolioWorkerSessionStart(
      db,
      session.id,
      { hook_event_name: "SessionStart", receiptDigest: "must-not-reach-worker" },
      expectedCapability,
      worker
    );
    assert.equal(acknowledged.length, 0, "a strict-body rejection must not create a worker ACK signal or receipt");
    const accepted = handleClaudePortfolioWorkerSessionStart(
      db,
      session.id,
      { hook_event_name: "SessionStart" },
      expectedCapability,
      worker
    );

    // Assert
    assert.equal(normalNotification.status, 200);
    assert.notEqual(missing.status, 200);
    assert.notEqual(wrongAttachToken.status, 200);
    assert.notEqual(wrongEvent.status, 200);
    assert.equal(extraWorkerKey.status, 400);
    assert.equal(accepted.status, 200);
    assert.deepEqual(acknowledged, [{
      userId: user.id,
      sessionId: session.id,
      workerAckCapability: expectedCapability
    }]);
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
      tmuxSession: "of-http-hook-session"
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
      tmuxSession: "of-notification-hook-session"
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
      tmuxSession: "of-path-hook-session"
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
      tmuxSession: "of-message-hook-session"
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
      tmuxSession: "of-denied-hook-session"
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
      tmuxSession: "of-lifecycle-session"
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
});
