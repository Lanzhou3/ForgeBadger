import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { digestPortfolioValue, PortfolioRepository } from "../src/db/repositories/portfolio-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { SessionRepository } from "../src/db/repositories/session-repository.js";
import { UserRepository, type User } from "../src/db/repositories/user-repository.js";
import { PortfolioIntakeService, type EnrollProjectInput } from "../src/services/portfolio/intake-service.js";
import { createPlatformToolManifestService } from "../src/services/portfolio/platform-tool-manifest.js";
import { createTaskPacketService } from "../src/services/portfolio/task-packet-service.js";
import { createExecutablePortfolioAttempt } from "./portfolio-phase4-fixture.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  migrateTestDb(db);
  return db;
}

function createFileTestDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  migrateTestDb(db);
  return db;
}

function migrateTestDb(db: Database.Database): void {
  // Foreign keys are connection-local in SQLite, so every contract test opts in explicitly.
  db.pragma("foreign_keys = ON");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
}

function enrollProject(
  db: Database.Database,
  userId: string,
  input: Omit<EnrollProjectInput, "observedState" | "evidenceIds" | "initialEvidence">
) {
  const evidenceId = `evidence:${input.idempotencyKey}`;
  return new PortfolioIntakeService(db, userId).enrollProject({
    ...input,
    observedState: { status: "verified", source: "portfolio-repository-test" },
    evidenceIds: [evidenceId],
    initialEvidence: [{
      id: evidenceId,
      producer: "portfolio-repository-test",
      sourceCategory: "test",
      observedAt: new Date("2026-08-14T00:00:00.000Z"),
      digest: `sha256:${evidenceId}`,
      summary: "Trusted current evidence for a Portfolio repository fixture.",
      confidence: "high",
      freshness: "current"
    }]
  }).enrollment;
}

function directEnrollmentInput(
  projectId: string,
  observedState: unknown,
  idempotencyKey: string
): Parameters<PortfolioRepository["enrollProject"]>[0] {
  const evidenceId = `evidence:${idempotencyKey}`;
  return {
    projectId,
    objective: "Persist an evidence-backed semantic Dossier state",
    intendedOutcome: "Evidence references supplement actual observations rather than replace them",
    observedState: observedState as Record<string, unknown>,
    evidenceIds: [evidenceId],
    initialEvidence: [{
      id: evidenceId,
      producer: "portfolio-repository-test",
      sourceCategory: "test",
      observedAt: new Date("2026-08-14T00:00:00.000Z"),
      digest: `sha256:${evidenceId}`,
      summary: "Trusted current evidence for a direct repository enrollment fixture.",
      confidence: "high",
      freshness: "current"
    }],
    idempotencyKey
  };
}

const nonMaterialObservedStates: ReadonlyArray<readonly [string, unknown]> = [
  ["null", null],
  ["undefined", undefined],
  ["empty-object", {}],
  ["empty-array", []],
  ["evidence-ids-only", { evidenceIds: ["evidence:placeholder"] }],
  ["null-status", { status: null }],
  ["blank-state", { state: "   " }],
  ["empty-details-object", { details: {} }],
  ["empty-details-array", { details: [] }],
  ["nested-placeholders", { details: { placeholder: null, evidenceIds: ["evidence:placeholder"] } }],
  ["nested-empty-values", { details: [null, undefined, " ", {}, []] }]
];

function createAcceptedWorkItem(input: {
  db: Database.Database;
  userId: string;
  projectId: string;
  title: string;
  idempotencyKey: string;
  acceptanceCriteria?: string[];
  verificationRequirements?: string[];
}) {
  const service = new PortfolioIntakeService(input.db, input.userId);
  const request = service.createRequest({
    projectId: input.projectId,
    source: "test",
    requestText: `Accepted Request for ${input.idempotencyKey}`,
    correlationId: `corr:${input.idempotencyKey}`,
    idempotencyKey: `${input.idempotencyKey}:request`
  });
  const evidence = new PortfolioRepository(input.db, input.userId).createEvidence({
    projectId: input.projectId,
    requestId: request.id,
    producer: "portfolio-repository-test",
    sourceCategory: "test",
    observedAt: new Date("2026-08-14T00:00:00.000Z"),
    digest: `sha256:${input.idempotencyKey}:evidence`,
    summary: "Trusted current evidence for an accepted Work Item fixture.",
    confidence: "high",
    freshness: "current",
    idempotencyKey: `${input.idempotencyKey}:evidence`
  });
  const outcome = service.decideIntake({
    requestId: request.id,
    candidateProjectIds: [input.projectId],
    selectedProjectId: input.projectId,
    scopeAssessment: "in_boundary",
    producer: "portfolio-repository-test",
    evidenceIds: [evidence.id],
    workItem: {
      title: input.title,
      ...(input.acceptanceCriteria ? { acceptanceCriteria: input.acceptanceCriteria } : {}),
      ...(input.verificationRequirements ? { verificationRequirements: input.verificationRequirements } : {})
    },
    idempotencyKey: `${input.idempotencyKey}:intake`
  });
  if (!outcome.workItem) throw new Error("Portfolio Work Item fixture requires accepted intake");
  return outcome.workItem;
}

function createConsumedOwnerAuthorization(input: {
  repo: PortfolioRepository;
  userId: string;
  projectId: string;
  workItemId: string;
  attemptId: string;
  actionIntentId: string;
  idempotencyKey: string;
}) {
  const actionDigest = input.repo.getActionIntentDigest(input.actionIntentId);
  assert.ok(actionDigest, "owner authorization requires a canonical action digest");
  const intent = input.repo.getActionIntent(input.actionIntentId);
  assert.ok(intent, "owner authorization requires an Action Intent");
  const authorization = input.repo.createAuthorization({
    projectId: input.projectId,
    workItemId: input.workItemId,
    attemptId: input.attemptId,
    actionIntentId: input.actionIntentId,
    authorizationTier: "owner_confirmation",
    actionDigest,
    policyRule: "owner-confirmation/v1",
    expiresAt: intent.expiresAt,
    idempotencyKey: input.idempotencyKey
  });
  const approved = input.repo.approveAuthorization({
    authorizationId: authorization.id,
    expectedProjectionVersion: authorization.projectionVersion,
    actionDigest: authorization.actionDigest,
    actorId: input.userId
  });
  input.repo.createStateGate().transition({
    recordType: "authorization",
    recordId: approved.id,
    toState: "consumed",
    actorId: input.userId,
    expectedProjectionVersion: approved.projectionVersion,
    idempotencyKey: `${input.idempotencyKey}:consume`
  });
  const consumed = input.repo.getAuthorization(authorization.id);
  assert.ok(consumed, "consumed owner authorization must remain durable");
  return consumed;
}

describe("PortfolioRepository", () => {
  let db: Database.Database;
  let owner: User;
  let other: User;
  let projectId: string;

  beforeEach(() => {
    // Arrange
    db = createTestDb();
    const users = new UserRepository(db);
    owner = users.create("portfolio-owner@example.com", "hash");
    other = users.create("portfolio-other@example.com", "hash");
    projectId = new ProjectRepository(db, owner.id).create({
      name: "Portfolio owner project",
      path: "/tmp/forgebadger-portfolio-owner",
      aiTool: "claude"
    }).id;
    new ProjectRepository(db, other.id).create({
      name: "Portfolio other project",
      path: "/tmp/forgebadger-portfolio-other",
      aiTool: "claude"
    }).id;
  });

  it("enables foreign keys and hides canonical Portfolio records from another tenant", () => {
    // Arrange
    const ownerRepo = new PortfolioRepository(db, owner.id);
    const otherRepo = new PortfolioRepository(db, other.id);
    const enrollment = enrollProject(db, owner.id, {
      projectId,
      objective: "Ship a tenant-safe Portfolio foundation",
      intendedOutcome: "A durable local workflow",
      idempotencyKey: "enrollment:owner-project"
    });
    const request = ownerRepo.createRequest({
      projectId,
      source: "web",
      requesterId: owner.id,
      requestText: "Create one durable Portfolio Request before any work starts.",
      correlationId: "corr:tenant-isolation",
      idempotencyKey: "request:tenant-isolation"
    });
    const workItem = createAcceptedWorkItem({
      db,
      userId: owner.id,
      projectId,
      title: "Verify tenant isolation",
      acceptanceCriteria: ["Foreign identifiers are non-disclosing"],
      idempotencyKey: "work-item:tenant-isolation"
    });
    const acceptedRequestId = workItem.requestId;
    const typedRequestId: string = workItem.requestId;
    assert.ok(acceptedRequestId);
    assert.equal(typedRequestId, acceptedRequestId);

    // Act
    const foreignKeys = db.pragma("foreign_keys", { simple: true });

    // Assert
    assert.equal(foreignKeys, 1);
    assert.equal(ownerRepo.getEnrollment(projectId)?.projectId, enrollment.projectId);
    assert.equal(ownerRepo.getRequest(request.id)?.requestText, request.requestText);
    assert.equal(ownerRepo.getWorkItem(workItem.id)?.id, workItem.id);
    assert.equal(otherRepo.getEnrollment(projectId), undefined);
    assert.equal(otherRepo.getRequest(request.id), undefined);
    assert.equal(otherRepo.getWorkItem(workItem.id), undefined);
    assert.throws(
      () => otherRepo.createWorkItem({
        projectId,
        requestId: acceptedRequestId,
        title: "Attempt cross-tenant project linkage",
        idempotencyKey: "work-item:foreign-project"
      }),
      /PORTFOLIO_PROJECT_NOT_FOUND|FOREIGN KEY|constraint/i
    );
  });

  it("requires a qualified Request at the public Work Item creation boundary", () => {
    // Arrange
    const repo = new PortfolioRepository(db, owner.id);
    enrollProject(db, owner.id, {
      projectId,
      objective: "Reject owner-direct Work Item creation.",
      intendedOutcome: "Every Work Item traces to an accepted intake decision.",
      idempotencyKey: "enrollment:work-item-request-required"
    });
    const rawWriter = repo as unknown as {
      createWorkItem: (input: {
        projectId: string;
        requestId?: string;
        title: string;
        idempotencyKey: string;
      }) => unknown;
    };

    // Act / Assert
    assert.equal(typeof rawWriter.createWorkItem, "function");
    assert.throws(
      () => rawWriter.createWorkItem({
        projectId,
        title: "Missing Request linkage",
        idempotencyKey: "work-item:missing-request"
      }),
      /PORTFOLIO_REQUEST_REQUIRED/
    );
    assert.throws(
      () => rawWriter.createWorkItem({
        projectId,
        requestId: "",
        title: "Empty Request linkage",
        idempotencyKey: "work-item:empty-request"
      }),
      /PORTFOLIO_REQUEST_REQUIRED/
    );
    const now = Date.now();
    assert.throws(
      () => db.prepare(`INSERT INTO portfolio_work_items (
        id, user_id, project_id, request_id, owner_user_id, title,
        idempotency_key, input_digest, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          "work-item:raw-null-request",
          owner.id,
          projectId,
          null,
          owner.id,
          "Raw insert without Request",
          "work-item:raw-null-request",
          "sha256:raw-null-request",
          now,
          now
        ),
      /NOT NULL constraint failed: portfolio_work_items\.request_id/
    );
  });

  it("updates a Dossier only with its current projection version", () => {
    // Arrange
    const repo = new PortfolioRepository(db, owner.id);
    enrollProject(db, owner.id, {
      projectId,
      objective: "Keep a Dossier under optimistic concurrency control",
      intendedOutcome: "A stale writer cannot overwrite the owner view",
      idempotencyKey: "enrollment:dossier-cas"
    });
    const original = repo.getDossier(projectId)!;

    // Act
    const updated = repo.updateDossier({
      projectId,
      expectedProjectionVersion: original.projectionVersion,
      observedState: { status: "reviewed", source: "portfolio-test" },
      evidenceIds: ["evidence:enrollment:dossier-cas"],
      idempotencyKey: "dossier:update:current"
    });

    // Assert
    assert.equal(updated.projectionVersion, original.projectionVersion + 1);
    assert.deepEqual(updated.observedState, {
      status: "reviewed",
      source: "portfolio-test",
      evidenceIds: ["evidence:enrollment:dossier-cas"]
    });
    assert.throws(
      () => repo.updateDossier({
        projectId,
        expectedProjectionVersion: original.projectionVersion,
        objective: "A stale concurrent update must not replace the current Dossier",
        idempotencyKey: "dossier:update:stale"
      }),
      /PORTFOLIO_STATE_CONFLICT/
    );
    assert.deepEqual(repo.getDossier(projectId)?.observedState, updated.observedState);
  });

  it("requires semantic observed state for direct Dossier activation and updates", () => {
    // Arrange
    const repo = new PortfolioRepository(db, owner.id);
    const activeProjectId = new ProjectRepository(db, owner.id).create({
      name: "Repository semantic Dossier state",
      path: "/tmp/forgebadger-portfolio-repository-semantic-dossier-state",
      aiTool: "claude"
    }).id;

    // Act / Assert: trusted evidence does not make placeholders into a Dossier observation.
    for (const [label, observedState] of nonMaterialObservedStates) {
      const invalidProjectId = new ProjectRepository(db, owner.id).create({
        name: `Repository non-material Dossier state ${label}`,
        path: `/tmp/forgebadger-portfolio-repository-non-material-dossier-state-${label}`,
        aiTool: "claude"
      }).id;
      assert.throws(
        () => repo.enrollProject(directEnrollmentInput(invalidProjectId, observedState, `enrollment:repository-${label}`)),
        /PORTFOLIO_OBSERVED_STATE_REQUIRED/
      );
      assert.equal(repo.getEnrollment(invalidProjectId), undefined);
      assert.equal(repo.getDossier(invalidProjectId), undefined);
    }

    const enrollment = repo.enrollProject(directEnrollmentInput(
      activeProjectId,
      { dirty: false },
      "enrollment:repository-semantic-state"
    ));
    const original = repo.getDossier(activeProjectId)!;
    const evidenceId = "evidence:enrollment:repository-semantic-state";
    assert.equal(enrollment.enrollmentStatus, "active");
    assert.deepEqual(original.observedState, { dirty: false, evidenceIds: [evidenceId] });
    for (const [label, observedState] of nonMaterialObservedStates) {
      assert.throws(
        () => repo.updateDossier({
          projectId: activeProjectId,
          expectedProjectionVersion: original.projectionVersion,
          observedState: observedState as Record<string, unknown>,
          evidenceIds: [evidenceId],
          idempotencyKey: `dossier:repository-non-material:${label}`
        }),
        /PORTFOLIO_OBSERVED_STATE_REQUIRED/
      );
    }

    const updated = repo.updateDossier({
      projectId: activeProjectId,
      expectedProjectionVersion: original.projectionVersion,
      observedState: { uncommittedChanges: 0 },
      evidenceIds: [evidenceId],
      idempotencyKey: "dossier:repository-semantic-state"
    });
    assert.deepEqual(updated.observedState, { uncommittedChanges: 0, evidenceIds: [evidenceId] });
    db.prepare("UPDATE portfolio_project_dossiers SET observed_state_json = ? WHERE project_id = ?")
      .run(JSON.stringify({ details: [], evidenceIds: [evidenceId] }), activeProjectId);
    assert.equal(repo.getDossier(activeProjectId), undefined);
  });

  it("replays enrollment, records its immutable audit fact, and prevents project deletion", () => {
    // Arrange
    const repo = new PortfolioRepository(db, owner.id);
    const enrollmentInput = {
      projectId,
      objective: "Delete only through the original project lifecycle",
      intendedOutcome: "No orphan Portfolio records remain",
      idempotencyKey: "enrollment:cascade"
    } as const;
    const first = enrollProject(db, owner.id, enrollmentInput);
    const replayed = enrollProject(db, owner.id, enrollmentInput);
    const request = repo.createRequest({
      projectId,
      source: "web",
      requestText: "Create children that must follow the enrolled project.",
      correlationId: "corr:cascade",
      idempotencyKey: "request:cascade"
    });
    const item = createAcceptedWorkItem({
      db,
      userId: owner.id,
      projectId,
      title: "Cascade Portfolio rows",
      idempotencyKey: "work-item:cascade"
    });
    // Act / Assert
    assert.equal(replayed.projectId, first.projectId);
    const enrollmentFact = repo.listFacts({ projectId, recordId: projectId }).find((fact) => fact.factType === "project_enrolled");
    assert.ok(enrollmentFact);
    assert.throws(
      () => new ProjectRepository(db, owner.id).delete(projectId),
      /FOREIGN KEY|constraint/i
    );
    assert.equal(repo.getEnrollment(projectId)?.projectId, projectId);
    assert.equal(repo.getRequest(request.id)?.id, request.id);
    assert.equal(repo.getWorkItem(item.id)?.id, item.id);
    assert.throws(
      () => db.prepare("DELETE FROM portfolio_facts WHERE id = ?").run(enrollmentFact.id),
      /PORTFOLIO_FACT_IMMUTABLE|immutable/i
    );
  });

  it("rejects parent deletion when immutable Portfolio facts would be removed", () => {
    // Arrange
    const repo = new PortfolioRepository(db, owner.id);
    enrollProject(db, owner.id, {
      projectId,
      objective: "Retain the immutable Portfolio ledger",
      intendedOutcome: "Project deletion cannot erase canonical facts",
      idempotencyKey: "enrollment:immutable-ledger"
    });
    const request = repo.createRequest({
      projectId,
      source: "web",
      requestText: "Create a fact that makes parent deletion unsafe.",
      correlationId: "corr:immutable-ledger",
      idempotencyKey: "request:immutable-ledger"
    });
    const item = createAcceptedWorkItem({
      db,
      userId: owner.id,
      projectId,
      title: "Immutable ledger deletion guard",
      idempotencyKey: "work-item:immutable-ledger"
    });
    const fact = repo.listFacts({ projectId, recordId: item.id }).find((stored) => stored.factType === "work_item_created");

    // Act / Assert
    assert.ok(fact);
    assert.throws(
      () => new ProjectRepository(db, owner.id).delete(projectId),
      /FOREIGN KEY|constraint/i
    );
    assert.equal(repo.getEnrollment(projectId)?.projectId, projectId);
    assert.equal(repo.getRequest(request.id)?.id, request.id);
    assert.equal(repo.getWorkItem(item.id)?.id, item.id);
    assert.ok(repo.listFacts({ projectId, recordId: item.id }).some((stored) => stored.id === fact.id));
    assert.throws(
      () => db.prepare("UPDATE portfolio_facts SET payload_json = '{}' WHERE id = ?").run(fact.id),
      /PORTFOLIO_FACT_IMMUTABLE|immutable/i
    );
  });

  it("rejects ActionIntent and command links that cross an enrolled project or session boundary", () => {
    // Arrange
    const repo = new PortfolioRepository(db, owner.id);
    enrollProject(db, owner.id, {
      projectId,
      objective: "Keep ActionIntents project-scoped",
      intendedOutcome: "No command crosses a project boundary",
      idempotencyKey: "enrollment:action-boundary:first"
    });
    const secondProjectId = new ProjectRepository(db, owner.id).create({
      name: "Second Portfolio project",
      path: "/tmp/forgebadger-portfolio-second",
      aiTool: "claude"
    }).id;
    enrollProject(db, owner.id, {
      projectId: secondProjectId,
      objective: "A separate project boundary",
      intendedOutcome: "No cross-project relationship is accepted",
      idempotencyKey: "enrollment:action-boundary:second"
    });
    const firstItem = createAcceptedWorkItem({
      db,
      userId: owner.id,
      projectId,
      title: "First command scope",
      idempotencyKey: "work-item:action-boundary:first"
    });
    const secondItem = createAcceptedWorkItem({
      db,
      userId: owner.id,
      projectId: secondProjectId,
      title: "Second command scope",
      idempotencyKey: "work-item:action-boundary:second"
    });
    const firstAttempt = createExecutablePortfolioAttempt(repo, {
      projectId,
      workItemId: firstItem.id,
      packetVersion: 1,
      packetDigest: "sha256:action-boundary:first",
      adapter: "claude",
      createdBy: owner.id,
      sourceWorkItemVersion: firstItem.projectionVersion,
      idempotencyKey: "attempt:action-boundary:first"
    });
    const secondAttempt = createExecutablePortfolioAttempt(repo, {
      projectId: secondProjectId,
      workItemId: secondItem.id,
      packetVersion: 1,
      packetDigest: "sha256:action-boundary:second",
      adapter: "claude",
      createdBy: owner.id,
      sourceWorkItemVersion: secondItem.projectionVersion,
      idempotencyKey: "attempt:action-boundary:second"
    });
    const firstSessionId = new SessionRepository(db, owner.id).create({
      projectId,
      name: "First Portfolio action session",
      aiTool: "claude",
      workingDir: "/tmp/forgebadger-portfolio-owner"
    }).id;
    const secondSessionId = new SessionRepository(db, owner.id).create({
      projectId: secondProjectId,
      name: "Second Portfolio action session",
      aiTool: "claude",
      workingDir: "/tmp/forgebadger-portfolio-second"
    }).id;
    const firstIntent = repo.createActionIntent({
      projectId,
      workItemId: firstItem.id,
      attemptId: firstAttempt.id,
      sessionId: firstSessionId,
      actionClass: "session.dispatch",
      payloadDigest: "sha256:action-boundary:intent",
      expiresAt: new Date(Date.now() + 60_000),
      idempotencyKey: "intent:action-boundary:first"
    });
    const foreignAssignment = repo.claimSessionAssignment({
      projectId: secondProjectId,
      workItemId: secondItem.id,
      attemptId: secondAttempt.id,
      sessionId: secondSessionId,
      adapter: "claude",
      leaseDurationMs: 60_000
    });

    // Act / Assert
    assert.throws(
      () => repo.createActionIntent({
        projectId,
        workItemId: firstItem.id,
        attemptId: firstAttempt.id,
        sessionId: secondSessionId,
        actionClass: "session.dispatch",
        payloadDigest: "sha256:foreign-session",
        expiresAt: new Date(Date.now() + 60_000),
        idempotencyKey: "intent:action-boundary:foreign-session"
      }),
      /PORTFOLIO_SESSION_NOT_FOUND|PORTFOLIO_SCOPE_MISMATCH/
    );
    assert.throws(
      () => repo.createActionIntent({
        projectId,
        workItemId: secondItem.id,
        actionClass: "session.dispatch",
        payloadDigest: "sha256:foreign-work-item",
        expiresAt: new Date(Date.now() + 60_000),
        idempotencyKey: "intent:action-boundary:foreign-work-item"
      }),
      /PORTFOLIO_WORK_ITEM_NOT_FOUND|PORTFOLIO_SCOPE_MISMATCH/
    );
    assert.throws(
      () => repo.createCommand({
        projectId,
        workItemId: firstItem.id,
        attemptId: firstAttempt.id,
        actionIntentId: firstIntent.id,
        assignmentId: foreignAssignment.id,
        commandType: "dispatch",
        payloadDigest: "sha256:foreign-assignment",
        idempotencyKey: "command:action-boundary:foreign-assignment"
      }),
      /PORTFOLIO_ASSIGNMENT_SCOPE_MISMATCH|PORTFOLIO_SCOPE_MISMATCH/
    );
  });

  it("rejects same-tenant links that mix Requests, Attempts, Evidence, Candidates, or Decisions across projects", () => {
    // Arrange
    const repo = new PortfolioRepository(db, owner.id);
    enrollProject(db, owner.id, {
      projectId,
      objective: "Keep every child in its enrolled project",
      intendedOutcome: "Tenant membership never weakens project scoping",
      idempotencyKey: "enrollment:record-scope:first"
    });
    const secondProjectId = new ProjectRepository(db, owner.id).create({
      name: "Second Portfolio record scope project",
      path: "/tmp/forgebadger-portfolio-record-scope",
      aiTool: "claude"
    }).id;
    enrollProject(db, owner.id, {
      projectId: secondProjectId,
      objective: "Keep this Portfolio project isolated",
      intendedOutcome: "Cross-project opaque IDs are rejected",
      idempotencyKey: "enrollment:record-scope:second"
    });
    const firstRequest = repo.createRequest({
      projectId,
      source: "web",
      requestText: "First project requirement",
      correlationId: "corr:record-scope:first",
      idempotencyKey: "request:record-scope:first"
    });
    const secondRequest = repo.createRequest({
      projectId: secondProjectId,
      source: "web",
      requestText: "Second project requirement",
      correlationId: "corr:record-scope:second",
      idempotencyKey: "request:record-scope:second"
    });
    const firstItem = createAcceptedWorkItem({
      db,
      userId: owner.id,
      projectId,
      title: "First project work",
      idempotencyKey: "work-item:record-scope:first"
    });
    const secondItem = createAcceptedWorkItem({
      db,
      userId: owner.id,
      projectId: secondProjectId,
      title: "Second project work",
      idempotencyKey: "work-item:record-scope:second"
    });
    const secondAttempt = createExecutablePortfolioAttempt(repo, {
      projectId: secondProjectId,
      workItemId: secondItem.id,
      packetVersion: 1,
      packetDigest: "sha256:record-scope:second",
      adapter: "claude",
      createdBy: owner.id,
      sourceWorkItemVersion: secondItem.projectionVersion,
      idempotencyKey: "attempt:record-scope:second"
    });
    const firstAttempt = createExecutablePortfolioAttempt(repo, {
      projectId,
      workItemId: firstItem.id,
      packetVersion: 1,
      adapter: "claude",
      createdBy: owner.id,
      sourceWorkItemVersion: firstItem.projectionVersion,
      idempotencyKey: "attempt:record-scope:first"
    });
    const secondCandidate = repo.createCompletionCandidate({
      projectId: secondProjectId,
      requestId: secondItem.requestId,
      workItemId: secondItem.id,
      attemptId: secondAttempt.id,
      summary: "A second-project candidate.",
      idempotencyKey: "candidate:record-scope:second"
    });

    // Act / Assert
    assert.throws(
      () => repo.createWorkItem({
        projectId,
        requestId: secondRequest.id,
        title: "Cross-project request relation",
        idempotencyKey: "work-item:record-scope:foreign-request"
      }),
      /PORTFOLIO_REQUEST_SCOPE_MISMATCH|PORTFOLIO_REQUEST_NOT_FOUND|PORTFOLIO_SCOPE_MISMATCH/
    );
    assert.throws(
      () => repo.createTaskAttempt({
        projectId,
        workItemId: secondItem.id,
        packetVersion: secondAttempt.packetVersion,
        packetDigest: secondAttempt.packetDigest,
        adapter: "claude",
        createdBy: owner.id,
        sourceWorkItemVersion: secondAttempt.sourceWorkItemVersion,
        packetId: secondAttempt.packetId,
        idempotencyKey: "attempt:record-scope:foreign"
      }),
      /PORTFOLIO_WORK_ITEM_NOT_FOUND|PORTFOLIO_SCOPE_MISMATCH/
    );
    assert.throws(
      () => repo.createEvidence({
        projectId,
        workItemId: secondItem.id,
        producer: "gateway.test.v1",
        sourceCategory: "declared_verification",
        observedAt: new Date(),
        digest: "sha256:record-scope:foreign-evidence",
        summary: "This evidence must not cross a project boundary.",
        confidence: "trusted_platform",
        freshness: "fresh",
        idempotencyKey: "evidence:record-scope:foreign"
      }),
      /PORTFOLIO_WORK_ITEM_NOT_FOUND|PORTFOLIO_SCOPE_MISMATCH/
    );
    assert.throws(
      () => repo.createCompletionCandidate({
        projectId,
        requestId: secondItem.requestId,
        workItemId: secondItem.id,
        attemptId: secondAttempt.id,
        summary: "This candidate must not cross a project boundary.",
        idempotencyKey: "candidate:record-scope:foreign"
      }),
      /PORTFOLIO_WORK_ITEM_NOT_FOUND|PORTFOLIO_SCOPE_MISMATCH/
    );
    assert.throws(
      () => repo.createAcceptanceDecision({
        projectId,
        requestId: firstItem.requestId,
        workItemId: firstItem.id,
        attemptId: firstAttempt.id,
        candidateId: secondCandidate.id,
        decision: "accepted",
        idempotencyKey: "acceptance:record-scope:foreign"
      }),
      /PORTFOLIO_CANDIDATE_SCOPE_MISMATCH|PORTFOLIO_SCOPE_MISMATCH/
    );
  });

  it("replays a matching create and rejects idempotency payload drift without a second row", () => {
    // Arrange
    const repo = new PortfolioRepository(db, owner.id);
    enrollProject(db, owner.id, {
      projectId,
      objective: "Replay only canonical requests",
      intendedOutcome: "One stored result",
      idempotencyKey: "enrollment:idempotency"
    });
    const input = {
      projectId,
      source: "web",
      requesterId: owner.id,
      requestText: "Preserve this exact requirement wording.",
      correlationId: "corr:idempotency",
      idempotencyKey: "request:stable-replay"
    } as const;

    // Act
    const created = repo.createRequest(input);
    const replayed = repo.createRequest(input);

    // Assert
    assert.equal(replayed.id, created.id);
    assert.equal(replayed.requestText, input.requestText);
    assert.throws(
      () => repo.createRequest({ ...input, requestText: "A different payload under the same key." }),
      /PORTFOLIO_IDEMPOTENCY_CONFLICT/
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM portfolio_requests WHERE user_id = ? AND project_id = ?")
        .get(owner.id, projectId) as { count: number }).count,
      1
    );
    assert.equal(repo.getRequest(created.id)?.requestText, input.requestText);
  });

  it("rejects duplicate Task Packet versions and digests for the same Work Item", () => {
    // Arrange
    const repo = new PortfolioRepository(db, owner.id);
    enrollProject(db, owner.id, {
      projectId,
      objective: "Keep Task Packet identities stable",
      intendedOutcome: "No packet version or digest ambiguity",
      idempotencyKey: "enrollment:task-packet-constraints"
    });
    const item = createAcceptedWorkItem({
      db,
      userId: owner.id,
      projectId,
      title: "Task Packet uniqueness",
      idempotencyKey: "work-item:task-packet-constraints"
    });
    const baselineAttempt = createExecutablePortfolioAttempt(repo, {
      projectId,
      workItemId: item.id,
      packetVersion: 1,
      adapter: "claude",
      createdBy: owner.id,
      sourceWorkItemVersion: item.projectionVersion,
      idempotencyKey: "attempt:task-packet-constraints"
    });
    const baseline = repo.getTaskPacket(baselineAttempt.packetId);
    assert.ok(baseline);
    const insertPacket = db.prepare(`INSERT INTO portfolio_task_packets (
      id, user_id, project_id, work_item_id, packet_version, packet_digest,
      skill_version, source_work_item_version, dossier_version, canonical_packet_json,
      manifest_version, manifest_digest, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    // Act / Assert
    assert.throws(
      () => insertPacket.run(
        "packet:duplicate-version", owner.id, projectId, item.id, baseline.packetVersion, "sha256:packet-revision",
        baseline.skillVersion, baseline.sourceWorkItemVersion, baseline.dossierVersion, JSON.stringify(baseline.canonicalPacket),
        baseline.manifestVersion, baseline.manifestDigest, owner.id, baseline.createdAt.getTime() + 1
      ),
      /UNIQUE constraint failed/
    );
    assert.throws(
      () => insertPacket.run(
        "packet:duplicate-digest", owner.id, projectId, item.id, baseline.packetVersion + 1, baseline.packetDigest,
        baseline.skillVersion, baseline.sourceWorkItemVersion, baseline.dossierVersion, JSON.stringify(baseline.canonicalPacket),
        baseline.manifestVersion, baseline.manifestDigest, owner.id, baseline.createdAt.getTime() + 2
      ),
      /UNIQUE constraint failed/
    );
  });

  it("rejects direct repository packets that omit executable skill authority or select observation-only tools", () => {
    // Arrange
    const repo = new PortfolioRepository(db, owner.id);
    enrollProject(db, owner.id, {
      projectId,
      objective: "Keep direct packet persistence inside executable authority.",
      intendedOutcome: "A repository caller cannot create a non-dispatchable packet.",
      idempotencyKey: "enrollment:direct-executable-packet"
    });
    const item = createAcceptedWorkItem({
      db,
      userId: owner.id,
      projectId,
      title: "Direct executable packet boundary",
      idempotencyKey: "work-item:direct-executable-packet"
    });
    const packets = createTaskPacketService(repo, createPlatformToolManifestService());
    const canonical = packets.rebuild({
      projectId,
      workItemId: item.id,
      adapter: "claude",
      skillVersion: "portfolio-execution/v1",
      toolIds: ["portfolio.submit_canonical_task_packet"]
    });
    const base = {
      projectId,
      workItemId: item.id,
      packetVersion: 1,
      sourceWorkItemVersion: canonical.workItem.projectionVersion,
      dossierVersion: canonical.project.dossierVersion,
      manifestVersion: canonical.platformTools.manifestVersion,
      manifestDigest: canonical.platformTools.manifestDigest,
      createdBy: owner.id,
      idempotencyKey: "packet:direct-executable-boundary"
    };
    const packetWithSkill = (skillVersion: unknown, toolIds: unknown[]) => {
      const canonicalPacket = {
        ...canonical,
        skill: { version: skillVersion, toolIds },
        platformTools: {
          ...canonical.platformTools,
          tools: toolIds.map((id) => ({ id, version: "v1", actionClass: "packet_submit" }))
        }
      };
      return {
        ...base,
        skillVersion,
        canonicalPacket,
        packetDigest: digestPortfolioValue(canonicalPacket)
      };
    };
    const withoutSkillVersion: Record<string, unknown> = packetWithSkill("portfolio-execution/v1", ["portfolio.submit_canonical_task_packet"]);
    delete withoutSkillVersion.skillVersion;
    const packetCountBefore = (db.prepare("SELECT COUNT(*) AS count FROM portfolio_task_packets WHERE work_item_id = ?")
      .get(item.id) as { count: number }).count;
    const packetOperationCountBefore = (db.prepare("SELECT COUNT(*) AS count FROM portfolio_operation_records WHERE operation = ?")
      .get("task_packet.create") as { count: number }).count;

    // Act / Assert
    assert.throws(
      () => repo.createTaskPacket(withoutSkillVersion as unknown as Parameters<typeof repo.createTaskPacket>[0]),
      /PORTFOLIO_EXECUTABLE_SKILL_REQUIRED/
    );
    assert.throws(
      () => repo.createTaskPacket(packetWithSkill(null, ["portfolio.submit_canonical_task_packet"]) as unknown as Parameters<typeof repo.createTaskPacket>[0]),
      /PORTFOLIO_EXECUTABLE_SKILL_REQUIRED/
    );
    assert.throws(
      () => repo.createTaskPacket(packetWithSkill("portfolio-execution/v1", []) as unknown as Parameters<typeof repo.createTaskPacket>[0]),
      /PORTFOLIO_EXECUTABLE_TOOLS_REQUIRED/
    );
    assert.throws(
      () => repo.createTaskPacket(packetWithSkill("portfolio-execution/v1", ["portfolio.bounded_observation"]) as unknown as Parameters<typeof repo.createTaskPacket>[0]),
      /PORTFOLIO_EXECUTABLE_TOOL_UNREGISTERED/
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM portfolio_task_packets WHERE work_item_id = ?").get(item.id) as { count: number }).count,
      packetCountBefore
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM portfolio_operation_records WHERE operation = ?").get("task_packet.create") as { count: number }).count,
      packetOperationCountBefore
    );
  });

  it("resolves provider source-event replays without exposing a raw SQLite uniqueness error", () => {
    // Arrange
    const repo = new PortfolioRepository(db, owner.id);
    enrollProject(db, owner.id, {
      projectId,
      objective: "Replay verified provider events safely",
      intendedOutcome: "One canonical inbound request",
      idempotencyKey: "enrollment:source-event"
    });
    const input = {
      projectId,
      source: "feishu",
      sourceEventId: "evt:portfolio:001",
      requestText: "A verified provider requirement.",
      correlationId: "corr:source-event",
      idempotencyKey: "request:source-event:first"
    } as const;
    const first = repo.createRequest(input);

    // Act / Assert
    const replayed = repo.createRequest({ ...input, idempotencyKey: "request:source-event:replay" });
    assert.equal(replayed.id, first.id);
    assert.throws(
      () => repo.createRequest({
        ...input,
        requestText: "A conflicting payload for the same provider event.",
        idempotencyKey: "request:source-event:drift"
      }),
      /PORTFOLIO_SOURCE_EVENT_CONFLICT|PORTFOLIO_IDEMPOTENCY_CONFLICT/
    );
  });

  it("enforces one active assignment per attempt and session, then permits an expired lease to be replaced", () => {
    // Arrange
    const repo = new PortfolioRepository(db, owner.id);
    const now = new Date("2026-08-14T09:00:00.000Z");
    enrollProject(db, owner.id, {
      projectId,
      objective: "Lease-exclusive execution",
      intendedOutcome: "Only one owner can dispatch",
      idempotencyKey: "enrollment:assignment"
    });
    const firstItem = createAcceptedWorkItem({
      db,
      userId: owner.id,
      projectId,
      title: "First leased attempt",
      idempotencyKey: "work-item:assignment:first"
    });
    const secondItem = createAcceptedWorkItem({
      db,
      userId: owner.id,
      projectId,
      title: "Second leased attempt",
      idempotencyKey: "work-item:assignment:second"
    });
    const firstAttempt = createExecutablePortfolioAttempt(repo, {
      projectId,
      workItemId: firstItem.id,
      packetVersion: 1,
      packetDigest: "sha256:first-attempt",
      adapter: "claude",
      createdBy: owner.id,
      sourceWorkItemVersion: firstItem.projectionVersion,
      idempotencyKey: "attempt:assignment:first"
    });
    const secondAttempt = createExecutablePortfolioAttempt(repo, {
      projectId,
      workItemId: secondItem.id,
      packetVersion: 1,
      packetDigest: "sha256:second-attempt",
      adapter: "claude",
      createdBy: owner.id,
      sourceWorkItemVersion: secondItem.projectionVersion,
      idempotencyKey: "attempt:assignment:second"
    });
    const firstSessionId = new SessionRepository(db, owner.id).create({
      projectId,
      name: "Portfolio first session",
      aiTool: "claude",
      workingDir: "/tmp/forgebadger-portfolio-owner"
    }).id;
    const secondSessionId = new SessionRepository(db, owner.id).create({
      projectId,
      name: "Portfolio second session",
      aiTool: "claude",
      workingDir: "/tmp/forgebadger-portfolio-owner"
    }).id;
    const first = repo.claimSessionAssignment({
      projectId,
      workItemId: firstItem.id,
      attemptId: firstAttempt.id,
      sessionId: firstSessionId,
      adapter: "claude",
      leaseDurationMs: 1_000,
      now
    });

    // Act / Assert
    const concurrentRunner = new PortfolioRepository(db, owner.id);
    assert.throws(
      () => concurrentRunner.claimSessionAssignment({
        projectId,
        workItemId: firstItem.id,
        attemptId: firstAttempt.id,
        sessionId: secondSessionId,
        adapter: "claude",
        leaseDurationMs: 1_000,
        now
      }),
      /PORTFOLIO_ASSIGNMENT_CONFLICT/
    );
    assert.throws(
      () => repo.claimSessionAssignment({
        projectId,
        workItemId: secondItem.id,
        attemptId: secondAttempt.id,
        sessionId: firstSessionId,
        adapter: "claude",
        leaseDurationMs: 1_000,
        now
      }),
      /PORTFOLIO_ASSIGNMENT_CONFLICT/
    );

    const replacement = repo.claimSessionAssignment({
      projectId,
      workItemId: firstItem.id,
      attemptId: firstAttempt.id,
      sessionId: secondSessionId,
      adapter: "claude",
      leaseDurationMs: 1_000,
      now: new Date(now.getTime() + 1_001)
    });

    assert.notEqual(replacement.id, first.id);
    assert.equal(repo.getSessionAssignment(first.id)?.releasedReason, "lease_expired");
    assert.equal(repo.getSessionAssignment(replacement.id)?.attemptId, firstAttempt.id);
  });

  it("allows only one contender to claim a lease across separate SQLite connections", () => {
    // Arrange
    const directory = mkdtempSync(path.join(tmpdir(), "forgebadger-portfolio-lease-"));
    const dbPath = path.join(directory, "portfolio.sqlite");
    let firstConnection: Database.Database | undefined;
    let secondConnection: Database.Database | undefined;

    try {
      firstConnection = createFileTestDb(dbPath);
      secondConnection = createFileTestDb(dbPath);
      const users = new UserRepository(firstConnection);
      const leaseOwner = users.create("portfolio-lease-owner@example.com", "hash");
      const leaseProjectId = new ProjectRepository(firstConnection, leaseOwner.id).create({
        name: "Portfolio concurrent lease project",
        path: "/tmp/forgebadger-portfolio-concurrent-lease",
        aiTool: "claude"
      }).id;
      const firstRepo = new PortfolioRepository(firstConnection, leaseOwner.id);
      const secondRepo = new PortfolioRepository(secondConnection, leaseOwner.id);
      enrollProject(firstConnection, leaseOwner.id, {
      projectId: leaseProjectId,
      objective: "Make lease ownership single-writer across connections",
        intendedOutcome: "Only one contender owns the active slot",
        idempotencyKey: "enrollment:multi-connection-lease"
      });
      const firstItem = createAcceptedWorkItem({
        db: firstConnection,
        userId: leaseOwner.id,
        projectId: leaseProjectId,
        title: "First concurrent lease item",
        idempotencyKey: "work-item:multi-connection:first"
      });
      const secondItem = createAcceptedWorkItem({
        db: firstConnection,
        userId: leaseOwner.id,
        projectId: leaseProjectId,
        title: "Second concurrent lease item",
        idempotencyKey: "work-item:multi-connection:second"
      });
      const firstAttempt = createExecutablePortfolioAttempt(firstRepo, {
        projectId: leaseProjectId,
        workItemId: firstItem.id,
        packetVersion: 1,
        packetDigest: "sha256:multi-connection:first",
        adapter: "claude",
        createdBy: leaseOwner.id,
        sourceWorkItemVersion: firstItem.projectionVersion,
        idempotencyKey: "attempt:multi-connection:first"
      });
      const secondAttempt = createExecutablePortfolioAttempt(firstRepo, {
        projectId: leaseProjectId,
        workItemId: secondItem.id,
        packetVersion: 1,
        packetDigest: "sha256:multi-connection:second",
        adapter: "claude",
        createdBy: leaseOwner.id,
        sourceWorkItemVersion: secondItem.projectionVersion,
        idempotencyKey: "attempt:multi-connection:second"
      });
      const firstSessionId = new SessionRepository(firstConnection, leaseOwner.id).create({
        projectId: leaseProjectId,
        name: "First concurrent lease session",
        aiTool: "claude",
        workingDir: "/tmp/forgebadger-portfolio-concurrent-lease"
      }).id;
      const secondSessionId = new SessionRepository(firstConnection, leaseOwner.id).create({
        projectId: leaseProjectId,
        name: "Second concurrent lease session",
        aiTool: "claude",
        workingDir: "/tmp/forgebadger-portfolio-concurrent-lease"
      }).id;
      const now = new Date("2026-08-14T10:00:00.000Z");
      const winner = firstRepo.claimSessionAssignment({
        projectId: leaseProjectId,
        workItemId: firstItem.id,
        attemptId: firstAttempt.id,
        sessionId: firstSessionId,
        adapter: "claude",
        leaseDurationMs: 60_000,
        now
      });

      // Act: hold a real uncommitted lease-row update while the second connection contends.
      secondConnection.pragma("busy_timeout = 1");
      let leaseWriteTransactionOpen = false;
      firstConnection.exec("BEGIN IMMEDIATE");
      leaseWriteTransactionOpen = true;
      try {
        const heldLeaseWrite = firstConnection.prepare(
          "UPDATE portfolio_session_assignments SET updated_at = updated_at + 1 WHERE id = ?"
        ).run(winner.id);
        assert.equal(heldLeaseWrite.changes, 1);
        assert.throws(
          () => secondRepo.claimSessionAssignment({
            projectId: leaseProjectId,
            workItemId: firstItem.id,
            attemptId: firstAttempt.id,
            sessionId: secondSessionId,
            adapter: "claude",
            leaseDurationMs: 60_000,
            now
          }),
          /SQLITE_BUSY|PORTFOLIO_ASSIGNMENT_CONFLICT/
        );
        assert.equal(
          (firstConnection.prepare("SELECT COUNT(*) AS count FROM portfolio_session_assignments WHERE attempt_id = ?")
            .get(firstAttempt.id) as { count: number }).count,
          1
        );
      } finally {
        if (leaseWriteTransactionOpen) firstConnection.exec("ROLLBACK");
      }

      // Assert: once the write lock is released, both uniqueness constraints still select the original winner.
      assert.throws(
        () => secondRepo.claimSessionAssignment({
          projectId: leaseProjectId,
          workItemId: firstItem.id,
          attemptId: firstAttempt.id,
          sessionId: secondSessionId,
          adapter: "claude",
          leaseDurationMs: 60_000,
          now
        }),
        /PORTFOLIO_ASSIGNMENT_CONFLICT/
      );
      assert.throws(
        () => secondRepo.claimSessionAssignment({
          projectId: leaseProjectId,
          workItemId: secondItem.id,
          attemptId: secondAttempt.id,
          sessionId: firstSessionId,
          adapter: "claude",
          leaseDurationMs: 60_000,
          now
        }),
        /PORTFOLIO_ASSIGNMENT_CONFLICT/
      );
      assert.equal(secondRepo.getSessionAssignment(winner.id)?.active, true);
    } finally {
      // The unique test directory is created above and is never shared with user state.
      secondConnection?.close();
      firstConnection?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("records redacted immutable aggregate facts without exposing a generic fact writer", () => {
    // Arrange
    const repo = new PortfolioRepository(db, owner.id);
    enrollProject(db, owner.id, {
      projectId,
      objective: "Redact auditable facts",
      intendedOutcome: "No secret reaches a Portfolio timeline",
      idempotencyKey: "enrollment:facts"
    });
    const secret = "sk-portfolio-super-secret";
    const githubToken = "ghp_abcdefghijklmnopqrstuvwxyz1234567890";
    const pem = "-----BEGIN PRIVATE KEY-----never-store-this-----END PRIVATE KEY-----";
    const request = repo.createRequest({
      projectId,
      source: "web",
      correlationId: "corr:facts",
      idempotencyKey: "request:fact-redaction",
      requestText: `Bearer jwt.secret.value, ${secret}, ${githubToken}, ${pem}, and raw terminal output are source input only.`,
      sourceMetadata: {
        authorization: `Bearer ${secret}`,
        terminalTranscript: "raw terminal output must not persist"
      }
    });
    const rawRepository = repo as unknown as {
      appendFact?: (input: unknown) => unknown;
    };

    // Act
    const facts = repo.listRequestFacts(request.id);

    // Assert
    assert.equal(rawRepository.appendFact, undefined);
    assert.throws(() => rawRepository.appendFact!({}), TypeError);
    const stored = facts.find((fact) => fact.factType === "request_received");
    assert.ok(stored);
    assert.equal(JSON.stringify(stored).includes(secret), false);
    assert.equal(JSON.stringify(stored).includes("jwt.secret.value"), false);
    assert.equal(JSON.stringify(stored).includes(githubToken), false);
    assert.equal(JSON.stringify(stored).includes(pem), false);
    assert.equal(JSON.stringify(stored).toLowerCase().includes("raw terminal output"), false);
    assert.throws(
      () => db.prepare("UPDATE portfolio_facts SET payload_json = '{}' WHERE id = ?").run(stored.id),
      /PORTFOLIO_FACT_IMMUTABLE|immutable/i
    );
    assert.throws(
      () => db.prepare("DELETE FROM portfolio_facts WHERE id = ?").run(stored.id),
      /PORTFOLIO_FACT_IMMUTABLE|immutable/i
    );
  });

  it("rolls back a request projection and command intent when their idempotency receipt cannot persist", () => {
    // Arrange
    const repo = new PortfolioRepository(db, owner.id);
    enrollProject(db, owner.id, {
      projectId,
      objective: "Keep operation persistence atomic",
      intendedOutcome: "No projection survives a failed receipt",
      idempotencyKey: "enrollment:receipt-rollback"
    });
    db.exec(`
      CREATE TRIGGER fail_request_operation_receipt
      BEFORE INSERT ON portfolio_operation_records
      WHEN NEW.operation = 'request.create'
      BEGIN
        SELECT RAISE(ABORT, 'forced request operation failure');
      END;
    `);

    // Act / Assert
    assert.throws(
      () => repo.createRequest({
        projectId,
        source: "web",
        requestText: "This request must roll back with its operation receipt.",
        correlationId: "corr:receipt-rollback",
        idempotencyKey: "request:receipt-rollback"
      }),
      /forced request operation failure/
    );
    assert.equal(repo.listRequests({ projectId }).length, 0);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM portfolio_operation_records WHERE operation = ?")
        .get("request.create") as { count: number }).count,
      0
    );
  });

  it("rolls back a command intent when its operation receipt write fails", () => {
    // Arrange
    const repo = new PortfolioRepository(db, owner.id);
    enrollProject(db, owner.id, {
      projectId,
      objective: "Keep command intents atomic",
      intendedOutcome: "No queued command exists without its receipt",
      idempotencyKey: "enrollment:command-rollback"
    });
    const item = createAcceptedWorkItem({
      db,
      userId: owner.id,
      projectId,
      title: "Command receipt rollback",
      idempotencyKey: "work-item:command-rollback"
    });
    const attempt = createExecutablePortfolioAttempt(repo, {
      projectId,
      workItemId: item.id,
      packetVersion: 1,
      packetDigest: "sha256:command-rollback",
      adapter: "claude",
      createdBy: owner.id,
      sourceWorkItemVersion: item.projectionVersion,
      idempotencyKey: "attempt:command-rollback"
    });
    const intent = repo.createActionIntent({
      projectId,
      workItemId: item.id,
      attemptId: attempt.id,
      actionClass: "session.dispatch",
      payloadDigest: "sha256:command-rollback",
      policyRule: "owner-confirmation/v1",
      expiresAt: new Date(Date.now() + 60_000),
      idempotencyKey: "intent:command-rollback"
    });
    const authorization = createConsumedOwnerAuthorization({
      repo,
      userId: owner.id,
      projectId,
      workItemId: item.id,
      attemptId: attempt.id,
      actionIntentId: intent.id,
      idempotencyKey: "authorization:command-rollback"
    });
    db.exec(`
      CREATE TRIGGER fail_command_operation_receipt
      BEFORE INSERT ON portfolio_operation_records
      WHEN NEW.operation = 'command.create'
      BEGIN
        SELECT RAISE(ABORT, 'forced command operation failure');
      END;
    `);

    // Act / Assert
    assert.throws(
      () => repo.createCommand({
        projectId,
        workItemId: item.id,
        attemptId: attempt.id,
        actionIntentId: intent.id,
        authorizationId: authorization.id,
        commandType: "session.dispatch",
        payloadDigest: "sha256:command-rollback",
        idempotencyKey: "command:receipt-rollback"
      }),
      /forced command operation failure/
    );
    assert.equal(countRows(db, "portfolio_commands"), 0);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM portfolio_operation_records WHERE operation = ?")
        .get("command.create") as { count: number }).count,
      0
    );
  });
});

function countRows(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}
