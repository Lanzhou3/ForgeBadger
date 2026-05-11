import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CopilotRepository } from "../src/db/repositories/copilot-repository.js";
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
