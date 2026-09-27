import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { SkillDiscoveryService } from "../src/services/skill-discovery.js";
import { resolveRegistryPackage } from "../src/services/skill-registry-package.js";
import { registryText } from "../src/services/skill-registry-http.js";
import {
  fetchGitHubSkillPackage,
  listSkillFiles,
} from "../src/services/github-skill-source.js";
import { skillFixture } from "./fixtures/skill-registry.js";
const resolveHost = async () => [{ address: "8.8.8.8", family: 4 }];

test("source discovery is tenant scoped, locally searchable and disabling is persistent", async (t) => {
  const f = skillFixture();
  t.after(() => f.db.close());
  const service = new SkillDiscoveryService(f.db, f.options);
  await service.refresh(f.owner.id, "octo/demo");
  const input = {
    q: "review",
    provider: "github" as const,
    page: 0,
    includeSkillsSh: false,
  };
  assert.equal((await service.search(f.owner.id, input)).items.length, 1);
  assert.equal((await service.search(f.other.id, input)).items.length, 0);
  service.remove(f.owner.id, "github:octo/demo");
  assert.equal((await service.search(f.owner.id, input)).items.length, 0);
  assert.equal(service.sources(f.owner.id)[0]?.status, "disabled");
  await service.refresh(f.owner.id, "octo/demo");
  assert.equal(service.sources(f.owner.id)[0]?.status, "active");
});

test("provider errors are isolated, 429 backs off, skills.sh is opt-in and cached", async (t) => {
  const f = skillFixture();
  t.after(() => f.db.close());
  let clawCalls = 0,
    skillsCalls = 0;
  const service = new SkillDiscoveryService(f.db, {
    ...f.options,
    fetcher: async (url, init) => {
      if (url.startsWith("https://clawhub.ai")) {
        clawCalls++;
        return new Response("Limited", {
          status: 429,
          headers: { "Retry-After": "60" },
        });
      }
      if (url.startsWith("https://skills.sh")) {
        skillsCalls++;
        return Response.json({
          skills: [{ name: "review", skillId: "review", source: "octo/demo" }],
        });
      }
      return f.options.fetcher!(url, init);
    },
  });
  await service.refresh(f.owner.id, "octo/demo");
  const result = await service.search(f.owner.id, {
    q: "review",
    provider: "all",
    page: 0,
    includeSkillsSh: false,
  });
  assert.equal(result.items.length, 1);
  assert.equal(
    result.statuses.find((s) => s.provider === "clawhub")?.status,
    "error",
  );
  assert.equal(skillsCalls, 0);
  await service.search(f.owner.id, {
    q: "review",
    provider: "all",
    page: 0,
    includeSkillsSh: true,
  });
  await service.search(f.owner.id, {
    q: "review",
    provider: "all",
    page: 0,
    includeSkillsSh: true,
  });
  assert.equal(clawCalls, 1);
  assert.equal(skillsCalls, 1);
});

test("ClawHub verifies publisher, exact version and every resource checksum", async () => {
  const files = [
    {
      path: "SKILL.md",
      content: "---\nname: react\ndescription: React guidance\n---\n# React",
    },
    { path: "references/guide.md", content: "Guide" },
  ];
  let wrongOwner = false,
    wrongHash = false,
    flagged = false;
  const urls: string[] = [];
  const options = {
    resolveHost,
    fetcher: async (url: string) => {
      urls.push(url);
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get("ownerHandle"), "author");
      if (parsed.pathname.endsWith("/file")) {
        assert.equal(parsed.searchParams.get("version"), "1.2.3");
        return new Response(
          files.find(
            (f) => f.path === parsed.searchParams.get("path"),
          )!.content,
        );
      }
      if (parsed.pathname.includes("/versions/"))
        return Response.json({
          version: {
            version: "1.2.3",
            files: files.map((f) => ({
              path: f.path,
              size: Buffer.byteLength(f.content),
              sha256: wrongHash
                ? "a".repeat(64)
                : createHash("sha256").update(f.content).digest("hex"),
            })),
          },
        });
      return Response.json({
        owner: { handle: wrongOwner ? "impostor" : "author" },
        latestVersion: { version: "1.2.3" },
        moderation: { isSuspicious: flagged },
      });
    },
  };
  const locator = { kind: "clawhub" as const, owner: "author", slug: "react" };
  const result = await resolveRegistryPackage(locator, options);
  assert.equal(result.package.files.length, 2);
  assert.equal(result.revision, "1.2.3");
  wrongOwner = true;
  await assert.rejects(
    resolveRegistryPackage(locator, options),
    /publisher identity/,
  );
  wrongOwner = false;
  wrongHash = true;
  await assert.rejects(
    resolveRegistryPackage(locator, options),
    /integrity mismatch/,
  );
  wrongHash = false;
  flagged = true;
  await assert.rejects(
    resolveRegistryPackage(locator, options),
    /flagged or blocked/,
  );
});

test("registry transport rejects private DNS, redirects and oversize streaming responses", async () => {
  let sent = 0;
  const fetcher = async () => {
    sent++;
    return new Response("ok");
  };
  await assert.rejects(
    registryText("https://clawhub.ai/api/v1/search", {
      fetcher,
      resolveHost: async () => [{ address: "127.0.0.1", family: 4 }],
    }),
    /rejected/,
  );
  assert.equal(sent, 0);
  for (const url of [
    "http://clawhub.ai",
    "https://clawhub.ai:123/a",
    "https://user:pass@clawhub.ai/a",
    "https://evil.test",
  ])
    await assert.rejects(
      registryText(url, { fetcher, resolveHost }),
      /Unsupported/,
    );
  await assert.rejects(
    registryText("https://clawhub.ai/a", {
      resolveHost,
      fetcher: async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1" },
        }),
    }),
    /302/,
  );
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(64));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    registryText(
      "https://clawhub.ai/a",
      { resolveHost, fetcher: async () => new Response(body) },
      32,
    ),
    /limit|large/,
  );
  assert.equal(cancelled, true);
});

test("GitHub supports trees larger than the retired 1000-entry limit and rejects special file modes", async () => {
  const tree = Array.from({ length: 1100 }, (_, i) => ({
    path: `file-${i}.md`,
    type: "blob",
    mode: "100644",
  }));
  tree.push({ path: "skills/review/SKILL.md", type: "blob", mode: "100644" });
  const listed = await listSkillFiles({
    owner: "octo",
    repo: "demo",
    sha: "a".repeat(40),
    resolveHost,
    fetcher: async () => Response.json({ tree, truncated: false }),
  });
  assert.equal(listed.files.length, 1);
  for (const mode of ["120000", "160000"])
    await assert.rejects(
      fetchGitHubSkillPackage({
        owner: "octo",
        repo: "demo",
        sha: "a".repeat(40),
        path: "skills/review/SKILL.md",
        resolveHost,
        fetcher: async () =>
          Response.json({
            tree: [{ path: "SKILL.md", type: "blob", mode }],
            truncated: false,
          }),
      }),
      /symlink|submodule|Unsupported/,
    );
});

test("Skill source refresh and disable preserve same-id Template items", async (t) => {
  const f = skillFixture();
  t.after(() => f.db.close());
  const { CatalogRepository } = await import(
    "../src/db/repositories/catalog-repository.js"
  );
  const repo = new CatalogRepository(f.db, f.owner.id);
  repo.upsertSource({
    sourceId: "github:octo/demo",
    type: "template",
    label: "Templates",
    url: "https://example.com",
  });
  const [template] = repo.replaceItems(
    "github:octo/demo",
    [
      {
        sourceId: "github:octo/demo",
        itemType: "template",
        externalId: "template",
        name: "template",
      },
    ],
    "template",
  );
  const service = new SkillDiscoveryService(f.db, f.options);
  await service.refresh(f.owner.id, "octo/demo");
  assert.ok(repo.getItemById(template!.id));
  service.remove(f.owner.id, "github:octo/demo");
  assert.ok(repo.getItemById(template!.id));
  assert.equal(
    repo.listSources().find((s) => s.type === "template")?.status,
    "active",
  );
});

test("confirmed GitHub aliases deduplicate skills.sh and identify installed Skills", async (t) => {
  const f = skillFixture();
  t.after(() => f.db.close());
  const { SkillInstallService } = await import(
    "../src/services/skill-install-service.js"
  );
  const installer = new SkillInstallService(f.db, f.options);
  const preview = await installer.preview(f.owner.id, {
    locator: { kind: "github", repo: "octo/demo", path: "skills/review" },
  });
  const { skill } = installer.consume(f.owner.id, preview.token);
  const service = new SkillDiscoveryService(f.db, {
    ...f.options,
    fetcher: async (url, init) =>
      url.startsWith("https://skills.sh")
        ? Response.json({
            skills: [{ skillId: "review", source: "octo/demo" }],
          })
        : url.startsWith("https://clawhub.ai")
          ? Response.json({ results: [] })
          : f.options.fetcher!(url, init),
  });
  const input = {
    q: "review",
    provider: "skills-sh" as const,
    page: 0,
    includeSkillsSh: true,
  };
  assert.equal(
    (await service.search(f.owner.id, input)).items[0]?.installedSkillId,
    skill.id,
  );
  await service.refresh(f.owner.id, "octo/demo");
  assert.equal(
    (await service.search(f.owner.id, { ...input, provider: "all" })).items
      .length,
    1,
  );
});

test("source filters cannot hide catalog ambiguity when matching installed aliases", async (t) => {
  const f = skillFixture();
  t.after(() => f.db.close());
  const { SkillInstallService } = await import(
    "../src/services/skill-install-service.js"
  );
  const { CatalogRepository } = await import(
    "../src/db/repositories/catalog-repository.js"
  );
  const installer = new SkillInstallService(f.db, f.options);
  const preview = await installer.preview(f.owner.id, {
    locator: { kind: "github", repo: "octo/demo", path: "skills/review" },
  });
  installer.consume(f.owner.id, preview.token);
  new CatalogRepository(f.db, f.owner.id).replaceItems(
    "github:octo/demo",
    ["skills/review/SKILL.md", "other/review/SKILL.md"].map((path) => ({
      sourceId: "github:octo/demo",
      itemType: "skill",
      externalId: path,
      name: "review",
      metadata: { marketplace: { repo: "octo/demo", skillPath: path } },
    })),
    "skill",
  );
  const service = new SkillDiscoveryService(f.db, {
    ...f.options,
    fetcher: async () =>
      Response.json({ skills: [{ skillId: "review", source: "octo/demo" }] }),
  });
  const result = await service.search(f.owner.id, {
    q: "review",
    provider: "skills-sh",
    page: 0,
    includeSkillsSh: true,
  });
  assert.equal(result.items[0]?.installedSkillId, undefined);
});
