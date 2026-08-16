import { createHash } from "node:crypto";

import {
  digestPortfolioValue,
  type PortfolioDispatchPreparation,
  type PortfolioRepository
} from "../../db/repositories/portfolio-repository.js";
import type { createAuthorizationPolicy } from "./authorization-policy.js";
import type { createTaskPacketService } from "./task-packet-service.js";
import type { createWorkerSignalService } from "./worker-signal-service.js";
import type { WorkerDispatchAuthorization } from "./worker-contract.js";
import type { WorkerLaunchMaterial } from "./worker-signal-service.js";

export type PreparedDispatch = PortfolioDispatchPreparation;

export interface PrepareDispatchRequest {
  projectId: string;
  workItemId: string;
  attemptId: string;
  sessionId: string;
  assignmentId: string;
  leaseToken: string;
  expectedAttemptProjectionVersion: number;
  expectedAssignmentProjectionVersion: number;
  idempotencyKey: string;
  expiresAt?: Date;
  authorizationId?: string;
}

/** @internal Startup-only sink for one durable worker launch claim. */
export interface WorkerLaunchPort {
  launch(input: { prepared: PreparedDispatch; material: WorkerLaunchMaterial }): Promise<void>;
}

type AuthorizationPolicy = ReturnType<typeof createAuthorizationPolicy>;
type PacketService = ReturnType<typeof createTaskPacketService>;
type WorkerSignals = ReturnType<typeof createWorkerSignalService>;

function commandIdFor(userId: string, idempotencyKey: string): string {
  return `dispatch-${createHash("sha256").update(`${userId}:portfolio.dispatch:${idempotencyKey}`).digest("hex").slice(0, 32)}`;
}

/** Coordinates only durable dispatch preparation; it never calls a CLI or tmux. */
export function createExecutionService(input: {
  repository: PortfolioRepository;
  packetService: PacketService;
  authorizationPolicy: AuthorizationPolicy;
  workerSignals: WorkerSignals;
  workerLaunchPort?: WorkerLaunchPort;
}) {
  function prepareDispatch(request: PrepareDispatchRequest): PreparedDispatch {
    input.packetService.validateAttempt(request.attemptId);
    const assignment = input.repository.getSessionAssignment(request.assignmentId);
    const attempt = input.repository.getTaskAttempt(request.attemptId);
    if (!assignment || !attempt || assignment.attemptId !== attempt.id || assignment.sessionId !== request.sessionId) {
      throw new Error("PORTFOLIO_LEASE_MISMATCH");
    }
    const authorization = resolveDispatchAuthorization({ repository: input.repository, policy: input.authorizationPolicy, request, attempt, assignment });
    const commandId = commandIdFor(input.repository.getUserId(), request.idempotencyKey);
    const binding = { commandId, assignmentId: request.assignmentId, attemptId: request.attemptId, sessionId: request.sessionId,
      adapter: assignment.adapter, leaseGeneration: assignment.leaseGeneration, packetDigest: attempt.packetDigest };
    const capability = input.workerSignals.deriveSessionStartCapabilityForForwarder(binding);
    const prepared = input.repository.prepareDispatch({
      ...request, commandId, actionClass: authorization.actionClass, resourceScope: authorization.resourceScope, policyRule: authorization.policyRule,
      authorizationTier: authorization.tier, authorizationExpiresAt: authorization.expiresAt, signalType: "session_start_ready",
      capabilityDigest: digestPortfolioValue(capability), signalExpiresAt: authorization.expiresAt,
      ...(authorization.authorizationId ? { authorizationId: authorization.authorizationId, authorizationActionDigest: authorization.actionDigest } : {}),
      ...(authorization.requestedExpiresAt ? { requestedAuthorizationExpiresAt: authorization.requestedExpiresAt } : {}), now: authorization.now
    });
    return prepared;
  }

  /**
   * @internal Runtime composition path, called only after prepareDispatch has
   * committed. A port failure after the one-shot claim is unknown and must be
   * reconciled rather than retried.
   */
  async function launchPreparedDispatch(prepared: PreparedDispatch): Promise<void> {
    if (!input.workerLaunchPort) throw new Error("PORTFOLIO_WORKER_LAUNCH_PORT_UNAVAILABLE");
    const material = prepareWorkerLaunch(prepared);
    try {
      await input.workerLaunchPort.launch({ prepared, material });
    } catch {
      throw new Error("PORTFOLIO_WORKER_LAUNCH_UNKNOWN");
    }
  }

  /** Issues only the owner-confirmed policy record; the owner must approve and consume it before dispatch. */
  function prepareOwnerAuthorization(request: {
    projectId: string;
    workItemId: string;
    attemptId: string;
    sessionId: string;
    assignmentId: string;
    leaseToken: string;
    idempotencyKey: string;
    expiresAt: Date;
  }) {
    input.packetService.validateAttempt(request.attemptId);
    const assignment = input.repository.getSessionAssignment(request.assignmentId);
    const attempt = input.repository.getTaskAttempt(request.attemptId);
    if (!assignment || !attempt || assignment.attemptId !== request.attemptId || assignment.sessionId !== request.sessionId) {
      throw new Error("PORTFOLIO_LEASE_MISMATCH");
    }
    const issuedAt = new Date();
    const decision = input.authorizationPolicy.classify(canonicalActionInput({ repository: input.repository, attempt, assignment, request, issuedAt, expiresAt: request.expiresAt }));
    if (decision.tier === "protected") throw new Error("PORTFOLIO_PROTECTED_ACTION");
    if (decision.tier !== "owner_confirmation") throw new Error("PORTFOLIO_AUTHORIZATION_NOT_REQUIRED");
    const actionIntent = input.repository.createActionIntent({ projectId: request.projectId, workItemId: request.workItemId,
      attemptId: request.attemptId, sessionId: request.sessionId, actionClass: decision.action.actionClass,
      resourceScope: decision.action.resourceScope, payloadDigest: attempt.packetDigest, assignmentLeaseToken: request.leaseToken,
      policyRule: decision.policyRule, expiresAt: request.expiresAt, idempotencyKey: `owner-authorization-action:${request.idempotencyKey}` });
    const actionDigest = input.repository.getActionIntentDigest(actionIntent.id);
    if (!actionDigest) throw new Error("PORTFOLIO_ACTION_INTENT_NOT_FOUND");
    const authorization = input.repository.createAuthorization({ projectId: request.projectId, workItemId: request.workItemId,
      attemptId: request.attemptId, actionIntentId: actionIntent.id, authorizationTier: "owner_confirmation", actionDigest,
      policyRule: decision.policyRule, expiresAt: request.expiresAt, idempotencyKey: `owner-authorization:${request.idempotencyKey}` });
    return { actionIntent, authorization };
  }

  function recordWorkerDispatchReceipt(inputValue: WorkerDispatchAuthorization & { receiptDigest: string; idempotencyKey: string; now?: Date }) {
    return input.workerSignals.recordDispatchReceipt(inputValue);
  }

  /**
   * @internal Startup composition only. Converts an already-durable expected
   * signal into one in-memory worker environment value; it is not a route,
   * websocket, attach, or browser capability.
  */
  function prepareWorkerLaunch(prepared: PreparedDispatch, now?: Date): WorkerLaunchMaterial {
    const signal = prepared.expectedSignal;
    if (prepared.command.id !== signal.commandId || prepared.assignment.id !== signal.assignmentId
      || prepared.command.assignmentId !== signal.assignmentId || prepared.command.attemptId !== signal.attemptId) {
      throw new Error("PORTFOLIO_WORKER_SIGNAL_BINDING_MISMATCH");
    }
    const material = input.workerSignals.prepareWorkerLaunch({ commandId: signal.commandId, assignmentId: signal.assignmentId,
      attemptId: signal.attemptId, sessionId: signal.sessionId, adapter: signal.adapter, leaseGeneration: signal.leaseGeneration,
      packetDigest: signal.packetDigest, ...(now ? { now } : {}) });
    return material;
  }

  function createCompletionCandidate(request: {
    projectId: string;
    workItemId: string;
    attemptId: string;
    summary: string;
    evidenceIds?: string[];
    idempotencyKey: string;
  }) {
    return input.repository.createCompletionCandidate(request);
  }

  function evaluateAcceptance(request: {
    candidateId: string;
    actorId: string;
    expectedCandidateProjectionVersion: number;
    idempotencyKey: string;
    policyRule: string;
  }) {
    const candidate = input.repository.getCompletionCandidate(request.candidateId);
    const workItem = candidate ? input.repository.getWorkItem(candidate.workItemId) : undefined;
    if (!candidate || !workItem || workItem.ownerUserId !== request.actorId) throw new Error("PORTFOLIO_CANDIDATE_NOT_FOUND");
    const currentDossier = input.repository.getCurrentDossier(candidate.projectId);
    const currentEvidence = currentDossier?.currentEvidence ?? [];
    const trustedEvidence = currentDossier !== undefined
      && candidate.evidenceIds.every((evidenceId) => currentEvidence.some((evidence) => evidence.id === evidenceId))
      && input.repository.hasCompletionCandidateEvidence(candidate.id);
    const decision = input.repository.createAcceptanceDecision({
      projectId: candidate.projectId, workItemId: candidate.workItemId, attemptId: candidate.attemptId,
      requestId: candidate.requestId, candidateId: candidate.id, decision: trustedEvidence ? "accepted" : "insufficient",
      ...(trustedEvidence ? { policyRule: request.policyRule } : {}), evidenceIds: candidate.evidenceIds, idempotencyKey: request.idempotencyKey
    });
    if (!trustedEvidence) return { candidate, decision, accepted: false };
    const gate = input.repository.createStateGate();
    gate.verifyCompletionCandidate({ candidateId: candidate.id, expectedProjectionVersion: request.expectedCandidateProjectionVersion,
      actorId: request.actorId, policyRule: request.policyRule, idempotencyKey: `${request.idempotencyKey}:verify` });
    const accepted = gate.transition({ recordType: "acceptance_decision", recordId: decision.id, toState: "accepted",
      expectedProjectionVersion: decision.projectionVersion, actorId: request.actorId, idempotencyKey: `${request.idempotencyKey}:accept` });
    return { candidate: input.repository.getCompletionCandidate(candidate.id), decision: input.repository.getAcceptanceDecision(decision.id), accepted };
  }

  return { prepareDispatch, launchPreparedDispatch, prepareOwnerAuthorization, recordWorkerDispatchReceipt, createCompletionCandidate, evaluateAcceptance };
}

function canonicalActionInput(input: {
  repository: PortfolioRepository;
  attempt: NonNullable<ReturnType<PortfolioRepository["getTaskAttempt"]>>;
  assignment: NonNullable<ReturnType<PortfolioRepository["getSessionAssignment"]>>;
  request: { projectId: string; workItemId: string; attemptId: string; sessionId: string };
  issuedAt: Date;
  expiresAt: Date;
  actionClass?: string;
  resourceScope?: Record<string, unknown>;
}) {
  return {
    userId: input.repository.getUserId(), projectId: input.request.projectId, workItemId: input.request.workItemId,
    attemptId: input.request.attemptId, sessionId: input.request.sessionId, actionClass: input.actionClass ?? "packet_submit",
    resourceScope: input.resourceScope ?? { toolId: "portfolio.submit_canonical_task_packet" }, packetDigest: input.attempt.packetDigest,
    assignmentLeaseTokenDigest: input.assignment.leaseTokenDigest, issuedAt: input.issuedAt, expiresAt: input.expiresAt
  };
}

function resolveDispatchAuthorization(input: {
  repository: PortfolioRepository;
  policy: AuthorizationPolicy;
  request: { projectId: string; workItemId: string; attemptId: string; sessionId: string; expiresAt?: Date; authorizationId?: string };
  attempt: NonNullable<ReturnType<PortfolioRepository["getTaskAttempt"]>>;
  assignment: NonNullable<ReturnType<PortfolioRepository["getSessionAssignment"]>>;
}): {
  tier: "preauthorized" | "owner_confirmation";
  actionClass: string;
  resourceScope: Record<string, unknown>;
  policyRule: string;
  expiresAt: Date;
  requestedExpiresAt?: Date;
  authorizationId?: string;
  actionDigest?: string;
  now: Date;
} {
  if (input.request.authorizationId) {
    const authorization = input.repository.getAuthorization(input.request.authorizationId);
    const actionIntent = authorization ? input.repository.getActionIntent(authorization.actionIntentId) : undefined;
    if (!authorization || !actionIntent) throw new Error("PORTFOLIO_AUTHORIZATION_SCOPE_MISMATCH");
    if (input.request.expiresAt && input.request.expiresAt.getTime() !== actionIntent.expiresAt.getTime()) {
      throw new Error("PORTFOLIO_AUTHORIZATION_SCOPE_MISMATCH");
    }
    const decision = input.policy.classify(canonicalActionInput({ repository: input.repository, attempt: input.attempt, assignment: input.assignment,
      request: input.request, actionClass: actionIntent.actionClass, resourceScope: actionIntent.resourceScope,
      issuedAt: actionIntent.issuedAt, expiresAt: actionIntent.expiresAt }));
    if (decision.tier === "protected") throw new Error("PORTFOLIO_PROTECTED_ACTION");
    if (decision.tier !== "owner_confirmation" || authorization.actionDigest !== decision.action.digest) {
      throw new Error("PORTFOLIO_AUTHORIZATION_SCOPE_MISMATCH");
    }
    return { tier: "owner_confirmation", actionClass: decision.action.actionClass, resourceScope: decision.action.resourceScope,
      policyRule: decision.policyRule, expiresAt: actionIntent.expiresAt, authorizationId: authorization.id,
      actionDigest: decision.action.digest, now: new Date() };
  }
  const now = new Date();
  const expiresAt = input.request.expiresAt ?? new Date(now.getTime() + 5 * 60_000);
  const decision = input.policy.classify(canonicalActionInput({ repository: input.repository, attempt: input.attempt, assignment: input.assignment,
    request: input.request, issuedAt: now, expiresAt }));
  if (decision.tier === "protected") throw new Error("PORTFOLIO_PROTECTED_ACTION");
  if (decision.tier !== "preauthorized") throw new Error("PORTFOLIO_AUTHORIZATION_REQUIRED");
  return { tier: "preauthorized", actionClass: decision.action.actionClass, resourceScope: decision.action.resourceScope,
    policyRule: decision.policyRule, expiresAt, ...(input.request.expiresAt ? { requestedExpiresAt: input.request.expiresAt } : {}), now };
}
