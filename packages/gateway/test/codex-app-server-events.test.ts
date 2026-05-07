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
    assert.equal(activities[0].message, "approval needed");
    assert.deepEqual(JSON.parse(activities[0].metadata ?? "{}"), {
      appServerSessionId: session.id,
      threadId: "thr_123",
      method: "notification/prompt",
      activityType: "permission_prompt"
    });
    assert.equal((events[0] as { type?: string }).type, "activity_created");
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
