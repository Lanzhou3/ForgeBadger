import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { digestPortfolioActionIntent, PortfolioRepository } from "../src/db/repositories/portfolio-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { SessionRepository } from "../src/db/repositories/session-repository.js";
import { UserRepository, type User } from "../src/db/repositories/user-repository.js";
import * as repositoryModule from "../src/db/repositories/index.js";
import { PortfolioIntakeService, type EnrollProjectInput } from "../src/services/portfolio/intake-service.js";
import { createExecutablePortfolioAttempt } from "./portfolio-phase4-fixture.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  // State-Gate guarantees are meaningful only when tenant composite FKs are enforced.
  db.pragma("foreign_keys = ON");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
  return db;
}

function enrollProject(
  db: Database.Database,
  userId: string,
  input: Omit<EnrollProjectInput, "observedState" | "evidenceIds" | "initialEvidence">
) {
  const evidenceId = `evidence:${input.idempotencyKey}`;
  return new PortfolioIntakeService(db, userId).enrollProject({
    ...input,
    observedState: { status: "verified", source: "portfolio-state-gate-test" },
    evidenceIds: [evidenceId],
    initialEvidence: [{
      id: evidenceId,
      producer: "portfolio-state-gate-test",
      sourceCategory: "test",
      observedAt: new Date("2026-08-14T00:00:00.000Z"),
      digest: `sha256:${evidenceId}`,
      summary: "Trusted current evidence for a Portfolio State Gate fixture.",
      confidence: "high",
      freshness: "current"
    }]
  }).enrollment;
}

function createAcceptedWorkItem(
  db: Database.Database,
  userId: string,
  projectId: string,
  idempotencyKey: string,
  title = `Work item for ${idempotencyKey}`,
  requirements: { acceptanceCriteria?: string[]; verificationRequirements?: string[] } = {}
) {
  const service = new PortfolioIntakeService(db, userId);
  const request = service.createRequest({
    projectId,
    source: "test",
    requestText: `Accepted Request for ${idempotencyKey}`,
    correlationId: `corr:${idempotencyKey}`,
    idempotencyKey: `${idempotencyKey}:request`
  });
  const evidence = new PortfolioRepository(db, userId).createEvidence({
    projectId,
    requestId: request.id,
    producer: "portfolio-state-gate-test",
    sourceCategory: "test",
    observedAt: new Date("2026-08-14T00:00:00.000Z"),
    digest: `sha256:${idempotencyKey}:evidence`,
    summary: "Trusted current evidence for an accepted State Gate Work Item fixture.",
    confidence: "high",
    freshness: "current",
    idempotencyKey: `${idempotencyKey}:evidence`
  });
  const outcome = service.decideIntake({
    requestId: request.id,
    candidateProjectIds: [projectId],
    selectedProjectId: projectId,
    scopeAssessment: "in_boundary",
    producer: "portfolio-state-gate-test",
    evidenceIds: [evidence.id],
    workItem: { title, ...requirements },
    idempotencyKey: `${idempotencyKey}:intake`
  });
  if (!outcome.workItem) throw new Error("State Gate fixture requires accepted intake");
  return outcome.workItem;
}

function createV1CompletionEvidence(
  repository: PortfolioRepository,
  input: {
    projectId: string;
    requestId?: string;
    workItemId?: string;
    attemptId?: string;
    source: "platform_lifecycle_v1" | "git_state_v1";
    freshness: "fresh" | "stale" | "unknown" | "timeout" | "failed";
    observedAt: Date;
    verificationKey?: string;
    idempotencyKey: string;
  }
) {
  // V1 source identity, rather than a caller-provided Evidence ID, controls currentness.
  return repository.createEvidence({
    projectId: input.projectId,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.workItemId ? { workItemId: input.workItemId } : {}),
    ...(input.attemptId ? { attemptId: input.attemptId } : {}),
    producer: `portfolio.${input.source}`,
    sourceCategory: input.source,
    observedAt: input.observedAt,
    digest: `sha256:${input.idempotencyKey}`,
    summary: `Bounded ${input.source} observation is ${input.freshness}.`,
    confidence: "trusted_platform",
    freshness: input.freshness,
    ...(input.verificationKey ? { verificationKey: input.verificationKey } : {}),
    idempotencyKey: input.idempotencyKey
  });
}

type GateRecordType = "request" | "work_item" | "task_attempt" | "authorization" | "acceptance_decision";
type PortfolioStateGate = ReturnType<PortfolioRepository["createStateGate"]>;

describe("PortfolioStateGate", () => {
  let db: Database.Database;
  let owner: User;
  let other: User;
  let projectId: string;
  let repo: PortfolioRepository;
  let gate: PortfolioStateGate;
  let operationSequence: number;

  beforeEach(() => {
    // Arrange
    db = createTestDb();
    const users = new UserRepository(db);
    owner = users.create("portfolio-gate-owner@example.com", "hash");
    other = users.create("portfolio-gate-other@example.com", "hash");
    projectId = new ProjectRepository(db, owner.id).create({
      name: "Portfolio state-gate project",
      path: "/tmp/openforge-portfolio-state-gate",
      aiTool: "claude"
    }).id;
    repo = new PortfolioRepository(db, owner.id);
    enrollProject(db, owner.id, {
      projectId,
      objective: "Validate only fact-backed workflow transitions",
      intendedOutcome: "No state write bypasses the State Gate",
      idempotencyKey: "enrollment:state-gate"
    });
    gate = repo.createStateGate();
    operationSequence = 0;
  });

  it("allows every Portfolio Request edge and rejects terminal and reverse edges", () => {
    // Arrange
    const edges = [
      [[], "triaged"],
      [[], "needs_owner_decision"],
      [[], "cancelled"],
      [["triaged"], "accepted"],
      [["triaged"], "declined"],
      [["triaged"], "needs_owner_decision"],
      [["triaged"], "cancelled"],
      [["needs_owner_decision"], "accepted"],
      [["needs_owner_decision"], "declined"],
      [["needs_owner_decision"], "cancelled"]
    ] as const;

    // Act / Assert
    for (const [prefix, target] of edges) {
      const request = createRequest(repo, projectId, owner.id, nextKey("request"));
      let current = request;
      for (const state of prefix) {
        transition(gate, repo, "request", current.id, state, owner.id, nextKey("request-prefix"));
        current = repo.getRequest(current.id)!;
      }
      transition(gate, repo, "request", current.id, target, owner.id, nextKey("request-edge"));
      assert.equal(repo.getRequest(current.id)?.state, target);
    }

    const terminal = createRequest(repo, projectId, owner.id, nextKey("request-terminal"));
    transition(gate, repo, "request", terminal.id, "cancelled", owner.id, nextKey("request-cancel"));
    assert.throws(
      () => transition(gate, repo, "request", terminal.id, "received", owner.id, nextKey("request-reopen")),
      /PORTFOLIO_INVALID_TRANSITION/
    );
  });

  it("transitions an unprojected Request to owner decision with a tenant-scoped fact", () => {
    // Arrange
    const request = repo.createRequest({
      source: "web",
      requesterId: owner.id,
      requestText: "Which enrolled project should own this request?",
      correlationId: "corr:unprojected-owner-decision",
      idempotencyKey: nextKey("unprojected-request")
    });

    // Act
    transition(gate, repo, "request", request.id, "needs_owner_decision", owner.id, nextKey("unprojected-owner-decision"));

    // Assert
    assert.equal(repo.getRequest(request.id)?.state, "needs_owner_decision");
    const fact = db.prepare(`SELECT id, user_id, project_id, request_id, record_type, record_id, fact_type
      FROM portfolio_facts WHERE record_id = ? AND fact_type = 'state_transition'`).get(request.id) as {
      id: string;
      user_id: string;
      project_id: string | null;
      request_id: string | null;
      record_type: string;
      record_id: string;
      fact_type: string;
    } | undefined;
    assert.ok(fact);
    assert.deepEqual({
      user_id: fact.user_id,
      project_id: fact.project_id,
      request_id: fact.request_id,
      record_type: fact.record_type,
      record_id: fact.record_id,
      fact_type: fact.fact_type
    }, {
      user_id: owner.id,
      project_id: null,
      request_id: request.id,
      record_type: "request",
      record_id: request.id,
      fact_type: "state_transition"
    });
    assert.throws(
      () => db.prepare("UPDATE portfolio_facts SET payload_json = '{}' WHERE id = ?").run(fact.id),
      /PORTFOLIO_FACT_IMMUTABLE|immutable/i
    );
    assert.throws(
      () => db.prepare("DELETE FROM portfolio_facts WHERE id = ?").run(fact.id),
      /PORTFOLIO_FACT_IMMUTABLE|immutable/i
    );
  });

  it("allows every Task Attempt edge and rejects an invalid lifecycle jump", () => {
    // Arrange
    const edges = [
      [[], "awaiting_authorization"], [[], "dispatching"], [[], "cancelled"],
      [["awaiting_authorization"], "dispatching"], [["awaiting_authorization"], "cancelled"],
      [["dispatching"], "running"], [["dispatching"], "awaiting_authorization"], [["dispatching"], "blocked"], [["dispatching"], "failed"], [["dispatching"], "cancelled"],
      [["dispatching", "running"], "awaiting_permission"], [["dispatching", "running"], "evaluating"], [["dispatching", "running"], "blocked"], [["dispatching", "running"], "failed"], [["dispatching", "running"], "cancelled"],
      [["dispatching", "running", "awaiting_permission"], "dispatching"], [["dispatching", "running", "awaiting_permission"], "running"], [["dispatching", "running", "awaiting_permission"], "blocked"], [["dispatching", "running", "awaiting_permission"], "failed"], [["dispatching", "running", "awaiting_permission"], "cancelled"],
      [["dispatching", "running", "evaluating"], "succeeded"], [["dispatching", "running", "evaluating"], "blocked"], [["dispatching", "running", "evaluating"], "failed"], [["dispatching", "running", "evaluating"], "cancelled"]
    ] as const;

    // Act / Assert
    for (const [prefix, target] of edges) {
      const attempt = createAttempt(db, owner.id, repo, projectId, nextKey("attempt"));
      let current = attempt;
      for (const state of prefix) {
        transition(gate, repo, "task_attempt", current.id, state, owner.id, nextKey("attempt-prefix"));
        current = repo.getTaskAttempt(current.id)!;
      }
      transition(gate, repo, "task_attempt", current.id, target, owner.id, nextKey("attempt-edge"));
      assert.equal(repo.getTaskAttempt(current.id)?.state, target);
    }

    const invalid = createAttempt(db, owner.id, repo, projectId, nextKey("attempt-invalid"));
    assert.throws(
      () => transition(gate, repo, "task_attempt", invalid.id, "running", owner.id, nextKey("attempt-invalid-edge")),
      /PORTFOLIO_INVALID_TRANSITION/
    );
  });

  it("allows owner-confirmation authorization and acceptance-decision edges and rejects invalid authorization consumption", () => {
    // Arrange
    const authorizationEdges = [
      ["owner_confirmation", [], "approved"], ["owner_confirmation", [], "rejected"], ["owner_confirmation", [], "expired"], ["owner_confirmation", [], "cancelled"],
      ["owner_confirmation", ["approved"], "consumed"], ["owner_confirmation", ["approved"], "expired"], ["owner_confirmation", ["approved"], "cancelled"]
    ] as const;
    const acceptanceEdges = [
      [[], "rejected"], [[], "superseded"], [["rejected"], "superseded"]
    ] as const;

    // Act / Assert
    for (const [tier, prefix, target] of authorizationEdges) {
      const authorization = createAuthorization(db, owner.id, repo, projectId, nextKey("authorization"), tier);
      let current = authorization;
      for (const state of prefix) {
        transition(gate, repo, "authorization", current.id, state, owner.id, nextKey("authorization-prefix"));
        current = repo.getAuthorization(current.id)!;
      }
      transition(gate, repo, "authorization", current.id, target, owner.id, nextKey("authorization-edge"));
      assert.equal(repo.getAuthorization(current.id)?.state, target);
    }

    for (const [prefix, target] of acceptanceEdges) {
      const decision = createAcceptanceDecision(db, owner.id, repo, projectId, nextKey("acceptance"));
      let current = decision;
      for (const state of prefix) {
        transition(gate, repo, "acceptance_decision", current.id, state, owner.id, nextKey("acceptance-prefix"));
        current = repo.getAcceptanceDecision(current.id)!;
      }
      transition(gate, repo, "acceptance_decision", current.id, target, owner.id, nextKey("acceptance-edge"));
      assert.equal(repo.getAcceptanceDecision(current.id)?.state, target);
    }

    const authorization = createAuthorization(db, owner.id, repo, projectId, nextKey("authorization-invalid"));
    assert.throws(
      () => transition(gate, repo, "authorization", authorization.id, "consumed", owner.id, nextKey("authorization-invalid-edge")),
      /PORTFOLIO_INVALID_TRANSITION|PORTFOLIO_PRECONDITION_FAILED/
    );
    const preauthorized = createAuthorization(db, owner.id, repo, projectId, nextKey("authorization-preauthorized"), "preauthorized");
    assert.throws(
      () => transition(gate, repo, "authorization", preauthorized.id, "approved", owner.id, nextKey("authorization-preauthorized-approve")),
      /PORTFOLIO_PRECONDITION_FAILED/
    );
    const decision = createAcceptanceDecision(db, owner.id, repo, projectId, nextKey("acceptance-invalid"));
    transition(gate, repo, "acceptance_decision", decision.id, "rejected", owner.id, nextKey("acceptance-reject"));
    assert.throws(
      () => transition(gate, repo, "acceptance_decision", decision.id, "accepted", owner.id, nextKey("acceptance-invalid-edge")),
      /PORTFOLIO_INVALID_TRANSITION/
    );
  });

  it("requires the Work Item owner to consume an approved owner-tier authorization", () => {
    // Arrange
    const authorization = createAuthorization(db, owner.id, repo, projectId, nextKey("owner-consumption"));
    const approved = repo.approveAuthorization({
      authorizationId: authorization.id,
      expectedProjectionVersion: authorization.projectionVersion,
      actionDigest: authorization.actionDigest,
      actorId: owner.id
    });

    // Act / Assert
    assert.throws(
      () => transition(gate, repo, "authorization", approved.id, "consumed", other.id, nextKey("owner-consumption-other")),
      /PORTFOLIO_OWNER_REQUIRED|PORTFOLIO_PRECONDITION_FAILED/
    );
    transition(gate, repo, "authorization", approved.id, "consumed", owner.id, nextKey("owner-consumption-owner"));
    assert.equal(repo.getAuthorization(authorization.id)?.state, "consumed");
  });

  it("fails closed when authorization tier, policy, digest, or owner identity diverges from its action intent", () => {
    // Arrange
    const authorization = createAuthorization(db, owner.id, repo, projectId, nextKey("authorization-binding"));
    const intent = repo.getActionIntent(authorization.actionIntentId);
    assert.ok(intent);
    assert.ok(authorization.workItemId);

    // Act / Assert
    assert.equal(repo.canApproveAuthorization(authorization.id, other.id), false);
    assert.equal(repo.canConsumeAuthorization(authorization.id, owner.id), false);
    assert.throws(
      () => repo.createAuthorization({
        projectId,
        workItemId: authorization.workItemId,
        actionIntentId: authorization.actionIntentId,
        authorizationTier: "owner_confirmation",
        actionDigest: "a".repeat(64),
        policyRule: "owner-confirmation/v1",
        expiresAt: intent.expiresAt,
        idempotencyKey: nextKey("authorization-digest-mismatch")
      }),
      /PORTFOLIO_AUTHORIZATION_DIGEST_MISMATCH/
    );
    assert.throws(
      () => repo.createAuthorization({
        projectId,
        workItemId: authorization.workItemId,
        actionIntentId: authorization.actionIntentId,
        authorizationTier: "preauthorized",
        actionDigest: authorization.actionDigest,
        policyRule: "owner-confirmation/v1",
        expiresAt: intent.expiresAt,
        idempotencyKey: nextKey("authorization-tier-policy-mismatch")
      }),
      /PORTFOLIO_AUTHORIZATION_POLICY_MISMATCH/
    );
    assert.throws(
      () => repo.approveAuthorization({
        authorizationId: authorization.id,
        expectedProjectionVersion: authorization.projectionVersion,
        actionDigest: authorization.actionDigest,
        actorId: other.id
      }),
      /PORTFOLIO_AUTHORIZATION_APPROVAL_REJECTED/
    );
  });

  it("requires observed dispatch, blocker evidence, completion evidence, accepted decision, and owner cancellation", () => {
    // Arrange
    const item = createAcceptedWorkItem(
      db,
      owner.id,
      projectId,
      nextKey("work-item"),
      "Evidence-gated work item",
      { acceptanceCriteria: ["complete"], verificationRequirements: ["gateway-contract-test"] }
    );
    const attempt = createExecutablePortfolioAttempt(repo, {
      projectId,
      workItemId: item.id,
      packetVersion: 1,
      packetDigest: "sha256:state-gate-attempt",
      adapter: "claude",
      createdBy: owner.id,
      sourceWorkItemVersion: item.projectionVersion,
      idempotencyKey: nextKey("attempt")
    });

    // A generic audit write must not be able to manufacture the receipt that starts work.
    const rawRepository = repo as unknown as {
      appendFact?: (input: unknown) => unknown;
    };
    assert.equal(rawRepository.appendFact, undefined);
    assert.throws(
      () => rawRepository.appendFact!({
        recordType: "task_attempt",
        factType: "dispatch_observed"
      }),
      TypeError
    );
    const sessionId = new SessionRepository(db, owner.id).create({
      projectId,
      name: "State Gate session",
      aiTool: "claude",
      workingDir: "/tmp/openforge-portfolio-state-gate"
    }).id;

    // Act / Assert: neither an idle Attempt nor another actor can alter lifecycle state.
    assert.throws(
      () => transition(gate, repo, "work_item", item.id, "in_progress", owner.id, nextKey("missing-dispatch"), attempt.id),
      /PORTFOLIO_PRECONDITION_FAILED/
    );
    assert.throws(
      () => transition(gate, repo, "work_item", item.id, "cancelled", other.id, nextKey("non-owner-cancel")),
      /PORTFOLIO_OWNER_REQUIRED/
    );

    const assignment = repo.claimSessionAssignment({
      projectId,
      workItemId: item.id,
      attemptId: attempt.id,
      sessionId,
      adapter: "claude",
      leaseDurationMs: 60_000
    });
    const intent = repo.createActionIntent({
      projectId,
      workItemId: item.id,
      attemptId: attempt.id,
      sessionId,
      actionClass: "session.dispatch",
      payloadDigest: "sha256:state-gate-dispatch",
      assignmentLeaseToken: assignment.leaseToken,
      policyRule: "owner-confirmation/v1",
      expiresAt: new Date(Date.now() + 60_000),
      idempotencyKey: nextKey("dispatch-intent")
    });
    const authorization = createConsumedOwnerAuthorization(repo, {
      userId: owner.id,
      projectId,
      workItemId: item.id,
      attemptId: attempt.id,
      actionIntentId: intent.id,
      idempotencyKey: nextKey("dispatch-authorization")
    });
    const command = repo.createCommand({
      projectId,
      workItemId: item.id,
      attemptId: attempt.id,
      actionIntentId: intent.id,
      assignmentId: assignment.id,
      authorizationId: authorization.id,
      commandType: "session.dispatch",
      payloadDigest: "sha256:state-gate-dispatch",
      idempotencyKey: nextKey("dispatch-command")
    });
    repo.recordDispatchReceipt({
      commandId: command.id,
      assignmentId: assignment.id,
      leaseToken: assignment.leaseToken,
      receiptDigest: "sha256:state-gate-dispatch-receipt",
      expectedProjectionVersion: command.projectionVersion,
      idempotencyKey: nextKey("dispatch-observed")
    });
    transition(gate, repo, "work_item", item.id, "in_progress", owner.id, nextKey("start-work"), attempt.id);

    assert.throws(
      () => transition(gate, repo, "work_item", item.id, "blocked", owner.id, nextKey("missing-blocker")),
      /PORTFOLIO_PRECONDITION_FAILED/
    );
    repo.createEvidence({
      projectId,
      requestId: item.requestId,
      workItemId: item.id,
      attemptId: attempt.id,
      producer: "owner.report.v1",
      sourceCategory: "owner_report",
      observedAt: new Date(),
      digest: "sha256:blocker-evidence",
      summary: "A concrete blocked dependency was reported.",
      confidence: "owner_reported",
      freshness: "fresh",
      isBlocker: true,
      idempotencyKey: nextKey("blocker-evidence")
    });
    transition(gate, repo, "work_item", item.id, "blocked", owner.id, nextKey("block-work"));
    assert.throws(
      () => transition(gate, repo, "work_item", item.id, "in_progress", owner.id, nextKey("missing-resume-dispatch"), attempt.id),
      /PORTFOLIO_PRECONDITION_FAILED/
    );
    const recoveredIntent = repo.createActionIntent({
      projectId,
      workItemId: item.id,
      attemptId: attempt.id,
      sessionId,
      actionClass: "session.dispatch",
      payloadDigest: "sha256:state-gate-recovered-dispatch",
      assignmentLeaseToken: assignment.leaseToken,
      policyRule: "owner-confirmation/v1",
      expiresAt: new Date(Date.now() + 60_000),
      idempotencyKey: nextKey("recovered-dispatch-intent")
    });
    const recoveredAuthorization = createConsumedOwnerAuthorization(repo, {
      userId: owner.id,
      projectId,
      workItemId: item.id,
      attemptId: attempt.id,
      actionIntentId: recoveredIntent.id,
      idempotencyKey: nextKey("recovered-dispatch-authorization")
    });
    const recoveredCommand = repo.createCommand({
      projectId,
      workItemId: item.id,
      attemptId: attempt.id,
      actionIntentId: recoveredIntent.id,
      assignmentId: assignment.id,
      authorizationId: recoveredAuthorization.id,
      commandType: "session.dispatch",
      payloadDigest: "sha256:state-gate-recovered-dispatch",
      idempotencyKey: nextKey("recovered-dispatch-command")
    });
    repo.recordDispatchReceipt({
      commandId: recoveredCommand.id,
      assignmentId: assignment.id,
      leaseToken: assignment.leaseToken,
      receiptDigest: "sha256:state-gate-recovered-dispatch-receipt",
      expectedProjectionVersion: recoveredCommand.projectionVersion,
      idempotencyKey: nextKey("recovered-dispatch-receipt")
    });
    assert.throws(
      () => transition(gate, repo, "work_item", item.id, "in_progress", other.id, nextKey("unauthorized-resume"), attempt.id),
      /PORTFOLIO_OWNER_REQUIRED|PORTFOLIO_PRECONDITION_FAILED/
    );
    transition(gate, repo, "work_item", item.id, "in_progress", owner.id, nextKey("resume-work"), attempt.id);

    assert.throws(
      () => transition(gate, repo, "work_item", item.id, "ready_for_review", owner.id, nextKey("attemptless-ready-for-review")),
      /PORTFOLIO_COMPLETION_ATTEMPT_REQUIRED/
    );
    assert.throws(
      () => transition(gate, repo, "work_item", item.id, "ready_for_review", owner.id, nextKey("missing-completion"), attempt.id),
      /PORTFOLIO_COMPLETION_EVIDENCE_INSUFFICIENT/
    );
    const acceptanceEvidence = repo.createEvidence({
      projectId,
      requestId: item.requestId,
      workItemId: item.id,
      attemptId: attempt.id,
      producer: "gateway.test.v1",
      sourceCategory: "declared_acceptance",
      observedAt: new Date(),
      digest: "sha256:acceptance-evidence",
      summary: "The named acceptance criterion passed without raw output.",
      confidence: "trusted_platform",
      freshness: "current",
      verificationKey: "acceptance:complete",
      idempotencyKey: nextKey("acceptance-evidence")
    });
    const verificationEvidence = repo.createEvidence({
      projectId,
      requestId: item.requestId,
      workItemId: item.id,
      attemptId: attempt.id,
      producer: "gateway.test.v1",
      sourceCategory: "declared_verification",
      observedAt: new Date(),
      digest: "sha256:verification-evidence",
      summary: "The required verification passed without raw output.",
      confidence: "trusted_platform",
      freshness: "current",
      verificationKey: "verification:gateway-contract-test",
      idempotencyKey: nextKey("verification-evidence")
    });
    const candidate = repo.createCompletionCandidate({
      projectId,
      requestId: item.requestId,
      workItemId: item.id,
      attemptId: attempt.id,
      summary: "The worker reports a completion candidate; it is not acceptance.",
      evidenceIds: [acceptanceEvidence.id, verificationEvidence.id],
      // Callers cannot mark a candidate verified through the create payload.
      verified: true,
      idempotencyKey: nextKey("completion-candidate")
    } as Parameters<PortfolioRepository["createCompletionCandidate"]>[0]);
    assert.equal(candidate.verifiedAt, null);
    assert.throws(
      () => gate.verifyCompletionCandidate({
        candidateId: candidate.id,
        expectedProjectionVersion: candidate.projectionVersion,
        actorId: other.id,
        policyRule: "non_owner_cannot_verify_candidate",
        idempotencyKey: nextKey("non-owner-verify-completion-candidate")
      }),
      /PORTFOLIO_PRECONDITION_FAILED/
    );
    gate.verifyCompletionCandidate({
      candidateId: candidate.id,
      expectedProjectionVersion: candidate.projectionVersion,
      actorId: owner.id,
      policyRule: "owner_verifies_trusted_candidate",
      idempotencyKey: nextKey("verify-completion-candidate")
    });
    const verifiedCandidate = repo.getCompletionCandidate(candidate.id)!;
    assert.ok(verifiedCandidate.verifiedAt);
    transition(gate, repo, "work_item", item.id, "ready_for_review", owner.id, nextKey("review-work"), attempt.id);

    assert.throws(
      () => transition(gate, repo, "work_item", item.id, "done", owner.id, nextKey("attemptless-done")),
      /PORTFOLIO_ACCEPTANCE_ATTEMPT_REQUIRED/
    );
    assert.throws(
      () => transition(gate, repo, "work_item", item.id, "done", owner.id, nextKey("missing-acceptance"), attempt.id),
      /PORTFOLIO_ACCEPTANCE_EVIDENCE_INSUFFICIENT/
    );
    assert.throws(
      () => transition(gate, repo, "work_item", item.id, "in_progress", owner.id, nextKey("missing-follow-up-attempt")),
      /PORTFOLIO_PRECONDITION_FAILED/
    );
    const followUpAttempt = createExecutablePortfolioAttempt(repo, {
      projectId,
      workItemId: item.id,
      packetVersion: 2,
      packetDigest: "sha256:state-gate-follow-up-attempt",
      adapter: "claude",
      createdBy: owner.id,
      sourceWorkItemVersion: repo.getWorkItem(item.id)!.projectionVersion,
      idempotencyKey: nextKey("follow-up-attempt")
    });
    assert.equal(followUpAttempt.workItemId, item.id);
    transition(gate, repo, "work_item", item.id, "in_progress", owner.id, nextKey("review-rejected"));
    transition(gate, repo, "work_item", item.id, "ready_for_review", owner.id, nextKey("review-again"), attempt.id);
    const insufficientDecision = repo.createAcceptanceDecision({
      projectId,
      requestId: item.requestId,
      workItemId: item.id,
      attemptId: attempt.id,
      candidateId: candidate.id,
      decision: "accepted",
      idempotencyKey: nextKey("insufficient-accepted-decision")
    });
    assert.throws(
      () => transition(gate, repo, "acceptance_decision", insufficientDecision.id, "accepted", owner.id, nextKey("insufficient-accept")),
      /PORTFOLIO_PRECONDITION_FAILED/
    );
    assert.throws(
      () => transition(gate, repo, "work_item", item.id, "done", owner.id, nextKey("insufficient-done"), attempt.id),
      /PORTFOLIO_ACCEPTANCE_EVIDENCE_INSUFFICIENT/
    );
    const decision = repo.createAcceptanceDecision({
      projectId,
      requestId: item.requestId,
      workItemId: item.id,
      attemptId: attempt.id,
      candidateId: candidate.id,
      decision: "accepted",
      policyRule: "owner_acceptance_with_trusted_evidence",
      evidenceIds: [acceptanceEvidence.id, verificationEvidence.id],
      idempotencyKey: nextKey("accepted-decision")
    });
    assert.throws(
      () => transition(gate, repo, "acceptance_decision", decision.id, "accepted", other.id, nextKey("non-owner-accept")),
      /PORTFOLIO_OWNER_REQUIRED|PORTFOLIO_PRECONDITION_FAILED/
    );
    transition(gate, repo, "acceptance_decision", decision.id, "accepted", owner.id, nextKey("accept-decision"));
    assert.throws(
      () => transition(gate, repo, "acceptance_decision", decision.id, "rejected", owner.id, nextKey("accepted-decision-reopen")),
      /PORTFOLIO_INVALID_TRANSITION/
    );
    transition(gate, repo, "work_item", item.id, "done", owner.id, nextKey("complete-work"), attempt.id);
    assert.equal(repo.getWorkItem(item.id)?.state, "done");
    assert.throws(
      () => transition(gate, repo, "work_item", item.id, "in_progress", owner.id, nextKey("reopen-work")),
      /PORTFOLIO_INVALID_TRANSITION/
    );
  });

  it("fails closed unless every acceptance criterion and verification requirement has trusted, fresh, attempt-scoped evidence", () => {
    // Arrange: a generic terminal-like success signal cannot satisfy two named acceptance criteria.
    const criterionItem = createAcceptedWorkItem(
      db,
      owner.id,
      projectId,
      nextKey("criterion-item"),
      "Per-criterion evidence item",
      { acceptanceCriteria: ["criterion:a", "criterion:b"], verificationRequirements: ["verify:a", "verify:b"] }
    );
    const criterionAttempt = createExecutablePortfolioAttempt(repo, {
      projectId,
      workItemId: criterionItem.id,
      packetVersion: 1,
      packetDigest: "sha256:criterion-attempt",
      adapter: "claude",
      createdBy: owner.id,
      sourceWorkItemVersion: criterionItem.projectionVersion,
      idempotencyKey: nextKey("criterion-attempt")
    });
    const genericEvidence = repo.createEvidence({
      projectId,
      requestId: criterionItem.requestId,
      workItemId: criterionItem.id,
      attemptId: criterionAttempt.id,
      producer: "gateway.terminal.lifecycle",
      sourceCategory: "terminal_lifecycle",
      observedAt: new Date(),
      digest: "sha256:terminal-only-completion",
      summary: "Terminal stopped; this does not prove every acceptance criterion.",
      confidence: "trusted_platform",
      freshness: "fresh",
      verificationKey: "acceptance:criterion:a",
      idempotencyKey: nextKey("generic-criterion-evidence")
    });
    const genericCandidate = repo.createCompletionCandidate({
      projectId,
      requestId: criterionItem.requestId,
      workItemId: criterionItem.id,
      attemptId: criterionAttempt.id,
      summary: "A terminal-only completion candidate is insufficient.",
      evidenceIds: [genericEvidence.id],
      idempotencyKey: nextKey("generic-criterion-candidate")
    });

    // Act / Assert: candidate verification must not collapse multiple criteria into one trusted fact.
    assert.throws(
      () => gate.verifyCompletionCandidate({
        candidateId: genericCandidate.id,
        expectedProjectionVersion: genericCandidate.projectionVersion,
        actorId: owner.id,
        policyRule: "per-criterion-evidence-required",
        idempotencyKey: nextKey("generic-criterion-verify")
      }),
      /PORTFOLIO_COMPLETION_EVIDENCE_INSUFFICIENT/
    );

    // Arrange / Act / Assert: attemptless observations can be stored, but can never become a completion candidate or decision.
    const attemptlessEvidence = repo.createEvidence({
      projectId,
      requestId: criterionItem.requestId,
      workItemId: criterionItem.id,
      producer: "gateway.observation",
      sourceCategory: "bounded_observation",
      observedAt: new Date(),
      digest: "sha256:attemptless-observation",
      summary: "A bounded observation without an execution Attempt.",
      confidence: "trusted_platform",
      freshness: "fresh",
      verificationKey: "acceptance:criterion:b",
      idempotencyKey: nextKey("attemptless-observation")
    });
    assert.throws(
      () => repo.createCompletionCandidate({
        projectId,
        requestId: criterionItem.requestId,
        workItemId: criterionItem.id,
        attemptId: "",
        summary: "Attemptless evidence cannot become a completion candidate.",
        evidenceIds: [attemptlessEvidence.id],
        idempotencyKey: nextKey("attemptless-candidate")
      }),
      /PORTFOLIO_COMPLETION_ATTEMPT_REQUIRED/
    );
    assert.throws(
      () => repo.createAcceptanceDecision({
        projectId,
        requestId: criterionItem.requestId,
        workItemId: criterionItem.id,
        attemptId: "",
        candidateId: genericCandidate.id,
        decision: "accepted",
        idempotencyKey: nextKey("attemptless-decision")
      }),
      /PORTFOLIO_ACCEPTANCE_ATTEMPT_REQUIRED/
    );
    const mismatchedAttempt = createExecutablePortfolioAttempt(repo, {
      projectId,
      workItemId: criterionItem.id,
      packetVersion: 2,
      adapter: "claude",
      createdBy: owner.id,
      sourceWorkItemVersion: criterionItem.projectionVersion,
      idempotencyKey: nextKey("mismatched-decision-attempt")
    });
    assert.throws(
      () => repo.createAcceptanceDecision({
        projectId,
        requestId: criterionItem.requestId,
        workItemId: criterionItem.id,
        attemptId: mismatchedAttempt.id,
        candidateId: genericCandidate.id,
        decision: "accepted",
        idempotencyKey: nextKey("mismatched-decision")
      }),
      /PORTFOLIO_CANDIDATE_SCOPE_MISMATCH/
    );

    // Arrange: every named verification must be trusted, fresh, and tied to the candidate attempt.
    const cases = [
      { name: "untrusted", confidence: "model_reported", freshness: "fresh", useOtherAttempt: false },
      { name: "stale", confidence: "trusted_platform", freshness: "stale", useOtherAttempt: false },
      { name: "wrong-attempt", confidence: "trusted_platform", freshness: "fresh", useOtherAttempt: true }
    ] as const;

    // Act / Assert
    for (const testCase of cases) {
      const item = createAcceptedWorkItem(
        db,
        owner.id,
        projectId,
        nextKey(`verification-${testCase.name}-item`),
        `Verification ${testCase.name} item`,
        { verificationRequirements: ["verify:a", "verify:b"] }
      );
      const expectedAttempt = createExecutablePortfolioAttempt(repo, {
        projectId,
        workItemId: item.id,
        packetVersion: 1,
        packetDigest: `sha256:${testCase.name}:expected-attempt`,
        adapter: "claude",
        createdBy: owner.id,
        sourceWorkItemVersion: item.projectionVersion,
        idempotencyKey: nextKey(`verification-${testCase.name}-expected-attempt`)
      });
      const otherAttempt = createExecutablePortfolioAttempt(repo, {
        projectId,
        workItemId: item.id,
        packetVersion: 2,
        packetDigest: `sha256:${testCase.name}:other-attempt`,
        adapter: "claude",
        createdBy: owner.id,
        sourceWorkItemVersion: item.projectionVersion,
        idempotencyKey: nextKey(`verification-${testCase.name}-other-attempt`)
      });
      const verificationA = repo.createEvidence({
        projectId,
        requestId: item.requestId,
        workItemId: item.id,
        attemptId: expectedAttempt.id,
        producer: "gateway.verification",
        sourceCategory: "declared_verification",
        observedAt: new Date(),
        digest: `sha256:${testCase.name}:verify-a`,
        summary: "Verification A passed.",
        confidence: "trusted_platform",
        freshness: "fresh",
        verificationKey: "verification:verify:a",
        idempotencyKey: nextKey(`verification-${testCase.name}-verify-a`)
      });
      const verificationB = repo.createEvidence({
        projectId,
        requestId: item.requestId,
        workItemId: item.id,
        attemptId: testCase.useOtherAttempt ? otherAttempt.id : expectedAttempt.id,
        producer: "gateway.verification",
        sourceCategory: "declared_verification",
        observedAt: new Date(),
        digest: `sha256:${testCase.name}:verify-b`,
        summary: "Verification B claim.",
        confidence: testCase.confidence,
        freshness: testCase.freshness,
        verificationKey: "verification:verify:b",
        idempotencyKey: nextKey(`verification-${testCase.name}-verify-b`)
      });

      const candidate = repo.createCompletionCandidate({
        projectId,
        requestId: item.requestId,
        workItemId: item.id,
        attemptId: expectedAttempt.id,
        summary: `${testCase.name} evidence must not satisfy the required verification set.`,
        evidenceIds: [verificationA.id, verificationB.id],
        idempotencyKey: nextKey(`verification-${testCase.name}-candidate`)
      });
      assert.throws(
        () => gate.verifyCompletionCandidate({
          candidateId: candidate.id,
          expectedProjectionVersion: candidate.projectionVersion,
          actorId: owner.id,
          policyRule: `reject-${testCase.name}-verification`,
          idempotencyKey: nextKey(`verification-${testCase.name}-candidate-verify`)
        }),
        /PORTFOLIO_COMPLETION_EVIDENCE_INSUFFICIENT/,
        `${testCase.name} evidence must not satisfy the required verification set`
      );
    }
  });

  it("rejects shadowed fresh V1 Evidence at candidate verification and acceptance gates for every latest bad status", () => {
    // Arrange / Act / Assert: each source's newest record invalidates an earlier fresh record of that same source.
    const statuses = ["stale", "unknown", "timeout", "failed"] as const;
    const baseObservedAt = new Date();
    for (const [index, freshness] of statuses.entries()) {
      const verificationItem = createAcceptedWorkItem(
        db,
        owner.id,
        projectId,
        nextKey(`shadowed-${freshness}-verification-item`),
        `Shadowed ${freshness} verification item`,
        { acceptanceCriteria: ["criterion"], verificationRequirements: ["verify"] }
      );
      const verificationAttempt = createExecutablePortfolioAttempt(repo, {
        projectId,
        workItemId: verificationItem.id,
        packetVersion: 1,
        adapter: "claude",
        createdBy: owner.id,
        sourceWorkItemVersion: verificationItem.projectionVersion,
        idempotencyKey: nextKey(`shadowed-${freshness}-verification-attempt`)
      });
      const observationTime = new Date(baseObservedAt.getTime() + index * 100);
      const verificationAcceptance = createV1CompletionEvidence(repo, {
        projectId,
        requestId: verificationItem.requestId,
        workItemId: verificationItem.id,
        attemptId: verificationAttempt.id,
        source: "platform_lifecycle_v1",
        freshness: "fresh",
        observedAt: observationTime,
        verificationKey: "acceptance:criterion",
        idempotencyKey: nextKey(`shadowed-${freshness}-verification-acceptance`)
      });
      const olderFreshVerification = createV1CompletionEvidence(repo, {
        projectId,
        requestId: verificationItem.requestId,
        workItemId: verificationItem.id,
        attemptId: verificationAttempt.id,
        source: "git_state_v1",
        freshness: "fresh",
        observedAt: new Date(observationTime.getTime() + 1),
        verificationKey: "verification:verify",
        idempotencyKey: nextKey(`shadowed-${freshness}-verification-fresh-git`)
      });
      const verificationCandidate = repo.createCompletionCandidate({
        projectId,
        requestId: verificationItem.requestId,
        workItemId: verificationItem.id,
        attemptId: verificationAttempt.id,
        summary: `A newer ${freshness} Git result must reject the candidate.`,
        evidenceIds: [verificationAcceptance.id, olderFreshVerification.id],
        idempotencyKey: nextKey(`shadowed-${freshness}-verification-candidate`)
      });
      createV1CompletionEvidence(repo, {
        projectId,
        source: "git_state_v1",
        freshness,
        observedAt: new Date(observationTime.getTime() + 2),
        idempotencyKey: nextKey(`shadowed-${freshness}-verification-latest-git`)
      });

      assert.throws(
        () => gate.verifyCompletionCandidate({
          candidateId: verificationCandidate.id,
          expectedProjectionVersion: verificationCandidate.projectionVersion,
          actorId: owner.id,
          policyRule: `shadowed-${freshness}-candidate-rejected`,
          idempotencyKey: nextKey(`shadowed-${freshness}-candidate-verify`)
        }),
        /PORTFOLIO_COMPLETION_EVIDENCE_INSUFFICIENT/,
        `${freshness} must reject candidate verification when it shadows the old fresh Git Evidence`
      );
      assert.equal(repo.getCompletionCandidate(verificationCandidate.id)?.verifiedAt, null);

      const acceptanceItem = createAcceptedWorkItem(
        db,
        owner.id,
        projectId,
        nextKey(`shadowed-${freshness}-acceptance-item`),
        `Shadowed ${freshness} acceptance item`,
        { acceptanceCriteria: ["criterion"], verificationRequirements: ["verify"] }
      );
      const acceptanceAttempt = createExecutablePortfolioAttempt(repo, {
        projectId,
        workItemId: acceptanceItem.id,
        packetVersion: 1,
        adapter: "claude",
        createdBy: owner.id,
        sourceWorkItemVersion: acceptanceItem.projectionVersion,
        idempotencyKey: nextKey(`shadowed-${freshness}-acceptance-attempt`)
      });
      const acceptanceEvidence = createV1CompletionEvidence(repo, {
        projectId,
        requestId: acceptanceItem.requestId,
        workItemId: acceptanceItem.id,
        attemptId: acceptanceAttempt.id,
        source: "platform_lifecycle_v1",
        freshness: "fresh",
        observedAt: new Date(observationTime.getTime() + 10),
        verificationKey: "acceptance:criterion",
        idempotencyKey: nextKey(`shadowed-${freshness}-acceptance-platform`)
      });
      const acceptanceVerification = createV1CompletionEvidence(repo, {
        projectId,
        requestId: acceptanceItem.requestId,
        workItemId: acceptanceItem.id,
        attemptId: acceptanceAttempt.id,
        source: "git_state_v1",
        freshness: "fresh",
        observedAt: new Date(observationTime.getTime() + 11),
        verificationKey: "verification:verify",
        idempotencyKey: nextKey(`shadowed-${freshness}-acceptance-git`)
      });
      const acceptanceCandidate = repo.createCompletionCandidate({
        projectId,
        requestId: acceptanceItem.requestId,
        workItemId: acceptanceItem.id,
        attemptId: acceptanceAttempt.id,
        summary: `Candidate is verified before the later ${freshness} Git result.`,
        evidenceIds: [acceptanceEvidence.id, acceptanceVerification.id],
        idempotencyKey: nextKey(`shadowed-${freshness}-acceptance-candidate`)
      });
      gate.verifyCompletionCandidate({
        candidateId: acceptanceCandidate.id,
        expectedProjectionVersion: acceptanceCandidate.projectionVersion,
        actorId: owner.id,
        policyRule: `shadowed-${freshness}-candidate-initially-valid`,
        idempotencyKey: nextKey(`shadowed-${freshness}-candidate-initial-verify`)
      });
      const decision = repo.createAcceptanceDecision({
        projectId,
        requestId: acceptanceItem.requestId,
        workItemId: acceptanceItem.id,
        attemptId: acceptanceAttempt.id,
        candidateId: acceptanceCandidate.id,
        decision: "accepted",
        policyRule: `shadowed-${freshness}-acceptance-policy`,
        evidenceIds: [acceptanceEvidence.id, acceptanceVerification.id],
        idempotencyKey: nextKey(`shadowed-${freshness}-acceptance-decision`)
      });
      createV1CompletionEvidence(repo, {
        projectId,
        source: "git_state_v1",
        freshness,
        observedAt: new Date(observationTime.getTime() + 12),
        idempotencyKey: nextKey(`shadowed-${freshness}-acceptance-latest-git`)
      });

      assert.throws(
        () => transition(gate, repo, "acceptance_decision", decision.id, "accepted", owner.id, nextKey(`shadowed-${freshness}-acceptance-transition`)),
        /PORTFOLIO_PRECONDITION_FAILED/,
        `${freshness} must revoke acceptance authority derived from the shadowed fresh Git Evidence`
      );
      assert.equal(repo.getAcceptanceDecision(decision.id)?.state, "candidate");
    }
  });

  it("binds Work Item start and recovery receipts to the attempt named by the transition", () => {
    // Arrange
    const item = createAcceptedWorkItem(db, owner.id, projectId, nextKey("attempt-bound-item"), "Attempt-bound receipt precondition");
    const receiptAttempt = createExecutablePortfolioAttempt(repo, {
      projectId,
      workItemId: item.id,
      packetVersion: 1,
      packetDigest: "sha256:attempt-bound-receipt",
      adapter: "claude",
      createdBy: owner.id,
      sourceWorkItemVersion: item.projectionVersion,
      idempotencyKey: nextKey("attempt-bound-receipt-attempt")
    });
    const otherAttempt = createExecutablePortfolioAttempt(repo, {
      projectId,
      workItemId: item.id,
      packetVersion: 2,
      packetDigest: "sha256:attempt-bound-other",
      adapter: "claude",
      createdBy: owner.id,
      sourceWorkItemVersion: item.projectionVersion,
      idempotencyKey: nextKey("attempt-bound-other-attempt")
    });
    const sessionId = new SessionRepository(db, owner.id).create({
      projectId,
      name: "Attempt-bound receipt session",
      aiTool: "claude",
      workingDir: "/tmp/openforge-portfolio-attempt-bound"
    }).id;
    const assignment = repo.claimSessionAssignment({
      projectId,
      workItemId: item.id,
      attemptId: receiptAttempt.id,
      sessionId,
      adapter: "claude",
      leaseDurationMs: 60_000
    });
    recordValidatedDispatchReceipt(repo, {
      userId: owner.id,
      projectId,
      workItemId: item.id,
      attemptId: receiptAttempt.id,
      sessionId,
      assignmentId: assignment.id,
      leaseToken: assignment.leaseToken,
      idempotencyKey: nextKey("attempt-bound-initial-receipt")
    });
    const startInput = {
      recordType: "work_item" as const,
      recordId: item.id,
      toState: "in_progress" as const,
      actorId: owner.id,
      expectedProjectionVersion: item.projectionVersion
    };

    // Act / Assert: a valid receipt for Attempt A cannot authorize a missing or mismatched Attempt B transition.
    assert.throws(
      () => gate.transition({ ...startInput, idempotencyKey: nextKey("attempt-bound-start-missing") }),
      /PORTFOLIO_PRECONDITION_FAILED/
    );
    assert.throws(
      () => gate.transition({ ...startInput, attemptId: otherAttempt.id, idempotencyKey: nextKey("attempt-bound-start-other") }),
      /PORTFOLIO_PRECONDITION_FAILED/
    );
    transition(gate, repo, "work_item", item.id, "in_progress", owner.id, nextKey("attempt-bound-start-receipt"), receiptAttempt.id);
    repo.createEvidence({
      projectId,
      requestId: item.requestId,
      workItemId: item.id,
      attemptId: receiptAttempt.id,
      producer: "gateway.test.v1",
      sourceCategory: "declared_blocker",
      observedAt: new Date(),
      digest: "sha256:attempt-bound-blocker",
      summary: "A blocked dependency needs a recovered dispatch receipt.",
      confidence: "trusted_platform",
      freshness: "fresh",
      isBlocker: true,
      idempotencyKey: nextKey("attempt-bound-blocker")
    });
    transition(gate, repo, "work_item", item.id, "blocked", owner.id, nextKey("attempt-bound-block"));
    recordValidatedDispatchReceipt(repo, {
      userId: owner.id,
      projectId,
      workItemId: item.id,
      attemptId: receiptAttempt.id,
      sessionId,
      assignmentId: assignment.id,
      leaseToken: assignment.leaseToken,
      idempotencyKey: nextKey("attempt-bound-recovered-receipt")
    });
    const blocked = repo.getWorkItem(item.id)!;
    const resumeInput = {
      recordType: "work_item" as const,
      recordId: item.id,
      toState: "in_progress" as const,
      actorId: owner.id,
      expectedProjectionVersion: blocked.projectionVersion
    };

    assert.throws(
      () => gate.transition({ ...resumeInput, idempotencyKey: nextKey("attempt-bound-resume-missing") }),
      /PORTFOLIO_PRECONDITION_FAILED/
    );
    assert.throws(
      () => gate.transition({ ...resumeInput, attemptId: otherAttempt.id, idempotencyKey: nextKey("attempt-bound-resume-other") }),
      /PORTFOLIO_PRECONDITION_FAILED/
    );
    transition(gate, repo, "work_item", item.id, "in_progress", owner.id, nextKey("attempt-bound-resume-receipt"), receiptAttempt.id);
    assert.equal(repo.getWorkItem(item.id)?.state, "in_progress");
  });

  it("allows an owner to cancel a todo Work Item and keeps the terminal state closed", () => {
    // Arrange
    const item = createAcceptedWorkItem(db, owner.id, projectId, nextKey("owner-cancellation"), "Owner cancellation authority");

    // Act
    transition(gate, repo, "work_item", item.id, "cancelled", owner.id, nextKey("owner-cancels"));

    // Assert
    assert.equal(repo.getWorkItem(item.id)?.state, "cancelled");
    assert.throws(
      () => transition(gate, repo, "work_item", item.id, "in_progress", owner.id, nextKey("cancelled-reopen")),
      /PORTFOLIO_INVALID_TRANSITION/
    );
  });

  it("does not expose a Repository state-write bypass outside the State Gate", () => {
    // Arrange / Act
    const directWriter = repo as unknown as {
      applyStateTransition?: unknown;
      registerStateGateWriter?: unknown;
      markCompletionCandidateVerified?: unknown;
      commitStateTransition?: unknown;
      stateTransitionPort?: unknown;
      createStateGate?: unknown;
      appendFact?: unknown;
      createIntakeDecision?: unknown;
    };
    const safeGate = repo.createStateGate();
    const rawGate = safeGate as unknown as {
      commit: (input: unknown) => unknown;
      verify: (candidateId: string, projectionVersion: number, idempotencyKey: string) => unknown;
    };

    // Assert
    assert.equal(directWriter.applyStateTransition, undefined);
    assert.equal(directWriter.registerStateGateWriter, undefined);
    assert.equal(directWriter.markCompletionCandidateVerified, undefined);
    assert.equal(directWriter.commitStateTransition, undefined);
    assert.equal(directWriter.stateTransitionPort, undefined);
    assert.equal(directWriter.appendFact, undefined);
    assert.equal(directWriter.createIntakeDecision, undefined);
    assert.deepEqual(Object.getOwnPropertySymbols(repo), []);
    assert.equal(typeof directWriter.createStateGate, "function");
    assert.equal(typeof safeGate.transition, "function");
    assert.equal(Object.hasOwn(safeGate, "commit"), false);
    assert.equal(Object.hasOwn(safeGate, "verify"), false);
    assert.equal(rawGate.commit, undefined);
    assert.equal(rawGate.verify, undefined);
    assert.throws(() => rawGate.commit({}), TypeError);
    assert.throws(() => rawGate.verify("candidate-id", 1, "forged-verification"), TypeError);
    assert.equal("commitStateTransition" in repositoryModule, false);
    assert.equal("portfolioStateTransitionPort" in repositoryModule, false);
    assert.equal("registerStateGateWriter" in repositoryModule, false);
  });

  it("rolls back a state projection and idempotency receipt when immutable fact persistence fails", () => {
    // Arrange
    const request = createRequest(repo, projectId, owner.id, nextKey("rollback-request"));
    const initialFactCount = repo.listFacts({ projectId, recordId: request.id }).length;
    db.exec(`
      CREATE TRIGGER fail_portfolio_state_fact
      BEFORE INSERT ON portfolio_facts
      WHEN NEW.fact_type = 'state_transition'
      BEGIN
        SELECT RAISE(ABORT, 'forced state fact failure');
      END;
    `);

    // Act / Assert
    assert.throws(
      () => transition(gate, repo, "request", request.id, "triaged", owner.id, nextKey("rollback-transition")),
      /forced state fact failure/
    );
    assert.equal(repo.getRequest(request.id)?.state, "received");
    assert.equal(repo.getRequest(request.id)?.projectionVersion, request.projectionVersion);
    assert.equal(repo.listFacts({ projectId, recordId: request.id }).length, initialFactCount);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM portfolio_operation_records WHERE operation = ?")
        .get("state_transition.request") as { count: number }).count,
      0
    );
  });

  it("uses expected projection version CAS and returns an idempotent transition replay without duplicate facts", () => {
    // Arrange
    const request = createRequest(repo, projectId, owner.id, nextKey("cas-request"));
    const input = {
      recordType: "request" as const,
      recordId: request.id,
      toState: "triaged",
      actorId: owner.id,
      expectedProjectionVersion: request.projectionVersion,
      idempotencyKey: nextKey("cas-transition")
    };

    // Act
    const first = gate.transition(input);
    const replayed = gate.transition(input);

    // Assert
    assert.deepEqual(replayed, first);
    assert.equal(repo.getRequest(request.id)?.state, "triaged");
    const transitionFacts = repo.listFacts({ projectId, recordId: request.id })
      .filter((fact) => fact.factType === "state_transition");
    assert.equal(transitionFacts.length, 1);
    assert.equal(transitionFacts[0]?.payload.toState, "triaged");
    assert.throws(
      () => gate.transition({ ...input, toState: "cancelled", idempotencyKey: nextKey("stale-transition"), expectedProjectionVersion: request.projectionVersion }),
      /PORTFOLIO_STATE_CONFLICT/
    );
    assert.equal(repo.getRequest(request.id)?.state, "triaged");
    assert.equal(repo.listFacts({ projectId, recordId: request.id }).filter((fact) => fact.factType === "state_transition").length, 1);
  });

  function nextKey(prefix: string): string {
    operationSequence += 1;
    return `${prefix}:${operationSequence}`;
  }
});

function transition(
  gate: PortfolioStateGate,
  repo: PortfolioRepository,
  recordType: GateRecordType,
  recordId: string,
  toState: string,
  actorId: string,
  idempotencyKey: string,
  attemptId?: string
): void {
  const record = getRecord(repo, recordType, recordId);
  assert.ok(record, `${recordType} fixture should exist before its transition`);
  gate.transition({
    recordType,
    recordId,
    toState,
    actorId,
    expectedProjectionVersion: record.projectionVersion,
    idempotencyKey,
    ...(attemptId ? { attemptId } : {})
  });
}

function recordValidatedDispatchReceipt(
  repo: PortfolioRepository,
  input: {
    userId: string;
    projectId: string;
    workItemId: string;
    attemptId: string;
    sessionId: string;
    assignmentId: string;
    leaseToken: string;
    idempotencyKey: string;
  }
): void {
  const dispatchPayloadDigest = `sha256:${input.idempotencyKey}:dispatch`;
  const intent = repo.createActionIntent({
    projectId: input.projectId,
    workItemId: input.workItemId,
    attemptId: input.attemptId,
    sessionId: input.sessionId,
    actionClass: "session.dispatch",
    payloadDigest: dispatchPayloadDigest,
    assignmentLeaseToken: input.leaseToken,
    policyRule: "owner-confirmation/v1",
    expiresAt: new Date(Date.now() + 60_000),
    idempotencyKey: `${input.idempotencyKey}:intent`
  });
  const authorization = createConsumedOwnerAuthorization(repo, {
    userId: input.userId,
    projectId: input.projectId,
    workItemId: input.workItemId,
    attemptId: input.attemptId,
    actionIntentId: intent.id,
    idempotencyKey: `${input.idempotencyKey}:authorization`
  });
  const command = repo.createCommand({
    projectId: input.projectId,
    workItemId: input.workItemId,
    attemptId: input.attemptId,
    actionIntentId: intent.id,
    assignmentId: input.assignmentId,
    authorizationId: authorization.id,
    commandType: "session.dispatch",
    payloadDigest: dispatchPayloadDigest,
    idempotencyKey: `${input.idempotencyKey}:command`
  });
  repo.recordDispatchReceipt({
    commandId: command.id,
    assignmentId: input.assignmentId,
    leaseToken: input.leaseToken,
    receiptDigest: `sha256:${input.idempotencyKey}:receipt`,
    expectedProjectionVersion: command.projectionVersion,
    idempotencyKey: `${input.idempotencyKey}:receipt`
  });
}

function createConsumedOwnerAuthorization(
  repo: PortfolioRepository,
  input: {
    userId: string;
    projectId: string;
    workItemId: string;
    attemptId: string;
    actionIntentId: string;
    idempotencyKey: string;
  }
) {
  const actionDigest = repo.getActionIntentDigest(input.actionIntentId);
  assert.ok(actionDigest, "owner authorization requires a canonical action digest");
  const intent = repo.getActionIntent(input.actionIntentId);
  assert.ok(intent, "owner authorization requires its Action Intent");
  const authorization = repo.createAuthorization({
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
  const approved = repo.approveAuthorization({
    authorizationId: authorization.id,
    expectedProjectionVersion: authorization.projectionVersion,
    actionDigest: authorization.actionDigest,
    actorId: input.userId
  });
  repo.createStateGate().transition({
    recordType: "authorization",
    recordId: approved.id,
    toState: "consumed",
    actorId: input.userId,
    expectedProjectionVersion: approved.projectionVersion,
    idempotencyKey: `${input.idempotencyKey}:consume`
  });
  const consumed = repo.getAuthorization(authorization.id);
  assert.ok(consumed, "consumed owner authorization must remain durable");
  return consumed;
}

function getRecord(repo: PortfolioRepository, recordType: GateRecordType, recordId: string): { projectionVersion: number } | undefined {
  switch (recordType) {
    case "request": return repo.getRequest(recordId);
    case "work_item": return repo.getWorkItem(recordId);
    case "task_attempt": return repo.getTaskAttempt(recordId);
    case "authorization": return repo.getAuthorization(recordId);
    case "acceptance_decision": return repo.getAcceptanceDecision(recordId);
  }
}

function createRequest(repo: PortfolioRepository, projectId: string, requesterId: string, idempotencyKey: string) {
  return repo.createRequest({
    projectId,
    source: "web",
    requesterId,
    requestText: `Requirement for ${idempotencyKey}`,
    correlationId: `corr:${idempotencyKey}`,
    idempotencyKey
  });
}

function createWorkItem(db: Database.Database, userId: string, projectId: string, idempotencyKey: string) {
  return createAcceptedWorkItem(db, userId, projectId, idempotencyKey);
}

function createAttempt(db: Database.Database, userId: string, repo: PortfolioRepository, projectId: string, idempotencyKey: string) {
  const item = createWorkItem(db, userId, projectId, `${idempotencyKey}:work-item`);
  return createExecutablePortfolioAttempt(repo, {
    projectId,
    workItemId: item.id,
    packetVersion: 1,
    packetDigest: `sha256:${idempotencyKey}`,
    adapter: "claude",
    createdBy: item.ownerUserId,
    sourceWorkItemVersion: item.projectionVersion,
    idempotencyKey
  });
}

function createAuthorization(
  db: Database.Database,
  userId: string,
  repo: PortfolioRepository,
  projectId: string,
  idempotencyKey: string,
  authorizationTier: "preauthorized" | "owner_confirmation" = "owner_confirmation"
) {
  const item = createWorkItem(db, userId, projectId, `${idempotencyKey}:work-item`);
  const policyRule = authorizationTier === "preauthorized"
    ? "preauthorized:session.dispatch/v1"
    : "owner-confirmation/v1";
  const expiresAt = new Date(Date.now() + 60_000);
  const intent = repo.createActionIntent({
    projectId,
    workItemId: item.id,
    actionClass: "session.dispatch",
    payloadDigest: `sha256:${idempotencyKey}:intent`,
    resourceScope: {},
    policyRule,
    expiresAt,
    idempotencyKey: `${idempotencyKey}:intent`
  });
  const actionDigest = digestPortfolioActionIntent({
    userId,
    projectId: intent.projectId,
    workItemId: intent.workItemId,
    attemptId: intent.attemptId,
    sessionId: intent.sessionId,
    actionClass: intent.actionClass,
    resourceScope: intent.resourceScope,
    payloadDigest: intent.payloadDigest,
    assignmentLeaseTokenDigest: intent.assignmentLeaseTokenDigest,
    policyRule: intent.policyRule,
    issuedAt: intent.issuedAt,
    expiresAt: intent.expiresAt
  });
  return repo.createAuthorization({
    projectId,
    workItemId: item.id,
    actionIntentId: intent.id,
    authorizationTier,
    actionDigest,
    policyRule,
    expiresAt,
    idempotencyKey
  });
}

function createAcceptanceDecision(db: Database.Database, userId: string, repo: PortfolioRepository, projectId: string, idempotencyKey: string) {
  const item = createWorkItem(db, userId, projectId, `${idempotencyKey}:work-item`);
  const attempt = createExecutablePortfolioAttempt(repo, {
    projectId,
    workItemId: item.id,
    packetVersion: 1,
    adapter: "claude",
    createdBy: item.ownerUserId,
    sourceWorkItemVersion: item.projectionVersion,
    idempotencyKey: `${idempotencyKey}:attempt`
  });
  const candidate = repo.createCompletionCandidate({
    projectId,
    requestId: item.requestId,
    workItemId: item.id,
    attemptId: attempt.id,
    summary: "Acceptance Decision lifecycle fixture.",
    idempotencyKey: `${idempotencyKey}:candidate`
  });
  return repo.createAcceptanceDecision({
    projectId,
    requestId: item.requestId,
    workItemId: item.id,
    attemptId: attempt.id,
    candidateId: candidate.id,
    decision: "candidate",
    idempotencyKey
  });
}
