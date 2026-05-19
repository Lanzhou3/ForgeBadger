import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ProjectRepository, SessionRepository, UserRepository } from "../src/db/repositories/index.js";
import { createDbSessionRecoveryStore } from "../src/services/db-session-recovery-store.js";

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

describe("DbSessionRecoveryStore", () => {
  it("uses the sessions table as the tmux recovery index", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("recovery@example.com", "hash");
    const project = new ProjectRepository(db, user.id).create({
      name: "Recovery Project",
      path: "/tmp/recovery-project",
      aiTool: "claude"
    });
    const repo = new SessionRepository(db, user.id);
    const session = repo.create({
      projectId: project.id,
      name: "Recoverable",
      aiTool: "claude",
      workingDir: project.path,
      attachToken: "attach-old",
      tmuxSession: "of-user-session",
      credentialMode: "host_environment"
    });
    const store = createDbSessionRecoveryStore(db);

    const listed = await store.listSessions();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.id, session.id);
    assert.equal(listed[0]?.userId, user.id);
    assert.equal(listed[0]?.attachToken, "attach-old");
    assert.equal(listed[0]?.tmuxName, "of-user-session");
    assert.equal(listed[0]?.launchPlan.command, "claude");
    assert.equal(listed[0]?.launchPlan.cwd, project.path);

    await store.upsertSession({
      ...listed[0]!,
      attachToken: "attach-new",
      tmuxName: "of-user-session-new"
    });

    const updated = repo.getById(session.id);
    assert.equal(updated?.attachToken, "attach-new");
    assert.equal(updated?.tmuxSession, "of-user-session-new");
    assert.equal(updated?.status, "running");

    await store.removeSession(session.id, "other-user");

    assert.equal(repo.getById(session.id)?.tmuxSession, "of-user-session-new");

    await store.removeSession(session.id, user.id);

    assert.deepEqual(await store.listSessions(), []);
    assert.equal(repo.getById(session.id)?.tmuxSession, null);
  });
});
