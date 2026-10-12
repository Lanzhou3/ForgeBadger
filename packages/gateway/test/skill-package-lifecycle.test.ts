import assert from "node:assert/strict";
import { test } from "node:test";
import { SkillInstallService } from "../src/services/skill-install-service.js";
import { SkillRepository } from "../src/db/repositories/skill-repository.js";
import {
  parseSkillPackage,
  storedSkillFiles,
} from "../src/services/skill-package.js";
import { skillFixture } from "./fixtures/skill-registry.js";
import { CliSkillRevisionRepository } from "../src/db/repositories/cli-skill-revision-repository.js";
const locator = {
  kind: "github" as const,
  repo: "octo/demo",
  path: "skills/review",
};

test("preview binds the full immutable package, tenant, operation and single-use token", async (t) => {
  const f = skillFixture();
  t.after(() => f.db.close());
  const service = new SkillInstallService(f.db, f.options);
  const preview = await service.preview(f.owner.id, { locator });
  assert.equal(preview.package.files.length, 3);
  assert.ok(preview.package.warnings.includes("contains-scripts"));
  assert.throws(
    () => service.consume(f.other.id, preview.token),
    /expired or unavailable/,
  );
  assert.throws(
    () => service.consume(f.owner.id, preview.token, { operation: "update" }),
    /does not match/,
  );
  f.files["skills/review/references/rules.md"] = "changed upstream";
  f.bump();
  const calls = f.requests.length;
  const { skill } = service.consume(f.owner.id, preview.token, {
    operation: "install",
  });
  assert.equal(skill.isEnabled, false);
  assert.equal(f.requests.length, calls);
  assert.equal(
    storedSkillFiles(skill).find((file) => file.path === "references/rules.md")
      ?.content,
    "first rules",
  );
  assert.equal(JSON.parse(skill.remoteProvenance!).storage, "database");
  assert.throws(() => service.consume(f.owner.id, preview.token), /expired/);
  assert.throws(() => service.history(f.other.id, skill.id), /not found/);
  assert.equal(service.history(f.owner.id, skill.id)[0]?.action, "install");
  const duplicate = await service.preview(f.owner.id, { locator });
  assert.throws(() => service.consume(f.owner.id, duplicate.token), /already exists/);
  assert.equal(service.history(f.owner.id, skill.id).length, 1);
});

test("resource-only changes update and rollback with complete file diff", async (t) => {
  const f = skillFixture();
  t.after(() => f.db.close());
  const service = new SkillInstallService(f.db, f.options);
  const first = await service.preview(f.owner.id, { locator });
  const { skill } = service.consume(f.owner.id, first.token);
  const revision = service.history(f.owner.id, skill.id)[0]!;
  assert.equal(
    (await service.checkUpdate(f.owner.id, skill.id)).updateAvailable,
    false,
  );
  f.files["skills/review/references/rules.md"] = "second rules";
  f.bump();
  assert.equal(
    (await service.checkUpdate(f.owner.id, skill.id)).updateAvailable,
    true,
  );
  const update = await service.preview(f.owner.id, { skillId: skill.id });
  assert.deepEqual(update.changes, [
    {
      path: "references/rules.md",
      kind: "modified",
      before: "first rules",
      after: "second rules",
    },
  ]);
  service.consume(f.owner.id, update.token, {
    skillId: skill.id,
    operation: "update",
  });
  const before = f.requests.length;
  const restore = await service.preview(f.owner.id, {
    skillId: skill.id,
    revisionId: revision.id,
  });
  const result = service.consume(f.owner.id, restore.token, {
    skillId: skill.id,
    operation: "rollback",
  });
  assert.equal(f.requests.length, before);
  assert.equal(storedSkillFiles(result.skill)[0]?.path, "SKILL.md");
  assert.equal(
    storedSkillFiles(result.skill).find(
      (file) => file.path === "references/rules.md",
    )?.content,
    "first rules",
  );
  assert.equal(service.history(f.owner.id, skill.id).length, 3);
});

test("preview expiry, local edits, upstream rename and post-preview edits are rejected", async (t) => {
  const f = skillFixture();
  t.after(() => f.db.close());
  let now = Date.now();
  const service = new SkillInstallService(f.db, f.options, () => now);
  const expired = await service.preview(f.owner.id, { locator });
  now += 300001;
  assert.throws(() => service.consume(f.owner.id, expired.token), /expired/);
  const preview = await service.preview(f.owner.id, { locator });
  const { skill } = service.consume(f.owner.id, preview.token);
  const repo = new SkillRepository(f.db, f.owner.id);
  repo.update(skill.id, { content: skill.content + "local edit" });
  await assert.rejects(
    service.preview(f.owner.id, { skillId: skill.id }),
    /Local edits/,
  );
  repo.update(skill.id, { content: skill.content });
  f.files["skills/review/SKILL.md"] = skill.content.replace(
    "name: review",
    "name: renamed",
  );
  await assert.rejects(
    service.preview(f.owner.id, { skillId: skill.id }),
    /renamed/,
  );
  f.files["skills/review/SKILL.md"] = skill.content;
  const next = await service.preview(f.owner.id, { skillId: skill.id });
  repo.update(skill.id, { description: "Edited after preview" });
  assert.throws(
    () => service.consume(f.owner.id, next.token, { skillId: skill.id }),
    /changed after preview/,
  );
});

test("disabled user and foreign project cannot consume or publish a preview", async (t) => {
  const f = skillFixture();
  t.after(() => f.db.close());
  const service = new SkillInstallService(f.db, f.options);
  const preview = await service.preview(f.owner.id, { locator });
  assert.throws(
    () => service.consume(f.owner.id, preview.token, { projectId: f.other.id }),
    /Project not found/,
  );
  assert.equal(new SkillRepository(f.db, f.owner.id).listOwned().length, 0);
  f.users.update(f.owner.id, { status: "disabled" });
  assert.throws(() => service.consume(f.owner.id, preview.token), /inactive/);
  f.users.update(f.owner.id, { status: "active" });
  const fetcher = f.options.fetcher!;
  const deferred = new SkillInstallService(f.db, {
    ...f.options,
    fetcher: async (...args) => {
      const res = await fetcher(...args);
      f.users.update(f.owner.id, { status: "disabled" });
      return res;
    },
  });
  await assert.rejects(deferred.preview(f.owner.id, { locator }), /inactive/);
});

test("revision retention is bounded and cascading deletion removes snapshots", async (t) => {
  const f = skillFixture();
  t.after(() => f.db.close());
  const repo = new SkillRepository(f.db, f.owner.id);
  const skill = repo.create({ name: "revision-test", content: "test" });
  const revisions = new CliSkillRevisionRepository(f.db, f.owner.id);
  for (let i = 0; i < 24; i++)
    revisions.create(skill.id, "update", { i }, String(i));
  assert.equal(revisions.list(skill.id).length, 20);
  assert.equal(revisions.list(skill.id)[0]?.packageHash, "23");
  repo.delete(skill.id);
  assert.equal(revisions.list(skill.id).length, 0);
});

test("package validation refuses unsafe, binary, duplicate, oversized, colliding and malformed files", () => {
  const main = {
    path: "SKILL.md",
    content: "---\nname: review\ndescription: Review\n---\nBody",
  };
  for (const path of [
    "../escape",
    "a/../../escape",
    "a\\b",
    "a/%2e%2e/x",
    "CON.txt",
    "x.",
    "/abs",
    ".forgebadger-managed.json",
  ])
    assert.throws(() => parseSkillPackage([main, { path, content: "x" }]));
  assert.throws(
    () => parseSkillPackage([main, { path: "a", content: "\0" }]),
    /UTF-8/,
  );
  assert.throws(
    () =>
      parseSkillPackage([
        main,
        { path: "a", content: "x".repeat(128 * 1024 + 1) },
      ]),
    /limit/,
  );
  assert.throws(
    () =>
      parseSkillPackage([
        main,
        { path: "a", content: "a" },
        { path: "A", content: "b" },
      ]),
    /Duplicate/,
  );
  assert.throws(
    () =>
      parseSkillPackage([
        main,
        { path: "a", content: "a" },
        { path: "a/b", content: "b" },
      ]),
    /collision/,
  );
  assert.throws(
    () =>
      parseSkillPackage([
        { ...main, content: "---\nname: x\nname: y\ndescription: test\n---" },
      ]),
    /YAML/,
  );
});

test("legacy plain-Markdown installations restore exact content and metadata after update", async (t) => {
  const f = skillFixture();
  t.after(() => f.db.close());
  const { computeContentHash } = await import(
    "../src/services/github-skill-source.js"
  );
  const repo = new SkillRepository(f.db, f.owner.id);
  const skill = repo.create({
    name: "review",
    description: "Historical description",
    version: "0.9",
    source: "github:octo/demo",
    content: "# Plain Markdown\n",
    remoteProvenance: JSON.stringify({
      kind: "github",
      repo: "octo/demo",
      path: "skills/review/SKILL.md",
      ref: "main",
      resolvedCommitSha: "a".repeat(40),
      contentHash: computeContentHash("# Plain Markdown\n"),
      installedAt: new Date().toISOString(),
    }),
  });
  const service = new SkillInstallService(f.db, f.options);
  const update = await service.preview(f.owner.id, { skillId: skill.id });
  service.consume(f.owner.id, update.token, { skillId: skill.id });
  const legacy = service
    .history(f.owner.id, skill.id)
    .find((r) => r.action === "legacy")!;
  const preview = await service.preview(f.owner.id, {
    skillId: skill.id,
    revisionId: legacy.id,
  });
  const restored = service.consume(f.owner.id, preview.token, {
    skillId: skill.id,
  }).skill;
  assert.equal(restored.content, skill.content);
  assert.equal(restored.description, skill.description);
  assert.equal(restored.version, skill.version);
  assert.equal(JSON.parse(restored.remoteProvenance!).legacyGlobalMirror, true);
  const restoredRevision = service.history(f.owner.id, skill.id)[0]!;
  const repeat = await service.preview(f.owner.id, {
    skillId: skill.id,
    revisionId: restoredRevision.id,
  });
  assert.equal(
    service.consume(f.owner.id, repeat.token, { skillId: skill.id }).skill
      .content,
    skill.content,
  );
});
