import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { signJwt } from "../src/auth/jwt.js";
import { AuditLogRepository } from "../src/db/repositories/audit-log-repository.js";
import { ProjectManagerRepository } from "../src/db/repositories/project-manager-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { SessionRepository } from "../src/db/repositories/session-repository.js";
import { UserRepository, type User } from "../src/db/repositories/user-repository.js";
import { createProjectManagerRoutes } from "../src/routes/project-manager.js";

const secret = "0123456789abcdef0123456789abcdef";

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

describe("project-manager routes", () => {
  let db: Database.Database;
  let app: express.Express;
  let owner: User;
  let other: User;
  let projectId: string;
  let token: string;

  beforeEach(() => {
    db = createTestDb();
    const users = new UserRepository(db);
    owner = users.create("pm-route-owner@example.com", "hash");
    other = users.create("pm-route-other@example.com", "hash");
    projectId = new ProjectRepository(db, owner.id).create({
      name: "OpenForge",
      path: "/tmp/openforge-route-pm",
      aiTool: "claude"
    }).id;
    token = signJwt({ userId: owner.id, email: owner.email }, secret);

    app = express();
    app.locals.jwtSecret = secret;
    app.use(express.json());
    app.use("/api/v1/projects", createProjectManagerRoutes(db));
  });

  it("returns canonical envelopes for authenticated owner project-manager requests", async () => {
    const goalUpsert = await request("PUT", `/api/v1/projects/${projectId}/project-manager/goal`, {
      summary: "Close Phase 4",
      constraints: ["No Feishu terminal authority"],
      acceptanceCriteria: ["ledger is auditable"]
    });
    const goalRead = await request("GET", `/api/v1/projects/${projectId}/project-manager/goal`);
    const created = await request("POST", `/api/v1/projects/${projectId}/project-manager/work-items`, {
      title: "Implement routes",
      acceptanceCriteria: ["route tests pass"]
    });
    const itemId = created.body.data.workItem.id as string;
    const listed = await request("GET", `/api/v1/projects/${projectId}/project-manager/work-items?limit=10`);
    const detail = await request("GET", `/api/v1/projects/${projectId}/project-manager/work-items/${itemId}`);
    const status = await request("PATCH", `/api/v1/projects/${projectId}/project-manager/work-items/${itemId}/status`, {
      status: "in_progress"
    });
    const evidence = await request("POST", `/api/v1/projects/${projectId}/project-manager/work-items/${itemId}/evidence`, {
      evidenceRefs: [{ kind: "test", label: "route suite", status: "passed", ref: "test/project-manager-routes.test.ts" }]
    });
    const ledger = await request("GET", `/api/v1/projects/${projectId}/project-manager/ledger?limit=10`);

    for (const response of [goalUpsert, goalRead, created, listed, detail, status, evidence, ledger]) {
      assert.equal(response.status, response === created ? 201 : 200);
      assert.equal(response.body.code, 0);
      assert.equal(response.body.message, "");
      assert.equal(typeof response.body.data, "object");
    }
    assert.equal(goalRead.body.data.goal.summary, "Close Phase 4");
    assert.equal(listed.body.data.workItems.length, 1);
    assert.equal(detail.body.data.workItem.id, itemId);
    assert.equal(status.body.data.workItem.status, "in_progress");
    assert.equal(evidence.body.data.workItem.evidenceRefCount, 1);
    assert.equal(ledger.body.data.events.length, 4);
  });

  it("returns a bounded task packet derived from a work item without raw details", async () => {
    const item = new ProjectManagerRepository(db, owner.id).createWorkItem(projectId, {
      title: "Fix launch readiness",
      description: "Make the dashboard show blockers before terminal launch.",
      acceptanceCriteria: ["Runtime blockers are visible", "CLI adapters are checked"],
      details: {
        rawTerminalOutput: "$ claude unsafe",
        taskPacket: {
          expectedVerification: ["pnpm --dir packages/web typecheck"],
          evidenceRequirements: ["typecheck output", "browser smoke"]
        }
      }
    });

    const response = await request("GET", `/api/v1/projects/${projectId}/project-manager/work-items/${item.id}/task-packet`);
    const serialized = JSON.stringify(response.body);

    assert.equal(response.status, 200);
    assert.equal(response.body.code, 0);
    assert.equal(response.body.data.taskPacket.workItemId, item.id);
    assert.equal(response.body.data.taskPacket.projectId, projectId);
    assert.equal(response.body.data.taskPacket.runtime.adapter, "claude");
    assert.equal(response.body.data.taskPacket.runtime.templateId, "builtin-claude-code");
    assert.match(response.body.data.taskPacket.prompt, /Fix launch readiness/u);
    assert.deepEqual(response.body.data.taskPacket.acceptanceCriteria, [
      "Runtime blockers are visible",
      "CLI adapters are checked"
    ]);
    assert.deepEqual(response.body.data.taskPacket.expectedVerification, [
      "pnpm --dir packages/web typecheck"
    ]);
    assert.deepEqual(response.body.data.taskPacket.evidenceRequirements, [
      "typecheck output",
      "browser smoke"
    ]);
    assert.equal(response.body.data.taskPacket.sessionLink, null);
    assert.equal(response.body.data.taskPacket.blockedReason, "no_linked_session");
    assert.doesNotMatch(serialized, /unsafe|rawTerminalOutput|details/u);
  });

  it("lists task packets as a work queue without raw details", async () => {
    const repo = new ProjectManagerRepository(db, owner.id);
    const planned = repo.createWorkItem(projectId, {
      title: "Plan task",
      status: "todo",
      acceptanceCriteria: ["planned queue"],
      details: { rawTerminalOutput: "$ unsafe" }
    });
    const running = repo.createWorkItem(projectId, {
      title: "Run task",
      status: "in_progress",
      acceptanceCriteria: ["running queue"]
    });
    const waiting = repo.createWorkItem(projectId, {
      title: "Review task",
      status: "ready_for_review",
      acceptanceCriteria: ["review queue"]
    });
    const blocked = repo.createWorkItem(projectId, {
      title: "Blocked task",
      status: "blocked",
      acceptanceCriteria: ["blocked queue"]
    });
    const completed = repo.createWorkItem(projectId, {
      title: "Done task",
      status: "done",
      acceptanceCriteria: ["completed queue"]
    });

    const response = await request("GET", `/api/v1/projects/${projectId}/project-manager/task-packets?limit=10`);
    const packets = response.body.data.taskPackets as Array<{
      workItemId: string;
      workItemStatus: string;
      queueStatus: string;
      title: string;
    }>;
    const byId = new Map(packets.map((packet) => [packet.workItemId, packet]));
    const serialized = JSON.stringify(response.body);

    assert.equal(response.status, 200);
    assert.equal(response.body.code, 0);
    assert.equal(packets.length, 5);
    assert.equal(byId.get(planned.id)?.queueStatus, "planned");
    assert.equal(byId.get(running.id)?.queueStatus, "running");
    assert.equal(byId.get(waiting.id)?.queueStatus, "waiting_for_review");
    assert.equal(byId.get(blocked.id)?.queueStatus, "blocked");
    assert.equal(byId.get(completed.id)?.queueStatus, "completed");
    assert.equal(byId.get(planned.id)?.workItemStatus, "todo");
    assert.doesNotMatch(serialized, /unsafe|rawTerminalOutput|details/u);
  });

  it("links exactly one same-project session to a task packet and rejects cross-project sessions", async () => {
    const repo = new ProjectManagerRepository(db, owner.id);
    const item = repo.createWorkItem(projectId, {
      title: "Run task from work item",
      acceptanceCriteria: ["session is linked once"]
    });
    const sessionRepo = new SessionRepository(db, owner.id);
    const session = sessionRepo.create({
      projectId,
      name: "Run task from work item",
      aiTool: "claude",
      workingDir: "/tmp/openforge-route-pm",
      credentialMode: "host_environment"
    });
    sessionRepo.update(session.id, { status: "running", tmuxSession: "of-task-packet" });
    const otherProjectId = new ProjectRepository(db, owner.id).create({
      name: "Other project",
      path: "/tmp/openforge-other-task-packet",
      aiTool: "claude"
    }).id;
    const crossProjectSession = sessionRepo.create({
      projectId: otherProjectId,
      name: "Wrong project",
      aiTool: "claude",
      workingDir: "/tmp/openforge-other-task-packet",
      credentialMode: "host_environment"
    });

    const rejected = await request("POST", `/api/v1/projects/${projectId}/project-manager/work-items/${item.id}/task-packet/session-link`, {
      sessionId: crossProjectSession.id
    });
    const linked = await request("POST", `/api/v1/projects/${projectId}/project-manager/work-items/${item.id}/task-packet/session-link`, {
      sessionId: session.id
    });
    const relinked = await request("POST", `/api/v1/projects/${projectId}/project-manager/work-items/${item.id}/task-packet/session-link`, {
      sessionId: session.id
    });
    const detail = await request("GET", `/api/v1/projects/${projectId}/project-manager/work-items/${item.id}/task-packet`);

    assert.equal(rejected.status, 404);
    assert.deepEqual(rejected.body, { code: 1, message: "Session not found" });
    assert.equal(linked.status, 200);
    assert.equal(linked.body.code, 0);
    assert.equal(linked.body.data.taskPacket.sessionLink.sessionId, session.id);
    assert.equal(linked.body.data.taskPacket.sessionLink.status, "running");
    assert.equal(linked.body.data.taskPacket.blockedReason, null);
    assert.equal(relinked.status, 200);
    assert.equal(detail.body.data.taskPacket.sessionLink.sessionId, session.id);
    const stored = repo.getWorkItem(projectId, item.id);
    assert.equal((stored?.details.taskPacket as { sessionId?: string } | undefined)?.sessionId, session.id);
  });

  it("starts a task packet by creating one idle session without storing the prompt", async () => {
    const repo = new ProjectManagerRepository(db, owner.id);
    const item = repo.createWorkItem(projectId, {
      title: "Fix task launch",
      description: "Prepare a safe operator handoff for this task.",
      acceptanceCriteria: ["one session is created", "prompt is derived on read"],
      details: {
        taskPacket: {
          expectedVerification: ["pnpm --dir packages/gateway test"],
          evidenceRequirements: ["route test output"]
        }
      }
    });

    const started = await request("POST", `/api/v1/projects/${projectId}/project-manager/work-items/${item.id}/task-packet/start`);
    const repeated = await request("POST", `/api/v1/projects/${projectId}/project-manager/work-items/${item.id}/task-packet/start`);
    const sessions = new SessionRepository(db, owner.id).listByProject(projectId);
    const stored = repo.getWorkItem(projectId, item.id);
    const serializedDetails = JSON.stringify(stored?.details ?? {});

    assert.equal(started.status, 201);
    assert.equal(started.body.code, 0);
    assert.equal(started.body.data.session.projectId, projectId);
    assert.equal(started.body.data.session.name, "Task: Fix task launch");
    assert.equal(started.body.data.session.status, "idle");
    assert.equal(started.body.data.session.attachToken, undefined);
    assert.equal(started.body.data.taskPacket.sessionLink.sessionId, started.body.data.session.id);
    assert.equal(started.body.data.taskPacket.sessionLink.status, "idle");
    assert.equal(started.body.data.taskPacket.blockedReason, "linked_session_not_running");
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.data.session.id, started.body.data.session.id);
    assert.equal(sessions.length, 1);
    assert.equal((stored?.details.taskPacket as { sessionId?: string } | undefined)?.sessionId, started.body.data.session.id);
    assert.match(serializedDetails, /promptDigest/u);
    assert.doesNotMatch(serializedDetails, /Prepare a safe operator handoff|Acceptance criteria/u);
  });

  it("lists built-in starter packs with bounded task packet guidance", async () => {
    const response = await request("GET", `/api/v1/projects/${projectId}/project-manager/starter-packs`);
    const packs = response.body.data.starterPacks as Array<{
      id: string;
      recommendedAdapter: string;
      promptFrame: string;
      acceptanceChecklist: string[];
      verificationGuidance: string[];
      evidenceFields: string[];
    }>;
    const serialized = JSON.stringify(response.body);

    assert.equal(response.status, 200);
    assert.equal(response.body.code, 0);
    assert.deepEqual(packs.map((pack) => pack.id), [
      "code-review",
      "bugfix",
      "docs-sync",
      "test-generation",
      "release-notes",
      "first-user-evidence"
    ]);
    for (const pack of packs) {
      assert.equal(pack.recommendedAdapter.length > 0, true);
      assert.equal(pack.promptFrame.length > 0, true);
      assert.equal(pack.acceptanceChecklist.length > 0, true);
      assert.equal(pack.verificationGuidance.length > 0, true);
      assert.equal(pack.evidenceFields.length > 0, true);
    }
    assert.doesNotMatch(serialized, /api[_-]?key|secret|authorization|attachToken|rawTerminal|terminal transcript/iu);
  });

  it("creates task packets from starter packs through existing work items", async () => {
    const packIds = ["code-review", "bugfix", "docs-sync"];
    const created = [];

    for (const packId of packIds) {
      const response = await request(
        "POST",
        `/api/v1/projects/${projectId}/project-manager/starter-packs/${packId}/task-packet`
      );
      created.push(response);
    }

    const sessions = new SessionRepository(db, owner.id).listByProject(projectId);
    const workItems = new ProjectManagerRepository(db, owner.id).listWorkItems(projectId, { limit: 10 });
    const serialized = JSON.stringify(created.map((response) => response.body));

    for (const response of created) {
      assert.equal(response.status, 201);
      assert.equal(response.body.code, 0);
      assert.equal(response.body.data.pack.id.length > 0, true);
      assert.equal(response.body.data.workItem.status, "todo");
      assert.equal(response.body.data.taskPacket.workItemId, response.body.data.workItem.id);
      assert.equal(response.body.data.taskPacket.blockedReason, "no_linked_session");
      assert.deepEqual(
        response.body.data.taskPacket.expectedVerification,
        response.body.data.pack.verificationGuidance
      );
      assert.deepEqual(
        response.body.data.taskPacket.evidenceRequirements,
        response.body.data.pack.evidenceFields
      );
      assert.match(response.body.data.taskPacket.prompt, new RegExp(response.body.data.pack.promptFrame.slice(0, 24), "u"));
    }
    assert.equal(sessions.length, 0);
    assert.equal(workItems.length, 3);
    assert.doesNotMatch(serialized, /api[_-]?key|secret|authorization|attachToken|rawTerminal|terminal transcript/iu);
  });

  it("returns 404 for missing or cross-tenant projects without leaking ownership", async () => {
    const foreignProject = new ProjectRepository(db, other.id).create({
      name: "Foreign",
      path: "/tmp/foreign-pm",
      aiTool: "claude"
    });

    const missing = await request("GET", "/api/v1/projects/missing-project/project-manager/goal");
    const foreign = await request("GET", `/api/v1/projects/${foreignProject.id}/project-manager/goal`);

    assert.equal(missing.status, 404);
    assert.deepEqual(missing.body, { code: 1, message: "Project not found" });
    assert.equal(foreign.status, 404);
    assert.deepEqual(foreign.body, { code: 1, message: "Project not found" });
  });

  it("rejects invalid input without writing ledger or audit rows", async () => {
    const repo = new ProjectManagerRepository(db, owner.id);
    const item = repo.createWorkItem(projectId, { title: "Validate routes" });
    const beforeEvents = repo.listLedgerEvents(projectId, { workItemId: item.id }).length;
    const beforeProjectEvents = repo.listLedgerEvents(projectId).length;
    const beforeAudit = new AuditLogRepository(db, owner.id).list({
      resourceType: "project_manager_work_item",
      resourceId: item.id
    }).length;

    const invalidStatus = await request("PATCH", `/api/v1/projects/${projectId}/project-manager/work-items/${item.id}/status`, {
      status: "invalid"
    });
    const invalidEvidence = await request("POST", `/api/v1/projects/${projectId}/project-manager/work-items/${item.id}/evidence`, {
      evidenceRefs: [{ kind: "test", unexpected: "field" }]
    });
    const overLimit = await request("GET", `/api/v1/projects/${projectId}/project-manager/work-items?limit=101`);
    const invalidEventType = await request("GET", `/api/v1/projects/${projectId}/project-manager/ledger?eventType=raw_terminal_output`);
    const rawDetails = await request("POST", `/api/v1/projects/${projectId}/project-manager/work-items`, {
      title: "Raw details",
      details: {
        note: [
          "$ claude --dangerously-skip-permissions",
          `${["std", "out"].join("")}: transcript`,
          `${["std", "err"].join("")}: failure`
        ].join("\n")
      }
    });

    for (const response of [invalidStatus, invalidEvidence, overLimit, invalidEventType, rawDetails]) {
      assert.equal(response.status, 400);
      assert.equal(response.body.code, 1);
    }
    assert.equal(repo.getWorkItem(projectId, item.id)?.status, "todo");
    assert.equal(repo.listLedgerEvents(projectId, { workItemId: item.id }).length, beforeEvents);
    assert.equal(repo.listLedgerEvents(projectId).length, beforeProjectEvents);
    assert.equal(new AuditLogRepository(db, owner.id).list({
      resourceType: "project_manager_work_item",
      resourceId: item.id
    }).length, beforeAudit);
  });

  it("rejects done status without evidence or manual completion reason and leaves the item unchanged", async () => {
    const repo = new ProjectManagerRepository(db, owner.id);
    const item = repo.createWorkItem(projectId, { title: "Done gate" });
    repo.updateWorkItemStatus(projectId, item.id, { status: "in_progress" });

    const res = await request("PATCH", `/api/v1/projects/${projectId}/project-manager/work-items/${item.id}/status`, {
      status: "done"
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.code, 1);
    assert.equal(repo.getWorkItem(projectId, item.id)?.status, "in_progress");
  });

  it("filters ledger events by type before applying the response limit", async () => {
    const repo = new ProjectManagerRepository(db, owner.id);
    const item = repo.createWorkItem(projectId, { title: "Ledger filter" });
    repo.updateWorkItemStatus(projectId, item.id, { status: "in_progress" });
    await request("POST", `/api/v1/projects/${projectId}/project-manager/work-items/${item.id}/evidence`, {
      evidenceRefs: [{ kind: "test", label: "route", status: "passed", ref: "test/project-manager-routes.test.ts" }]
    });

    const response = await request("GET", `/api/v1/projects/${projectId}/project-manager/ledger?eventType=evidence_attached&limit=1`);

    assert.equal(response.status, 200);
    assert.equal(response.body.code, 0);
    assert.equal(response.body.data.events.length, 1);
    assert.equal(response.body.data.events[0].eventType, "evidence_attached");
  });

  it("updates, deletes, and batch-moves work items through tenant-scoped routes", async () => {
    const repo = new ProjectManagerRepository(db, owner.id);
    const first = repo.createWorkItem(projectId, { title: "Board first" });
    const second = repo.createWorkItem(projectId, { title: "Board second" });
    const deleted = repo.createWorkItem(projectId, { title: "Board deleted" });

    const edit = await request("PATCH", `/api/v1/projects/${projectId}/project-manager/work-items/${first.id}`, {
      title: "Board first edited",
      description: "Edited from the board",
      priority: 9,
      acceptanceCriteria: ["board edit is saved"]
    });
    const invalidDelete = await request("DELETE", `/api/v1/projects/${projectId}/project-manager/work-items/${deleted.id}`, {
      confirm: false
    });
    const deleteRes = await request("DELETE", `/api/v1/projects/${projectId}/project-manager/work-items/${deleted.id}`, {
      confirm: true
    });
    const invalidBatch = await request("POST", `/api/v1/projects/${projectId}/project-manager/work-items/batch/status`, {
      updates: [
        { workItemId: first.id, status: "done" }
      ]
    });
    assert.equal(invalidBatch.status, 400);
    assert.equal(repo.getWorkItem(projectId, first.id)?.status, "todo");

    const batch = await request("POST", `/api/v1/projects/${projectId}/project-manager/work-items/batch/status`, {
      updates: [
        { workItemId: first.id, status: "in_progress" },
        { workItemId: second.id, status: "blocked" }
      ]
    });
    const ledger = await request("GET", `/api/v1/projects/${projectId}/project-manager/ledger?limit=20`);

    assert.equal(edit.status, 200);
    assert.equal(edit.body.data.workItem.title, "Board first edited");
    assert.equal(edit.body.data.workItem.priority, 9);
    assert.equal(invalidDelete.status, 400);
    assert.equal(deleteRes.status, 200);
    assert.equal(deleteRes.body.data.workItem.id, deleted.id);
    assert.equal(repo.getWorkItem(projectId, deleted.id), undefined);
    assert.equal(batch.status, 200);
    assert.deepEqual(batch.body.data.workItems.map((item: { id: string; status: string }) => [item.id, item.status]), [
      [first.id, "in_progress"],
      [second.id, "blocked"]
    ]);
    assert.ok(ledger.body.data.events.some((event: { eventType: string }) => event.eventType === "work_item_updated"));
    assert.ok(ledger.body.data.events.some((event: { eventType: string; trace?: { targetId?: string } }) =>
      event.eventType === "work_item_deleted" && event.trace?.targetId === deleted.id
    ));
  });

  it("returns pending action evidence refs and bounded ledger trace without raw details", async () => {
    const repo = new ProjectManagerRepository(db, owner.id);
    const rawPromptKey = ["raw", "Prompt"].join("");
    const providerPayloadKey = ["provider", "Payload"].join("");
    const approvalDiffKey = ["approval", "Diff"].join("");
    const executionSummaryKey = ["execution", "Summary"].join("");
    const stdOutKey = ["std", "out"].join("");
    const tokenKey = ["api", "Token"].join("");
    const item = repo.createWorkItem(projectId, {
      title: "Trace route item",
      details: {
        copilotRunId: "route-run-1",
        pendingActionId: "route-pa-create-1",
        actionType: "create_work_item",
        targetType: "work_item",
        targetId: "route-draft-item",
        evidenceRefCount: 0,
        approvalStatus: "approved",
        executionStatus: "succeeded",
        [rawPromptKey]: "summarize the terminal output",
        [providerPayloadKey]: "{ model: 'unsafe' }",
        [approvalDiffKey]: "+ secret diff",
        [executionSummaryKey]: "full execution summary",
        [stdOutKey]: "terminal output",
        [tokenKey]: "fake-route-token"
      }
    });

    const evidence = await request("POST", `/api/v1/projects/${projectId}/project-manager/work-items/${item.id}/evidence`, {
      evidenceRefs: [{
        kind: "copilot_run",
        label: "Approved Copilot action",
        status: "verified",
        ref: "copilot://runs/route-run-1/actions/route-pa-attach-1",
        copilotRunId: "route-run-1",
        pendingActionId: "route-pa-attach-1"
      }]
    });
    const ledger = await request("GET", `/api/v1/projects/${projectId}/project-manager/ledger?limit=10`);
    const traceEvent = ledger.body.data.events.find((event: { eventType: string }) => event.eventType === "work_item_created");
    const serialized = JSON.stringify({ evidence: evidence.body, ledger: ledger.body });

    assert.equal(evidence.status, 200);
    assert.equal(evidence.body.code, 0);
    assert.equal(evidence.body.data.workItem.evidenceRefs.at(-1).pendingActionId, "route-pa-attach-1");
    assert.equal(ledger.status, 200);
    assert.equal(ledger.body.code, 0);
    assert.deepEqual(traceEvent.trace, {
      copilotRunId: "route-run-1",
      pendingActionId: "route-pa-create-1",
      actionType: "create_work_item",
      targetType: "work_item",
      targetId: "route-draft-item",
      evidenceRefCount: 0,
      approvalStatus: "approved",
      executionStatus: "succeeded"
    });
    assert.equal("details" in traceEvent, false);
    assertRawRouteDataExcluded(serialized);
  });

  it("keeps cross-tenant ledger trace markers inaccessible", async () => {
    const foreignProject = new ProjectRepository(db, other.id).create({
      name: "Foreign trace",
      path: "/tmp/foreign-trace-pm",
      aiTool: "claude"
    });
    new ProjectManagerRepository(db, other.id).createWorkItem(foreignProject.id, {
      title: "Foreign trace item",
      details: {
        copilotRunId: "foreign-run-1",
        pendingActionId: "foreign-pa-1",
        actionType: "create_work_item",
        targetType: "work_item",
        targetId: "foreign-item",
        evidenceRefCount: 0,
        approvalStatus: "approved",
        executionStatus: "succeeded"
      }
    });

    const response = await request("GET", `/api/v1/projects/${foreignProject.id}/project-manager/ledger`);
    const serialized = JSON.stringify(response.body);

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { code: 1, message: "Project not found" });
    assert.equal(serialized.includes("foreign-run-1"), false);
    assert.equal(serialized.includes("foreign-pa-1"), false);
  });

  it("redacts raw multiline evidence references before route responses", async () => {
    const repo = new ProjectManagerRepository(db, owner.id);
    const item = repo.createWorkItem(projectId, { title: "Evidence ref guard" });
    const rawRef = [
      "$ codex exec unsafe-command",
      `${["std", "out"].join("")}: transcript`,
      `${["std", "err"].join("")}: failure`
    ].join("\n");

    const evidence = await request("POST", `/api/v1/projects/${projectId}/project-manager/work-items/${item.id}/evidence`, {
      evidenceRefs: [{ kind: "test", label: "raw evidence", status: "passed", ref: rawRef }]
    });
    const detail = await request("GET", `/api/v1/projects/${projectId}/project-manager/work-items/${item.id}`);
    const serialized = JSON.stringify({ evidence: evidence.body, detail: detail.body });

    assert.equal(evidence.status, 200);
    assert.doesNotMatch(serialized, /unsafe-command|transcript|failure/u);
    assert.match(serialized, /\[REDACTED\]/u);
  });

  it("omits raw details and secret-like values from route responses", async () => {
    const providerSecret = ["sk", "route-provider-secret"].join("-");
    const routeRef = ["Authorization:", "Bearer route.jwt.secret"].join(" ");
    const stdErrKey = ["std", "err"].join("");
    const routeStdErrSecret = ["sk", ["route-std", "err-secret"].join("")].join("-");
    const routeSignature = ["X-Lark", "Signature: route-secret"].join("-");
    const repo = new ProjectManagerRepository(db, owner.id);
    const created = repo.createWorkItem(projectId, {
      title: "Redacted route item",
      details: {
        rawTerminalOutput: "OPENFORGE_ATTACH_TOKEN=route-attach-secret",
        providerCredential: providerSecret
      }
    });
    repo.attachEvidence(projectId, created.id, {
      evidenceRefs: [{ kind: "test", label: "route", status: "passed", ref: routeRef }],
      details: { [stdErrKey]: routeStdErrSecret, signature: routeSignature }
    });

    const item = await request("GET", `/api/v1/projects/${projectId}/project-manager/work-items/${created.id}`);
    const ledger = await request("GET", `/api/v1/projects/${projectId}/project-manager/ledger`);
    const serialized = JSON.stringify({ item: item.body, ledger: ledger.body });

    assert.equal(serialized.includes("details"), false);
    assert.doesNotMatch(serialized, new RegExp(["route-attach-secret", ["sk", "route-provider-secret"].join("-"), "route\\.jwt\\.secret"].join("|"), "u"));
    assert.doesNotMatch(serialized, new RegExp([["sk", "route-std", "err-secret"].join("-"), "route-secret"].join("|"), "u"));
  });

  async function request(method: string, pathname: string, body?: unknown) {
    return makeRequest(app, method, pathname, body, {
      Authorization: `Bearer ${token}`
    });
  }
});

function assertRawRouteDataExcluded(serialized: string): void {
  assert.equal(serialized.includes("details"), false);
  assert.doesNotMatch(
    serialized,
    /rawPrompt|terminal output|providerPayload|approvalDiff|executionSummary|fake-route-token|stdout|stderr|apiKey|JWT|private key/iu
  );
}

async function makeRequest(
  app: express.Express,
  method: string,
  pathname: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      const payload = body ? JSON.stringify(body) : undefined;
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: pathname,
          method,
          headers: {
            "Content-Type": "application/json",
            ...headers,
            ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {})
          }
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            server.close();
            resolve({
              status: res.statusCode || 0,
              body: data ? JSON.parse(data) : undefined
            });
          });
        }
      );
      req.on("error", (error) => {
        server.close();
        reject(error);
      });
      if (payload) req.write(payload);
      req.end();
    });
  });
}
