import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/db/migrations"
);

/** Runs a single migration file's statements against a raw better-sqlite3 db. */
function runMigration(db: Database.Database, filename: string): void {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, filename), "utf8");
  const statements = sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) {
    db.exec(statement);
  }
}

describe("claude_route_assignments migration 0143 (failover list)", () => {
  it("carries the legacy single assignment over as position 1", () => {
    const db = new Database(":memory:");
    // Old-shape table exactly as created by migration 0073. better-sqlite3
    // enables the foreign_keys pragma by default, so the referenced tables
    // must exist for the INSERT ... SELECT to run.
    db.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE model_provider_profiles (id TEXT PRIMARY KEY);
      CREATE TABLE provider_credentials (id TEXT PRIMARY KEY);
      CREATE TABLE claude_route_assignments (
        user_id text PRIMARY KEY NOT NULL,
        provider_profile_id text NOT NULL,
        credential_id text NOT NULL,
        updated_at integer NOT NULL
      );
    `);
    db.prepare("INSERT INTO users (id) VALUES ('u1')").run();
    db.prepare("INSERT INTO model_provider_profiles (id) VALUES ('p1'), ('p2'), ('p3')").run();
    db.prepare("INSERT INTO provider_credentials (id) VALUES ('c1'), ('c2'), ('c3'), ('c9')").run();
    db.prepare("INSERT INTO claude_route_assignments (user_id, provider_profile_id, credential_id, updated_at) VALUES ('u1', 'p1', 'c1', 123)").run();

    runMigration(db, "0143_claude_route_failover.sql");

    const rows = db.prepare("SELECT * FROM claude_route_assignments ORDER BY position").all() as Array<Record<string, unknown>>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.user_id, "u1");
    assert.equal(rows[0]!.provider_profile_id, "p1");
    assert.equal(rows[0]!.credential_id, "c1");
    assert.equal(rows[0]!.position, 1);
    assert.equal(rows[0]!.updated_at, 123);

    // New shape: composite PK per user+provider, unique position per user.
    db.prepare("INSERT INTO claude_route_assignments (user_id, provider_profile_id, credential_id, position, updated_at) VALUES ('u1', 'p2', 'c2', 2, 5)").run();
    assert.throws(() => {
      db.prepare("INSERT INTO claude_route_assignments (user_id, provider_profile_id, credential_id, position, updated_at) VALUES ('u1', 'p3', 'c3', 2, 5)").run();
    }, /UNIQUE constraint failed/);
    assert.throws(() => {
      db.prepare("INSERT INTO claude_route_assignments (user_id, provider_profile_id, credential_id, position, updated_at) VALUES ('u1', 'p1', 'c9', 3, 5)").run();
    }, /UNIQUE constraint failed/);
    db.close();
  });
});
