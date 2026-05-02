import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ProjectRepository,
  SessionRepository,
  SessionSnapshotRepository,
  UserRepository
} from "../src/db/repositories/index.js";
import { recordSessionSnapshot } from "../src/services/session-snapshots.js";

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

describe("session snapshots", () => {
  it("records structured session metadata without terminal scrollback", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("snapshot@example.com", "hash");
    const project = new ProjectRepository(db, user.id).create({
      name: "Snapshot Project",
      path: "/tmp/snapshot",
      aiTool: "claude"
    });
    const session = new SessionRepository(db, user.id).create({
      projectId: project.id,
      name: "Snapshot Session",
      aiTool: "claude",
      workingDir: project.path,
      tmuxSession: "of-user-session"
    });

    const snapshot = recordSessionSnapshot({
      db,
      userId: user.id,
      session,
      configVersion: "1.2.3",
      metadata: { reason: "session_started", terminalScrollback: "must not be stored" }
    });

    const stored = new SessionSnapshotRepository(db, user.id).list({ sessionId: session.id });

    assert.equal(snapshot.tmuxSession, "of-user-session");
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.configVersion, "1.2.3");
    assert.equal(stored[0]?.metadata?.includes("terminalScrollback"), false);
    db.close();
  });
});
