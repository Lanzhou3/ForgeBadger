import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ProjectManagerRepository } from "../src/db/repositories/project-manager-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import {
  ProjectManagerExecutionLedgerService,
  buildDeterministicTaskPacket,
  calculateBoundedBackoff,
  digestTaskPacket
} from "../src/services/project-manager/execution-ledger.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
  return db;
}

describe("ProjectManagerExecutionLedgerService", () => {
  let db: Database.Database;
  let userId: string;
  let projectId: string;
  let workItemId: string;

  beforeEach(() => {
    db = createTestDb();
    userId = new UserRepository(db).create("ledger-owner@example.com", "hash").id;
    projectId = new ProjectRepository(db, userId).create({
      name: "Ledger project",
      path: "/tmp/openforge-ledger",
      aiTool: "claude"
    }).id;
    workItemId = new ProjectManagerRepository(db, userId).createWorkItem(projectId, {
      title: "Run the control loop",
      description: "Persist every authoritative transition",
      acceptanceCriteria: ["state is durable"]
    }).id;
  });

  it("persists the prepare, dispatch, permission, evaluation, and success path", () => {
    const service = new ProjectManagerExecutionLedgerService(db, userId);
    const attempt = service.prepare({
      projectId,
      workItemId,
      sourceVersion: 4,
      taskPacket: { title: "Run task", acceptanceCriteria: ["tests pass"] }
    });

    assert.equal(service.transition(attempt.id, "dispatch").observedState, "dispatching");
    assert.equal(service.transition(attempt.id, "worker_ready").observedState, "running");
    assert.equal(service.transition(attempt.id, "permission_requested").observedState, "waiting_for_permission");
    assert.equal(service.transition(attempt.id, "permission_resolved").observedState, "running");
    assert.equal(service.transition(attempt.id, "completion_candidate").observedState, "evaluating");
    assert.equal(service.transition(attempt.id, "acceptance_passed").observedState, "succeeded");

    const events = db.prepare(`
      SELECT event_type, details_json FROM project_manager_ledger_events
      WHERE user_id = ? AND project_id = ? AND work_item_id = ? ORDER BY created_at ASC
    `).all(userId, projectId, workItemId) as Array<{ event_type: string; details_json: string }>;
    assert.equal(events.filter((event) => event.event_type === "execution_state_changed").length, 6);
    assert.match(events.at(-1)?.details_json ?? "", /acceptance_passed/);
  });

  it("supports blocked, failed, and cancelled terminals but rejects illegal transitions", () => {
    const service = new ProjectManagerExecutionLedgerService(db, userId);
    const first = service.prepare({
      projectId,
      workItemId,
      sourceVersion: 1,
      taskPacket: { title: "First" }
    });
    assert.throws(() => service.transition(first.id, "acceptance_passed"), /ATTEMPT_TRANSITION_INVALID/);
    assert.equal(service.transition(first.id, "blocked", { failureCode: "POLICY_DENIED" }).observedState, "blocked");

    const second = service.prepare({
      projectId,
      workItemId,
      sourceVersion: 2,
      taskPacket: { title: "Second" }
    });
    assert.equal(service.transition(second.id, "failed", { failureCode: "WORKER_FAILED" }).observedState, "failed");

    const third = service.prepare({
      projectId,
      workItemId,
      sourceVersion: 3,
      taskPacket: { title: "Third" }
    });
    assert.equal(service.transition(third.id, "cancel").observedState, "cancelled");
  });

  it("builds deterministic packets and rejects source drift", () => {
    const left = buildDeterministicTaskPacket({
      title: "Implement",
      context: { beta: 2, alpha: 1 },
      acceptanceCriteria: ["green"]
    });
    const right = buildDeterministicTaskPacket({
      acceptanceCriteria: ["green"],
      context: { alpha: 1, beta: 2 },
      title: "Implement"
    });

    assert.deepEqual(left, right);
    assert.equal(digestTaskPacket(left), digestTaskPacket(right));

    const service = new ProjectManagerExecutionLedgerService(db, userId);
    const attempt = service.prepare({ projectId, workItemId, sourceVersion: 7, taskPacket: left });
    assert.doesNotThrow(() => service.assertInputSnapshot(attempt.id, 7, left));
    assert.throws(
      () => service.assertInputSnapshot(attempt.id, 8, { ...left, title: "Changed" }),
      /ATTEMPT_INPUT_DRIFT/
    );
  });

  it("enforces reconcile, decision, follow-up, retry, and deadline ceilings", () => {
    const service = new ProjectManagerExecutionLedgerService(db, userId, {
      maxReconcile: 1,
      maxDecision: 1,
      maxFollowUp: 1,
      maxRetry: 1
    });
    const attempt = service.prepare({
      projectId,
      workItemId,
      sourceVersion: 1,
      taskPacket: { title: "Bounded" },
      deadlineAt: new Date(Date.now() + 60_000)
    });

    for (const budget of ["reconcile", "decision", "follow_up", "retry"] as const) {
      assert.equal(service.consumeBudget(attempt.id, budget), 1);
      assert.throws(() => service.consumeBudget(attempt.id, budget), new RegExp(`ATTEMPT_${budget.toUpperCase()}_LIMIT`));
    }
    service.transition(attempt.id, "blocked", { failureCode: "BUDGET_EXHAUSTED" });

    const expired = service.prepare({
      projectId,
      workItemId,
      sourceVersion: 2,
      taskPacket: { title: "Expired" },
      deadlineAt: new Date(Date.now() - 1)
    });
    assert.throws(() => service.consumeBudget(expired.id, "reconcile"), /ATTEMPT_DEADLINE_EXCEEDED/);
    assert.equal(calculateBoundedBackoff(1, 1_000, 5_000), 1_000);
    assert.equal(calculateBoundedBackoff(10, 1_000, 5_000), 5_000);
    assert.throws(() => calculateBoundedBackoff(0, 1_000, 5_000), /BACKOFF_ATTEMPT_INVALID/);
  });
});
