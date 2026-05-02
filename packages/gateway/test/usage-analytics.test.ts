import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ModelRepository,
  ProjectRepository,
  SessionRepository,
  UsageRepository,
  UserRepository
} from "../src/db/repositories/index.js";

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

describe("usage analytics", () => {
  it("summarizes session duration and estimated model cost", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("usage@example.com", "hash");
    const project = new ProjectRepository(db, user.id).create({
      name: "Usage Project",
      path: "/tmp/usage",
      aiTool: "opencode"
    });
    const model = new ModelRepository(db, user.id).create({
      name: "Usage Model",
      provider: "anthropic",
      modelId: "claude-sonnet-4-5"
    });
    const session = new SessionRepository(db, user.id).create({
      projectId: project.id,
      name: "Usage Session",
      aiTool: "opencode",
      workingDir: project.path,
      modelId: model.id
    });
    const startedAt = new Date("2026-05-02T00:00:00.000Z");
    const stoppedAt = new Date("2026-05-02T02:00:00.000Z");
    db.prepare("UPDATE sessions SET created_at = ?, last_active = ? WHERE id = ?").run(
      Math.floor(startedAt.getTime() / 1000),
      Math.floor(stoppedAt.getTime() / 1000),
      session.id
    );

    const repo = new UsageRepository(db, user.id);
    repo.setModelRate(model.id, 1.5);
    const summary = repo.getSummary(new Date("2026-05-02T03:00:00.000Z"));

    assert.equal(summary.totalSessions, 1);
    assert.equal(summary.totalDurationMs, 2 * 60 * 60 * 1000);
    assert.equal(summary.estimatedCostUsd, 3);
    assert.equal(summary.costLabel, "estimated");
    assert.equal(summary.byAdapter[0]?.adapter, "opencode");
    db.close();
  });
});
