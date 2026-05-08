import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function runMigrationTwice(db: Database): void {
  const drizzleDb = drizzle(db);
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/db/migrations"
  );
  migrate(drizzleDb, { migrationsFolder });
}

describe("db schema", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("creates all expected tables after migration", () => {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle_%' ORDER BY name"
      )
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    assert.deepEqual(names, [
      "agents",
      "api_keys",
      "audit_logs",
      "catalog_items",
      "catalog_sources",
      "model_cost_rates",
      "model_profiles",
      "model_provider_profiles",
      "models",
      "notifications",
      "plugins",
      "project_agent_sequences",
      "project_skills",
      "projects",
      "provider_credentials",
      "session_activities",
      "session_snapshots",
      "sessions",
      "skills",
      "template_files",
      "templates",
      "user_settings",
      "users"
    ]);
  });

  it("rejects duplicate emails due to unique constraint", () => {
    db.prepare(
      "INSERT INTO users (id, username, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("u1", "alice", "alice@example.com", "hash", "user", "active");

    assert.throws(
      () => {
        db.prepare(
          "INSERT INTO users (id, username, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?)"
        ).run("u2", "bob", "alice@example.com", "hash", "user", "active");
      },
      /UNIQUE constraint failed/
    );
  });

  it("rejects duplicate usernames due to unique constraint", () => {
    db.prepare(
      "INSERT INTO users (id, username, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("u1", "alice", "alice@example.com", "hash", "user", "active");

    assert.throws(
      () => {
        db.prepare(
          "INSERT INTO users (id, username, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?)"
        ).run("u2", "alice", "bob@example.com", "hash", "user", "active");
      },
      /UNIQUE constraint failed/
    );
  });

  it("cascades user deletion to projects", () => {
    db.prepare(
      "INSERT INTO users (id, username, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("u1", "alice", "alice@example.com", "hash", "user", "active");

    db.prepare(
      "INSERT INTO projects (id, user_id, name, path, ai_tool, status) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("p1", "u1", "proj", "/tmp/proj", "claude", "active");

    const before = db.prepare("SELECT * FROM projects WHERE user_id = ?").all("u1") as unknown[];
    assert.equal(before.length, 1);

    db.prepare("DELETE FROM users WHERE id = ?").run("u1");

    const after = db.prepare("SELECT * FROM projects WHERE user_id = ?").all("u1") as unknown[];
    assert.equal(after.length, 0);
  });

  it("is idempotent when running migrations twice", () => {
    assert.doesNotThrow(() => runMigrationTwice(db));
  });
});
