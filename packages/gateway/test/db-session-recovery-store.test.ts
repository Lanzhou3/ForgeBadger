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
    assert.equal(listed[0]?.createdAt, session.createdAt.toISOString());

    db.prepare("UPDATE sessions SET created_at = ? WHERE id = ?")
      .run(session.createdAt.getTime(), session.id);
    const legacyMillisecondRow = await store.listSessions();
    assert.equal(legacyMillisecondRow[0]?.createdAt, session.createdAt.toISOString());

    await store.upsertSession({
      ...listed[0]!,
      attachToken: "attach-new",
      tmuxName: "of-user-session-new"
    });

    const updated = repo.getById(session.id);
    assert.equal(updated?.attachToken, "attach-new");
    assert.equal(updated?.tmuxSession, "of-user-session-new");
    assert.equal(updated?.status, "running");
    const rawUpdated = db.prepare("SELECT updated_at FROM sessions WHERE id = ?")
      .get(session.id) as { updated_at: number };
    assert.ok(rawUpdated.updated_at < 100_000_000_000, "session timestamps must use Unix seconds");

    await store.removeSession(session.id, "other-user");

    assert.equal(repo.getById(session.id)?.tmuxSession, "of-user-session-new");

    await store.removeSession(session.id, user.id);

    assert.deepEqual(await store.listSessions(), []);
    assert.equal(repo.getById(session.id)?.tmuxSession, null);
  });

  it("encrypts the attach token at rest when a master key is configured", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("encrypted@example.com", "hash");
    const project = new ProjectRepository(db, user.id).create({
      name: "Encrypted Project",
      path: "/tmp/encrypted-project",
      aiTool: "claude"
    });
    const repo = new SessionRepository(db, user.id);
    const session = repo.create({
      projectId: project.id,
      name: "Encrypted",
      aiTool: "claude",
      workingDir: project.path,
      attachToken: "plaintext-token",
      tmuxSession: "of-enc-session",
      credentialMode: "host_environment"
    });

    const masterKey = "a".repeat(64); // 64 hex chars
    const store = createDbSessionRecoveryStore(db, masterKey);

    await store.upsertSession({
      id: session.id,
      userId: user.id,
      attachToken: "secret-attach-token",
      tmuxName: "of-enc-session",
      launchPlan: {
        command: "claude",
        args: [],
        cwd: project.path,
        env: { FORGEBADGER_SESSION_ID: session.id },
        secretEnvNames: [],
        credentialMode: "host_environment"
      },
      createdAt: new Date().toISOString()
    });

    // DB must NOT hold the plaintext.
    const row = db.prepare("SELECT attach_token FROM sessions WHERE id = ?").get(session.id) as {
      attach_token: string;
    };
    assert.ok(!row.attach_token.includes("secret-attach-token"), "DB must not store plaintext attach token");
    assert.ok(row.attach_token.startsWith("enc:"), "encrypted token should carry the enc: prefix");

    // Reading back decrypts to the original.
    const listed = await store.listSessions();
    assert.equal(listed[0]?.attachToken, "secret-attach-token");

    db.close();
  });

  it("reads legacy plaintext attach tokens without a master key", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("legacy@example.com", "hash");
    const project = new ProjectRepository(db, user.id).create({
      name: "Legacy Project",
      path: "/tmp/legacy-project",
      aiTool: "claude"
    });
    const repo = new SessionRepository(db, user.id);
    repo.create({
      projectId: project.id,
      name: "Legacy",
      aiTool: "claude",
      workingDir: project.path,
      attachToken: "legacy-plaintext",
      tmuxSession: "of-legacy-session",
      credentialMode: "host_environment"
    });

    const store = createDbSessionRecoveryStore(db);
    const listed = await store.listSessions();
    assert.equal(listed[0]?.attachToken, "legacy-plaintext");

    db.close();
  });
});
