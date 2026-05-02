import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ProjectRepository,
  ProjectSkillRepository,
  SkillRepository,
  TemplateRepository,
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

describe("team library visibility foundations", () => {
  it("lets users read shared Skills without allowing ownership mutation", () => {
    const db = createTestDb();
    const userA = new UserRepository(db).create("skill-owner@example.com", "hash");
    const userB = new UserRepository(db).create("skill-reader@example.com", "hash");
    const ownerRepo = new SkillRepository(db, userA.id);
    const readerRepo = new SkillRepository(db, userB.id);

    const shared = ownerRepo.create({
      name: "Shared Review",
      content: "# Shared",
      visibility: "shared"
    });

    assert.ok(readerRepo.list().some((skill) => skill.id === shared.id));
    assert.equal(readerRepo.update(shared.id, { name: "stolen" }), undefined);
    db.close();
  });

  it("limits admin-visible Skills to owners and admin users", () => {
    const db = createTestDb();
    const owner = new UserRepository(db).create("skill-admin-owner@example.com", "hash");
    const admin = new UserRepository(db).create("skill-admin@example.com", "hash");
    const reader = new UserRepository(db).create("skill-normal-reader@example.com", "hash");
    db.prepare("UPDATE users SET role = ? WHERE id = ?").run("admin", admin.id);

    const adminOnly = new SkillRepository(db, owner.id).create({
      name: "Admin Skill",
      content: "# Admin",
      visibility: "admin"
    });

    assert.ok(new SkillRepository(db, owner.id).list().some((skill) => skill.id === adminOnly.id));
    assert.ok(new SkillRepository(db, admin.id).list().some((skill) => skill.id === adminOnly.id));
    assert.equal(new SkillRepository(db, reader.id).list().some((skill) => skill.id === adminOnly.id), false);
    assert.equal(new SkillRepository(db, admin.id).update(adminOnly.id, { name: "stolen" }), undefined);
    db.close();
  });

  it("includes shared Skills when listing project Skills for configuration injection", () => {
    const db = createTestDb();
    const owner = new UserRepository(db).create("shared-project-skill-owner@example.com", "hash");
    const reader = new UserRepository(db).create("shared-project-skill-reader@example.com", "hash");
    const shared = new SkillRepository(db, owner.id).create({
      name: "Shared Project Skill",
      content: "# Shared Project Skill",
      visibility: "shared"
    });
    const project = new ProjectRepository(db, reader.id).create({
      name: "Reader Project",
      path: "/tmp/openforge-shared-project-skill",
      aiTool: "claude"
    });

    const projectSkills = new ProjectSkillRepository(db, reader.id);
    projectSkills.setSkill(project.id, shared.id, true);

    assert.ok(projectSkills.listByProject(project.id).some((skill) => skill.skillId === shared.id));
    db.close();
  });

  it("includes admin Skills in project Skill listings only for admin users", () => {
    const db = createTestDb();
    const owner = new UserRepository(db).create("admin-project-skill-owner@example.com", "hash");
    const admin = new UserRepository(db).create("admin-project-skill-reader@example.com", "hash");
    const reader = new UserRepository(db).create("normal-project-skill-reader@example.com", "hash");
    db.prepare("UPDATE users SET role = ? WHERE id = ?").run("admin", admin.id);
    const adminOnly = new SkillRepository(db, owner.id).create({
      name: "Admin Project Skill",
      content: "# Admin Project Skill",
      visibility: "admin"
    });
    const adminProject = new ProjectRepository(db, admin.id).create({
      name: "Admin Project",
      path: "/tmp/openforge-admin-project-skill",
      aiTool: "claude"
    });
    const readerProject = new ProjectRepository(db, reader.id).create({
      name: "Reader Project",
      path: "/tmp/openforge-normal-project-skill",
      aiTool: "claude"
    });

    const adminProjectSkills = new ProjectSkillRepository(db, admin.id);
    const readerProjectSkills = new ProjectSkillRepository(db, reader.id);
    adminProjectSkills.setSkill(adminProject.id, adminOnly.id, true);
    readerProjectSkills.setSkill(readerProject.id, adminOnly.id, true);

    assert.ok(adminProjectSkills.listByProject(adminProject.id).some((skill) => skill.skillId === adminOnly.id));
    assert.equal(readerProjectSkills.listByProject(readerProject.id).some((skill) => skill.skillId === adminOnly.id), false);
    db.close();
  });

  it("lets users read shared Templates without allowing ownership mutation", () => {
    const db = createTestDb();
    const userA = new UserRepository(db).create("template-owner@example.com", "hash");
    const userB = new UserRepository(db).create("template-reader@example.com", "hash");
    const ownerRepo = new TemplateRepository(db, userA.id);
    const readerRepo = new TemplateRepository(db, userB.id);

    const shared = ownerRepo.create({
      name: "Shared Template",
      visibility: "shared",
      files: [{ filePath: ".claude/CLAUDE.md", content: "# Shared", fileType: "markdown" }]
    });

    assert.ok(readerRepo.list().some((template) => template.id === shared.id));
    assert.equal(readerRepo.update(shared.id, { name: "stolen" }), undefined);
    db.close();
  });

  it("limits admin-visible Templates to owners and admin users", () => {
    const db = createTestDb();
    const owner = new UserRepository(db).create("template-admin-owner@example.com", "hash");
    const admin = new UserRepository(db).create("template-admin@example.com", "hash");
    const reader = new UserRepository(db).create("template-normal-reader@example.com", "hash");
    db.prepare("UPDATE users SET role = ? WHERE id = ?").run("admin", admin.id);

    const adminOnly = new TemplateRepository(db, owner.id).create({
      name: "Admin Template",
      visibility: "admin",
      files: [{ filePath: ".claude/CLAUDE.md", content: "# Admin", fileType: "markdown" }]
    });

    assert.ok(new TemplateRepository(db, owner.id).list().some((template) => template.id === adminOnly.id));
    assert.ok(new TemplateRepository(db, admin.id).list().some((template) => template.id === adminOnly.id));
    assert.equal(new TemplateRepository(db, reader.id).list().some((template) => template.id === adminOnly.id), false);
    assert.equal(new TemplateRepository(db, admin.id).update(adminOnly.id, { name: "stolen" }), undefined);
    db.close();
  });
});
