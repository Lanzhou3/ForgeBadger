import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CatalogRepository } from "../src/db/repositories/catalog-repository.js";
import { UserRepository } from "../src/db/repositories/index.js";
import {
  MARKETPLACE_SEEDS,
  parseMarketplaceManifest,
  refreshGitHubMarketplace
} from "../src/services/skill-marketplaces.js";
import type { GitHubFetchResponse } from "../src/services/github-skill-source.js";

function allowTestResolver() {
  return async () => [{ address: "8.8.8.8", family: 4 }];
}

function jsonResponse(value: unknown, status = 200): GitHubFetchResponse {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    arrayBuffer: async () => bytes.buffer as ArrayBuffer
  };
}

function textResponse(body: string, status = 200): GitHubFetchResponse {
  const bytes = new TextEncoder().encode(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    arrayBuffer: async () => bytes.buffer as ArrayBuffer
  };
}

function recordingFetcher(handler: (url: string) => GitHubFetchResponse) {
  const urls: string[] = [];
  const fetcher = async (url: string) => {
    urls.push(url);
    return handler(url);
  };
  return { fetcher, urls };
}

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

const marketplaceManifest = {
  name: "demo-marketplace",
  owner: { name: "octo" },
  plugins: [
    { name: "pdf", source: "./plugins/pdf", description: "PDF tools", version: "1.2.0" },
    { name: "external", source: { source: "github", repo: "other/tool", ref: "main" }, description: "External" },
    { name: "subdir-tool", source: { source: "git-subdir", url: "https://github.com/other/mono.git", path: "tools/x" } },
    { name: "npm-tool", source: { source: "npm", package: "npm-tool" } },
    { name: "archive-tool", source: { source: "archive", url: "https://example.com/a.zip" } },
    { name: "command-tool", source: { source: "command", command: "make" } }
  ]
};

describe("parseMarketplaceManifest", () => {
  it("normalizes relative, github, and git-subdir plugin sources", () => {
    const result = parseMarketplaceManifest(marketplaceManifest, "octo/hello");
    assert.equal(result.marketplaceName, "demo-marketplace");
    assert.deepEqual(
      result.plugins.map((plugin) => plugin.name),
      ["pdf", "external", "subdir-tool"]
    );

    const pdf = result.plugins[0];
    assert.equal(pdf?.origin.repo, "octo/hello");
    assert.equal(pdf?.origin.path, "plugins/pdf");
    assert.equal(pdf?.description, "PDF tools");
    assert.equal(pdf?.version, "1.2.0");

    const external = result.plugins[1];
    assert.equal(external?.origin.repo, "other/tool");
    assert.equal(external?.origin.ref, "main");

    const subdir = result.plugins[2];
    assert.equal(subdir?.origin.repo, "other/mono");
    assert.equal(subdir?.origin.path, "tools/x");
  });

  it("skips npm, archive, and command sources with reasons", () => {
    const result = parseMarketplaceManifest(marketplaceManifest, "octo/hello");
    assert.deepEqual(
      result.skipped.map((entry) => entry.name),
      ["npm-tool", "archive-tool", "command-tool"]
    );
    assert.match(result.skipped[0]?.reason ?? "", /npm/);
  });
});

describe("parseMarketplaceManifest skills expansion", () => {
  it("expands a root-source plugin with a skills array into per-skill entries", () => {
    const manifest = {
      name: "anthropic-agent-skills",
      owner: { name: "anthropics" },
      plugins: [
        {
          name: "document-skills",
          source: "./",
          description: "Document skills",
          skills: ["./skills/xlsx", "./skills/pdf", "./skills/docx"]
        }
      ]
    };
    const result = parseMarketplaceManifest(manifest, "anthropics/skills");
    assert.deepEqual(
      result.plugins.map((plugin) => plugin.name),
      ["xlsx", "pdf", "docx"]
    );
    assert.equal(result.skipped.length, 0);
    for (const plugin of result.plugins) {
      assert.equal(plugin.origin.repo, "anthropics/skills");
      assert.equal(plugin.pluginName, "document-skills");
      assert.equal(plugin.description, "Document skills");
    }
    const xlsx = result.plugins[0];
    assert.equal(xlsx?.externalId, "skills/xlsx");
    assert.equal(xlsx?.origin.path, "skills/xlsx");
  });

  it("treats a root-source plugin without a skills array as a single root skill", () => {
    const manifest = {
      name: "root-skill",
      owner: { name: "octo" },
      plugins: [{ name: "solo", source: "./" }]
    };
    const result = parseMarketplaceManifest(manifest, "octo/solo");
    assert.equal(result.skipped.length, 0);
    assert.equal(result.plugins.length, 1);
    assert.equal(result.plugins[0]?.name, "solo");
    assert.equal(result.plugins[0]?.origin.repo, "octo/solo");
    assert.equal(result.plugins[0]?.origin.path, undefined);
    assert.equal(result.plugins[0]?.externalId, undefined);
  });

  it("joins non-root source directories with skills entries", () => {
    const manifest = {
      name: "nested",
      owner: { name: "octo" },
      plugins: [{ name: "plugin-bundle", source: "./plugins/bundle", skills: ["alpha", "beta"] }]
    };
    const result = parseMarketplaceManifest(manifest, "octo/mono");
    assert.equal(result.skipped.length, 0);
    assert.deepEqual(
      result.plugins.map((plugin) => plugin.name),
      ["alpha", "beta"]
    );
    assert.deepEqual(
      result.plugins.map((plugin) => plugin.externalId),
      ["plugins/bundle/alpha", "plugins/bundle/beta"]
    );
    assert.deepEqual(
      result.plugins.map((plugin) => plugin.origin.path),
      ["plugins/bundle/alpha", "plugins/bundle/beta"]
    );
    assert.equal(result.plugins[0]?.pluginName, "plugin-bundle");
  });

  it("skips plugins with unsafe or non-string skills entries", () => {
    const manifest = {
      name: "bad-skills",
      owner: { name: "octo" },
      plugins: [
        { name: "escape", source: "./", skills: ["../x"] },
        { name: "weird", source: "./", skills: [42] }
      ]
    };
    const result = parseMarketplaceManifest(manifest, "octo/bad");
    assert.equal(result.plugins.length, 0);
    assert.deepEqual(
      result.skipped.map((entry) => entry.name),
      ["escape", "weird"]
    );
    assert.match(result.skipped[0]?.reason ?? "", /invalid skills entry/);
    assert.match(result.skipped[1]?.reason ?? "", /must be relative path strings/);
  });
});

describe("refreshGitHubMarketplace", () => {
  it("stores marketplace plugins as catalog items with marketplace metadata", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("marketplace@example.com", "hash");
    const { fetcher } = recordingFetcher((url) => {
      if (url === "https://api.github.com/repos/octo/hello") {
        return jsonResponse({ default_branch: "main" });
      }
      if (url === "https://api.github.com/repos/octo/hello/commits/main") {
        return jsonResponse({ sha: "commitsha1" });
      }
      if (url.startsWith("https://raw.githubusercontent.com/octo/hello/commitsha1/")) {
        return textResponse(JSON.stringify(marketplaceManifest));
      }
      return jsonResponse({}, 404);
    });

    const result = await refreshGitHubMarketplace({
      db,
      userId: user.id,
      repo: "octo/hello",
      fetcher,
      resolveHost: allowTestResolver()
    });

    assert.equal(result.marketplaceName, "demo-marketplace");
    assert.equal(result.sha, "commitsha1");
    assert.equal(result.source.type, "skill");
    assert.equal(result.source.sourceId, "demo-marketplace");
    assert.equal(result.items.length, 3);
    assert.equal(result.skipped.length, 3);

    const pdfItem = result.items.find((item) => item.externalId === "pdf");
    assert.ok(pdfItem);
    const pdfMetadata = JSON.parse(pdfItem.metadata ?? "{}") as {
      marketplace?: { repo?: string; sha?: string; pluginName?: string; skillPath?: string };
      skillPackage?: unknown;
    };
    assert.equal(pdfMetadata.marketplace?.repo, "octo/hello");
    assert.equal(pdfMetadata.marketplace?.sha, "commitsha1");
    assert.equal(pdfMetadata.marketplace?.pluginName, "pdf");
    assert.equal(pdfMetadata.marketplace?.skillPath, "plugins/pdf");
    assert.equal(pdfMetadata.skillPackage, undefined, "marketplace items must not embed content");

    const externalItem = result.items.find((item) => item.externalId === "external");
    const externalMetadata = JSON.parse(externalItem?.metadata ?? "{}") as {
      marketplace?: { repo?: string; sha?: string; ref?: string };
    };
    assert.equal(externalMetadata.marketplace?.repo, "other/tool");
    assert.equal(externalMetadata.marketplace?.ref, "main");
    assert.equal(externalMetadata.marketplace?.sha, undefined, "external repos stay unpinned until refresh fetches them");

    db.close();
  });

  it("falls back to plain SKILL.md discovery when the repo has no marketplace.json", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("marketplace-fallback@example.com", "hash");
    const tree = {
      tree: [
        { path: "SKILL.md", type: "blob" },
        { path: "skills/pdf/SKILL.md", type: "blob" },
        { path: "readme.md", type: "blob" }
      ],
      truncated: false
    };
    const { fetcher } = recordingFetcher((url) => {
      if (url === "https://api.github.com/repos/octo/plain") {
        return jsonResponse({ default_branch: "main" });
      }
      if (url === "https://api.github.com/repos/octo/plain/commits/main") {
        return jsonResponse({ sha: "plainsha1" });
      }
      if (url.startsWith("https://api.github.com/repos/octo/plain/git/trees/")) {
        return jsonResponse(tree);
      }
      if (url.startsWith("https://raw.githubusercontent.com/octo/plain/plainsha1/")) {
        return jsonResponse({}, 404);
      }
      return jsonResponse({}, 404);
    });

    const result = await refreshGitHubMarketplace({
      db,
      userId: user.id,
      repo: "octo/plain",
      fetcher,
      resolveHost: allowTestResolver()
    });

    assert.equal(result.marketplaceName, undefined);
    assert.equal(result.source.sourceId, "octo/plain");
    assert.deepEqual(
      result.items.map((item) => item.externalId).sort(),
      ["SKILL.md", "skills/pdf/SKILL.md"]
    );
    const item = result.items.find((entry) => entry.externalId === "skills/pdf/SKILL.md");
    const metadata = JSON.parse(item?.metadata ?? "{}") as { marketplace?: { skillPath?: string; sha?: string } };
    assert.equal(metadata.marketplace?.skillPath, "skills/pdf");
    assert.equal(metadata.marketplace?.sha, "plainsha1");

    const listed = new CatalogRepository(db, user.id).listItems();
    assert.equal(listed.length, 2);
    db.close();
  });

  it("surfaces refresh errors instead of writing partial catalog state", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("marketplace-error@example.com", "hash");
    const { fetcher } = recordingFetcher((url) => {
      if (url === "https://api.github.com/repos/octo/missing") {
        return jsonResponse({}, 404);
      }
      return jsonResponse({}, 404);
    });

    await assert.rejects(
      () =>
        refreshGitHubMarketplace({
          db,
          userId: user.id,
          repo: "octo/missing",
          fetcher,
          resolveHost: allowTestResolver()
        }),
      /not found \(404\)/
    );
    assert.equal(new CatalogRepository(db, user.id).listSources().length, 0);
    db.close();
  });

  it("rejects repos with subpaths or refs", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("marketplace-shape@example.com", "hash");
    const { fetcher } = recordingFetcher(() => jsonResponse({}, 404));
    await assert.rejects(
      () =>
        refreshGitHubMarketplace({
          db,
          userId: user.id,
          repo: "octo/hello/subdir",
          fetcher,
          resolveHost: allowTestResolver()
        }),
      /owner\/repo/
    );
    db.close();
  });

  it("stores anthropics/skills-style expanded entries with per-skill metadata", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("skills-style@example.com", "hash");
    const manifest = {
      name: "anthropic-agent-skills",
      owner: { name: "anthropics" },
      plugins: [
        {
          name: "example-skills",
          source: "./",
          skills: ["./skills/pdf", "./skills/docx"]
        },
        { name: "solo-plugin", source: "./" }
      ]
    };
    const { fetcher } = recordingFetcher((url) => {
      if (url === "https://api.github.com/repos/anthropics/skills") {
        return jsonResponse({ default_branch: "main" });
      }
      if (url === "https://api.github.com/repos/anthropics/skills/commits/main") {
        return jsonResponse({ sha: "skillsha1" });
      }
      if (url.startsWith("https://raw.githubusercontent.com/anthropics/skills/skillsha1/")) {
        return textResponse(JSON.stringify(manifest));
      }
      return jsonResponse({}, 404);
    });

    const result = await refreshGitHubMarketplace({
      db,
      userId: user.id,
      repo: "anthropics/skills",
      fetcher,
      resolveHost: allowTestResolver()
    });

    assert.equal(result.marketplaceName, "anthropic-agent-skills");
    assert.equal(result.skipped.length, 0);
    assert.equal(result.items.length, 3);

    const pdfItem = result.items.find((item) => item.externalId === "skills/pdf");
    assert.ok(pdfItem);
    assert.equal(pdfItem.name, "pdf");
    const pdfMetadata = JSON.parse(pdfItem.metadata ?? "{}") as {
      marketplace?: { repo?: string; sha?: string; pluginName?: string; skillPath?: string };
    };
    assert.equal(pdfMetadata.marketplace?.repo, "anthropics/skills");
    assert.equal(pdfMetadata.marketplace?.sha, "skillsha1");
    assert.equal(pdfMetadata.marketplace?.pluginName, "example-skills");
    assert.equal(pdfMetadata.marketplace?.skillPath, "skills/pdf");

    const soloItem = result.items.find((item) => item.externalId === "solo-plugin");
    assert.ok(soloItem);
    const soloMetadata = JSON.parse(soloItem.metadata ?? "{}") as { marketplace?: { skillPath?: string } };
    assert.equal(soloMetadata.marketplace?.skillPath, undefined, "root-source skills pin no skillPath");

    db.close();
  });
});

describe("MARKETPLACE_SEEDS", () => {
  it("lists the curated seed marketplaces", () => {
    assert.deepEqual([...MARKETPLACE_SEEDS], [
      "anthropics/claude-plugins-official",
      "anthropics/skills",
      "anthropics/claude-plugins-community"
    ]);
  });
});
