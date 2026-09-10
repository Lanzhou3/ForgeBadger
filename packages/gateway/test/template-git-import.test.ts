import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { before, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { TemplateRepository } from "../src/db/repositories/template-repository.js";
import {
  deriveTemplateName,
  importTemplateFromGit,
  inferTemplateAdapter,
  TemplateGitImportError
} from "../src/services/template-git-import.js";

function createTestDb(): Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = OFF");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
  db.pragma("foreign_keys = OFF");
  return db;
}

function runFixtureGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
  });
}

async function createGitFixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "forgebadger-tpl-git-fixture-"));
  for (const [filePath, content] of Object.entries(files)) {
    const absolute = path.join(dir, filePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
  }
  runFixtureGit(dir, ["init", "--quiet"]);
  runFixtureGit(dir, ["config", "user.email", "forgebadger-test@example.com"]);
  runFixtureGit(dir, ["config", "user.name", "ForgeBadger Test"]);
  runFixtureGit(dir, ["add", "-A"]);
  runFixtureGit(dir, ["commit", "--quiet", "-m", "fixture"]);
  return dir;
}

describe("deriveTemplateName", () => {
  it("derives the repository name from https urls with a .git suffix", () => {
    assert.equal(deriveTemplateName("https://github.com/acme/team-templates.git"), "team-templates");
  });

  it("derives the repository name from ssh-style urls", () => {
    assert.equal(deriveTemplateName("git@github.com:acme/templates.git"), "templates");
  });

  it("derives the repository name from urls without a .git suffix", () => {
    assert.equal(deriveTemplateName("https://gitlab.example.com/groups/team/repo"), "repo");
  });

  it("falls back to a generic name for empty urls", () => {
    assert.equal(deriveTemplateName("   "), "git-template");
  });
});

describe("inferTemplateAdapter", () => {
  it("prefers opencode markers over other adapters", () => {
    assert.equal(inferTemplateAdapter(["CLAUDE.md", "opencode.json"]), "opencode");
    assert.equal(inferTemplateAdapter([".opencode/agent.md", ".claude/settings.json"]), "opencode");
  });

  it("detects codex markers", () => {
    assert.equal(inferTemplateAdapter(["AGENTS.override.md"]), "codex");
    assert.equal(inferTemplateAdapter([".codex/config.toml", "README.md"]), "codex");
    assert.equal(inferTemplateAdapter([".kimi-code/config.toml", ".codex/config.toml"]), "codex");
  });

  it("detects kimi markers", () => {
    assert.equal(inferTemplateAdapter([".kimi-code/skills/review/SKILL.md"]), "kimi");
    assert.equal(inferTemplateAdapter(["kimi-code.config.json", "README.md"]), "kimi");
  });

  it("detects claude markers", () => {
    assert.equal(inferTemplateAdapter(["CLAUDE.md"]), "claude");
    assert.equal(inferTemplateAdapter([".claude/settings.json"]), "claude");
  });

  it("returns null when no adapter markers are present", () => {
    assert.equal(inferTemplateAdapter(["README.md", "docs/notes.md"]), null);
  });
});

let gitAvailable = true;

before(async () => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
  } catch {
    gitAvailable = false;
  }
});

describe("importTemplateFromGit", () => {
  it(
    "imports a repository as a new template with inferred adapter",
    { skip: !gitAvailable },
    async () => {
      const fixture = await createGitFixture({
        "AGENTS.md": "# Team Conventions\n- Keep PRs small\n",
        ".claude/settings.json": '{\n  "model": "sonnet"\n}\n'
      });
      const db = createTestDb();
      try {
        const repo = new TemplateRepository(db, "git-import-user");
        const result = await importTemplateFromGit(repo, {
          url: fixture,
          name: "Team Conventions",
          description: "Imported from a fixture repository"
        });
        assert.equal(result.adapter, "claude");
        assert.equal(result.fileCount, 2);
        assert.equal(result.skippedFiles.length, 0);
        assert.equal(result.name, "Team Conventions");

        const template = repo.getById(result.templateId);
        assert.ok(template);
        assert.equal(template.name, "Team Conventions");
        assert.equal(template.adapter, "claude");
        assert.equal(template.version, "1.0.0");

        const exported = repo.exportPackage(result.templateId);
        const paths = exported.files.map((file) => file.filePath).sort();
        assert.deepEqual(paths, [".claude/settings.json", "AGENTS.md"]);
        const agents = exported.files.find((file) => file.filePath === "AGENTS.md");
        assert.ok(agents);
        assert.equal(agents.content, "# Team Conventions\n- Keep PRs small\n");
      } finally {
        db.close();
        await rm(fixture, { recursive: true, force: true });
      }
    }
  );

  it(
    "honors the branch parameter and rejects unknown branches",
    { skip: !gitAvailable },
    async () => {
      const fixture = await createGitFixture({
        "CLAUDE.md": "# Rules\n"
      });
      const db = createTestDb();
      try {
        const defaultBranch = runFixtureGit(fixture, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
        const repo = new TemplateRepository(db, "git-import-user");
        const result = await importTemplateFromGit(repo, { url: fixture, branch: defaultBranch });
        assert.equal(result.fileCount, 1);

        await assert.rejects(
          importTemplateFromGit(repo, { url: fixture, branch: "no-such-branch" }),
          (error: unknown) => {
            assert.ok(error instanceof TemplateGitImportError);
            assert.equal(error.status, 400);
            assert.match(error.message, /Failed to clone/);
            return true;
          }
        );
      } finally {
        db.close();
        await rm(fixture, { recursive: true, force: true });
      }
    }
  );

  it(
    "rejects urls that cannot be cloned",
    { skip: !gitAvailable },
    async () => {
      const db = createTestDb();
      try {
        const repo = new TemplateRepository(db, "git-import-user");
        const missing = path.join(tmpdir(), "forgebadger-no-such-repo-xyz");
        await assert.rejects(
          importTemplateFromGit(repo, { url: missing }),
          (error: unknown) => {
            assert.ok(error instanceof TemplateGitImportError);
            assert.equal(error.status, 400);
            assert.match(error.message, /Failed to clone/);
            return true;
          }
        );
      } finally {
        db.close();
      }
    }
  );

  it(
    "rejects repositories without importable files",
    { skip: !gitAvailable },
    async () => {
      const fixture = await createGitFixture({
        "big.txt": "x".repeat(600 * 1024)
      });
      const db = createTestDb();
      try {
        const repo = new TemplateRepository(db, "git-import-user");
        await assert.rejects(
          importTemplateFromGit(repo, { url: fixture }),
          (error: unknown) => {
            assert.ok(error instanceof TemplateGitImportError);
            assert.equal(error.status, 404);
            assert.match(error.message, /No importable files/);
            return true;
          }
        );
      } finally {
        db.close();
        await rm(fixture, { recursive: true, force: true });
      }
    }
  );
});
