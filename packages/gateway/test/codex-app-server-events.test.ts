import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { ActivityRepository } from "../src/db/repositories/activity-repository.js";
import {
  CodexAppServerManager,
  type CodexAppServerChild
} from "../src/services/codex-app-server-manager.js";
import {
  createCodexAppServerNotificationEvent,
  type CodexAppServerTransport
} from "../src/services/codex-app-server-client.js";
import { attachCodexAppServerNotificationPersistence } from "../src/services/codex-app-server-events.js";
import { OpenForgeEventBus } from "../src/services/event-bus.js";

describe("Codex app-server notification persistence", () => {
  it("records normalized app-server notifications as activity events without transcript metadata", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("codex-events@example.com", "hash");
    const projectRoot = await mkdtemp(path.join(tmpdir(), "openforge-codex-events-"));
    const project = new ProjectRepository(db, user.id).create({
      name: "Codex Events",
      path: projectRoot,
      aiTool: "codex"
    });
    const transport = new ManualTransport();
    const manager = new CodexAppServerManager({
      runtimeRoot: projectRoot,
      spawn: () => new FakeChild(7788),
      transportFactory: () => transport
    });
    const eventBus = new OpenForgeEventBus();
    const events: unknown[] = [];
    eventBus.on("event", (event) => events.push(event));
    attachCodexAppServerNotificationPersistence({ db, manager, eventBus });

    const session = await manager.start({
      userId: user.id,
      projectId: project.id,
      projectRoot,
      credentialMode: "host_environment",
      runtimeMode: "app-server-stdio"
    });
    transport.emitMessage(JSON.stringify(createCodexAppServerNotificationEvent({
      threadId: "thr_123",
      notificationType: "permission_prompt",
      message: "approval needed"
    })));

    const activities = new ActivityRepository(db, user.id).list({ projectId: project.id });
    assert.equal(activities.length, 1);
    assert.equal(activities[0].type, "codex_app_server_notification");
    assert.equal(activities[0].status, "warning");
    assert.equal(activities[0].message, "Codex app-server permission prompt");
    assert.deepEqual(JSON.parse(activities[0].metadata ?? "{}"), {
      appServerSessionId: session.id,
      threadId: "thr_123",
      method: "notification/prompt",
      activityType: "permission_prompt"
    });
    assert.equal((events[0] as { type?: string }).type, "activity_created");
  });

  it("records automatic stop and error lifecycle events as activity rows", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("codex-lifecycle@example.com", "hash");
    const projectRoot = await mkdtemp(path.join(tmpdir(), "openforge-codex-lifecycle-"));
    const project = new ProjectRepository(db, user.id).create({
      name: "Codex Lifecycle",
      path: projectRoot,
      aiTool: "codex"
    });
    const children: FakeChild[] = [];
    const manager = new CodexAppServerManager({
      runtimeRoot: projectRoot,
      spawn: () => {
        const child = new FakeChild(8800 + children.length);
        children.push(child);
        return child;
      }
    });
    const eventBus = new OpenForgeEventBus();
    const events: unknown[] = [];
    eventBus.on("event", (event) => events.push(event));
    attachCodexAppServerNotificationPersistence({ db, manager, eventBus });

    const stoppedSession = await manager.start({
      userId: user.id,
      projectId: project.id,
      projectRoot,
      credentialMode: "host_environment",
      runtimeMode: "app-server-stdio"
    });
    children[0]?.emit("exit", 0);

    const errorSession = await manager.start({
      userId: user.id,
      projectId: project.id,
      projectRoot,
      credentialMode: "host_environment",
      runtimeMode: "app-server-stdio"
    });
    children[1]?.emit("error", new Error("codex crashed"));

    const activities = new ActivityRepository(db, user.id).list({ projectId: project.id });
    const stoppedActivity = activities.find((activity) => activity.type === "codex_app_server_stopped");
    const errorActivity = activities.find((activity) => activity.type === "codex_app_server_error");
    assert.ok(stoppedActivity);
    assert.ok(errorActivity);
    assert.equal(stoppedActivity.status, "info");
    assert.equal(stoppedActivity.message, "Codex app-server stopped");
    assert.deepEqual(JSON.parse(stoppedActivity.metadata ?? "{}"), {
      appServerSessionId: stoppedSession.id,
      runtimeMode: "app-server-stdio",
      listen: "stdio://",
      pid: 8800
    });
    assert.equal(errorActivity.status, "error");
    assert.equal(errorActivity.message, "codex crashed");
    assert.deepEqual(JSON.parse(errorActivity.metadata ?? "{}"), {
      appServerSessionId: errorSession.id,
      runtimeMode: "app-server-stdio",
      listen: "stdio://",
      pid: 8801,
      errorMessage: "codex crashed"
    });
    assert.equal(events.filter((event) => (event as { type?: string }).type === "activity_created").length, 2);
  });

  it("redacts unsafe notification and lifecycle error messages before persistence", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("codex-redaction@example.com", "hash");
    const projectRoot = await mkdtemp(path.join(tmpdir(), "openforge-codex-redaction-"));
    const project = new ProjectRepository(db, user.id).create({
      name: "Codex Redaction",
      path: projectRoot,
      aiTool: "codex"
    });
    const children: FakeChild[] = [];
    const transport = new ManualTransport();
    const manager = new CodexAppServerManager({
      runtimeRoot: projectRoot,
      perUserLimit: 2,
      spawn: () => {
        const child = new FakeChild(9900 + children.length);
        children.push(child);
        return child;
      },
      transportFactory: () => transport
    });
    attachCodexAppServerNotificationPersistence({ db, manager });

    await manager.start({
      userId: user.id,
      projectId: project.id,
      projectRoot,
      credentialMode: "host_environment",
      runtimeMode: "app-server-stdio"
    });
    transport.emitMessage(JSON.stringify(createCodexAppServerNotificationEvent({
      threadId: "thr_123",
      notificationType: "permission_prompt",
      message: "OPENAI_API_KEY=sk-test secret prompt text"
    })));

    const errorSession = await manager.start({
      userId: user.id,
      projectId: project.id,
      projectRoot,
      credentialMode: "host_environment",
      runtimeMode: "app-server-stdio"
    });
    children[1]?.emit("error", new Error("boom\n    at /root/private/project/index.js:1:1"));

    const activities = new ActivityRepository(db, user.id).list({ projectId: project.id });
    const notificationActivity = activities.find((activity) => activity.type === "codex_app_server_notification");
    const errorActivity = activities.find((activity) => activity.type === "codex_app_server_error");
    assert.ok(notificationActivity);
    assert.ok(errorActivity);
    assert.equal(notificationActivity.message, "Codex app-server permission prompt");
    assert.doesNotMatch(JSON.stringify(notificationActivity), /sk-test|secret prompt/i);
    assert.equal(errorActivity.message, "Codex app-server process error");
    assert.deepEqual(JSON.parse(errorActivity.metadata ?? "{}"), {
      appServerSessionId: errorSession.id,
      runtimeMode: "app-server-stdio",
      listen: "stdio://",
      pid: 9901,
      errorMessage: "Codex app-server process error"
    });
  });
});

class FakeChild extends EventEmitter implements CodexAppServerChild {
  constructor(readonly pid: number) {
    super();
  }

  kill(): boolean {
    this.emit("exit", 0);
    return true;
  }
}

class ManualTransport implements CodexAppServerTransport {
  private messageHandler: ((raw: string | Buffer) => void) | undefined;
  private closeHandler: ((code?: number, reason?: string) => void) | undefined;

  send(): void {}

  close(code?: number, reason?: string): void {
    this.closeHandler?.(code, reason);
  }

  onMessage(handler: (raw: string | Buffer) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: (code?: number, reason?: string) => void): void {
    this.closeHandler = handler;
  }

  emitMessage(raw: string): void {
    this.messageHandler?.(raw);
  }
}

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const drizzleDb = drizzle(db);
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/db/migrations"
  );
  migrate(drizzleDb, { migrationsFolder });
  return db;
}
