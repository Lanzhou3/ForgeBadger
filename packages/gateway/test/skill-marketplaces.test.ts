import { skillFixture } from "./fixtures/skill-registry.js";
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

describe('refreshGitHubMarketplace',()=>{
  it('indexes actual nested Skills instead of advertising bare plugin directories',async()=>{
    const f=skillFixture();
    try {
      f.files['.claude-plugin/marketplace.json']=JSON.stringify({name:'same-name',owner:{name:'octo'},plugins:[{name:'tools',source:'./plugins/tools'},{name:'empty',source:'./plugins/empty'}]});
      f.files['plugins/tools/skills/helper/SKILL.md']='---\nname: helper\ndescription: Helps\n---\nHelper';
      const result=await refreshGitHubMarketplace({db:f.db,userId:f.owner.id,repo:'octo/demo',...f.options});
      assert.equal(result.source.sourceId,'github:octo/demo');assert.equal(result.marketplaceName,'same-name');
      assert.deepEqual(result.items.map(item=>item.name).sort(),['helper','review']);
      const helper=result.items.find(item=>item.name==='helper')!;
      assert.equal(JSON.parse(helper.metadata!).marketplace.skillPath,'plugins/tools/skills/helper/SKILL.md');
      assert.equal(JSON.parse(helper.metadata!).marketplace.sha,'1'.repeat(40));
      assert.equal(new CatalogRepository(f.db,f.other.id).listItems().length,0);
    } finally {f.db.close();}
  });
  it('refreshes standalone Skill repositories and preserves the snapshot on malformed metadata',async()=>{
    const f=skillFixture();
    try {
      const input={db:f.db,userId:f.owner.id,repo:'octo/demo',...f.options};
      const result=await refreshGitHubMarketplace(input);assert.equal(result.items.length,1);
      assert.equal(result.items[0]?.name,'review');
      f.files['skills/review/SKILL.md']='not a skill';
      const partial=await refreshGitHubMarketplace(input);assert.equal(partial.skipped.length,1);assert.equal(JSON.parse(partial.items[0]!.metadata!).stale,true);
      assert.equal(new CatalogRepository(f.db,f.owner.id).listItems()[0]?.name,'review');
    } finally {f.db.close();}
  });
  it('checks active ownership again after remote requests',async()=>{
    const f=skillFixture();
    try {
      const fetcher=f.options.fetcher!;
      await assert.rejects(refreshGitHubMarketplace({db:f.db,userId:f.owner.id,repo:'octo/demo',...f.options,fetcher:async(...args)=>{const response=await fetcher(...args);f.users.update(f.owner.id,{status:'disabled'});return response;}}),/inactive/);
      assert.equal(new CatalogRepository(f.db,f.owner.id).listItems().length,0);
    } finally {f.db.close();}
  });
  it('rejects repositories with implicit subpaths',async()=>{
    const f=skillFixture();try {await assert.rejects(refreshGitHubMarketplace({db:f.db,userId:f.owner.id,repo:'octo/demo/skills',...f.options}),/owner\/repo/);}finally{f.db.close();}
  });
});
describe('MARKETPLACE_SEEDS',()=>{it('uses Skill-oriented repositories',()=>assert.deepEqual([...MARKETPLACE_SEEDS],['anthropics/skills','vercel-labs/agent-skills','openai/skills']));});

it('retains external plugin Skills if ref or tree discovery becomes unavailable',async()=>{
  const f=skillFixture();let unavailable=false;
  f.files['.claude-plugin/marketplace.json']=JSON.stringify({name:'market',owner:{name:'octo'},plugins:[{name:'external',source:{source:'github',repo:'other/plugin'}}]});
  const fetcher:NonNullable<typeof f.options.fetcher>=async(url,init)=>{
    if(url.includes('/other/plugin')) {
      if(unavailable)return new Response('Limited',{status:429});
      if(url.includes('/git/trees/'))return Response.json({tree:[{path:'SKILL.md',type:'blob'}],truncated:false});
      if(url.includes('/commits/'))return new Response('b'.repeat(40));
      if(url.startsWith('https://raw.'))return new Response('---\nname: external\ndescription: External skill\n---\nExternal');
      return Response.json({default_branch:'main'});
    }
    return f.options.fetcher!(url,init);
  };
  try {
    const input={db:f.db,userId:f.owner.id,repo:'octo/demo',...f.options,fetcher};
    assert.equal((await refreshGitHubMarketplace(input)).items.length,2);
    unavailable=true;const partial=await refreshGitHubMarketplace(input);
    assert.deepEqual(partial.items.map(item=>item.name).sort(),['external','review']);
    assert.equal(JSON.parse(partial.items.find(item=>item.name==='external')!.metadata!).stale,true);
  } finally {f.db.close();}
});
