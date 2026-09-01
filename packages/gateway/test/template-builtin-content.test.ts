import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { TemplateRepository } from "../src/db/repositories/template-repository.js";
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

describe("built-in Claude template surface", () => {
  it("keeps CLAUDE.md within the 200-line budget", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("builtin-surface@example.com", "hash");
    const repo = new TemplateRepository(db, user.id);
    repo.listBuiltIn();

    const withFiles = repo.getById("builtin-claude-code");
    const claudeMd = withFiles?.files?.find((file) => file.filePath === "CLAUDE.md")?.content ?? "";
    assert.ok(claudeMd.length > 0);
    assert.ok(claudeMd.split("\n").length <= 200);
    db.close();
  });

  it("no longer ships CHANGELOG.md or CONTRIBUTING.md", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("builtin-surface2@example.com", "hash");
    const repo = new TemplateRepository(db, user.id);
    repo.listBuiltIn();

    const withFiles = repo.getById("builtin-claude-code");
    const filePaths = (withFiles?.files ?? []).map((file) => file.filePath);
    assert.equal(filePaths.includes("CHANGELOG.md"), false);
    assert.equal(filePaths.includes("CONTRIBUTING.md"), false);
    assert.ok(filePaths.includes("CLAUDE.md"));
    assert.ok(filePaths.includes(".claude/rules/security.md"));
    assert.ok(filePaths.includes("WORKFLOW.md"));
    assert.ok(filePaths.includes("PLAN.md"));
    db.close();
  });

  it("advanced the built-in version to 2.2.0", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("builtin-surface3@example.com", "hash");
    const repo = new TemplateRepository(db, user.id);
    repo.listBuiltIn();

    assert.equal(repo.getBuiltInClaude().version, "2.2.0");
    db.close();
  });

  it("describes terminal persistence without assuming tmux on native Windows", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("builtin-terminal-runtime@example.com", "hash");
    const repo = new TemplateRepository(db, user.id);
    repo.listBuiltIn();

    for (const templateId of ["builtin-claude-code", "builtin-opencode", "builtin-codex", "builtin-kimi"]) {
      const content = (repo.getById(templateId)?.files ?? []).map((file) => file.content).join("\n");
      assert.doesNotMatch(content, /Terminal sessions are tmux-backed/);
      assert.match(content, /tmux on macOS\/Linux.*psmux on Windows/i);
    }
    db.close();
  });

  it("seeds the built-in Kimi Code template with AGENTS.md and .kimi-code agents", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("builtin-kimi@example.com", "hash");
    const repo = new TemplateRepository(db, user.id);
    repo.listBuiltIn();

    const withFiles = repo.getById("builtin-kimi");
    assert.equal(withFiles?.name, "Kimi Code");
    const filePaths = (withFiles?.files ?? []).map((file) => file.filePath);
    assert.ok(filePaths.includes("AGENTS.md"));
    assert.ok(filePaths.includes(".kimi-code/agents/code-reviewer.md"));
    assert.ok(filePaths.includes(".kimi-code/agents/planner.md"));
    db.close();
  });
});
