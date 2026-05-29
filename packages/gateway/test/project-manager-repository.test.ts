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

  it("edits and deletes work items with ledger and audit rows", () => {
    const repo = new ProjectManagerRepository(db, owner.id);
    const item = repo.createWorkItem(projectId, {
      title: "Draft board item",
      description: "Before edit",
      acceptanceCriteria: ["old criterion"]
    });

    const updated = repo.updateWorkItem(projectId, item.id, {
      title: "Refine board item",
      description: null,
      priority: 42,
      acceptanceCriteria: ["new criterion"]
    });
    const removed = repo.deleteWorkItem(projectId, item.id, { confirm: true });

    const events = repo.listLedgerEvents(projectId);
    const itemEvents = events.filter((event) => event.details.targetId === item.id || event.workItemId === item.id);
    const auditLogs = new AuditLogRepository(db, owner.id).list({
      resourceType: "project_manager_work_item",
      resourceId: item.id
    });

    assert.equal(updated.title, "Refine board item");
    assert.equal(updated.description, null);
    assert.equal(updated.priority, 42);
    assert.deepEqual(updated.acceptanceCriteria, ["new criterion"]);
    assert.equal(removed.id, item.id);
    assert.equal(repo.getWorkItem(projectId, item.id), undefined);
    assert.deepEqual(itemEvents.map((event) => event.eventType), [
      "work_item_created",
      "work_item_updated",
      "work_item_deleted"
    ]);
    assert.equal(itemEvents.at(-1)?.workItemId, null);
    assert.equal(itemEvents.at(-1)?.details.targetId, item.id);
    assert.equal(auditLogs.length, 3);
  });

  it("batch-updates work item statuses atomically through transition rules", () => {
    const repo = new ProjectManagerRepository(db, owner.id);
    const first = repo.createWorkItem(projectId, { title: "Move first" });
    const second = repo.createWorkItem(projectId, { title: "Move second" });
    const third = repo.createWorkItem(projectId, { title: "Done without evidence" });
    repo.updateWorkItemStatus(projectId, third.id, { status: "in_progress" });

    assert.throws(
      () => repo.batchUpdateWorkItemStatuses(projectId, {
        updates: [
          { workItemId: first.id, status: "in_progress" },
          { workItemId: third.id, status: "done" }
        ]
      }),
      /evidence|manual completion/i
    );
    assert.equal(repo.getWorkItem(projectId, first.id)?.status, "todo");
    assert.equal(repo.getWorkItem(projectId, third.id)?.status, "in_progress");

    const updated = repo.batchUpdateWorkItemStatuses(projectId, {
      updates: [
        { workItemId: first.id, status: "in_progress" },
        { workItemId: second.id, status: "blocked" }
      ]
    });

    assert.deepEqual(updated.map((item) => [item.id, item.status]), [
      [first.id, "in_progress"],
      [second.id, "blocked"]
    ]);
    assert.equal(repo.listLedgerEvents(projectId, { workItemId: first.id }).at(-1)?.eventType, "work_item_status_changed");
    assert.equal(repo.listLedgerEvents(projectId, { workItemId: second.id }).at(-1)?.eventType, "blocker_recorded");
  });

  it("filters ledger events by type before applying the result limit", () => {
    const repo = new ProjectManagerRepository(db, owner.id);
    const item = repo.createWorkItem(projectId, { title: "Collect evidence" });
    repo.updateWorkItemStatus(projectId, item.id, { status: "in_progress" });
    repo.attachEvidence(projectId, item.id, {
      evidenceRefs: [{ kind: "test", label: "repository", status: "passed", ref: "test/project-manager-repository.test.ts" }]
    });

    const events = repo.listLedgerEvents(projectId, {
      eventType: "evidence_attached",
      limit: 1
    });

    assert.equal(events.length, 1);
    assert.equal(events[0]?.eventType, "evidence_attached");
  });

  it("preserves Copilot pending action evidence refs and safe ledger trace markers", () => {
    const repo = new ProjectManagerRepository(db, owner.id);
    const created = repo.createWorkItem(projectId, {
      title: "Trace Copilot proposal",
      evidenceRefs: [{
        kind: "copilot_run",
        label: "Copilot proposal",
        status: "accepted",
        copilotRunId: "run-create-1",
        pendingActionId: "pa-create-1"
      }],
      details: {
        copilotRunId: "run-create-1",
        pendingActionId: "pa-create-1",
        actionType: "create_work_item",
        targetType: "work_item",
        targetId: "draft-work-item",
        evidenceRefCount: 1,
        approvalStatus: "approved",
        executionStatus: "succeeded"
      }
    });

    const statusChanged = repo.updateWorkItemStatus(projectId, created.id, {
      status: "in_progress",
      evidenceRefs: [{
        kind: "copilot_run",
        label: "Status proposal",
        status: "accepted",
        copilotRunId: "run-status-1",
        pendingActionId: "pa-status-1"
      }],
      details: {
        copilotRunId: "run-status-1",
        pendingActionId: "pa-status-1",
        actionType: "update_work_item_status",
        targetType: "work_item",
        targetId: created.id,
        evidenceRefCount: 2,
        approvalStatus: "approved",
        executionStatus: "succeeded"
      }
    });

    const attached = repo.attachEvidence(projectId, created.id, {
      evidenceRefs: [{
        kind: "copilot_run",
        label: "Attached proposal evidence",
        status: "verified",
        copilotRunId: "run-attach-1",
        pendingActionId: "pa-attach-1"
      }],
      details: {
        copilotRunId: "run-attach-1",
        pendingActionId: "pa-attach-1",
        actionType: "attach_evidence",
        targetType: "work_item",
        targetId: created.id,
        evidenceRefCount: 3,
        approvalStatus: "approved",
        executionStatus: "succeeded"
      }
    });

    const events = repo.listLedgerEvents(projectId, { workItemId: created.id });

    assert.equal(created.evidenceRefs[0]?.pendingActionId, "pa-create-1");
    assert.equal(statusChanged.evidenceRefs.at(-1)?.pendingActionId, "pa-status-1");
    assert.equal(attached.evidenceRefs.at(-1)?.pendingActionId, "pa-attach-1");
    assert.equal(events[0]?.details.pendingActionId, "pa-create-1");
    assert.equal(events[1]?.details.pendingActionId, "pa-status-1");
    assert.equal(events[2]?.details.pendingActionId, "pa-attach-1");
    assert.deepEqual(events[2]?.details, {
      copilotRunId: "run-attach-1",
      pendingActionId: "pa-attach-1",
      actionType: "attach_evidence",
      targetType: "work_item",
      targetId: created.id,
      evidenceRefCount: 3,
      approvalStatus: "approved",
      executionStatus: "succeeded"
    });
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

  it("does not persist raw multiline detail notes into projection, ledger, or audit rows", () => {
    const repo = new ProjectManagerRepository(db, owner.id);
    const rawTranscript = [
      "$ claude --dangerously-skip-permissions",
      `${["std", "out"].join("")}: running command`,
      `${["std", "err"].join("")}: failure output`
    ].join("\n");

    const item = repo.createWorkItem(projectId, {
      title: "Raw detail guard",
      details: { note: rawTranscript }
    });
    const stored = JSON.stringify({
      item: repo.getWorkItem(projectId, item.id),
      events: repo.listLedgerEvents(projectId, { workItemId: item.id }),
      audit: new AuditLogRepository(db, owner.id).list({
        resourceType: "project_manager_work_item",
        resourceId: item.id
      })
    });

    assert.doesNotMatch(stored, /dangerously-skip-permissions|running command|failure output/u);
    assert.match(stored, /\[REDACTED\]/u);
  });

  it("does not persist raw multiline evidence reference values", () => {
    const repo = new ProjectManagerRepository(db, owner.id);
    const rawRef = [
      "$ codex exec unsafe-command",
      `${["std", "out"].join("")}: terminal transcript`,
      `${["std", "err"].join("")}: failure output`
    ].join("\n");

    const item = repo.createWorkItem(projectId, {
      title: "Raw evidence ref guard",
      evidenceRefs: [{
        kind: "test",
        label: "Gateway route evidence",
        status: "passed",
        ref: rawRef
      }]
    });
    const stored = JSON.stringify({
      item: repo.getWorkItem(projectId, item.id),
      events: repo.listLedgerEvents(projectId, { workItemId: item.id }),
      audit: new AuditLogRepository(db, owner.id).list({
        resourceType: "project_manager_work_item",
        resourceId: item.id
      })
    });

    assert.doesNotMatch(stored, /unsafe-command|terminal transcript|failure output/u);
    assert.match(stored, /\[REDACTED\]/u);
  });

  it("keeps terminal snapshot and session evidence references bounded", () => {
    const repo = new ProjectManagerRepository(db, owner.id);
    const item = repo.createWorkItem(projectId, {
      title: "Attach terminal context"
    });
    const sessionId = "session-trace-1";

    const updated = repo.attachEvidence(projectId, item.id, {
      evidenceRefs: [{
        kind: "terminal_snapshot",
        label: "Latest terminal snapshot",
        ref: `terminal-snapshot:${sessionId}:latest`,
        sessionId
      }, {
        kind: "session",
        label: "Session context",
        ref: `session:${sessionId}`,
        sessionId
      }],
      details: {
        note: "bounded marker only",
        rawTerminalOutput: "$ claude --dangerously-skip-permissions\nstdout: secret output"
      }
    });
    const events = repo.listLedgerEvents(projectId, { workItemId: item.id });
    const stored = JSON.stringify({ updated, events });

    assert.deepEqual(updated.evidenceRefs.map((ref) => ref.kind), ["terminal_snapshot", "session"]);
    assert.equal(updated.evidenceRefs[0]?.sessionId, sessionId);
    assert.equal(updated.evidenceRefs[0]?.ref, `terminal-snapshot:${sessionId}:latest`);
    assert.equal(events[1]?.eventType, "evidence_attached");
    assert.equal(events[1]?.evidenceRefs[0]?.sessionId, sessionId);
    assert.doesNotMatch(stored, /dangerously-skip-permissions|secret output/u);
    assert.match(stored, /\[REDACTED\]/u);
  });
});
