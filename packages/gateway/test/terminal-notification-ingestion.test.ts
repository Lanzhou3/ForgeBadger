import assert from "node:assert/strict";
import { it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";

import { NotificationRepository } from "../src/db/repositories/notification-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { SessionRepository } from "../src/db/repositories/session-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { ForgeBadgerEventBus, type ForgeBadgerEvent } from "../src/services/event-bus.js";
import { attachNotificationPersistence } from "../src/services/notification-events.js";
import { ingestTerminalNotification } from "../src/services/terminal-notification-ingestion.js";

it("redacts terminal-native notification text before WebSocket events and persistence", () => {
  const db = new Database(":memory:");
  try {
    migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL("../src/db/migrations", import.meta.url)) });
    const user = new UserRepository(db).create("osc-redaction@example.com", "hash");
    const project = new ProjectRepository(db, user.id).create({
      name: "OSC project", path: "/tmp/osc-project", aiTool: "opencode"
    });
    const session = new SessionRepository(db, user.id).create({
      projectId: project.id, name: "OSC session", aiTool: "opencode", workingDir: project.path
    });
    const eventBus = new ForgeBadgerEventBus();
    attachNotificationPersistence({ db, eventBus });
    const events: ForgeBadgerEvent[] = [];
    eventBus.on("event", event => events.push(event as ForgeBadgerEvent));
    const marker = "sk-FAKEOSCSECRET123456";

    const result = ingestTerminalNotification({
      db, eventBus, sessionId: session.id,
      notification: { kind: "osc", code: 777, title: `Permission ${marker}`, body: "Approve?" }
    });

    assert.deepEqual(result, { handled: true });
    assert.equal(events.length, 2);
    assert.equal(JSON.stringify(events).includes(marker), false);
    assert.equal(JSON.stringify(new NotificationRepository(db, user.id).list()).includes(marker), false);
    const activity = db.prepare("SELECT message FROM session_activities WHERE user_id = ?").all(user.id);
    assert.equal(JSON.stringify(activity).includes(marker), false);
  } finally {
    db.close();
  }
});
