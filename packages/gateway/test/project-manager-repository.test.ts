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

  it("preserves the linked taskPacket sessionId across a status change", () => {
    const repo = new ProjectManagerRepository(db, owner.id);
    const item = repo.createWorkItem(projectId, {
      title: "Linked task",
      details: {
        taskPacket: {
          workItemId: "wi-1",
          projectId,
          runtime: { adapter: "claude", templateId: "builtin-claude-code" },
          sessionId: "session-link-123"
        },
        note: "initial"
      }
    });

    // Status change that only patches unrelated details must not wipe the
    // linked session id.
    const updated = repo.updateWorkItemStatus(projectId, item.id, {
      status: "in_progress",
      details: { note: "moving along" }
    });

    const details = updated.details as { taskPacket?: { sessionId?: string }; note?: string };
    assert.equal(details.taskPacket?.sessionId, "session-link-123", "sessionId must survive a status change");
    assert.equal(details.note, "moving along");
  });

  describe("stages", () => {
    it("creates, orders, updates, and deletes stages with tenant scoping", () => {
      const repo = new ProjectManagerRepository(db, owner.id);
      const otherRepo = new ProjectManagerRepository(db, other.id);

      const first = repo.createStage(projectId, { name: "需求分析" });
      const second = repo.createStage(projectId, { name: "编码实现", description: "build it" });
      assert.equal(first.position, 0);
      assert.equal(second.position, 1);
      assert.deepEqual(repo.listStages(projectId).map((stage) => stage.id), [first.id, second.id]);

      const updated = repo.updateStage(projectId, first.id, { name: "需求梳理", status: "completed" });
      assert.equal(updated.name, "需求梳理");
      assert.equal(updated.status, "completed");

      assert.equal(otherRepo.listStages(projectId).length, 0);
      assert.throws(() => otherRepo.updateStage(projectId, first.id, { name: "x" }), /not found/);

      repo.deleteStage(projectId, second.id);
      assert.deepEqual(repo.listStages(projectId).map((stage) => stage.id), [first.id]);
      assert.throws(() => repo.deleteStage(projectId, second.id), /not found/);
    });

    it("seeds the SDLC template once and rejects a second seed", () => {
      const repo = new ProjectManagerRepository(db, owner.id);
      const stages = repo.seedStageTemplate(projectId);
      assert.deepEqual(
        stages.map((stage) => stage.name),
        ["需求分析", "架构设计", "编码实现", "测试验证", "发布交付"]
      );
      assert.deepEqual(stages.map((stage) => stage.position), [0, 1, 2, 3, 4]);
      assert.throws(() => repo.seedStageTemplate(projectId), /already/);
    });

    it("reorders stages with sequential positions and validates the id set", () => {
      const repo = new ProjectManagerRepository(db, owner.id);
      const seeded = repo.seedStageTemplate(projectId);
      const ids = seeded.map((stage) => stage.id);
      const reversed = [...ids].reverse();

      const stages = repo.reorderStages(projectId, reversed);
      assert.deepEqual(stages.map((stage) => stage.id), reversed);
      assert.deepEqual(stages.map((stage) => stage.position), [0, 1, 2, 3, 4]);

      assert.throws(() => repo.reorderStages(projectId, ids.slice(0, 2)), /exactly/);
      assert.throws(() => repo.reorderStages(projectId, [...ids, "missing"]), /exactly/);
    });

    it("deleting a stage moves its work items back to the backlog", () => {
      const repo = new ProjectManagerRepository(db, owner.id);
      const stage = repo.createStage(projectId, { name: "编码实现" });
      const item = repo.createWorkItem(projectId, { title: "实现", stageId: stage.id });
      assert.equal(item.stageId, stage.id);

      repo.deleteStage(projectId, stage.id);
      assert.equal(repo.getWorkItem(projectId, item.id)?.stageId, null);
    });

    it("assigns work items to stages via create and update", () => {
      const repo = new ProjectManagerRepository(db, owner.id);
      const seeded = repo.seedStageTemplate(projectId);
      const first = seeded[0];
      const second = seeded[1];
      assert.ok(first && second);

      const item = repo.createWorkItem(projectId, { title: "任务", stageId: first.id });
      assert.equal(item.stageId, first.id);

      const moved = repo.updateWorkItem(projectId, item.id, { stageId: second.id });
      assert.equal(moved.stageId, second.id);

      const cleared = repo.updateWorkItem(projectId, item.id, { stageId: null });
      assert.equal(cleared.stageId, null);
    });

    it("rejects work items referencing unknown stages", () => {
      const repo = new ProjectManagerRepository(db, owner.id);
      assert.throws(
        () => repo.createWorkItem(projectId, { title: "任务", stageId: "missing-stage" }),
        /stage not found/i
      );
      const item = repo.createWorkItem(projectId, { title: "任务" });
      assert.throws(
        () => repo.updateWorkItem(projectId, item.id, { stageId: "missing-stage" }),
        /stage not found/i
      );
    });
  });

  describe("work item dependencies", () => {
    it("adds, lists, and removes dependencies with ledger events", () => {
      const repo = new ProjectManagerRepository(db, owner.id);
      const design = repo.createWorkItem(projectId, { title: "设计" });
      const build = repo.createWorkItem(projectId, { title: "实现" });

      const link = repo.addWorkItemDependency(projectId, build.id, design.id);
      assert.equal(link.blockerWorkItemId, design.id);
      assert.equal(link.blockedWorkItemId, build.id);
      assert.deepEqual(repo.listWorkItemLinks(projectId).map((entry) => entry.id), [link.id]);

      const addedEvents = repo.listLedgerEvents(projectId, { workItemId: build.id });
      assert.equal(addedEvents.at(-1)?.eventType, "dependency_added");

      repo.removeWorkItemDependency(projectId, build.id, design.id);
      assert.equal(repo.listWorkItemLinks(projectId).length, 0);
      const removedEvents = repo.listLedgerEvents(projectId, { workItemId: build.id });
      assert.equal(removedEvents.at(-1)?.eventType, "dependency_removed");
    });

    it("rejects self links, duplicates, and direct or transitive cycles", () => {
      const repo = new ProjectManagerRepository(db, owner.id);
      const a = repo.createWorkItem(projectId, { title: "A" });
      const b = repo.createWorkItem(projectId, { title: "B" });
      const c = repo.createWorkItem(projectId, { title: "C" });

      assert.throws(() => repo.addWorkItemDependency(projectId, a.id, a.id), /itself/);
      repo.addWorkItemDependency(projectId, b.id, a.id); // b blocked by a
      assert.throws(() => repo.addWorkItemDependency(projectId, b.id, a.id), /already exists/);
      repo.addWorkItemDependency(projectId, c.id, b.id); // c blocked by b
      assert.throws(() => repo.addWorkItemDependency(projectId, a.id, b.id), /cycle/); // direct cycle
      assert.throws(() => repo.addWorkItemDependency(projectId, a.id, c.id), /cycle/); // transitive cycle
    });

    it("rejects dependencies referencing unknown work items", () => {
      const repo = new ProjectManagerRepository(db, owner.id);
      const item = repo.createWorkItem(projectId, { title: "任务" });
      assert.throws(() => repo.addWorkItemDependency(projectId, item.id, "missing"), /not found/);
      assert.throws(() => repo.addWorkItemDependency(projectId, "missing", item.id), /not found/);
      assert.throws(() => repo.removeWorkItemDependency(projectId, item.id, "missing"), /not found/);
    });

    it("removes dependency links when a work item is deleted", () => {
      const repo = new ProjectManagerRepository(db, owner.id);
      const a = repo.createWorkItem(projectId, { title: "A" });
      const b = repo.createWorkItem(projectId, { title: "B" });
      repo.addWorkItemDependency(projectId, b.id, a.id);

      repo.deleteWorkItem(projectId, a.id, { confirm: true });
      assert.equal(repo.listWorkItemLinks(projectId).length, 0);
    });
  });
});
