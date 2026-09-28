import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import {
  createInitRenderPlan,
  listAvailableTemplates,
  parseForgeBadgerCliArgs,
  runForgeBadgerCli
} from "../src/cli/init.js";
import { TemplateRepository } from "../src/db/repositories/template-repository.js";
import type { Database } from "../src/db/types.js";

function migrationsFolder(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");
}

function createMigratedDatabase(dbPath: string): Database {
  const db = new BetterSqlite3(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = OFF");
  migrate(drizzle(db), { migrationsFolder: migrationsFolder() });
  db.pragma("foreign_keys = OFF");
  return db;
}

async function withTemplateDatabase<T>(
  fn: (
    env: { FORGEBADGER_DB_PATH: string },
    repo: TemplateRepository,
    db: Database
  ) => Promise<T> | T
): Promise<T> {
  const stateDir = await mkdtemp(path.join(tmpdir(), "forgebadger-cli-init-db-"));
  const dbPath = path.join(stateDir, "forgebadger.db");
  const db = createMigratedDatabase(dbPath);
  try {
    return await fn({ FORGEBADGER_DB_PATH: dbPath }, new TemplateRepository(db, "test-user"), db);
  } finally {
    db.close();
    await rm(stateDir, { recursive: true, force: true });
  }
}

describe("forgebadger init CLI prototype", () => {
  it("parses init arguments with template id and dry-run", () => {
    const command = parseForgeBadgerCliArgs([
      "init",
      "--path",
      "/tmp/demo",
      "--template-id",
      "builtin-claude-code",
      "--dry-run"
    ]);

    assert.deepEqual(command, {
      command: "init",
      projectPath: "/tmp/demo",
      templateId: "builtin-claude-code",
      credentialMode: "host_environment",
      listTemplates: false,
      dryRun: true
    });

    assert.equal(
      parseForgeBadgerCliArgs(["--", "init", "--path", "/tmp/demo"]).projectPath,
      "/tmp/demo"
    );
  });

  it("parses --list-templates without requiring --path", () => {
    assert.deepEqual(parseForgeBadgerCliArgs(["init", "--list-templates"]), {
      command: "init",
      projectPath: null,
      templateId: "builtin-claude-code",
      credentialMode: "host_environment",
      listTemplates: true,
      dryRun: false
    });
  });

  it("rejects init without --path when not listing templates", () => {
    assert.throws(() => parseForgeBadgerCliArgs(["init"]), /--path/);
  });

  it("creates a dry-run render plan from the built-in template", async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), "forgebadger-cli-init-"));
    const stateDir = await mkdtemp(path.join(tmpdir(), "forgebadger-cli-init-db-"));
    try {
      const plan = await createInitRenderPlan({
        projectPath,
        templateId: "builtin-claude-code",
        credentialMode: "host_environment",
        dryRun: true,
        env: { FORGEBADGER_DB_PATH: path.join(stateDir, "missing.db") }
      });

      assert.equal(plan.targetRoot, projectPath);
      assert.equal(plan.templateId, "builtin-claude-code");
      assert.equal(plan.dryRun, true);
      assert.ok(plan.files.some((file) => file.relativePath === "CLAUDE.md"));
      assert.ok(plan.files.some((file) => file.relativePath === ".claude/settings.json"));
      assert.match(
        plan.files.find((file) => file.relativePath === "CLAUDE.md")?.content ?? "",
        /forgebadger-cli-init-/
      );
    } finally {
      await rm(projectPath, { recursive: true, force: true });
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it("uses only the ForgeBadger Gateway URL override", async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), "forgebadger-cli-init-env-"));
    const stateDir = await mkdtemp(path.join(tmpdir(), "forgebadger-cli-init-db-"));
    const env = { FORGEBADGER_DB_PATH: path.join(stateDir, "missing.db") };
    try {
      const defaultPlan = await createInitRenderPlan({
        projectPath,
        templateId: "builtin-claude-code",
        credentialMode: "host_environment",
        dryRun: true,
        env: { ...env, OLD_PRODUCT_GATEWAY_URL: "http://old.example:48731" }
      });
      const currentPlan = await createInitRenderPlan({
        projectPath,
        templateId: "builtin-claude-code",
        credentialMode: "host_environment",
        dryRun: true,
        env: { ...env, FORGEBADGER_GATEWAY_URL: "http://current.example:48731" }
      });

      assert.match(JSON.stringify(defaultPlan.files), /http:\/\/127\.0\.0\.1:48731/);
      assert.match(JSON.stringify(currentPlan.files), /http:\/\/current\.example:48731/);
    } finally {
      await rm(projectPath, { recursive: true, force: true });
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it("lists all templates from the local database with cross-user usage counts", async () => {
    await withTemplateDatabase(async (env, repo, db) => {
      const custom = repo.create({
        name: "Team Baseline",
        description: "team baseline",
        version: "1.2.0",
        adapter: "opencode",
        files: [
          { filePath: "AGENTS.md", content: "team rules" },
          { filePath: ".opencode/opencode.json", content: "{}" }
        ]
      });

      let templates = listAvailableTemplates(env);
      const builtins = templates.filter((template) => template.isBuiltin);
      const listed = templates.find((template) => template.id === custom.id);
      assert.equal(builtins.length, 4);
      assert.equal(templates.length, builtins.length + 1);
      assert.ok(listed);
      assert.equal(listed.adapter, "opencode");
      assert.equal(listed.usageCount, 0);

      db.prepare(
        "INSERT INTO projects (id, user_id, name, path, ai_tool, template_id) VALUES ('demo-project', 'other-user', 'Demo', '/tmp/demo', 'opencode', ?)"
      ).run(custom.id);

      templates = listAvailableTemplates(env);
      assert.equal(templates.find((template) => template.id === custom.id)?.usageCount, 1);
    });
  });

  it("renders config files following the template adapter", async () => {
    await withTemplateDatabase(async (env, repo) => {
      const custom = repo.create({
        name: "Opencode Baseline",
        adapter: "opencode",
        files: [
          { filePath: "AGENTS.md", content: "team rules" },
          { filePath: ".opencode/opencode.json", content: "{}" }
        ]
      });
      const projectPath = await mkdtemp(path.join(tmpdir(), "forgebadger-cli-init-adapter-"));
      try {
        const plan = await createInitRenderPlan({
          projectPath,
          templateId: custom.id,
          credentialMode: "host_environment",
          dryRun: true,
          env
        });

        const paths = plan.files.map((file) => file.relativePath);
        assert.ok(paths.includes("AGENTS.md"));
        assert.ok(paths.includes(".opencode/opencode.json"));
        assert.ok(!paths.includes("CLAUDE.md"));
      } finally {
        await rm(projectPath, { recursive: true, force: true });
      }
    });
  });

  it("falls back to built-in templates when the database file is missing", async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), "forgebadger-cli-init-fallback-"));
    try {
      const templates = listAvailableTemplates({
        FORGEBADGER_DB_PATH: path.join(stateDir, "missing.db")
      });

      assert.equal(templates.length, 4);
      assert.ok(templates.every((template) => template.isBuiltin));
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it("prints a JSON envelope for --list-templates", async () => {
    await withTemplateDatabase(async (env, repo) => {
      const custom = repo.create({
        name: "Envelope Baseline",
        adapter: "claude",
        files: [{ filePath: "AGENTS.md", content: "x" }]
      });
      let output = "";
      const original = process.stdout.write;
      process.stdout.write = ((chunk: string) => {
        output += String(chunk);
        return true;
      }) as unknown as typeof process.stdout.write;
      try {
        const code = await runForgeBadgerCli(["init", "--list-templates"], env);
        assert.equal(code, 0);

        const parsed = JSON.parse(output) as {
          code: number;
          data: Array<{ id: string }>;
          message: string;
        };
        assert.equal(parsed.code, 0);
        assert.equal(parsed.message, "");
        assert.ok(Array.isArray(parsed.data));
        assert.ok(parsed.data.length >= 4);
        assert.ok(parsed.data.some((template) => template.id === custom.id));
      } finally {
        process.stdout.write = original;
      }
    });
  });
});
