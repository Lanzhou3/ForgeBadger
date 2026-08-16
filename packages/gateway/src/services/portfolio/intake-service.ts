import type { Database } from "../../db/types.js";
import {
  PortfolioRepository,
  type PortfolioDossier,
  type PortfolioEnrollmentEvidenceInput,
  type PortfolioIntakeDecision,
  type PortfolioProjectEnrollment,
  type PortfolioRequest,
  type PortfolioWorkItem
} from "../../db/repositories/portfolio-repository.js";

export type PortfolioIntakeScopeAssessment =
  | "in_boundary"
  | "ambiguous"
  | "multi_project"
  | "missing_dossier"
  | "scope_change"
  | "material_scope_change"
  | "owner_confirmed";

export interface PortfolioWorkItemDraft {
  title: string;
  description?: string;
  acceptanceCriteria?: string[];
  verificationRequirements?: string[];
}

export interface PortfolioIntakeOutcome {
  request: PortfolioRequest;
  decision: PortfolioIntakeDecision;
  workItem?: PortfolioWorkItem;
}

export interface PortfolioRequestTimeline {
  request: {
    id: string;
    projectId: string | null;
    source: string;
    state: PortfolioRequest["state"];
    projectionVersion: number;
    correlationId: string;
    receivedAt: Date;
    createdAt: Date;
    updatedAt: Date;
  };
  decisions: Array<{
    id: string;
    selectedProjectId: string | null;
    candidateProjectIds: string[];
    scopeAssessment: string;
    producer: string;
    evidenceIds: string[];
    state: PortfolioIntakeDecision["state"];
    projectionVersion: number;
    createdAt: Date;
    updatedAt: Date;
  }>;
  workItems: Array<{
    id: string;
    projectId: string;
    state: PortfolioWorkItem["state"];
    projectionVersion: number;
    createdAt: Date;
    updatedAt: Date;
  }>;
  facts: Array<{
    id: string;
    projectId: string | null;
    workItemId: string | null;
    attemptId: string | null;
    recordType: string;
    recordId: string;
    factType: string;
    correlationId: string | null;
    createdAt: Date;
  }>;
}

export type PortfolioInitialEnrollmentEvidence = PortfolioEnrollmentEvidenceInput;

export interface EnrollProjectInput {
  projectId: string;
  objective: string;
  intendedOutcome: string;
  scope?: Record<string, unknown>;
  observedState: Record<string, unknown>;
  evidenceIds: string[];
  initialEvidence: PortfolioInitialEnrollmentEvidence[];
  idempotencyKey: string;
}

export interface UpdateDossierInput {
  projectId: string;
  expectedProjectionVersion: number;
  objective?: string;
  intendedOutcome?: string;
  scope?: Record<string, unknown>;
  observedState?: Record<string, unknown>;
  evidenceIds?: string[];
  idempotencyKey: string;
}

export interface CreateRequestInput {
  projectId?: string;
  source: string;
  sourceEventId?: string;
  requesterId?: string;
  requestText: string;
  correlationId: string;
  idempotencyKey: string;
  sourceMetadata?: Record<string, unknown>;
}

export interface DecideIntakeInput {
  requestId: string;
  candidateProjectIds: string[];
  selectedProjectId?: string;
  scopeAssessment: PortfolioIntakeScopeAssessment;
  producer: string;
  evidenceIds?: string[];
  workItem?: PortfolioWorkItemDraft;
  idempotencyKey: string;
}

export interface ResolveOwnerDecisionInput {
  requestId: string;
  projectId: string;
  evidenceIds?: string[];
  workItem?: PortfolioWorkItemDraft;
  idempotencyKey: string;
}

function uniqueIds(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function requireText(value: string, code: string): void {
  if (!value.trim()) throw new Error(code);
}

function hasMaterialObservedValue(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => hasMaterialObservedValue(item, seen));
  return Object.entries(value).some(([key, item]) => key !== "evidenceIds" && hasMaterialObservedValue(item, seen));
}

function assertObservedStateContent(observedState: unknown): void {
  const record = observedState !== null && typeof observedState === "object" && !Array.isArray(observedState)
    ? observedState as Record<string, unknown>
    : {};
  if (!Object.entries(record).some(([key, value]) => key !== "evidenceIds" && hasMaterialObservedValue(value))) {
    throw new Error("PORTFOLIO_OBSERVED_STATE_REQUIRED");
  }
}

/** Owns the immutable intake flow; no API, channel, terminal, or scheduler side effects live here. */
export class PortfolioIntakeService {
  private readonly repository: PortfolioRepository;

  constructor(database: Database, private readonly userId: string) {
    this.repository = new PortfolioRepository(database, userId);
  }

  enrollProject(input: EnrollProjectInput): { enrollment: PortfolioProjectEnrollment; dossier: PortfolioDossier } {
    requireText(input.objective, "PORTFOLIO_DOSSIER_OBJECTIVE_REQUIRED");
    requireText(input.intendedOutcome, "PORTFOLIO_DOSSIER_OUTCOME_REQUIRED");
    const evidenceIds = uniqueIds(input.evidenceIds);
    assertObservedStateContent(input.observedState);
    if (evidenceIds.length === 0) throw new Error("PORTFOLIO_ENROLLMENT_EVIDENCE_REQUIRED");
    const enrollment = this.repository.enrollProject({
      projectId: input.projectId,
      objective: input.objective,
      intendedOutcome: input.intendedOutcome,
      ...(input.scope ? { scopeJson: input.scope } : {}),
      observedState: input.observedState,
      evidenceIds,
      initialEvidence: input.initialEvidence,
      idempotencyKey: input.idempotencyKey
    });
    const dossier = this.repository.getCurrentDossier(input.projectId);
    if (!dossier || enrollment.enrollmentStatus !== "active") throw new Error("PORTFOLIO_ENROLLMENT_STATE_CONFLICT");
    return { enrollment, dossier };
  }

  updateDossier(input: UpdateDossierInput): PortfolioDossier {
    const evidenceIds = uniqueIds(input.evidenceIds ?? []);
    const hasObservedState = Object.prototype.hasOwnProperty.call(input, "observedState");
    if (hasObservedState) assertObservedStateContent(input.observedState);
    if (hasObservedState && evidenceIds.length === 0) {
      throw new Error("PORTFOLIO_OBSERVED_STATE_EVIDENCE_REQUIRED");
    }
    this.assertEvidenceScope(input.projectId, evidenceIds);
    return this.repository.updateDossier({
      projectId: input.projectId,
      expectedProjectionVersion: input.expectedProjectionVersion,
      ...(input.objective !== undefined ? { objective: input.objective } : {}),
      ...(input.intendedOutcome !== undefined ? { intendedOutcome: input.intendedOutcome } : {}),
      ...(input.scope !== undefined ? { scope: input.scope } : {}),
      ...(hasObservedState ? { observedState: { ...(input.observedState ?? {}), evidenceIds }, evidenceIds } : {}),
      idempotencyKey: input.idempotencyKey
    });
  }

  createRequest(input: CreateRequestInput): PortfolioRequest {
    requireText(input.source, "PORTFOLIO_REQUEST_SOURCE_REQUIRED");
    requireText(input.requestText, "PORTFOLIO_REQUEST_TEXT_REQUIRED");
    requireText(input.correlationId, "PORTFOLIO_CORRELATION_ID_REQUIRED");
    if (input.requesterId && input.requesterId !== this.userId) throw new Error("PORTFOLIO_REQUESTER_SCOPE_MISMATCH");
    return this.repository.createRequest({
      ...input,
      requesterId: this.userId
    });
  }

  decideIntake(input: DecideIntakeInput): PortfolioIntakeOutcome {
    const candidateProjectIds = uniqueIds(input.candidateProjectIds);
    const recordedSelectedProjectId = this.hasDossier(input.selectedProjectId) ? input.selectedProjectId : undefined;
    return this.repository.runInTransaction(() => {
      const request = this.requireRequest(input.requestId);
      const evidenceIds = uniqueIds(input.evidenceIds ?? []);
      if (request.projectId && input.selectedProjectId && input.selectedProjectId !== request.projectId) {
        throw new Error("PORTFOLIO_REQUEST_ROUTE_CONFLICT");
      }
      const clearRoute = input.scopeAssessment === "in_boundary"
        && candidateProjectIds.length === 1
        && recordedSelectedProjectId === candidateProjectIds[0]
        && this.hasTrustedRequestEvidence(request, recordedSelectedProjectId, evidenceIds);
      if (!clearRoute) {
        const decision = this.repository.recordAwaitingOwnerIntakeDecision({
          requestId: request.id, candidateProjectIds, scopeAssessment: input.scopeAssessment, producer: input.producer,
          evidenceIds, idempotencyKey: `${input.idempotencyKey}:decision`
        });
        return this.moveToOwnerDecision(request, decision, input.idempotencyKey);
      }
      const decision = this.repository.acceptInBoundaryIntakeDecision({
        requestId: request.id, projectId: recordedSelectedProjectId as string, candidateProjectIds,
        producer: input.producer, evidenceIds, idempotencyKey: `${input.idempotencyKey}:decision`
      });
      return this.acceptClearRoute(request, decision, recordedSelectedProjectId as string, input.workItem, input.idempotencyKey);
    });
  }

  resolveOwnerDecision(input: ResolveOwnerDecisionInput): PortfolioIntakeOutcome {
    return this.repository.runInTransaction(() => {
      const decisionIdempotencyKey = `${input.idempotencyKey}:decision`;
      const existingDecision = this.repository.getIntakeDecisionByIdempotencyKey(decisionIdempotencyKey);
      if (existingDecision) {
        const request = this.requireRequest(input.requestId);
        const replayedDecision = this.repository.acceptOwnerIntakeDecision({ requestId: request.id, projectId: input.projectId,
          evidenceIds: uniqueIds(input.evidenceIds ?? []), idempotencyKey: decisionIdempotencyKey });
        if (replayedDecision.id !== existingDecision.id || request.state !== "accepted" || request.projectId !== input.projectId) {
          throw new Error("PORTFOLIO_OWNER_DECISION_REPLAY_CONFLICT");
        }
        return this.existingAcceptedOutcome(request, replayedDecision, input.projectId, input.workItem);
      }
      const request = this.requireRequest(input.requestId);
      if (request.state !== "needs_owner_decision") throw new Error("PORTFOLIO_OWNER_DECISION_REQUIRED");
      if (request.projectId && request.projectId !== input.projectId) throw new Error("PORTFOLIO_REQUEST_ROUTE_CONFLICT");
      const dossier = this.repository.getCurrentDossier(input.projectId);
      if (!dossier) throw new Error("PORTFOLIO_DOSSIER_NOT_FOUND");
      if (dossier.ownerUserId !== this.userId) throw new Error("PORTFOLIO_OWNER_REQUIRED");
      const decision = this.repository.acceptOwnerIntakeDecision({ requestId: request.id, projectId: input.projectId,
        evidenceIds: uniqueIds(input.evidenceIds ?? []), idempotencyKey: decisionIdempotencyKey });
      const routed = this.repository.routeRequest({
        requestId: request.id,
        projectId: input.projectId,
        expectedProjectionVersion: request.projectionVersion,
        idempotencyKey: `${input.idempotencyKey}:route`
      });
      const accepted = this.transitionRequest(routed, "accepted", `${input.idempotencyKey}:accepted`);
      const workItem = this.createSingleWorkItem(accepted, input.projectId, input.workItem, input.idempotencyKey);
      return { request: accepted, decision, workItem };
    });
  }

  getRequestTimeline(requestId: string): PortfolioRequestTimeline {
    const request = this.requireRequest(requestId);
    return {
      // Deliberately excludes requestText, sourceMetadata, idempotency keys, and fact payloads.
      request: {
        id: request.id,
        projectId: request.projectId,
        source: request.source,
        state: request.state,
        projectionVersion: request.projectionVersion,
        correlationId: request.correlationId,
        receivedAt: request.receivedAt,
        createdAt: request.createdAt,
        updatedAt: request.updatedAt
      },
      decisions: this.repository.listIntakeDecisionsForRequest(request.id).map((decision) => ({
        id: decision.id,
        selectedProjectId: decision.selectedProjectId,
        candidateProjectIds: decision.candidateProjectIds,
        scopeAssessment: decision.scopeAssessment,
        producer: decision.producer,
        evidenceIds: decision.evidenceIds,
        state: decision.state,
        projectionVersion: decision.projectionVersion,
        createdAt: decision.createdAt,
        updatedAt: decision.updatedAt
      })),
      workItems: this.repository.listWorkItemsForRequest(request.id).map((workItem) => ({
        id: workItem.id,
        projectId: workItem.projectId,
        state: workItem.state,
        projectionVersion: workItem.projectionVersion,
        createdAt: workItem.createdAt,
        updatedAt: workItem.updatedAt
      })),
      facts: this.repository.listRequestFacts(request.id).map((fact) => ({
        id: fact.id,
        projectId: fact.projectId,
        workItemId: fact.workItemId,
        attemptId: fact.attemptId,
        recordType: fact.recordType,
        recordId: fact.recordId,
        factType: fact.factType,
        correlationId: fact.correlationId,
        createdAt: fact.createdAt
      }))
    };
  }

  private acceptClearRoute(
    request: PortfolioRequest,
    decision: PortfolioIntakeDecision,
    projectId: string,
    workItemDraft: PortfolioWorkItemDraft | undefined,
    idempotencyKey: string
  ): PortfolioIntakeOutcome {
    if (request.state === "accepted") return this.existingAcceptedOutcome(request, decision, projectId, workItemDraft);
    if (request.state !== "received") throw new Error("PORTFOLIO_INTAKE_STATE_INVALID");
    const routed = this.repository.routeRequest({
      requestId: request.id,
      projectId,
      expectedProjectionVersion: request.projectionVersion,
      idempotencyKey: `${idempotencyKey}:route`
    });
    const triaged = this.transitionRequest(routed, "triaged", `${idempotencyKey}:triaged`);
    const accepted = this.transitionRequest(triaged, "accepted", `${idempotencyKey}:accepted`);
    const workItem = this.createSingleWorkItem(accepted, projectId, workItemDraft, idempotencyKey);
    return { request: accepted, decision, workItem };
  }

  private moveToOwnerDecision(
    request: PortfolioRequest,
    decision: PortfolioIntakeDecision,
    idempotencyKey: string
  ): PortfolioIntakeOutcome {
    if (request.state === "needs_owner_decision") return { request, decision };
    if (request.state !== "received") throw new Error("PORTFOLIO_INTAKE_STATE_INVALID");
    return { request: this.transitionRequest(request, "needs_owner_decision", `${idempotencyKey}:owner-decision`), decision };
  }

  private createSingleWorkItem(
    request: PortfolioRequest,
    projectId: string,
    draft: PortfolioWorkItemDraft | undefined,
    idempotencyKey: string
  ): PortfolioWorkItem {
    const existing = this.repository.listWorkItemsForRequest(request.id, 2);
    if (existing.length > 1) throw new Error("PORTFOLIO_REQUEST_WORK_ITEM_INVARIANT");
    if (existing[0]) return existing[0];
    const workItem = draft ?? { title: "Portfolio request" };
    requireText(workItem.title, "PORTFOLIO_WORK_ITEM_TITLE_REQUIRED");
    return this.repository.createWorkItem({
      projectId,
      requestId: request.id,
      title: workItem.title,
      ...(workItem.description !== undefined ? { description: workItem.description } : {}),
      ...(workItem.acceptanceCriteria !== undefined ? { acceptanceCriteria: workItem.acceptanceCriteria } : {}),
      ...(workItem.verificationRequirements !== undefined ? { verificationRequirements: workItem.verificationRequirements } : {}),
      idempotencyKey: `${idempotencyKey}:work-item`
    });
  }

  private transitionRequest(request: PortfolioRequest, toState: "triaged" | "needs_owner_decision" | "accepted", idempotencyKey: string): PortfolioRequest {
    this.repository.createStateGate().transition({
      recordType: "request",
      recordId: request.id,
      toState,
      expectedProjectionVersion: request.projectionVersion,
      actorId: this.userId,
      correlationId: request.correlationId,
      idempotencyKey
    });
    const updated = this.repository.getRequest(request.id);
    if (!updated) throw new Error("PORTFOLIO_REQUEST_NOT_FOUND");
    return updated;
  }

  private existingAcceptedOutcome(
    request: PortfolioRequest,
    decision: PortfolioIntakeDecision,
    projectId: string,
    workItemDraft?: PortfolioWorkItemDraft
  ): PortfolioIntakeOutcome {
    if (request.projectId !== projectId || decision.selectedProjectId !== projectId) {
      throw new Error("PORTFOLIO_OWNER_DECISION_REPLAY_CONFLICT");
    }
    const workItems = this.repository.listWorkItemsForRequest(request.id, 2);
    if (workItems.length !== 1) throw new Error("PORTFOLIO_REQUEST_WORK_ITEM_INVARIANT");
    const workItem = workItems[0];
    if (!workItem) throw new Error("PORTFOLIO_REQUEST_WORK_ITEM_INVARIANT");
    if (workItem.projectId !== projectId) throw new Error("PORTFOLIO_REQUEST_WORK_ITEM_INVARIANT");
    this.assertReplayWorkItem(workItem, workItemDraft);
    return { request, decision, workItem };
  }

  private assertReplayWorkItem(workItem: PortfolioWorkItem, draft: PortfolioWorkItemDraft | undefined): void {
    const expected = draft ?? { title: "Portfolio request" };
    requireText(expected.title, "PORTFOLIO_WORK_ITEM_TITLE_REQUIRED");
    const sameDraft = workItem.title === expected.title
      && workItem.description === (expected.description ?? null)
      && JSON.stringify(workItem.acceptanceCriteria) === JSON.stringify(expected.acceptanceCriteria ?? [])
      && JSON.stringify(workItem.verificationRequirements) === JSON.stringify(expected.verificationRequirements ?? []);
    if (!sameDraft) throw new Error("PORTFOLIO_OWNER_DECISION_REPLAY_CONFLICT");
  }

  private hasDossier(projectId: string | undefined): boolean {
    return Boolean(projectId && this.repository.getCurrentDossier(projectId));
  }

  private requireRequest(requestId: string): PortfolioRequest {
    const request = this.repository.getRequest(requestId);
    if (!request) throw new Error("PORTFOLIO_REQUEST_NOT_FOUND");
    return request;
  }

  private hasTrustedRequestEvidence(
    request: PortfolioRequest,
    projectId: string | undefined,
    evidenceIds: string[]
  ): boolean {
    if (!projectId || evidenceIds.length === 0) return false;
    const dossier = this.repository.getCurrentDossier(projectId);
    if (!dossier) return false;
    return evidenceIds.every((evidenceId) => {
      const evidence = this.repository.getEvidence(evidenceId);
      return evidence?.projectId === projectId
        && evidence.requestId === request.id
        && dossier.currentEvidence.some((current) => current.id === evidenceId);
    });
  }

  private assertEvidenceScope(projectId: string, evidenceIds: string[]): void {
    const dossier = this.repository.getCurrentDossier(projectId);
    for (const evidenceId of evidenceIds) {
      const evidence = this.repository.getEvidence(evidenceId);
      if (!evidence || evidence.projectId !== projectId
        || !dossier?.currentEvidence.some((current) => current.id === evidenceId)) {
        throw new Error("PORTFOLIO_EVIDENCE_NOT_FOUND");
      }
    }
  }
}
