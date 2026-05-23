import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CopilotLiveRunConflictError,
  CopilotRepository
} from "../src/db/repositories/copilot-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";

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

describe("CopilotRepository", () => {
  let db: Database.Database;
  let userId: string;
  let otherUserId: string;
  let repo: CopilotRepository;
  let otherRepo: CopilotRepository;

  beforeEach(() => {
    db = createTestDb();
    const users = new UserRepository(db);
    userId = users.create("copilot@example.com", "hash").id;
    otherUserId = users.create("other-copilot@example.com", "hash").id;
    repo = new CopilotRepository(db, userId);
    otherRepo = new CopilotRepository(db, otherUserId);
  });

  it("creates and lists runs scoped to the current user", () => {
    const run = repo.createRun({
      status: "running",
      source: "copilot",
      goal: "Summarize Gateway health"
    });
    otherRepo.createRun({
      status: "running",
      source: "copilot",
      goal: "Other user's run"
    });

    const listed = repo.listRuns();

    assert.equal(run.userId, userId);
    assert.equal(run.goal, "Summarize Gateway health");
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.id, run.id);
  });

  it("rejects a second live run for the same user and exposes the active run", () => {
    const active = repo.createRun({
      status: "waiting_for_approval",
      source: "copilot",
      goal: "Approve first action"
    });

    assert.throws(
      () => {
        repo.createRun({
          status: "running",
          source: "copilot",
          goal: "Start another run"
        });
      },
      (error) =>
        error instanceof CopilotLiveRunConflictError &&
        error.activeRun?.id === active.id &&
        error.activeRun.status === "waiting_for_approval"
    );

    repo.updateRun(active.id, { status: "completed", completedAt: Date.now() });

    const next = repo.createRun({
      status: "queued",
      source: "copilot",
      goal: "Start after completion"
    });

    assert.equal(next.status, "queued");
  });

  it("recovers stale queued and running runs without closing approval waits", () => {
    const oldRunning = repo.createRun({
      status: "running",
      source: "copilot",
      goal: "Crashed model request"
    });
    repo.updateRun(oldRunning.id, { status: "running" });
    db.prepare("UPDATE copilot_runs SET updated_at = ? WHERE id = ?").run(1000, oldRunning.id);

    const recovered = repo.recoverStaleExecutionRuns(2000, 5000);

    const waiting = repo.createRun({
      status: "waiting_for_approval",
      source: "copilot",
      goal: "Needs approval"
    });
    db.prepare("UPDATE copilot_runs SET updated_at = ? WHERE id = ?").run(1000, waiting.id);
    const recoveredAfterWaiting = repo.recoverStaleExecutionRuns(2000, 6000);

    assert.deepEqual(recovered.map((run) => run.id), [oldRunning.id]);
    assert.deepEqual(recoveredAfterWaiting, []);
    assert.equal(repo.getRun(oldRunning.id)?.status, "failed");
    assert.equal(repo.getRun(oldRunning.id)?.errorCode, "copilot_stale_run_recovered");
    assert.equal(repo.getRun(waiting.id)?.status, "waiting_for_approval");
  });

  it("cancels stale approval waits and rejects their pending actions", () => {
    const run = repo.createRun({
      status: "waiting_for_approval",
      source: "copilot",
      goal: "Approve adapter refresh"
    });
    const action = repo.createPendingAction(run.id, {
      type: "openforge.propose_adapter_refresh",
      input: { adapter: "codex" }
    });
    db.prepare("UPDATE copilot_runs SET updated_at = ? WHERE id = ?").run(1000, run.id);
    db.prepare("UPDATE copilot_pending_actions SET updated_at = ? WHERE id = ?").run(1000, action.id);

    const recovered = repo.recoverStaleApprovalRuns(2000, 5000);

    assert.deepEqual(recovered.map((item) => item.id), [run.id]);
    assert.equal(repo.getRun(run.id)?.status, "cancelled");
    assert.equal(repo.getRun(run.id)?.errorCode, "copilot_stale_approval_recovered");
    assert.equal(repo.getPendingAction(action.id)?.status, "rejected");
    assert.deepEqual(repo.getPendingAction(action.id)?.result, { reason: "stale_approval_recovered" });
    assert.equal(repo.findActiveRun(), undefined);
  });

  it("creates and lists conversations scoped to the current user", () => {
    const conversation = repo.createConversation({
      title: "Debug provider setup",
      source: "models",
      sourceRefId: "model-tab"
    });
    otherRepo.createConversation({
      title: "Other user conversation",
      source: "copilot"
    });

    const listed = repo.listConversations();

    assert.equal(conversation.userId, userId);
    assert.equal(conversation.title, "Debug provider setup");
    assert.equal(conversation.source, "models");
    assert.equal(conversation.sourceRefId, "model-tab");
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.id, conversation.id);
  });

  it("stores conversation messages and links assistant messages to runs", () => {
    const conversation = repo.createConversation({
      title: "Terminal help",
      source: "session",
      sourceRefId: "session-1"
    });
    const run = repo.createRun({
      status: "completed",
      source: "session",
      sourceRefId: "session-1",
      goal: "Explain terminal output"
    });

    const userMessage = repo.createConversationMessage(conversation.id, {
      role: "user",
      content: "What failed?"
    });
    const assistantMessage = repo.createConversationMessage(conversation.id, {
      role: "assistant",
      content: "The provider returned 404.",
      runId: run.id,
      payload: { status: "completed" }
    });

    const messages = repo.listConversationMessages(conversation.id);

    assert.deepEqual(messages.map((message) => message.id), [userMessage.id, assistantMessage.id]);
    assert.equal(messages[1]?.runId, run.id);
    assert.deepEqual(messages[1]?.payload, { status: "completed" });
    assert.equal(repo.getConversation(conversation.id)?.lastMessageAt, assistantMessage.createdAt);
  });

  it("soft deletes conversations and individual messages", () => {
    const conversation = repo.createConversation({
      title: "Delete me",
      source: "copilot"
    });
    const first = repo.createConversationMessage(conversation.id, {
      role: "user",
      content: "Keep the audit trail"
    });
    repo.createConversationMessage(conversation.id, {
      role: "assistant",
      content: "Visible until conversation deletion"
    });

    const deletedMessage = repo.deleteConversationMessage(first.id);

    assert.equal(deletedMessage?.deletedAt !== null, true);
    assert.deepEqual(repo.listConversationMessages(conversation.id).map((message) => message.role), ["assistant"]);

    const deletedConversation = repo.deleteConversation(conversation.id);

    assert.equal(deletedConversation?.deletedAt !== null, true);
    assert.equal(repo.getConversation(conversation.id), undefined);
    assert.deepEqual(repo.listConversations(), []);
    assert.deepEqual(repo.listConversationMessages(conversation.id), []);
  });

  it("appends run events with increasing sequences", () => {
    const run = repo.createRun({
      status: "running",
      source: "dashboard",
      goal: "Explain the latest session"
    });

    const first = repo.addEvent(run.id, {
      type: "assistant_message",
      message: "Gateway is healthy.",
      payload: { text: "Gateway is healthy." }
    });
    const second = repo.addEvent(run.id, {
      type: "assistant_message",
      message: "No pending actions.",
      payload: { text: "No pending actions." }
    });

    assert.equal(first.sequence, 1);
    assert.equal(second.sequence, 2);
    assert.deepEqual(repo.listEvents(run.id).map((event) => event.sequence), [1, 2]);
  });

  it("updates the run step count as events are appended", () => {
    const run = repo.createRun({
      status: "running",
      source: "copilot",
      goal: "Track run progress"
    });

    repo.addEvent(run.id, {
      type: "assistant_message",
      message: "First step",
      payload: { text: "First step" }
    });
    repo.addEvent(run.id, {
      type: "tool_result",
      message: "openforge.get_dashboard_summary",
      payload: { output: { ok: true } }
    });

    assert.equal(repo.getRun(run.id)?.stepCount, 2);
  });

  it("creates pending actions in pending state", () => {
    const run = repo.createRun({
      status: "waiting_for_approval",
      source: "settings",
      goal: "Prepare a safe setting update"
    });

    const action = repo.createPendingAction(run.id, {
      type: "openforge.propose_setting_update",
      input: { key: "theme", value: "dark" }
    });

    assert.equal(action.status, "pending");
    assert.equal(action.type, "openforge.propose_setting_update");
    assert.deepEqual(action.input, { key: "theme", value: "dark" });
  });

  it("updates pending actions only when the current status matches", () => {
    const run = repo.createRun({
      status: "waiting_for_approval",
      source: "copilot",
      goal: "Guard action transitions"
    });
    const action = repo.createPendingAction(run.id, {
      type: "openforge.propose_setting_update",
      input: { key: "theme", value: "dark" }
    });
    repo.updatePendingActionIfStatus(action.id, "pending", {
      status: "approved",
      result: { ok: true },
      approvedBy: userId,
      approvedAt: Date.now()
    });

    const rejected = repo.updatePendingActionIfStatus(action.id, "pending", {
      status: "rejected",
      result: { reason: "run_cancelled" }
    });

    assert.equal(rejected, undefined);
    assert.equal(repo.getPendingAction(action.id)?.status, "approved");
    assert.deepEqual(repo.getPendingAction(action.id)?.result, { ok: true });
  });

  it("updates runs only when the current status matches", () => {
    const run = repo.createRun({
      status: "waiting_for_approval",
      source: "copilot",
      goal: "Complete after approval"
    });

    const cancelled = repo.updateRun(run.id, { status: "cancelled" });
    const result = repo.updateRunIfStatus(run.id, "waiting_for_approval", {
      status: "completed",
      completedAt: Date.now()
    });

    assert.equal(cancelled?.status, "cancelled");
    assert.equal(result?.status, "cancelled");
    assert.equal(repo.getRun(run.id)?.status, "cancelled");
  });

  it("does not approve a processing pending action after its run leaves the expected status", () => {
    const run = repo.createRun({
      status: "waiting_for_approval",
      source: "copilot",
      goal: "Approve action atomically"
    });
    const action = repo.createPendingAction(run.id, {
      type: "openforge.propose_setting_update",
      input: { key: "theme", value: "dark" }
    });
    repo.updatePendingActionIfStatus(action.id, "pending", { status: "processing" });
    repo.updateRun(run.id, { status: "cancelled", completedAt: Date.now() });

    const approved = repo.updatePendingActionIfStatusAndRunStatus(
      action.id,
      "processing",
      "waiting_for_approval",
      {
        status: "approved",
        result: { ok: true },
        approvedBy: userId,
        approvedAt: Date.now()
      }
    );

    assert.equal(approved, undefined);
    assert.equal(repo.getPendingAction(action.id)?.status, "processing");
  });

  it("prevents cross-user reads and writes", () => {
    const run = repo.createRun({
      status: "running",
      source: "copilot",
      goal: "Tenant-owned run"
    });
    const action = repo.createPendingAction(run.id, {
      type: "openforge.propose_setting_update",
      input: { key: "language", value: "zh-CN" }
    });

    assert.equal(otherRepo.getRun(run.id), undefined);
    assert.deepEqual(otherRepo.listEvents(run.id), []);
    assert.equal(
      otherRepo.updateRun(run.id, { status: "completed" }),
      undefined
    );
    assert.equal(
      otherRepo.updatePendingAction(action.id, { status: "approved" }),
      undefined
    );
  });
});
