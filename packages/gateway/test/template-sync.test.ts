import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { TemplateRepository } from "../src/db/repositories/template-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import {
  applyTemplateSync,
  buildTemplateUsage,
  MAX_SYNC_PROJECTS,
  previewTemplateSync,
  TemplateSyncError
} from "../src/services/template-sync.js";

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

interface Fixture {
  db: Database;
  userAId: string;
  userBId: string;
  templateId: string;
  dirs: { compliant: string; stale: string; missing: string };
  pCompliantId: string;
  pStaleId: string;
  pMissingId: string;
  projectRepo: ProjectRepository;
}

async function createFixture(): Promise<Fixture> {
  const db = createTestDb();
  const userRepo = new UserRepository(db);
  const userA = userRepo.create("tpl-sync-a@example.com", "hash-a");
  const userB = userRepo.create("tpl-sync-b@example.com", "hash-b");

  const templateRepo = new TemplateRepository(db, userA.id);
  const template = templateRepo.create({ name: "sync-template" });
  templateRepo.updateFile(template.id, "CLAUDE.md", "T\n");

  const projectRepo = new ProjectRepository(db, userA.id);
  const dirs = {
    compliant: await mkdtemp(path.join(tmpdir(), "openforge-tpl-sync-ok-")),
    stale: await mkdtemp(path.join(tmpdir(), "openforge-tpl-sync-stale-")),
    missing: await mkdtemp(path.join(tmpdir(), "openforge-tpl-sync-missing-"))
  };
  await writeFile(path.join(dirs.compliant, "CLAUDE.md"), "T\n");
  await writeFile(path.join(dirs.stale, "CLAUDE.md"), "DIFFERENT\n");

  const pCompliant = projectRepo.create({
    name: "p-compliant",
    path: dirs.compliant,
    aiTool: "claude",
    templateId: template.id
  });
  const pStale = projectRepo.create({
    name: "p-stale",
    path: dirs.stale,
    aiTool: "claude",
    templateId: template.id
  });
  const pMissing = projectRepo.create({
    name: "p-missing",
    path: dirs.missing,
    aiTool: "claude",
    templateId: template.id
  });

  return {
    db,
    userAId: userA.id,
    userBId: userB.id,
    templateId: template.id,
    dirs,
    pCompliantId: pCompliant.id,
    pStaleId: pStale.id,
    pMissingId: pMissing.id,
    projectRepo
  };
}

function expectSyncError(
  promise: Promise<unknown>,
  expectedStatus: number
): Promise<void> {
  return assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof TemplateSyncError);
    assert.equal(error.status, expectedStatus);
    return true;
  });
}

describe("template sync usage", () => {
  it("derives compliant/stale/missing status for linked projects", async () => {
    const fixture = await createFixture();
    const usage = await buildTemplateUsage(fixture.db, fixture.userAId, fixture.templateId);

    assert.equal(usage.templateId, fixture.templateId);
    assert.equal(usage.usageCount, 3);
    const byName = new Map(usage.projects.map((project) => [project.name, project]));
    assert.equal(byName.get("p-compliant")?.configStatus, "compliant");
    assert.equal(byName.get("p-stale")?.configStatus, "stale");
    assert.equal(byName.get("p-missing")?.configStatus, "missing");
    for (const project of usage.projects) {
      assert.ok(project.id);
      assert.ok(project.path);
      assert.equal(project.isImported, false);
    }
  });

  it("filters the project list when explicit projectIds are provided", async () => {
    const fixture = await createFixture();
    const usage = await buildTemplateUsage(
      fixture.db,
      fixture.userAId,
      fixture.templateId,
      [fixture.pStaleId]
    );

    assert.equal(usage.projects.length, 1);
    assert.equal(usage.projects[0].id, fixture.pStaleId);
  });

  it("rejects unknown templates with 404", async () => {
    const fixture = await createFixture();
    await expectSyncError(
      buildTemplateUsage(fixture.db, fixture.userAId, "no-such-template"),
      404
    );
  });

  it("does not leak other tenants' projects when a foreign project id is requested", async () => {
    const fixture = await createFixture();
    const foreignProject = new ProjectRepository(fixture.db, fixture.userBId).create({
      name: "p-foreign",
      path: "/tmp/p-foreign",
      aiTool: "claude",
      templateId: fixture.templateId
    });

    await expectSyncError(
      buildTemplateUsage(fixture.db, fixture.userAId, fixture.templateId, [foreignProject.id]),
      404
    );
  });

  it("rejects more than MAX_SYNC_PROJECTS explicit ids", async () => {
    const fixture = await createFixture();
    const ids = Array.from({ length: MAX_SYNC_PROJECTS + 1 }, (_, index) => `id-${index}`);
    await expectSyncError(
      buildTemplateUsage(fixture.db, fixture.userAId, fixture.templateId, ids),
      400
    );
  });

  it("rejects implicit sync over MAX_SYNC_PROJECTS linked projects", async () => {
    const fixture = await createFixture();
    for (let index = 0; index < MAX_SYNC_PROJECTS; index += 1) {
      fixture.projectRepo.create({
        name: `p-extra-${index}`,
        path: `/tmp/p-extra-${index}`,
        aiTool: "claude",
        templateId: fixture.templateId
      });
    }

    await expectSyncError(
      buildTemplateUsage(fixture.db, fixture.userAId, fixture.templateId),
      400
    );
  });

  it("is not visible to a tenant that cannot read the template", async () => {
    const fixture = await createFixture();
    await expectSyncError(
      buildTemplateUsage(fixture.db, fixture.userBId, fixture.templateId),
      404
    );
  });
});

describe("template sync preview", () => {
  it("reports conflicts and summaries without writing any files", async () => {
    const fixture = await createFixture();
    const preview = await previewTemplateSync(fixture.db, fixture.userAId, fixture.templateId);

    assert.equal(preview.templateId, fixture.templateId);
    assert.equal(preview.projects.length, 3);

    const byId = new Map(preview.projects.map((entry) => [entry.projectId, entry]));
    assert.ok(byId.get(fixture.pCompliantId)?.summary.modifiedFiles.includes("CLAUDE.md") === false);
    assert.ok(byId.get(fixture.pStaleId)?.summary.modifiedFiles.includes("CLAUDE.md"));
    assert.ok(byId.get(fixture.pStaleId)?.summary.requiresDecision.includes("CLAUDE.md"));
    assert.ok(byId.get(fixture.pMissingId)?.summary.missingFiles.includes("CLAUDE.md"));

    assert.equal(existsSync(path.join(fixture.dirs.missing, "CLAUDE.md")), false);
    assert.equal(
      await readFile(path.join(fixture.dirs.stale, "CLAUDE.md"), "utf8"),
      "DIFFERENT\n"
    );
  });
});

describe("template sync apply", () => {
  it("writes missing config files and records activity + audit entries", async () => {
    const fixture = await createFixture();
    const result = await applyTemplateSync(fixture.db, fixture.userAId, fixture.templateId, {
      projectIds: [fixture.pMissingId]
    });

    assert.equal(result.templateId, fixture.templateId);
    assert.equal(result.projects.length, 1);
    const entry = result.projects[0];
    assert.equal(entry.projectId, fixture.pMissingId);
    assert.equal(entry.result?.outcome, "applied");
    assert.ok(entry.result?.writtenFiles.includes("CLAUDE.md"));
    assert.equal(await readFile(path.join(fixture.dirs.missing, "CLAUDE.md"), "utf8"), "T\n");

    const activity = fixture.db
      .prepare(
        "SELECT type, status, project_id AS projectId FROM session_activities WHERE user_id = ? AND project_id = ?"
      )
      .get(fixture.userAId, fixture.pMissingId) as { type: string; status: string };
    assert.equal(activity.type, "config_sync");
    assert.equal(activity.status, "success");

    const audit = fixture.db
      .prepare(
        "SELECT action, resource_type AS resourceType FROM audit_logs WHERE user_id = ? AND resource_id = ?"
      )
      .get(fixture.userAId, fixture.pMissingId) as { action: string };
    assert.equal(audit.action, "project.config_sync");
  });

  it("honors per-project skip decisions and leaves modified files untouched", async () => {
    const fixture = await createFixture();
    const result = await applyTemplateSync(fixture.db, fixture.userAId, fixture.templateId, {
      projectIds: [fixture.pStaleId],
      decisions: {
        [fixture.pStaleId]: { "CLAUDE.md": "skip" }
      }
    });

    const entry = result.projects[0];
    assert.equal(entry.result?.outcome, "applied");
    assert.ok(entry.result?.skippedFiles.includes("CLAUDE.md"));
    assert.equal(await readFile(path.join(fixture.dirs.stale, "CLAUDE.md"), "utf8"), "DIFFERENT\n");
  });

  it("continues with other projects when one project fails", async () => {
    const fixture = await createFixture();
    const blockedParent = await mkdtemp(path.join(tmpdir(), "openforge-tpl-sync-blocked-"));
    const blockedPath = path.join(blockedParent, "not-a-directory");
    await writeFile(blockedPath, "x");
    const pBad = fixture.projectRepo.create({
      name: "p-bad",
      path: blockedPath,
      aiTool: "claude",
      templateId: fixture.templateId
    });

    const result = await applyTemplateSync(fixture.db, fixture.userAId, fixture.templateId, {
      projectIds: [fixture.pMissingId, pBad.id]
    });

    const good = result.projects.find((entry) => entry.projectId === fixture.pMissingId);
    const bad = result.projects.find((entry) => entry.projectId === pBad.id);
    assert.equal(good?.result?.outcome, "applied");
    assert.ok(bad?.error);
    assert.equal(existsSync(path.join(fixture.dirs.missing, "CLAUDE.md")), true);
  });

  it("rejects when the template is not readable by the caller", async () => {
    const fixture = await createFixture();
    await expectSyncError(
      applyTemplateSync(fixture.db, fixture.userBId, fixture.templateId),
      404
    );
  });
});