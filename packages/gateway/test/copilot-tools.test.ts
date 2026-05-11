import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { UserRepository } from "../src/db/repositories/user-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { ActivityRepository } from "../src/db/repositories/activity-repository.js";
import { createCopilotToolRegistry, executeCopilotTool } from "../src/services/copilot/tool-registry.js";
import { createCopilotReadTools } from "../src/services/copilot/read-tools.js";

const masterKey = "abcdef0123456789abcdef0123456789";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const drizzleDb = drizzle(db);
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/db/migrations"
  );
  migrate(drizzleDb, { migrationsFolder });
  return db;
}

describe("copilot tools", () => {
  let db: Database.Database;
  let userId: string;
  let otherUserId: string;
  let registry: ReturnType<typeof createCopilotToolRegistry>;

  beforeEach(() => {
    db = createTestDb();
    const users = new UserRepository(db);
    userId = users.create("copilot-tools@example.com", "hash").id;
    otherUserId = users.create("other-copilot-tools@example.com", "hash").id;
    registry = createCopilotToolRegistry(createCopilotReadTools());
  });

  it("rejects unknown tools", async () => {
    const result = await executeCopilotTool(registry, "openforge.unknown", {}, context(userId));

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "copilot_tool_not_allowed");
  });

  it("rejects invalid tool input", async () => {
    const result = await executeCopilotTool(
      registry,
      "openforge.get_recent_activity",
      { limit: 10_000 },
      context(userId)
    );

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "copilot_tool_validation_failed");
  });

  it("executes read tools without approval", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });

    const result = await executeCopilotTool(registry, "openforge.list_projects", {}, context(userId));

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.requiresApproval, false);
    assert.equal((result.output as { projects: Array<{ id: string }> }).projects[0]?.id, project.id);
  });

  it("redacts tool outputs before returning them", async () => {
    new ActivityRepository(db, userId).create({
      type: "copilot_test",
      message: "Bearer abc.def sk-test123456789",
      metadata: { OPENFORGE_ATTACH_TOKEN: "secret-token" }
    });

    const result = await executeCopilotTool(
      registry,
      "openforge.get_recent_activity",
      { limit: 1 },
      context(userId)
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    const json = JSON.stringify(result.output);
    assert.match(json, /Bearer \[REDACTED\]/);
    assert.match(json, /sk-\[REDACTED\]/);
    assert.doesNotMatch(json, /secret-token/);
  });

  it("keeps read tools tenant-scoped", async () => {
    new ProjectRepository(db, userId).create({
      name: "Owned",
      path: "/tmp/owned",
      aiTool: "claude"
    });
    new ProjectRepository(db, otherUserId).create({
      name: "Foreign",
      path: "/tmp/foreign",
      aiTool: "codex"
    });

    const result = await executeCopilotTool(registry, "openforge.list_projects", {}, context(userId));

    assert.equal(result.ok, true);
    if (!result.ok) return;
    const names = (result.output as { projects: Array<{ name: string }> }).projects.map((project) => project.name);
    assert.deepEqual(names, ["Owned"]);
  });

  function context(id: string) {
    return { db, userId: id, masterKey };
  }
});
