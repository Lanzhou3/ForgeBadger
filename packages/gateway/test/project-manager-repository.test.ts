import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AuditLogRepository } from "../src/db/repositories/audit-log-repository.js";
import { ProjectManagerRepository } from "../src/db/repositories/project-manager-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { UserRepository, type User } from "../src/db/repositories/user-repository.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const drizzleDb = drizzle(db);
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/db/migrations"
  );
  migrate(drizzleDb, { migrationsFolder });
  return db;
}

describe("ProjectManagerRepository", () => {
  let db: Database.Database;
  let owner: User;
  let other: User;
  let projectId: string;

  beforeEach(() => {
    db = createTestDb();
    const users = new UserRepository(db);
    owner = users.create("pm-owner@example.com", "hash");
    other = users.create("pm-other@example.com", "hash");
    projectId = new ProjectRepository(db, owner.id).create({
      name: "OpenForge",
      path: "/tmp/openforge-pm",
      aiTool: "claude"
    }).id;
  });

  it("keeps goals, work items, and ledger events tenant scoped", () => {
    const ownerRepo = new ProjectManagerRepository(db, owner.id);
    const otherRepo = new ProjectManagerRepository(db, other.id);

    const goal = ownerRepo.upsertGoal(projectId, {
      summary: "Ship project manager ledger",
      acceptanceCriteria: ["tenant scoped"]
    });
    const item = ownerRepo.createWorkItem(projectId, {
      title: "Implement repository",
      acceptanceCriteria: ["ledger event recorded"]
    });

    assert.equal(ownerRepo.getGoal(projectId)?.id, goal.id);
    assert.equal(otherRepo.getGoal(projectId), undefined);
    assert.equal(ownerRepo.getWorkItem(projectId, item.id)?.id, item.id);
    assert.equal(otherRepo.getWorkItem(projectId, item.id), undefined);
    assert.equal(ownerRepo.listLedgerEvents(projectId).length, 2);
    assert.deepEqual(otherRepo.listLedgerEvents(projectId), []);
  });

  it("updates projection, appends one ledger event, and writes one audit row per mutation", () => {
    const repo = new ProjectManagerRepository(db, owner.id);

    const item = repo.createWorkItem(projectId, {
      title: "Run validation",
      acceptanceCriteria: ["tests pass"]
    });
    const createdEvents = repo.listLedgerEvents(projectId, { workItemId: item.id });
    const createdAudit = new AuditLogRepository(db, owner.id).list({
      resourceType: "project_manager_work_item",
      resourceId: item.id
    });

    assert.equal(item.status, "todo");
    assert.equal(createdEvents.length, 1);
    assert.equal(createdEvents[0]?.eventType, "work_item_created");
    assert.equal(createdAudit.length, 1);

    const updated = repo.updateWorkItemStatus(projectId, item.id, {
      status: "in_progress",
      details: { reason: "Started implementation" }
    });
    const events = repo.listLedgerEvents(projectId, { workItemId: item.id });
    const auditLogs = new AuditLogRepository(db, owner.id).list({
      resourceType: "project_manager_work_item",
      resourceId: item.id
    });

    assert.equal(updated.status, "in_progress");
    assert.equal(events.length, 2);
    assert.equal(events[1]?.eventType, "work_item_status_changed");
    assert.equal(auditLogs.length, 2);
  });

  it("rejects done without evidence or manual completion reason before writing rows", () => {
    const repo = new ProjectManagerRepository(db, owner.id);
    const item = repo.createWorkItem(projectId, { title: "Close item" });
    repo.updateWorkItemStatus(projectId, item.id, { status: "in_progress" });
    const beforeEvents = repo.listLedgerEvents(projectId, { workItemId: item.id }).length;
    const beforeAudit = new AuditLogRepository(db, owner.id).list({
      resourceType: "project_manager_work_item",
      resourceId: item.id
    }).length;

    assert.throws(
      () => repo.updateWorkItemStatus(projectId, item.id, { status: "done" }),
      /evidence|manual completion/i
    );

    assert.equal(repo.getWorkItem(projectId, item.id)?.status, "in_progress");
    assert.equal(repo.listLedgerEvents(projectId, { workItemId: item.id }).length, beforeEvents);
    assert.equal(new AuditLogRepository(db, owner.id).list({
      resourceType: "project_manager_work_item",
      resourceId: item.id
    }).length, beforeAudit);
  });

  it("records manual completion as the single done ledger event", () => {
    const repo = new ProjectManagerRepository(db, owner.id);
    const item = repo.createWorkItem(projectId, { title: "Manual verification" });
    repo.updateWorkItemStatus(projectId, item.id, { status: "in_progress" });

    const updated = repo.updateWorkItemStatus(projectId, item.id, {
      status: "done",
      manualCompletionReason: "Maintainer verified local smoke evidence."
    });
    const events = repo.listLedgerEvents(projectId, { workItemId: item.id });

    assert.equal(updated.status, "done");
    assert.equal(events.length, 3);
    assert.equal(events[2]?.eventType, "manual_completion_recorded");
    assert.equal(JSON.stringify(events[2]).includes("Maintainer verified"), false);
  });

  it("normalizes secret-like evidence and details before ledger or audit persistence", () => {
    const repo = new ProjectManagerRepository(db, owner.id);
    const apiKey = ["sk", "secret-value"].join("-");
    const cliSecret = ["sk", ["cli-std", "err-secret"].join("")].join("-");
    const authRef = ["Authorization:", "Bearer jwt.secret.value"].join(" ");
    const signature = ["X-Lark", "Signature: secret-signature"].join("-");
    const stdErrKey = ["std", "err"].join("");
    const rawCliStdErrKey = ["rawCliStd", "err"].join("");
    const item = repo.createWorkItem(projectId, {
      title: "Redact evidence",
      details: {
        apiKey,
        rawTerminalOutput: "OPENFORGE_ATTACH_TOKEN=attach-secret",
        [stdErrKey]: "Bearer jwt.secret.value",
        eventEncryptKey: "feishu-event-secret",
        providerCredential: "provider-secret"
      }
    });

    repo.attachEvidence(projectId, item.id, {
      evidenceRefs: [{
        kind: "test",
        label: "Gateway test",
        status: "passed",
        ref: authRef,
        path: "packages/gateway/test/project-manager-repository.test.ts"
      }],
      details: {
        signature,
        [rawCliStdErrKey]: cliSecret
      }
    });

    const stored = JSON.stringify({
      item: repo.getWorkItem(projectId, item.id),
      events: repo.listLedgerEvents(projectId, { workItemId: item.id }),
      audit: new AuditLogRepository(db, owner.id).list({
        resourceType: "project_manager_work_item",
        resourceId: item.id
      })
    });

    assert.doesNotMatch(stored, new RegExp([[ "sk", "secret-value" ].join("-"), "attach-secret", "jwt\\.secret\\.value", "feishu-event-secret"].join("|"), "u"));
    assert.doesNotMatch(stored, new RegExp(["provider-secret", "secret-signature", ["sk", "cli-std", "err-secret"].join("-")].join("|"), "u"));
    assert.match(stored, /\[REDACTED\]/u);
  });
});
