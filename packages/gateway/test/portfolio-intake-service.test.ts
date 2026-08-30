import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { PortfolioRepository } from "../src/db/repositories/portfolio-repository.js";
import { UserRepository, type User } from "../src/db/repositories/user-repository.js";
import { PortfolioIntakeService, type EnrollProjectInput } from "../src/services/portfolio/intake-service.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  // SQLite foreign-key enforcement is connection-local, including for test databases.
  db.pragma("foreign_keys = ON");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
  return db;
}

function countRows(db: Database.Database, table: string, requestId?: string): number {
  if (requestId) {
    return (db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE request_id = ?`).get(requestId) as { count: number }).count;
  }
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function createEvidence(input: {
  db: Database.Database;
  userId: string;
  projectId: string;
  requestId?: string;
  confidence?: string;
  freshness?: string;
  idempotencyKey: string;
}) {
  return new PortfolioRepository(input.db, input.userId).createEvidence({
    projectId: input.projectId,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    producer: "portfolio-intake-test",
    sourceCategory: "test",
    observedAt: new Date("2026-08-14T00:00:00.000Z"),
    digest: `sha256:${input.idempotencyKey}`,
    summary: "Verified evidence for the Portfolio intake contract test.",
    confidence: input.confidence ?? "high",
    freshness: input.freshness ?? "current",
    idempotencyKey: input.idempotencyKey
  });
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

function enrollmentInputForObservedState(projectId: string, observedState: unknown, idempotencyKey: string): EnrollProjectInput {
  const evidenceId = `evidence:${idempotencyKey}`;
  return {
    projectId,
    objective: "Reject non-material Dossier state even with trusted evidence.",
    intendedOutcome: "Evidence provenance never substitutes for an observed fact.",
    observedState: observedState as Record<string, unknown>,
    evidenceIds: [evidenceId],
    initialEvidence: [{
      id: evidenceId,
      producer: "portfolio-intake-test",
      sourceCategory: "test",
      observedAt: new Date("2026-08-14T00:00:00.000Z"),
      digest: `sha256:${evidenceId}`,
      summary: "Trusted current evidence for an observed-state validation fixture.",
      confidence: "high",
      freshness: "current"
    }],
    idempotencyKey
  };
}

function enrollProject(
  service: PortfolioIntakeService,
  input: Omit<EnrollProjectInput, "observedState" | "evidenceIds" | "initialEvidence"> & {
    observedState?: Record<string, unknown>;
    evidenceId?: string;
    confidence?: string;
    freshness?: string;
  }
) {
  const evidenceId = input.evidenceId ?? `evidence:${input.idempotencyKey}`;
  return service.enrollProject({
    ...input,
    observedState: input.observedState ?? { status: "verified", source: "portfolio-intake-test" },
    evidenceIds: [evidenceId],
    initialEvidence: [{
      id: evidenceId,
      producer: "portfolio-intake-test",
      sourceCategory: "test",
      observedAt: new Date("2026-08-14T00:00:00.000Z"),
      digest: `sha256:${evidenceId}`,
      summary: "Trusted current evidence for Portfolio enrollment.",
      confidence: input.confidence ?? "high",
      freshness: input.freshness ?? "current"
    }]
  });
}

describe("PortfolioIntakeService", () => {
  let db: Database.Database;
  let owner: User;
  let other: User;
  let projectId: string;
  let service: PortfolioIntakeService;

  beforeEach(() => {
    // Arrange
    db = createTestDb();
    const users = new UserRepository(db);
    owner = users.create("portfolio-intake-owner@example.com", "hash");
    other = users.create("portfolio-intake-other@example.com", "hash");
    projectId = new ProjectRepository(db, owner.id).create({
      name: "Portfolio intake project",
      path: "/tmp/forgebadger-portfolio-intake",
      aiTool: "claude"
    }).id;
    service = new PortfolioIntakeService(db, owner.id);
  });

  it("enrolls an owned project with a Dossier and versioned observed state", () => {
    // Arrange
    const scope = { roots: ["packages/gateway"], excluded: ["node_modules"] };

    // Act
    const enrolled = enrollProject(service, {
      projectId,
      objective: "Turn verified requests into governed Portfolio work.",
      intendedOutcome: "A safe, traceable Gateway workflow.",
      scope,
      idempotencyKey: "enrollment:intake-service"
    });
    const evidence = createEvidence({
      db,
      userId: owner.id,
      projectId,
      idempotencyKey: "evidence:dossier:verified"
    });
    service.updateDossier({
      projectId,
      expectedProjectionVersion: enrolled.dossier.projectionVersion,
      observedState: { status: "verified", evidence: "dossier-test" },
      evidenceIds: [evidence.id],
      idempotencyKey: "dossier:update:intake-service"
    });

    // Assert
    assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
    assert.equal(enrolled.enrollment.ownerUserId, owner.id);
    assert.equal(enrolled.dossier.ownerUserId, owner.id);
    const dossier = db.prepare(`SELECT objective, intended_outcome, scope_json, observed_state_json, projection_version
      FROM portfolio_project_dossiers WHERE user_id = ? AND project_id = ?`).get(owner.id, projectId) as {
      objective: string;
      intended_outcome: string;
      scope_json: string;
      observed_state_json: string;
      projection_version: number;
    } | undefined;
    assert.deepEqual(dossier, {
      objective: "Turn verified requests into governed Portfolio work.",
      intended_outcome: "A safe, traceable Gateway workflow.",
      scope_json: JSON.stringify(scope),
      observed_state_json: JSON.stringify({ status: "verified", evidence: "dossier-test", evidenceIds: [evidence.id] }),
      projection_version: enrolled.dossier.projectionVersion + 1
    });
    assert.ok(countRows(db, "portfolio_facts") >= 2);
  });

  it("refuses active enrollment without nonempty observed state and current trusted project Evidence", () => {
    // Arrange
    const missingEvidenceProjectId = new ProjectRepository(db, owner.id).create({
      name: "Missing enrollment evidence",
      path: "/tmp/forgebadger-portfolio-enrollment-missing-evidence",
      aiTool: "claude"
    }).id;
    const emptyStateProjectId = new ProjectRepository(db, owner.id).create({
      name: "Empty enrollment observed state",
      path: "/tmp/forgebadger-portfolio-enrollment-empty-state",
      aiTool: "claude"
    }).id;
    const staleEvidenceProjectId = new ProjectRepository(db, owner.id).create({
      name: "Stale enrollment evidence",
      path: "/tmp/forgebadger-portfolio-enrollment-stale-evidence",
      aiTool: "claude"
    }).id;
    const evidenceOnlyStateProjectId = new ProjectRepository(db, owner.id).create({
      name: "Evidence-only enrollment observed state",
      path: "/tmp/forgebadger-portfolio-enrollment-evidence-only-state",
      aiTool: "claude"
    }).id;
    const rawRepository = new PortfolioRepository(db, owner.id) as unknown as {
      createProjectEnrollment?: unknown;
      activateProjectEnrollment?: unknown;
    };

    // Act / Assert
    assert.equal(rawRepository.createProjectEnrollment, undefined);
    assert.equal(rawRepository.activateProjectEnrollment, undefined);
    assert.throws(
      () => service.enrollProject({
        projectId: missingEvidenceProjectId,
        objective: "Reject enrollment without evidence.",
        intendedOutcome: "No active Dossier is inferred from a directory.",
        observedState: { status: "observed" },
        evidenceIds: [],
        idempotencyKey: "enrollment:missing-evidence"
      }),
      /PORTFOLIO_ENROLLMENT_EVIDENCE_REQUIRED/
    );
    assert.throws(
      () => service.enrollProject({
        projectId: emptyStateProjectId,
        objective: "Reject an empty Dossier observation.",
        intendedOutcome: "Observed State must describe current evidence.",
        observedState: {},
        evidenceIds: ["evidence:empty-state"],
        initialEvidence: [{
          id: "evidence:empty-state",
          producer: "portfolio-intake-test",
          sourceCategory: "test",
          observedAt: new Date("2026-08-14T00:00:00.000Z"),
          digest: "sha256:empty-state",
          summary: "A trusted current fixture cannot compensate for an empty observed state.",
          confidence: "high",
          freshness: "current"
        }],
        idempotencyKey: "enrollment:empty-state"
      }),
      /PORTFOLIO_OBSERVED_STATE_REQUIRED/
    );
    assert.throws(
      () => enrollProject(service, {
        projectId: staleEvidenceProjectId,
        objective: "Reject stale evidence for initial activation.",
        intendedOutcome: "An old signal cannot activate a Portfolio Project.",
        evidenceId: "evidence:stale-enrollment",
        freshness: "stale",
        idempotencyKey: "enrollment:stale-evidence"
      }),
      /PORTFOLIO_ENROLLMENT_EVIDENCE_INVALID/
    );
    assert.throws(
      () => enrollProject(service, {
        projectId: evidenceOnlyStateProjectId,
        objective: "Reject evidence IDs presented as the sole observation.",
        intendedOutcome: "Dossiers retain actual current-state facts.",
        observedState: { evidenceIds: ["evidence:evidence-only-state"] },
        evidenceId: "evidence:evidence-only-state",
        idempotencyKey: "enrollment:evidence-only-state"
      }),
      /PORTFOLIO_OBSERVED_STATE_REQUIRED/
    );
    for (const candidateProjectId of [
      missingEvidenceProjectId,
      emptyStateProjectId,
      staleEvidenceProjectId,
      evidenceOnlyStateProjectId
    ]) {
      const status = db.prepare("SELECT enrollment_status FROM portfolio_projects WHERE project_id = ?").get(candidateProjectId) as { enrollment_status: string } | undefined;
      assert.equal(status, undefined);
      assert.equal(new PortfolioRepository(db, owner.id).getDossier(candidateProjectId), undefined);
    }
  });

  it("rejects non-material observed state while retaining false and zero Dossier facts", () => {
    // Arrange / Assert: each enrollment has exact current trusted evidence but no semantic observation.
    for (const [label, observedState] of nonMaterialObservedStates) {
      const invalidProjectId = new ProjectRepository(db, owner.id).create({
        name: `Non-material enrollment ${label}`,
        path: `/tmp/forgebadger-portfolio-non-material-enrollment-${label}`,
        aiTool: "claude"
      }).id;
      const idempotencyKey = `enrollment:non-material:${label}`;
      assert.throws(
        () => service.enrollProject(enrollmentInputForObservedState(invalidProjectId, observedState, idempotencyKey)),
        /PORTFOLIO_OBSERVED_STATE_REQUIRED/
      );
      assert.equal(new PortfolioRepository(db, owner.id).getEnrollment(invalidProjectId), undefined);
      assert.equal(new PortfolioRepository(db, owner.id).getDossier(invalidProjectId), undefined);
    }

    const enrolled = enrollProject(service, {
      projectId,
      objective: "Retain concrete false and zero observations.",
      intendedOutcome: "Known negative and zero values remain auditable state.",
      observedState: { dirty: false },
      idempotencyKey: "enrollment:material-false"
    });
    const evidence = createEvidence({
      db,
      userId: owner.id,
      projectId,
      idempotencyKey: "evidence:material-zero"
    });
    const updated = service.updateDossier({
      projectId,
      expectedProjectionVersion: enrolled.dossier.projectionVersion,
      observedState: { uncommittedChanges: 0 },
      evidenceIds: [evidence.id],
      idempotencyKey: "dossier:update:material-zero"
    });
    assert.deepEqual(enrolled.dossier.observedState, {
      dirty: false,
      evidenceIds: ["evidence:enrollment:material-false"]
    });
    assert.deepEqual(updated.observedState, { uncommittedChanges: 0, evidenceIds: [evidence.id] });

    for (const [label, observedState] of nonMaterialObservedStates) {
      assert.throws(
        () => service.updateDossier({
          projectId,
          expectedProjectionVersion: updated.projectionVersion,
          observedState: observedState as Record<string, unknown>,
          evidenceIds: [evidence.id],
          idempotencyKey: `dossier:update:non-material:${label}`
        }),
        /PORTFOLIO_OBSERVED_STATE_REQUIRED/
      );
    }

    // A malformed row written outside the service boundary is also hidden from Dossier readers.
    db.prepare("UPDATE portfolio_project_dossiers SET observed_state_json = ? WHERE project_id = ?")
      .run(JSON.stringify({ details: { placeholder: null }, evidenceIds: [evidence.id] }), projectId);
    assert.equal(new PortfolioRepository(db, owner.id).getDossier(projectId), undefined);
  });

  it("requires current scoped Evidence whenever an observed Dossier state changes", () => {
    // Arrange
    const enrolled = enrollProject(service, {
      projectId,
      objective: "Keep observed Dossier changes tied to current evidence.",
      intendedOutcome: "No caller can replace a trusted observation without provenance.",
      idempotencyKey: "enrollment:dossier-update-evidence"
    });

    // Act / Assert
    assert.throws(
      () => service.updateDossier({
        projectId,
        expectedProjectionVersion: enrolled.dossier.projectionVersion,
        observedState: { status: "changed-without-evidence" },
        idempotencyKey: "dossier:update:without-evidence"
      }),
      /PORTFOLIO_OBSERVED_STATE_EVIDENCE_REQUIRED/
    );
    assert.throws(
      () => service.updateDossier({
        projectId,
        expectedProjectionVersion: enrolled.dossier.projectionVersion,
        observedState: { status: "changed-with-unknown-evidence" },
        evidenceIds: ["evidence:unknown-dossier-update"],
        idempotencyKey: "dossier:update:unknown-evidence"
      }),
      /PORTFOLIO_EVIDENCE_NOT_FOUND/
    );
    assert.throws(
      () => service.updateDossier({
        projectId,
        expectedProjectionVersion: enrolled.dossier.projectionVersion,
        observedState: {},
        evidenceIds: ["evidence:enrollment:dossier-update-evidence"],
        idempotencyKey: "dossier:update:empty-state"
      }),
      /PORTFOLIO_OBSERVED_STATE_REQUIRED/
    );
    assert.throws(
      () => service.updateDossier({
        projectId,
        expectedProjectionVersion: enrolled.dossier.projectionVersion,
        observedState: { evidenceIds: ["evidence:enrollment:dossier-update-evidence"] },
        evidenceIds: ["evidence:enrollment:dossier-update-evidence"],
        idempotencyKey: "dossier:update:evidence-only-state"
      }),
      /PORTFOLIO_OBSERVED_STATE_REQUIRED/
    );
    const repository = new PortfolioRepository(db, owner.id);
    assert.throws(
      () => repository.updateDossier({
        projectId,
        expectedProjectionVersion: enrolled.dossier.projectionVersion,
        observedState: { status: "repository-change-without-evidence" },
        idempotencyKey: "dossier:repository-update:without-evidence"
      }),
      /PORTFOLIO_ENROLLMENT_EVIDENCE_REQUIRED/
    );
    assert.throws(
      () => repository.updateDossier({
        projectId,
        expectedProjectionVersion: enrolled.dossier.projectionVersion,
        observedState: {},
        evidenceIds: ["evidence:enrollment:dossier-update-evidence"],
        idempotencyKey: "dossier:repository-update:empty-state"
      }),
      /PORTFOLIO_OBSERVED_STATE_REQUIRED/
    );
    assert.throws(
      () => repository.updateDossier({
        projectId,
        expectedProjectionVersion: enrolled.dossier.projectionVersion,
        observedState: { evidenceIds: ["evidence:enrollment:dossier-update-evidence"] },
        evidenceIds: ["evidence:enrollment:dossier-update-evidence"],
        idempotencyKey: "dossier:repository-update:evidence-only-state"
      }),
      /PORTFOLIO_OBSERVED_STATE_REQUIRED/
    );
    const persisted = repository.getDossier(projectId);
    assert.equal(persisted?.projectionVersion, enrolled.dossier.projectionVersion);
    assert.deepEqual(persisted?.observedState, enrolled.dossier.observedState);
  });

  it("hides and refuses to update a Dossier when its observed Evidence becomes stale", () => {
    // Arrange
    const enrollment = enrollProject(service, {
      projectId,
      objective: "Expose Dossiers only while their evidence remains current.",
      intendedOutcome: "A stale Dossier must not look active to callers.",
      evidenceId: "evidence:dossier-read-freshness",
      idempotencyKey: "enrollment:dossier-read-freshness"
    });
    const repository = new PortfolioRepository(db, owner.id);

    // Act
    db.prepare("UPDATE portfolio_evidence SET freshness = 'stale' WHERE id = ?").run("evidence:dossier-read-freshness");

    // Assert
    assert.equal(repository.getDossier(projectId), undefined);
    assert.throws(
      () => repository.updateDossier({
        projectId,
        expectedProjectionVersion: enrollment.dossier.projectionVersion,
        observedState: { status: "stale" },
        evidenceIds: ["evidence:dossier-read-freshness"],
        idempotencyKey: "dossier:update:stale-evidence"
      }),
      /PORTFOLIO_DOSSIER_NOT_FOUND/
    );
  });

  it("rejects an older fresh V1 Git fact after each newer bad source status at Intake and Dossier update gates", () => {
    // Arrange: legacy current enrollment Evidence keeps the Dossier available while V1 source history is evaluated.
    const enrollment = enrollProject(service, {
      projectId,
      objective: "Latest V1 source results govern every project-level evidence gate.",
      intendedOutcome: "Old Git observations cannot authorize work after a newer probe failure.",
      idempotencyKey: "enrollment:latest-v1-intake-gates"
    });
    const repository = new PortfolioRepository(db, owner.id);
    const statuses = ["stale", "unknown", "timeout", "failed"] as const;
    const baseObservedAt = new Date();

    // Act / Assert
    for (const [index, freshness] of statuses.entries()) {
      const request = service.createRequest({
        projectId,
        source: "web",
        requestText: `Reject stale authority after latest Git ${freshness}.`,
        correlationId: `corr:latest-v1-${freshness}`,
        idempotencyKey: `request:latest-v1-${freshness}`
      });
      const olderFresh = repository.createEvidence({
        projectId,
        requestId: request.id,
        producer: "portfolio.git-state-v1",
        sourceCategory: "git_state_v1",
        observedAt: new Date(baseObservedAt.getTime() + index * 10),
        digest: `sha256:latest-v1:${freshness}:older-fresh`,
        summary: "An older bounded Git observation was fresh when collected.",
        confidence: "trusted_platform",
        freshness: "fresh",
        idempotencyKey: `evidence:latest-v1:${freshness}:older-fresh`
      });
      repository.createEvidence({
        projectId,
        producer: "portfolio.git-state-v1",
        sourceCategory: "git_state_v1",
        observedAt: new Date(baseObservedAt.getTime() + index * 10 + 1),
        digest: `sha256:latest-v1:${freshness}:latest-bad`,
        summary: `The latest bounded Git observation is ${freshness}.`,
        confidence: "trusted_platform",
        freshness,
        idempotencyKey: `evidence:latest-v1:${freshness}:latest-bad`
      });

      const outcome = service.decideIntake({
        requestId: request.id,
        candidateProjectIds: [projectId],
        selectedProjectId: projectId,
        scopeAssessment: "in_boundary",
        producer: "portfolio-intake-test",
        evidenceIds: [olderFresh.id],
        idempotencyKey: `intake:latest-v1:${freshness}`
      });

      assert.equal(outcome.request.state, "needs_owner_decision", `${freshness} must prevent automatic Intake routing`);
      assert.equal(outcome.workItem, undefined);
      assert.throws(
        () => service.updateDossier({
          projectId,
          expectedProjectionVersion: enrollment.dossier.projectionVersion,
          observedState: { source: `latest Git ${freshness}` },
          evidenceIds: [olderFresh.id],
          idempotencyKey: `dossier:latest-v1:${freshness}`
        }),
        /PORTFOLIO_EVIDENCE_NOT_FOUND/,
        `${freshness} must prevent replacing Dossier observed state with the shadowed fresh fact`
      );

      // Direct repository callers must hit the same source-aware fence, not merely the service precheck.
      const directRequest = repository.createRequest({
        projectId,
        source: "web",
        requestText: `Direct repository Intake must reject the latest Git ${freshness}.`,
        correlationId: `corr:repository-latest-v1-${freshness}`,
        idempotencyKey: `request:repository-latest-v1-${freshness}`
      });
      const directOlderFresh = repository.createEvidence({
        projectId,
        requestId: directRequest.id,
        producer: "portfolio.git-state-v1",
        sourceCategory: "git_state_v1",
        observedAt: new Date(baseObservedAt.getTime() + index * 10 + 2),
        digest: `sha256:repository-latest-v1:${freshness}:older-fresh`,
        summary: "A direct repository fixture retains an older fresh Git observation.",
        confidence: "trusted_platform",
        freshness: "fresh",
        idempotencyKey: `evidence:repository-latest-v1:${freshness}:older-fresh`
      });
      repository.createEvidence({
        projectId,
        producer: "portfolio.git-state-v1",
        sourceCategory: "git_state_v1",
        observedAt: new Date(baseObservedAt.getTime() + index * 10 + 3),
        digest: `sha256:repository-latest-v1:${freshness}:latest-bad`,
        summary: `The direct repository fixture records latest Git ${freshness}.`,
        confidence: "trusted_platform",
        freshness,
        idempotencyKey: `evidence:repository-latest-v1:${freshness}:latest-bad`
      });

      assert.throws(
        () => repository.acceptInBoundaryIntakeDecision({
          requestId: directRequest.id,
          projectId,
          candidateProjectIds: [projectId],
          producer: "portfolio-intake-test",
          evidenceIds: [directOlderFresh.id],
          idempotencyKey: `repository-intake:latest-v1:${freshness}`
        }),
        /PORTFOLIO_INTAKE_EVIDENCE_INVALID/,
        `${freshness} must reject a direct repository Intake decision using the shadowed fresh Git fact`
      );
      assert.throws(
        () => repository.updateDossier({
          projectId,
          expectedProjectionVersion: enrollment.dossier.projectionVersion,
          observedState: { source: `repository latest Git ${freshness}` },
          evidenceIds: [directOlderFresh.id],
          idempotencyKey: `repository-dossier:latest-v1:${freshness}`
        }),
        /PORTFOLIO_ENROLLMENT_EVIDENCE_INVALID/,
        `${freshness} must reject a direct repository Dossier update using the shadowed fresh Git fact`
      );
      assert.equal(repository.getRequest(directRequest.id)?.state, "received");
      assert.equal(countRows(db, "portfolio_intake_decisions", directRequest.id), 0);
      assert.equal(repository.getDossier(projectId)?.projectionVersion, enrollment.dossier.projectionVersion);
    }
  });

  it("preserves an original Web request and rejects a divergent idempotency replay", () => {
    // Arrange
    enrollProject(service, {
      projectId,
      objective: "Preserve every Web-originated requirement verbatim.",
      intendedOutcome: "Retries cannot rewrite request intent.",
      scope: { roots: ["packages/gateway"] },
      idempotencyKey: "enrollment:immutable-request"
    });
    const input = {
      source: "web",
      sourceEventId: "web:event:immutable-request",
      requesterId: owner.id,
      requestText: "Ship <intake> safely; preserve this exact wording.",
      correlationId: "corr:immutable-request",
      sourceMetadata: { origin: "portfolio-web" },
      idempotencyKey: "request:immutable-request"
    } as const;

    // Act
    const created = service.createRequest(input);
    const replayed = service.createRequest(input);

    // Assert
    assert.equal(replayed.id, created.id);
    assert.equal(countRows(db, "portfolio_requests"), 1);
    assert.throws(
      () => service.createRequest({
        ...input,
        requestText: "A replay must not silently rewrite the original requirement."
      }),
      /PORTFOLIO_IDEMPOTENCY_CONFLICT/
    );
    const request = db.prepare(`SELECT request_text, source, requester_id, source_event_id, correlation_id
      FROM portfolio_requests WHERE id = ?`).get(created.id) as {
      request_text: string;
      source: string;
      requester_id: string;
      source_event_id: string;
      correlation_id: string;
    } | undefined;
    assert.deepEqual(request, {
      request_text: input.requestText,
      source: input.source,
      requester_id: owner.id,
      source_event_id: input.sourceEventId,
      correlation_id: input.correlationId
    });
  });

  it("enforces immutable Request payload fields while allowing workflow state and project routing updates", () => {
    // Arrange
    enrollProject(service, {
      projectId,
      objective: "Keep an incoming requirement immutable after receipt.",
      intendedOutcome: "Workflow routing remains mutable without rewriting source input.",
      idempotencyKey: "enrollment:immutable-request-fields:first"
    });
    const secondProjectId = new ProjectRepository(db, owner.id).create({
      name: "Request routing target",
      path: "/tmp/forgebadger-portfolio-request-routing-target",
      aiTool: "claude"
    }).id;
    enrollProject(service, {
      projectId: secondProjectId,
      objective: "Provide a permitted routing target.",
      intendedOutcome: "The immutable payload trigger does not block project routing.",
      idempotencyKey: "enrollment:immutable-request-fields:second"
    });
    const request = service.createRequest({
      source: "web",
      sourceEventId: "web:event:immutable-fields",
      requesterId: owner.id,
      requestText: "Preserve this requirement exactly.",
      correlationId: "corr:immutable-fields",
      sourceMetadata: { origin: "portfolio-web" },
      idempotencyKey: "request:immutable-fields"
    });

    // Act / Assert
    for (const statement of [
      "UPDATE portfolio_requests SET request_text = 'rewritten' WHERE id = ?",
      "UPDATE portfolio_requests SET requester_id = 'rewritten' WHERE id = ?",
      "UPDATE portfolio_requests SET source = 'rewritten' WHERE id = ?",
      "UPDATE portfolio_requests SET source_event_id = 'rewritten' WHERE id = ?",
      "UPDATE portfolio_requests SET source_metadata_json = '{}' WHERE id = ?",
      "UPDATE portfolio_requests SET received_at = 0 WHERE id = ?",
      "UPDATE portfolio_requests SET correlation_id = 'rewritten' WHERE id = ?",
      "UPDATE portfolio_requests SET idempotency_key = 'rewritten' WHERE id = ?",
      "UPDATE portfolio_requests SET input_digest = 'rewritten' WHERE id = ?"
    ]) {
      assert.throws(
        () => db.prepare(statement).run(request.id),
        /PORTFOLIO_REQUEST_IMMUTABLE/
      );
    }
    const repository = new PortfolioRepository(db, owner.id);
    const routed = repository.routeRequest({
      requestId: request.id,
      projectId: secondProjectId,
      expectedProjectionVersion: request.projectionVersion,
      idempotencyKey: "request:immutable-fields:route"
    });
    repository.createStateGate().transition({
      recordType: "request",
      recordId: routed.id,
      toState: "triaged",
      actorId: owner.id,
      expectedProjectionVersion: routed.projectionVersion,
      correlationId: routed.correlationId,
      idempotencyKey: "request:immutable-fields:triaged"
    });
    const mutableProjection = repository.getRequest(request.id);
    assert.equal(mutableProjection?.projectId, secondProjectId);
    assert.equal(mutableProjection?.state, "triaged");
  });

  it("does not let a tenant member spoof a Request requester and rejects the same direct repository write", () => {
    // Arrange
    enrollProject(service, {
      projectId,
      objective: "Keep Portfolio Request identity tenant-owned.",
      intendedOutcome: "A caller cannot create work under another user's identity.",
      scope: { roots: ["packages/gateway"] },
      idempotencyKey: "enrollment:requester-scope"
    });
    const spoofedInput = {
      projectId,
      source: "web",
      requesterId: other.id,
      requestText: "A caller must not attribute this request to a different tenant member.",
      correlationId: "corr:requester-scope",
      idempotencyKey: "request:requester-scope"
    } as const;

    // Act / Assert
    try {
      const request = service.createRequest(spoofedInput);
      assert.equal(request.requesterId, owner.id);
    } catch (error) {
      assert.match(String(error), /PORTFOLIO_REQUESTER_SCOPE_MISMATCH/);
    }
    assert.throws(
      () => new PortfolioRepository(db, owner.id).createRequest({
        ...spoofedInput,
        idempotencyKey: "request:requester-scope:repository"
      }),
      /PORTFOLIO_REQUESTER_SCOPE_MISMATCH/
    );
  });

  it("creates exactly one linked todo Work Item for an idempotent clear intake", () => {
    // Arrange
    enrollProject(service, {
      projectId,
      objective: "Keep the Gateway's request-to-work trace explicit.",
      intendedOutcome: "Clear in-boundary intake creates a single todo item.",
      scope: { roots: ["packages/gateway"] },
      idempotencyKey: "enrollment:clear-intake"
    });
    const request = service.createRequest({
      source: "web",
      requestText: "Add a durable intake decision service for Gateway requests.",
      correlationId: "corr:clear-intake",
      idempotencyKey: "request:clear-intake"
    });
    const evidence = createEvidence({
      db,
      userId: owner.id,
      projectId,
      requestId: request.id,
      idempotencyKey: "evidence:intake:clear"
    });
    const decision = {
      requestId: request.id,
      candidateProjectIds: [projectId],
      selectedProjectId: projectId,
      scopeAssessment: "in_boundary",
      producer: "portfolio-intake-test",
      evidenceIds: [evidence.id],
      workItem: {
        title: "Implement durable Portfolio intake",
        description: "Keep the request relationship in canonical Portfolio persistence.",
        acceptanceCriteria: ["The Work Item is linked to its Request"],
        verificationRequirements: ["portfolio-intake-service.test.ts"]
      },
      idempotencyKey: "intake:clear"
    } as const;

    // Act
    const first = service.decideIntake(decision);
    const replayed = service.decideIntake(decision);

    // Assert
    assert.ok(first.workItem);
    assert.equal(first.workItem.state, "todo");
    assert.equal(first.workItem.requestId, request.id);
    assert.equal(replayed.workItem?.id, first.workItem.id);
    assert.equal(countRows(db, "portfolio_work_items", request.id), 1);
    const intakeDecision = db.prepare(`SELECT selected_project_id, scope_assessment, producer
      FROM portfolio_intake_decisions WHERE user_id = ? AND request_id = ?`).get(owner.id, request.id) as {
      selected_project_id: string;
      scope_assessment: string;
      producer: string;
    } | undefined;
    assert.deepEqual(intakeDecision, {
      selected_project_id: projectId,
      scope_assessment: "in_boundary",
      producer: "portfolio-intake-test"
    });
  });

  it("accepts a pre-bound Request only through its enrolled project and rejects conflicting intake routes", () => {
    // Arrange
    enrollProject(service, {
      projectId,
      objective: "Keep pre-bound Request routing inside its enrolled project.",
      intendedOutcome: "A clear intake keeps the original project relationship intact.",
      idempotencyKey: "enrollment:pre-bound-intake:first"
    });
    const secondProjectId = new ProjectRepository(db, owner.id).create({
      name: "Conflicting pre-bound intake project",
      path: "/tmp/forgebadger-portfolio-pre-bound-intake-second",
      aiTool: "claude"
    }).id;
    enrollProject(service, {
      projectId: secondProjectId,
      objective: "Provide a separate active Dossier for conflict assertions.",
      intendedOutcome: "A pre-bound Request never silently changes projects.",
      idempotencyKey: "enrollment:pre-bound-intake:second"
    });
    const repository = new PortfolioRepository(db, owner.id);
    const clearRequest = service.createRequest({
      projectId,
      source: "web",
      requestText: "Complete this known Project A Portfolio change.",
      correlationId: "corr:pre-bound-intake:clear",
      idempotencyKey: "request:pre-bound-intake:clear"
    });
    const clearEvidence = createEvidence({
      db,
      userId: owner.id,
      projectId,
      requestId: clearRequest.id,
      idempotencyKey: "evidence:pre-bound-intake:clear"
    });
    const conflictRequest = service.createRequest({
      projectId,
      source: "web",
      requestText: "This Project A Request must reject a Project B selection.",
      correlationId: "corr:pre-bound-intake:conflict",
      idempotencyKey: "request:pre-bound-intake:conflict"
    });

    // Act
    const clearOutcome = service.decideIntake({
      requestId: clearRequest.id,
      candidateProjectIds: [projectId],
      selectedProjectId: projectId,
      scopeAssessment: "in_boundary",
      producer: "portfolio-intake-test",
      evidenceIds: [clearEvidence.id],
      workItem: { title: "Complete the pre-bound Portfolio work" },
      idempotencyKey: "intake:pre-bound-intake:clear"
    });

    // Assert
    assert.equal(clearOutcome.request.state, "accepted");
    assert.equal(clearOutcome.request.projectId, projectId);
    assert.equal(clearOutcome.decision.state, "accepted");
    assert.equal(clearOutcome.decision.selectedProjectId, projectId);
    assert.equal(clearOutcome.workItem?.state, "todo");
    assert.equal(clearOutcome.workItem?.projectId, projectId);
    assert.equal(clearOutcome.workItem?.requestId, clearRequest.id);
    assert.equal(countRows(db, "portfolio_intake_decisions", clearRequest.id), 1);
    assert.equal(countRows(db, "portfolio_work_items", clearRequest.id), 1);
    const intakeFact = repository.listRequestFacts(clearRequest.id).find((fact) => fact.factType === "intake_decision_recorded");
    assert.equal(intakeFact?.projectId, projectId);

    assert.throws(
      () => service.decideIntake({
        requestId: conflictRequest.id,
        candidateProjectIds: [secondProjectId],
        selectedProjectId: secondProjectId,
        scopeAssessment: "in_boundary",
        producer: "portfolio-intake-test",
        idempotencyKey: "intake:pre-bound-intake:service-conflict"
      }),
      /PORTFOLIO_REQUEST_ROUTE_CONFLICT/
    );
    assert.throws(
      () => repository.acceptInBoundaryIntakeDecision({
        requestId: conflictRequest.id,
        projectId: secondProjectId,
        candidateProjectIds: [secondProjectId],
        producer: "portfolio-intake-test",
        evidenceIds: [],
        idempotencyKey: "intake:pre-bound-intake:repository-conflict"
      }),
      /PORTFOLIO_REQUEST_ROUTE_CONFLICT/
    );
    assert.equal(repository.getRequest(conflictRequest.id)?.state, "received");
    assert.equal(repository.getRequest(conflictRequest.id)?.projectId, projectId);
    assert.equal(countRows(db, "portfolio_intake_decisions", conflictRequest.id), 0);
    assert.equal(countRows(db, "portfolio_work_items", conflictRequest.id), 0);
  });

  it("exposes only constrained Intake Decision commands and rejects unproven acceptance before Work Item creation", () => {
    // Arrange
    enrollProject(service, {
      projectId,
      objective: "Keep direct repository Work Item writes behind accepted intake.",
      intendedOutcome: "A received requirement never becomes work without a selected decision.",
      idempotencyKey: "enrollment:direct-work-item"
    });
    const repository = new PortfolioRepository(db, owner.id);
    const rawRepository = repository as unknown as {
      createIntakeDecision?: (input: unknown) => unknown;
      appendFact?: (input: unknown) => unknown;
    };
    const request = repository.createRequest({
      source: "web",
      requesterId: owner.id,
      requestText: "A repository caller must not bypass intake acceptance.",
      correlationId: "corr:direct-work-item",
      idempotencyKey: "request:direct-work-item"
    });

    // Act / Assert
    assert.equal(rawRepository.createIntakeDecision, undefined);
    assert.equal(rawRepository.appendFact, undefined);
    assert.throws(
      () => repository.createWorkItem({
        projectId,
        requestId: request.id,
        title: "Bypass accepted intake",
        idempotencyKey: "work-item:direct-before-acceptance"
      }),
      /PORTFOLIO_REQUEST_NOT_FOUND|PORTFOLIO_REQUEST_INTAKE_NOT_ACCEPTED/
    );
    assert.throws(
      () => repository.acceptInBoundaryIntakeDecision({
        requestId: request.id,
        projectId,
        candidateProjectIds: [projectId],
        producer: "untrusted-public-caller",
        evidenceIds: [],
        idempotencyKey: "intake-decision:direct-without-evidence"
      }),
      /PORTFOLIO_INTAKE_EVIDENCE_REQUIRED/
    );
    assert.throws(
      () => repository.acceptInBoundaryIntakeDecision({
        requestId: request.id,
        projectId,
        candidateProjectIds: [projectId, "ambiguous-project"],
        producer: "untrusted-public-caller",
        evidenceIds: [],
        idempotencyKey: "intake-decision:direct-ambiguous"
      }),
      /PORTFOLIO_INTAKE_ROUTE_INVALID/
    );
    const awaitingOwner = repository.recordAwaitingOwnerIntakeDecision({
      requestId: request.id,
      candidateProjectIds: [projectId, "ambiguous-project"],
      scopeAssessment: "ambiguous",
      producer: "portfolio-intake-test",
      idempotencyKey: "intake-decision:direct-awaiting-owner"
    });
    assert.equal(awaitingOwner.state, "awaiting_owner");
    assert.equal(awaitingOwner.selectedProjectId, null);
    assert.throws(
      () => repository.acceptOwnerIntakeDecision({
        requestId: request.id,
        projectId,
        idempotencyKey: "intake-decision:direct-before-owner-state"
      }),
      /PORTFOLIO_OWNER_DECISION_REQUIRED/
    );
  });

  it("keeps clear intake in owner decision when required Evidence is absent, unknown, cross-scoped, or untrusted", () => {
    // Arrange
    enrollProject(service, {
      projectId,
      objective: "Allow only trusted, project-scoped evidence to auto-route work.",
      intendedOutcome: "Unsafe evidence cannot create a Work Item.",
      scope: { roots: ["packages/gateway"] },
      idempotencyKey: "enrollment:evidence-guards:first"
    });
    const secondProjectId = new ProjectRepository(db, owner.id).create({
      name: "Second evidence candidate",
      path: "/tmp/forgebadger-portfolio-evidence-second",
      aiTool: "claude"
    }).id;
    enrollProject(service, {
      projectId: secondProjectId,
      objective: "Keep cross-project evidence outside the selected Dossier.",
      intendedOutcome: "Evidence scope is never inferred from a caller-provided ID.",
      scope: { roots: ["packages/web"] },
      idempotencyKey: "enrollment:evidence-guards:second"
    });
    const foreignProjectId = new ProjectRepository(db, other.id).create({
      name: "Foreign evidence project",
      path: "/tmp/forgebadger-portfolio-evidence-foreign",
      aiTool: "claude"
    }).id;
    const foreignService = new PortfolioIntakeService(db, other.id);
    enrollProject(foreignService, {
      projectId: foreignProjectId,
      objective: "Keep foreign tenant evidence private.",
      intendedOutcome: "An opaque foreign Evidence ID is never trusted.",
      scope: { roots: ["packages/gateway"] },
      idempotencyKey: "enrollment:evidence-guards:foreign"
    });
    const absentRequest = service.createRequest({ source: "web", requestText: "Absent evidence must not start work.", correlationId: "corr:evidence-absent", idempotencyKey: "request:evidence-absent" });
    const missingRequest = service.createRequest({ source: "web", requestText: "Unknown evidence must not start work.", correlationId: "corr:evidence-missing", idempotencyKey: "request:evidence-missing" });
    const crossProjectRequest = service.createRequest({ source: "web", requestText: "Cross-project evidence must not start work.", correlationId: "corr:evidence-cross-project", idempotencyKey: "request:evidence-cross-project" });
    const evidenceSourceRequest = service.createRequest({ source: "web", requestText: "Evidence belongs to this different request.", correlationId: "corr:evidence-source", idempotencyKey: "request:evidence-source" });
    const crossRequest = service.createRequest({ source: "web", requestText: "Cross-request evidence must not start work.", correlationId: "corr:evidence-cross-request", idempotencyKey: "request:evidence-cross-request" });
    const foreignRequest = service.createRequest({ source: "web", requestText: "Foreign evidence must not start work.", correlationId: "corr:evidence-foreign", idempotencyKey: "request:evidence-foreign" });
    const untrustedRequest = service.createRequest({ source: "web", requestText: "Low-confidence evidence must not start work.", correlationId: "corr:evidence-untrusted", idempotencyKey: "request:evidence-untrusted" });
    const staleRequest = service.createRequest({ source: "web", requestText: "Stale evidence must not start work.", correlationId: "corr:evidence-stale", idempotencyKey: "request:evidence-stale" });
    const crossProjectEvidence = createEvidence({ db, userId: owner.id, projectId: secondProjectId, requestId: crossProjectRequest.id, idempotencyKey: "evidence:cross-project" });
    const crossRequestEvidence = createEvidence({ db, userId: owner.id, projectId, requestId: evidenceSourceRequest.id, idempotencyKey: "evidence:cross-request" });
    const foreignEvidence = createEvidence({ db, userId: other.id, projectId: foreignProjectId, idempotencyKey: "evidence:foreign" });
    const untrustedEvidence = createEvidence({ db, userId: owner.id, projectId, requestId: untrustedRequest.id, confidence: "low", idempotencyKey: "evidence:untrusted" });
    const staleEvidence = createEvidence({ db, userId: owner.id, projectId, requestId: staleRequest.id, freshness: "stale", idempotencyKey: "evidence:stale" });

    // Act
    const outcomes = [
      service.decideIntake({ requestId: absentRequest.id, candidateProjectIds: [projectId], selectedProjectId: projectId, scopeAssessment: "in_boundary", producer: "portfolio-intake-test", idempotencyKey: "intake:evidence-absent" }),
      service.decideIntake({ requestId: missingRequest.id, candidateProjectIds: [projectId], selectedProjectId: projectId, scopeAssessment: "in_boundary", producer: "portfolio-intake-test", evidenceIds: ["evidence:not-found"], idempotencyKey: "intake:evidence-missing" }),
      service.decideIntake({ requestId: crossProjectRequest.id, candidateProjectIds: [projectId], selectedProjectId: projectId, scopeAssessment: "in_boundary", producer: "portfolio-intake-test", evidenceIds: [crossProjectEvidence.id], idempotencyKey: "intake:evidence-cross-project" }),
      service.decideIntake({ requestId: crossRequest.id, candidateProjectIds: [projectId], selectedProjectId: projectId, scopeAssessment: "in_boundary", producer: "portfolio-intake-test", evidenceIds: [crossRequestEvidence.id], idempotencyKey: "intake:evidence-cross-request" }),
      service.decideIntake({ requestId: foreignRequest.id, candidateProjectIds: [projectId], selectedProjectId: projectId, scopeAssessment: "in_boundary", producer: "portfolio-intake-test", evidenceIds: [foreignEvidence.id], idempotencyKey: "intake:evidence-foreign" }),
      service.decideIntake({ requestId: untrustedRequest.id, candidateProjectIds: [projectId], selectedProjectId: projectId, scopeAssessment: "in_boundary", producer: "portfolio-intake-test", evidenceIds: [untrustedEvidence.id], idempotencyKey: "intake:evidence-untrusted" }),
      service.decideIntake({ requestId: staleRequest.id, candidateProjectIds: [projectId], selectedProjectId: projectId, scopeAssessment: "in_boundary", producer: "portfolio-intake-test", evidenceIds: [staleEvidence.id], idempotencyKey: "intake:evidence-stale" })
    ];

    // Assert
    for (const [request, outcome] of [
      [absentRequest, outcomes[0]],
      [missingRequest, outcomes[1]],
      [crossProjectRequest, outcomes[2]],
      [crossRequest, outcomes[3]],
      [foreignRequest, outcomes[4]],
      [untrustedRequest, outcomes[5]],
      [staleRequest, outcomes[6]]
    ] as const) {
      assert.equal(outcome?.request.state, "needs_owner_decision");
      assert.equal(outcome?.workItem, undefined);
      assert.equal(countRows(db, "portfolio_work_items", request.id), 0);
    }
  });

  it("replays exactly one owner resolution and rejects fresh or alternate-project resolutions after acceptance", () => {
    // Arrange
    enrollProject(service, {
      projectId,
      objective: "Require one owner-recorded routing decision per request.",
      intendedOutcome: "Duplicate owner actions cannot manufacture more work.",
      scope: { roots: ["packages/gateway"] },
      idempotencyKey: "enrollment:owner-replay:first"
    });
    const secondProjectId = new ProjectRepository(db, owner.id).create({
      name: "Alternate owner decision project",
      path: "/tmp/forgebadger-portfolio-owner-replay-second",
      aiTool: "claude"
    }).id;
    enrollProject(service, {
      projectId: secondProjectId,
      objective: "Reject late alternate routing after acceptance.",
      intendedOutcome: "A Request has one accepted Portfolio owner.",
      scope: { roots: ["packages/web"] },
      idempotencyKey: "enrollment:owner-replay:second"
    });
    const request = service.createRequest({
      source: "web",
      requestText: "An owner must choose a project for this ambiguous request.",
      correlationId: "corr:owner-replay",
      idempotencyKey: "request:owner-replay"
    });
    service.decideIntake({
      requestId: request.id,
      candidateProjectIds: [projectId, secondProjectId],
      scopeAssessment: "ambiguous",
      producer: "portfolio-intake-test",
      idempotencyKey: "intake:owner-replay"
    });
    const resolution = {
      requestId: request.id,
      projectId,
      workItem: { title: "Complete the owner-confirmed Portfolio work" },
      idempotencyKey: "owner-resolution:replay"
    } as const;

    // Act
    const accepted = service.resolveOwnerDecision(resolution);
    const replayed = service.resolveOwnerDecision(resolution);
    const decisionsBeforeRejection = countRows(db, "portfolio_intake_decisions", request.id);
    const workItemsBeforeRejection = countRows(db, "portfolio_work_items", request.id);

    // Assert
    assert.equal(accepted.request.state, "accepted");
    assert.equal(replayed.workItem?.id, accepted.workItem?.id);
    assert.throws(
      () => service.resolveOwnerDecision({ ...resolution, idempotencyKey: "owner-resolution:fresh" }),
      /PORTFOLIO_(OWNER_DECISION_REQUIRED|INTAKE_STATE_INVALID|REQUEST_ALREADY_ACCEPTED)/
    );
    assert.throws(
      () => service.resolveOwnerDecision({ ...resolution, projectId: secondProjectId, idempotencyKey: "owner-resolution:alternate-project" }),
      /PORTFOLIO_(OWNER_DECISION_REQUIRED|INTAKE_STATE_INVALID|REQUEST_ALREADY_ACCEPTED|IDEMPOTENCY_CONFLICT)/
    );
    assert.equal(countRows(db, "portfolio_intake_decisions", request.id), decisionsBeforeRejection);
    assert.equal(countRows(db, "portfolio_work_items", request.id), workItemsBeforeRejection);
  });

  it("routes ambiguous, missing-Dossier, and scope-changing requests to owner decision without Work Items", () => {
    // Arrange
    enrollProject(service, {
      projectId,
      objective: "Constrain automatic routing to enrolled, in-boundary work.",
      intendedOutcome: "Owner review handles uncertain scope.",
      scope: { roots: ["packages/gateway"] },
      idempotencyKey: "enrollment:routing-guards:first"
    });
    const secondProjectId = new ProjectRepository(db, owner.id).create({
      name: "Second intake candidate",
      path: "/tmp/forgebadger-portfolio-intake-second",
      aiTool: "claude"
    }).id;
    enrollProject(service, {
      projectId: secondProjectId,
      objective: "Offer a second valid candidate for ambiguity tests.",
      intendedOutcome: "No ambiguous request auto-starts work.",
      scope: { roots: ["packages/web"] },
      idempotencyKey: "enrollment:routing-guards:second"
    });
    const unenrolledProjectId = new ProjectRepository(db, owner.id).create({
      name: "Unenrolled intake candidate",
      path: "/tmp/forgebadger-portfolio-intake-unenrolled",
      aiTool: "claude"
    }).id;
    const ambiguous = service.createRequest({ source: "web", requestText: "Which project should own this shared change?", correlationId: "corr:ambiguous", idempotencyKey: "request:ambiguous" });
    const missingDossier = service.createRequest({ source: "web", requestText: "Route this to an unenrolled project.", correlationId: "corr:missing-dossier", idempotencyKey: "request:missing-dossier" });
    const scopeChange = service.createRequest({ source: "web", requestText: "Expand the Portfolio scope into a new product area.", correlationId: "corr:scope-change", idempotencyKey: "request:scope-change" });

    // Act
    const ambiguousOutcome = service.decideIntake({
      requestId: ambiguous.id,
      candidateProjectIds: [projectId, secondProjectId],
      scopeAssessment: "ambiguous",
      producer: "portfolio-intake-test",
      idempotencyKey: "intake:ambiguous"
    });
    const missingDossierOutcome = service.decideIntake({
      requestId: missingDossier.id,
      candidateProjectIds: [unenrolledProjectId],
      scopeAssessment: "missing_dossier",
      producer: "portfolio-intake-test",
      idempotencyKey: "intake:missing-dossier"
    });
    const scopeChangeOutcome = service.decideIntake({
      requestId: scopeChange.id,
      candidateProjectIds: [projectId],
      selectedProjectId: projectId,
      scopeAssessment: "scope_change",
      producer: "portfolio-intake-test",
      idempotencyKey: "intake:scope-change"
    });

    // Assert
    for (const [request, outcome] of [
      [ambiguous, ambiguousOutcome],
      [missingDossier, missingDossierOutcome],
      [scopeChange, scopeChangeOutcome]
    ] as const) {
      assert.equal(outcome.request.state, "needs_owner_decision");
      assert.equal(outcome.workItem, undefined);
      assert.equal(countRows(db, "portfolio_work_items", request.id), 0);
    }
  });

  it("hides another tenant's timeline and never projects terminal or secret request data", () => {
    // Arrange
    enrollProject(service, {
      projectId,
      objective: "Return safe causal timeline projections only.",
      intendedOutcome: "Unauthorized users and raw evidence remain excluded.",
      scope: { roots: ["packages/gateway"] },
      idempotencyKey: "enrollment:safe-timeline"
    });
    const rawTerminalTranscript = "$ cat ~/.config/forgebadger/token\\nterminal-session-secret-123";
    const request = service.createRequest({
      source: "web",
      requesterId: owner.id,
      requestText: rawTerminalTranscript,
      correlationId: "corr:safe-timeline",
      sourceMetadata: { terminalOutput: rawTerminalTranscript, apiKey: "terminal-session-secret-123" },
      idempotencyKey: "request:safe-timeline"
    });
    service.decideIntake({
      requestId: request.id,
      candidateProjectIds: [projectId],
      selectedProjectId: projectId,
      scopeAssessment: "in_boundary",
      producer: "portfolio-intake-test",
      workItem: { title: "Project a safe request timeline" },
      idempotencyKey: "intake:safe-timeline"
    });
    const otherService = new PortfolioIntakeService(db, other.id);

    // Act
    const timeline = service.getRequestTimeline(request.id);

    // Assert
    assert.ok(timeline);
    assert.throws(
      () => otherService.getRequestTimeline(request.id),
      /PORTFOLIO_REQUEST_NOT_FOUND/
    );
    const projection = JSON.stringify(timeline);
    assert.doesNotMatch(projection, /terminal-session-secret-123|terminalOutput|apiKey|cat ~\/\.config\/forgebadger\/token/);
    assert.ok(projection.includes(request.id));
  });
});
