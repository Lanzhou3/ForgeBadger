/**
 * handleSessionIdle: the Gateway side of the daemon's `session_idle` push.
 * Only flips a stuck "working" work state back to "idle" — never emits
 * notifications, never touches the DB beyond the session lookup.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { UserRepository } from "../src/db/repositories/user-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { SessionRepository, type Session } from "../src/db/repositories/session-repository.js";
import { ForgeBadgerEventBus } from "../src/services/event-bus.js";
import { handleSessionIdle } from "../src/services/session-idle-handler.js";

function createTestDb(): Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
  return db;
}

describe("handleSessionIdle", () => {
  let db: Database;
  let eventBus: ForgeBadgerEventBus;
  let session: Session;

  beforeEach(() => {
    db = createTestDb();
    eventBus = new ForgeBadgerEventBus();
    const user = new UserRepository(db).create("idle@example.com", "hash");
    const project = new ProjectRepository(db, user.id).create({
      name: "Idle Project",
      path: "/tmp/idle-project",
      aiTool: "kimi"
    });
    session = new SessionRepository(db, user.id).create({
      projectId: project.id,
      name: "Idle session",
      aiTool: "kimi",
      workingDir: project.path,
      attachToken: "idle-token",
      runtimeSessionName: "fb-idle-session"
    });
  });

  afterEach(() => {
    db.close();
  });

  it("flips a working session back to idle", () => {
    eventBus.setSessionWorkState({ userId: session.userId, sessionId: session.id, state: "working" });

    handleSessionIdle({ db, eventBus, sessionId: session.id });

    assert.equal(eventBus.getSessionWorkState(session.userId, session.id)?.state, "idle");
  });

  it("resolves sessions by runtime session name", () => {
    eventBus.setSessionWorkState({ userId: session.userId, sessionId: session.id, state: "working" });

    handleSessionIdle({ db, eventBus, sessionId: "fb-idle-session" });

    assert.equal(eventBus.getSessionWorkState(session.userId, session.id)?.state, "idle");
  });

  it("is a no-op when the session is not working", () => {
    handleSessionIdle({ db, eventBus, sessionId: session.id });

    assert.equal(eventBus.getSessionWorkState(session.userId, session.id), undefined);
  });

  it("is a no-op for unknown sessions", () => {
    assert.doesNotThrow(() => {
      handleSessionIdle({ db, eventBus, sessionId: "no-such-session" });
    });
  });
});
