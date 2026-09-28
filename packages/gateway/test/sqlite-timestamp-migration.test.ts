import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

describe("SQLite timestamp migration", () => {
  it("normalizes only millisecond values in mixed-unit timestamp columns", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE sessions (id text PRIMARY KEY, updated_at integer);
      CREATE TABLE notifications (id text PRIMARY KEY, updated_at integer);
      INSERT INTO sessions (id, updated_at) VALUES
        ('seconds', 1788134400),
        ('milliseconds', 1788134400123),
        ('empty', NULL);
      INSERT INTO notifications (id, updated_at) VALUES
        ('seconds', 1788134400),
        ('milliseconds', 1788134400456);
    `);

    db.exec(readMigration("0064_normalize_mixed_timestamp_units.sql"));

    assert.deepEqual(
      db.prepare("SELECT id, updated_at AS updatedAt FROM sessions ORDER BY id").all(),
      [
        { id: "empty", updatedAt: null },
        { id: "milliseconds", updatedAt: 1788134400 },
        { id: "seconds", updatedAt: 1788134400 }
      ]
    );
    assert.deepEqual(
      db.prepare("SELECT id, updated_at AS updatedAt FROM notifications ORDER BY id").all(),
      [
        { id: "milliseconds", updatedAt: 1788134400 },
        { id: "seconds", updatedAt: 1788134400 }
      ]
    );
  });
});

function readMigration(fileName: string): string {
  return readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations", fileName),
    "utf8"
  );
}
