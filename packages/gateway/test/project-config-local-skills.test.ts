import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { buildProjectConfigRenderPlan } from "../src/routes/projects.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { TemplateRepository } from "../src/db/repositories/template-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";

describe("project config render plan local Skills", () => {
  it("includes a locally discovered Skill in the first plan and remains stable after a repeat sync", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("config-local-skill@example.com", "hash");
    new TemplateRepository(db, user.id).listBuiltIn();
    const project = new ProjectRepository(db, user.id).create({
      name: "Local Skill Project",
      path: await mkdtemp(path.join(tmpdir(), "openforge-local-skill-plan-")),
      aiTool: "claude",
      templateId: "builtin-claude-code"
    });
    const syncSkills = (repo: { getByName(name: string): unknown; create(input: {
      name: string;
      source: "local";
      content: string;
    }): unknown }) => {
      if (!repo.getByName("local-review")) {
        repo.create({ name: "local-review", source: "local", content: "# Local Review\n" });
      }
    };

    const first = await buildProjectConfigRenderPlan(
      db,
      user.id,
      project.id,
      "builtin-claude-code",
      "host_environment",
      true,
      { syncSkills }
    );
    const second = await buildProjectConfigRenderPlan(
      db,
      user.id,
      project.id,
      "builtin-claude-code",
      "host_environment",
      true,
      { syncSkills }
    );

    const expectedSkill = ".claude/skills/local-review/SKILL.md";
    assert.ok(first.files.some((file) => file.relativePath === expectedSkill));
    assert.deepEqual(
      first.files.map((file) => file.relativePath),
      second.files.map((file) => file.relativePath)
    );
    db.close();
  });
});

function createTestDb(): Database {
  const db = new Database(":memory:");
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");
  migrate(drizzle(db), { migrationsFolder });
  return db;
}
