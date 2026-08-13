import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { CopilotAutomationRepository } from "../src/db/repositories/copilot-automation-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { UserRepository, type User } from "../src/db/repositories/user-repository.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
  return db;
}

describe("CopilotAutomationRepository", () => {
  let db: Database.Database;
  let owner: User;
  let other: User;
  let repo: CopilotAutomationRepository;
  let otherRepo: CopilotAutomationRepository;

  beforeEach(() => {
    db = createTestDb();
    const users = new UserRepository(db);
    owner = users.create("automation-owner@example.com", "hash");
    other = users.create("automation-other@example.com", "hash");
    repo = new CopilotAutomationRepository(db, owner.id);
    otherRepo = new CopilotAutomationRepository(db, other.id);
  });

  it("creates project and workspace automations within the tenant", () => {
    const automation = createAutomation(repo);
    createAutomation(otherRepo, "Other workspace report");

    assert.equal(automation.revision, 1);
    assert.equal(repo.list().length, 1);
    assert.equal(otherRepo.get(automation.id), undefined);
  });

  it("rejects stale optimistic revisions without overwriting", () => {
    const automation = createAutomation(repo);
    const updated = repo.updateWithRevision(automation.id, 1, { name: "Updated weekly report" });

    assert.equal(updated.revision, 2);
    assert.throws(
      () => repo.updateWithRevision(automation.id, 1, { name: "Stale update" }),
      /AUTOMATION_REVISION_CONFLICT/
    );
    assert.equal(repo.get(automation.id)?.name, "Updated weekly report");
  });

  it("creates at most one run for each stable scheduled slot", () => {
    const automation = createAutomation(repo);
    const first = repo.createOrGetRun(automation.id, "2026-08-17T01:00:00.000Z", "scheduled");
    const duplicate = repo.createOrGetRun(automation.id, "2026-08-17T01:00:00.000Z", "scheduled");

    assert.equal(first.id, duplicate.id);
    assert.equal(first.executionId, duplicate.executionId);
    assert.equal(repo.listRuns(automation.id).length, 1);
  });

  it("recovers expired run leases and persists the exact project snapshot", () => {
    const projects = new ProjectRepository(db, owner.id);
    const firstProject = projects.create({ name: "First", path: "/tmp/first", aiTool: "claude" });
    const secondProject = projects.create({ name: "Second", path: "/tmp/second", aiTool: "codex" });
    const automation = createAutomation(repo);
    repo.createOrGetRun(automation.id, "2026-08-17T01:00:00.000Z", "scheduled");

    const dueAt = Date.parse("2026-08-17T01:00:00.000Z");
    const first = repo.claimDueRun(new Date(dueAt), 50);
    assert.ok(first?.claimToken);
    assert.equal(repo.claimDueRun(new Date(dueAt + 25), 50), undefined);
    const recovered = repo.claimDueRun(new Date(dueAt + 51), 50);
    assert.equal(recovered?.id, first?.id);
    assert.notEqual(recovered?.claimToken, first?.claimToken);

    repo.saveProjectSnapshot(recovered!.id, recovered!.claimToken!, [
      { projectId: firstProject.id, name: firstProject.name },
      { projectId: secondProject.id, name: secondProject.name }
    ]);
    assert.deepEqual(
      repo.listProjectSnapshots(recovered!.id).map((item) => item.projectId),
      [firstProject.id, secondProject.id]
    );
  });
});

function createAutomation(repo: CopilotAutomationRepository, name = "Weekly workspace report") {
  return repo.create({
    name,
    status: "active",
    scopeType: "workspace",
    scopePolicy: { mode: "all_current_projects" },
    prompt: "Summarize progress, blockers, and next actions.",
    scheduleKind: "cron",
    scheduleExpression: "0 9 * * 1",
    timezone: "Asia/Shanghai",
    deliveryPlan: { channel: "feishu", accountId: "default", chatId: "oc_weekly" },
    authoritySnapshot: { mode: "observe", tools: ["project.read"] },
    nextRunAt: new Date(0)
  });
}
