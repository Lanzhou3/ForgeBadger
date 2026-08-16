import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { UserRepository } from "../src/db/repositories/user-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { ModelProviderRepository } from "../src/db/repositories/model-provider-repository.js";
import { ApiKeyRepository } from "../src/db/repositories/api-key-repository.js";
import { SessionRepository } from "../src/db/repositories/session-repository.js";
import { SkillRepository } from "../src/db/repositories/skill-repository.js";
import { getDashboardSummary } from "../src/services/dashboard-summary.js";

const masterKey = "abcdef0123456789abcdef0123456789";

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

describe("getDashboardSummary", () => {
  it("reports empty tenant stats and setup health gaps", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("empty@example.com", "hash");

    const summary = getDashboardSummary(db, user.id, masterKey);

    assert.deepEqual(summary.stats, {
      projects: 0,
      sessions: 0,
      runningSessions: 0,
      skills: 0,
      models: 0,
      apiKeys: 0,
      templates: 4
    });
    assert.equal(summary.health.gateway.healthy, true);
    assert.equal(summary.health.database.healthy, true);
    assert.equal(summary.health.projectConfig.healthy, false);
    assert.equal(summary.health.models.healthy, false);
    assert.equal(summary.health.credentials.healthy, false);
  });

  it("reports tenant-owned resources as healthy when configured", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("ready@example.com", "hash");
    const projectRoot = await mkdtemp(path.join(tmpdir(), "openforge-dashboard-"));
    const project = new ProjectRepository(db, user.id).create({
      name: "Ready",
      path: projectRoot,
      aiTool: "claude"
    });
    const providerRepo = new ModelProviderRepository(db, user.id, masterKey);
    const provider = providerRepo.createProviderProfile({
      providerKey: "anthropic",
      name: "Anthropic",
      authType: "api_key",
      apiFormat: "anthropic",
      supportedAdapters: ["claude"]
    });
    const model = providerRepo.createModelProfile({
      providerProfileId: provider.id,
      name: "Sonnet",
      modelId: "claude-sonnet"
    });
    new ApiKeyRepository(db, user.id, masterKey).create({
      provider: "anthropic",
      plaintextKey: "test-api-key-test",
      label: "local"
    });
    new SessionRepository(db, user.id).create({
      projectId: project.id,
      name: "Ready",
      aiTool: "claude",
      modelId: model.id,
      workingDir: projectRoot
    });
    new SkillRepository(db, user.id).create({
      name: "safe-review",
      content: "# Safe Review"
    });

    const summary = getDashboardSummary(db, user.id, masterKey);

    assert.equal(summary.stats.projects, 1);
    assert.equal(summary.stats.sessions, 1);
    assert.equal(summary.stats.skills, 1);
    assert.equal(summary.stats.models, 1);
    assert.equal(summary.stats.apiKeys, 1);
    assert.equal(summary.health.projectConfig.healthy, true);
    assert.equal(summary.health.models.healthy, true);
    assert.equal(summary.health.credentials.healthy, true);
    assert.equal(summary.health.sessions.healthy, true);
    assert.equal(summary.health.skills.healthy, true);
  });
});
