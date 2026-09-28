import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { TemplateRepository } from "../src/db/repositories/template-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";

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

describe("template usageCount derivation", () => {
  let db: Database;
  let userAId: string;
  let userBId: string;

  before(() => {
    db = createTestDb();
    const userRepo = new UserRepository(db);
    userAId = userRepo.create("a@example.com", "hash-a").id;
    userBId = userRepo.create("b@example.com", "hash-b").id;
  });

  after(() => {
    db.close();
  });

  function builtinClaude() {
    return new TemplateRepository(db, userAId)
      .listBuiltIn()
      .find((template) => template.id === "builtin-claude-code");
  }

  it("returns zero usage for built-ins before any project uses them", () => {
    const templates = new TemplateRepository(db, userAId).listBuiltIn();
    for (const template of templates) {
      assert.equal(template.usageCount, 0);
    }
  });

  it("counts a project created with the template once", () => {
    const repo = new TemplateRepository(db, userAId);
    const projectRepo = new ProjectRepository(db, userAId);
    projectRepo.create({
      name: "p1",
      path: "/tmp/p1",
      aiTool: "claude",
      templateId: "builtin-claude-code"
    });

    assert.equal(builtinClaude()?.usageCount, 1);
    assert.equal(
      repo.getById("builtin-claude-code")?.usageCount,
      1,
      "getById must apply the same derivation"
    );
    assert.equal(repo.getBuiltInClaude().usageCount, 1);
  });

  it("does not count other tenants' projects", () => {
    new ProjectRepository(db, userBId).create({
      name: "p2",
      path: "/tmp/p2",
      aiTool: "claude",
      templateId: "builtin-claude-code"
    });

    assert.equal(builtinClaude()?.usageCount, 1);
    const bTemplates = new TemplateRepository(db, userBId).listBuiltIn();
    assert.equal(
      bTemplates.find((template) => template.id === "builtin-claude-code")?.usageCount,
      1
    );
  });

  it("ignores stale persisted usage_count column values", () => {
    const persisted = db
      .prepare("UPDATE templates SET usage_count = 42 WHERE id = 'builtin-claude-code'")
      .run();
    assert.equal(persisted.changes, 1);

    assert.equal(builtinClaude()?.usageCount, 1);
  });

  it("counts custom templates through list()", () => {
    const repo = new TemplateRepository(db, userAId);
    const created = repo.create({ name: "custom-a" });
    const projectRepo = new ProjectRepository(db, userAId);
    projectRepo.create({
      name: "p3",
      path: "/tmp/p3",
      aiTool: "opencode",
      templateId: created.id
    });

    const listed = new TemplateRepository(db, userAId).list();
    assert.equal(listed.find((template) => template.id === created.id)?.usageCount, 1);
  });

  it("returns zero after the last project using the template is deleted", () => {
    const projectRepo = new ProjectRepository(db, userAId);
    const project = new ProjectRepository(db, userAId)
      .list()
      .find((candidate) => candidate.templateId === "builtin-claude-code");
    assert.ok(project);
    projectRepo.delete(project.id);

    assert.equal(builtinClaude()?.usageCount, 0);
  });
});