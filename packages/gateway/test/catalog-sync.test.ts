import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CatalogRepository } from "../src/db/repositories/catalog-repository.js";
import { SkillRepository, UserRepository } from "../src/db/repositories/index.js";
import { fetchRemoteCatalogManifest, refreshRemoteCatalog } from "../src/services/catalog-sync.js";

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

describe("remote catalog sync", () => {
  it("stores remote Skill and plugin metadata without installing local Skill content", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("catalog@example.com", "hash");
    const manifest = JSON.stringify({
      skills: [
        {
          id: "review-skill",
          name: "Review Skill",
          description: "Review changes",
          version: "1.2.0",
          content: "# Do not install this yet"
        }
      ],
      plugins: [
        {
          id: "plugin-safe",
          name: "Safe Plugin",
          description: "Safety checks",
          version: "0.3.0",
          adapter: "claude",
          category: "safety",
          configPath: ".claude/plugins/safe/plugin.json"
        }
      ]
    });

    const result = await refreshRemoteCatalog({
      db,
      userId: user.id,
      type: "skill",
      sourceId: "clawhub",
      label: "ClawHub",
      url: "https://example.test/catalog.json",
      fetcher: async () => response(manifest)
    });

    const repo = new CatalogRepository(db, user.id);
    const sources = repo.listSources();
    const items = repo.listItems();

    assert.equal(result.items.length, 2);
    assert.equal(sources[0]?.lastRefreshedAt instanceof Date, true);
    assert.deepEqual(items.map((item) => item.externalId).sort(), ["plugin-safe", "review-skill"]);
    assert.equal(new SkillRepository(db, user.id).list().length, 0);
    db.close();
  });

  it("rejects manifests over the configured size limit", async () => {
    await assert.rejects(
      () =>
        fetchRemoteCatalogManifest("https://example.test/large.json", {
          maxBytes: 8,
          fetcher: async () => response("{\"skills\":[]}")
        }),
      /Manifest exceeds size limit/
    );
  });

  it("stores remote template package metadata for later installation", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("catalog-template@example.com", "hash");
    const manifest = JSON.stringify({
      templates: [
        {
          id: "starter-template",
          name: "Starter Template",
          description: "Opinionated Claude Code starter",
          version: "2.0.0",
          files: [
            {
              filePath: ".claude/CLAUDE.md",
              content: "# {{projectName}}\n",
              fileType: "markdown"
            }
          ]
        }
      ]
    });

    const result = await refreshRemoteCatalog({
      db,
      userId: user.id,
      type: "template",
      sourceId: "clawhub",
      label: "ClawHub",
      url: "https://example.test/templates.json",
      fetcher: async () => response(manifest)
    });

    const item = result.items[0];
    assert.equal(item?.itemType, "template");
    assert.equal(item?.externalId, "starter-template");
    const metadata = JSON.parse(item?.metadata ?? "{}") as {
      templatePackage?: {
        name: string;
        version: string;
        files: Array<{ filePath: string; content: string; fileType: string }>;
      };
    };
    assert.equal(metadata.templatePackage?.name, "Starter Template");
    assert.equal(metadata.templatePackage?.version, "2.0.0");
    assert.equal(metadata.templatePackage?.files[0]?.filePath, ".claude/CLAUDE.md");
    db.close();
  });
});

function response(body: string): Response {
  return {
    ok: true,
    status: 200,
    async text() {
      return body;
    }
  } as Response;
}
