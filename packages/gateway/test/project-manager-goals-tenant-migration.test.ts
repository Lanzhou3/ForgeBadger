import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const migrationSql = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/db/migrations/0065_project_manager_goals_tenant_fk.sql"
  ),
  "utf8"
);

describe("0065 project manager goals tenant foreign key", () => {
  it("preserves valid goals and enforces project ownership", () => {
    const db = createLegacyFixture();
    db.prepare("INSERT INTO project_manager_goals (id, user_id, project_id, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("goal-1", "user-1", "project-1", "Keep me", 1, 1);

    db.transaction(() => db.exec(migrationSql))();

    assert.equal(db.prepare("SELECT summary FROM project_manager_goals WHERE id = ?").pluck().get("goal-1"), "Keep me");
    assert.throws(
      () => db.prepare("INSERT INTO project_manager_goals (id, user_id, project_id, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run("goal-cross", "user-1", "project-2", "Reject me", 2, 2),
      /FOREIGN KEY constraint failed/u
    );
    db.close();
  });

  it("fails before rebuilding when legacy data is cross-tenant", () => {
    const db = createLegacyFixture();
    db.pragma("foreign_keys = OFF");
    db.prepare("INSERT INTO project_manager_goals (id, user_id, project_id, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("goal-cross", "user-1", "project-2", "Legacy conflict", 1, 1);

    assert.throws(
      () => db.transaction(() => db.exec(migrationSql))(),
      /CHECK constraint failed/u
    );
    assert.equal(db.prepare("SELECT summary FROM project_manager_goals WHERE id = ?").pluck().get("goal-cross"), "Legacy conflict");
    db.close();
  });
});

function createLegacyFixture(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (id text PRIMARY KEY NOT NULL);
    CREATE TABLE projects (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      UNIQUE (user_id, id),
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );
    CREATE TABLE project_manager_goals (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      project_id text NOT NULL,
      summary text NOT NULL,
      constraints_json text NOT NULL DEFAULT '[]',
      acceptance_criteria_json text NOT NULL DEFAULT '[]',
      details_json text NOT NULL DEFAULT '{}',
      status text NOT NULL DEFAULT 'active',
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX idx_project_manager_goals_user_project
      ON project_manager_goals (user_id, project_id);
    INSERT INTO users (id) VALUES ('user-1'), ('user-2');
    INSERT INTO projects (id, user_id) VALUES ('project-1', 'user-1'), ('project-2', 'user-2');
  `);
  return db;
}
