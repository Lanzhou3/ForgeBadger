import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ProjectManagerExecutionRepository } from "../src/db/repositories/project-manager-execution-repository.js";
import { ProjectManagerRepository } from "../src/db/repositories/project-manager-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { SessionRepository } from "../src/db/repositories/session-repository.js";
import { UserRepository, type User } from "../src/db/repositories/user-repository.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
  return db;
}

describe("ProjectManagerExecutionRepository", () => {
  let db: Database.Database;
  let owner: User;
  let other: User;
  let projectId: string;
  let workItemId: string;
  let sessionId: string;

  beforeEach(() => {
    db = createTestDb();
    const users = new UserRepository(db);
    owner = users.create("execution-owner@example.com", "hash");
    other = users.create("execution-other@example.com", "hash");
    projectId = new ProjectRepository(db, owner.id).create({
      name: "Execution project",
      path: "/tmp/openforge-execution",
      aiTool: "claude"
    }).id;
    workItemId = new ProjectManagerRepository(db, owner.id).createWorkItem(projectId, {
      title: "Implement execution ledger"
    }).id;
    sessionId = new SessionRepository(db, owner.id).create({
      projectId,
      name: "Execution worker",
      aiTool: "claude",
      workingDir: "/tmp/openforge-execution"
    }).id;
  });

  it("creates or reuses one tenant-scoped prepared attempt for identical input", () => {
    const ownerRepo = new ProjectManagerExecutionRepository(db, owner.id);
    const otherRepo = new ProjectManagerExecutionRepository(db, other.id);

    const first = ownerRepo.createOrReusePreparedAttempt({
      projectId,
      workItemId,
      inputVersion: 3,
      inputDigest: "sha256:task-packet-v3"
    });
    const repeated = ownerRepo.createOrReusePreparedAttempt({
      projectId,
      workItemId,
      inputVersion: 3,
      inputDigest: "sha256:task-packet-v3"
    });

    assert.equal(repeated.id, first.id);
    assert.equal(first.attemptNumber, 1);
    assert.equal(first.desiredState, "prepared");
    assert.equal(first.observedState, "prepared");
    assert.equal(otherRepo.getAttempt(projectId, first.id), undefined);
  });

  it("uses compare-and-swap transitions and rejects stale state", () => {
    const repo = new ProjectManagerExecutionRepository(db, owner.id);
    const attempt = repo.createOrReusePreparedAttempt({
      projectId,
      workItemId,
      inputVersion: 1,
      inputDigest: "sha256:transition"
    });

    const transitioned = repo.compareAndSwapAttempt(attempt.id, {
      expectedObservedState: "prepared",
      desiredState: "running",
      observedState: "dispatching"
    });

    assert.equal(transitioned.observedState, "dispatching");
    assert.throws(
      () => repo.compareAndSwapAttempt(attempt.id, {
        expectedObservedState: "prepared",
        observedState: "running"
      }),
      /ATTEMPT_STATE_CONFLICT/
    );
  });

  it("releases expired assignment leases before granting a replacement", () => {
    const repo = new ProjectManagerExecutionRepository(db, owner.id);
    const attempt = repo.createOrReusePreparedAttempt({
      projectId,
      workItemId,
      inputVersion: 1,
      inputDigest: "sha256:lease"
    });
    const expiredAt = new Date(Date.now() - 1_000);
    const first = repo.createAssignment({
      projectId,
      workItemId,
      attemptId: attempt.id,
      sessionId,
      adapter: "claude",
      capabilities: { interrupt: true },
      leaseExpiresAt: expiredAt
    });

    const replacement = repo.createAssignment({
      projectId,
      workItemId,
      attemptId: attempt.id,
      sessionId,
      adapter: "claude",
      capabilities: { interrupt: true },
      leaseExpiresAt: new Date(Date.now() + 60_000)
    });

    assert.notEqual(replacement.id, first.id);
    assert.equal(repo.getAssignment(projectId, first.id)?.releasedReason, "lease_expired");
    assert.equal(repo.getAssignment(projectId, replacement.id)?.activeSlot, "active");
  });

  it("creates commands idempotently and rejects payload drift", () => {
    const repo = new ProjectManagerExecutionRepository(db, owner.id);
    const attempt = repo.createOrReusePreparedAttempt({
      projectId,
      workItemId,
      inputVersion: 1,
      inputDigest: "sha256:command"
    });
    const input = {
      projectId,
      workItemId,
      attemptId: attempt.id,
      commandType: "dispatch",
      idempotencyKey: "dispatch:attempt-1",
      payloadDigest: "sha256:payload-a"
    } as const;

    const first = repo.createCommand(input);
    const repeated = repo.createCommand(input);

    assert.equal(repeated.id, first.id);
    assert.throws(
      () => repo.createCommand({ ...input, payloadDigest: "sha256:payload-b" }),
      /COMMAND_PAYLOAD_DRIFT/
    );

    const otherItem = new ProjectManagerRepository(db, owner.id).createWorkItem(projectId, {
      title: "Other command scope"
    });
    const otherAttempt = repo.createOrReusePreparedAttempt({
      projectId,
      workItemId: otherItem.id,
      inputVersion: 1,
      inputDigest: "sha256:other-command"
    });
    const otherAssignment = repo.createAssignment({
      projectId,
      workItemId: otherItem.id,
      attemptId: otherAttempt.id,
      sessionId,
      adapter: "claude",
      capabilities: {},
      leaseExpiresAt: new Date(0),
      active: false
    });
    assert.throws(
      () => repo.createCommand({
        ...input,
        idempotencyKey: "dispatch:wrong-assignment",
        assignmentId: otherAssignment.id
      }),
      /COMMAND_SCOPE_MISMATCH/
    );
  });

  it("allows multiple prepared attempts but enforces one running attempt per user and one active assignment per project", () => {
    const repo = new ProjectManagerExecutionRepository(db, owner.id);
    const attempt = repo.createOrReusePreparedAttempt({
      projectId,
      workItemId,
      inputVersion: 1,
      inputDigest: "sha256:active-one"
    });
    const secondWorkItem = new ProjectManagerRepository(db, owner.id).createWorkItem(projectId, {
      title: "Competing execution"
    });
    const secondAttempt = repo.createOrReusePreparedAttempt({
      projectId,
      workItemId: secondWorkItem.id,
      inputVersion: 1,
      inputDigest: "sha256:active-two"
    });
    repo.compareAndSwapAttempt(attempt.id, {
      expectedObservedState: "prepared",
      desiredState: "running",
      observedState: "dispatching"
    });
    assert.throws(() => repo.compareAndSwapAttempt(secondAttempt.id, {
      expectedObservedState: "prepared",
      desiredState: "running",
      observedState: "dispatching"
    }), /ATTEMPT_ACTIVE_CONFLICT/);

    repo.createAssignment({
      projectId,
      workItemId,
      attemptId: attempt.id,
      sessionId,
      adapter: "claude",
      capabilities: {},
      leaseExpiresAt: new Date(Date.now() + 60_000)
    });
    const secondSession = new SessionRepository(db, owner.id).create({
      projectId,
      name: "Competing worker",
      aiTool: "claude",
      workingDir: "/tmp/openforge-execution"
    });
    assert.throws(
      () => repo.createAssignment({
        projectId,
        workItemId,
        attemptId: attempt.id,
        sessionId: secondSession.id,
        adapter: "claude",
        capabilities: {},
        leaseExpiresAt: new Date(Date.now() + 60_000)
      }),
      /ASSIGNMENT_ACTIVE_CONFLICT/
    );
  });
});
