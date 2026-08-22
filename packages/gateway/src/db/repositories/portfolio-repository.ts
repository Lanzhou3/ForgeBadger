import { createHash, randomUUID } from "node:crypto";

import type { Database } from "../types.js";
import { createPortfolioStateGate, type PortfolioStateGate } from "../../services/portfolio/state-gate.js";
import { PORTFOLIO_EXECUTION_SKILL_VERSION, PORTFOLIO_EXECUTION_TOOL_IDS, PORTFOLIO_EXECUTION_TOOL_VERSION } from "../../services/portfolio/execution-contract.js";
import { isCurrentPortfolioEvidence, isObservationSourceWindow } from "../../services/portfolio/evidence-current.js";
import type { ApprovedProjectRootIdentity } from "../../services/portfolio/observation-contract.js";

export type PortfolioRequestState = "received" | "triaged" | "needs_owner_decision" | "accepted" | "declined" | "cancelled";
export type PortfolioIntakeDecisionState = "awaiting_owner" | "accepted";
export type PortfolioWorkItemState = "todo" | "in_progress" | "blocked" | "ready_for_review" | "done" | "cancelled";
export type PortfolioTaskAttemptState = "prepared" | "awaiting_authorization" | "dispatching" | "running" | "awaiting_permission" | "evaluating" | "succeeded" | "blocked" | "failed" | "cancelled";
export type PortfolioAuthorizationState = "proposed" | "preauthorized" | "awaiting_owner" | "approved" | "rejected" | "expired" | "consumed" | "cancelled";
export type PortfolioWakeupState = "scheduled" | "claimed" | "completed" | "retry_scheduled" | "cancelled" | "exhausted";
export type PortfolioAcceptanceDecisionState = "candidate" | "accepted" | "rejected" | "superseded";
export type PortfolioStateRecordType = "request" | "work_item" | "task_attempt" | "authorization" | "wakeup" | "acceptance_decision";
export type PortfolioObservationSource = "platform_lifecycle_v1" | "git_state_v1";
export type PortfolioDossierDisplayStatus = "fresh" | "stale" | "unknown" | "timeout" | "failed";

export interface PortfolioClock {
  now(): Date;
}

const portfolioStateRecordTypes = ["request", "work_item", "task_attempt", "authorization", "wakeup", "acceptance_decision"] as const;
const portfolioObservationSources: readonly PortfolioObservationSource[] = ["platform_lifecycle_v1", "git_state_v1"];
function isPortfolioObservationSource(value: string): value is PortfolioObservationSource {
  return isObservationSourceWindow(value) && portfolioObservationSources.includes(value as PortfolioObservationSource);
}

export interface PortfolioStateTransitionCommit {
  recordType: PortfolioStateRecordType;
  recordId: string;
  fromState: string;
  toState: string;
  expectedProjectionVersion: number;
  actorId: string;
  attemptId?: string;
  idempotencyKey: string;
  correlationId?: string;
  now?: Date;
}

export interface PortfolioProjectEnrollment {
  projectId: string;
  userId: string;
  ownerUserId: string;
  enrollmentStatus: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PortfolioDossier {
  id: string;
  projectId: string;
  ownerUserId: string;
  objective: string;
  intendedOutcome: string;
  scope: Record<string, unknown>;
  observedState: Record<string, unknown>;
  projectionVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PortfolioDossierSourceDisplay {
  source: PortfolioObservationSource;
  status: PortfolioDossierDisplayStatus;
  evidence: PortfolioEvidence | null;
}

export interface PortfolioDossierDisplay extends PortfolioDossier {
  sources: PortfolioDossierSourceDisplay[];
}

export interface PortfolioCurrentDossier extends PortfolioDossier {
  currentEvidence: PortfolioEvidence[];
}

export interface PortfolioObservationProfile {
  id: string;
  projectId: string;
  status: "active" | "inactive";
  approvedRoot: ApprovedProjectRootIdentity | null;
  projectionVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PortfolioObservationProbe {
  id: string;
  profileId: string;
  source: PortfolioObservationSource;
  enabled: boolean;
  rootRef: "project_root";
  timeoutMs: number;
  maxOutputBytes: number;
  freshnessMs: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PortfolioEnrollmentEvidenceInput {
  id: string;
  producer: string;
  sourceCategory: string;
  observedAt: Date;
  digest: string;
  summary: string;
  confidence: string;
  freshness: string;
}

export interface PortfolioRequest {
  id: string;
  projectId: string | null;
  requesterId: string | null;
  source: string;
  sourceEventId: string | null;
  requestText: string;
  sourceMetadata: Record<string, unknown>;
  state: PortfolioRequestState;
  projectionVersion: number;
  correlationId: string;
  idempotencyKey: string;
  receivedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface PortfolioIntakeDecision {
  id: string;
  requestId: string;
  selectedProjectId: string | null;
  candidateProjectIds: string[];
  scopeAssessment: string;
  producer: string;
  evidenceIds: string[];
  state: PortfolioIntakeDecisionState;
  projectionVersion: number;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PortfolioWorkItem {
  id: string;
  projectId: string;
  requestId: string;
  ownerUserId: string;
  title: string;
  description: string | null;
  acceptanceCriteria: string[];
  verificationRequirements: string[];
  state: PortfolioWorkItemState;
  projectionVersion: number;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PortfolioTaskAttempt {
  id: string;
  projectId: string;
  workItemId: string;
  requestId: string | null;
  packetId: string | null;
  attemptNumber: number;
  sourceWorkItemVersion: number;
  packetVersion: number;
  packetDigest: string;
  adapter: string;
  createdBy: string;
  trackingEnabled: boolean;
  state: PortfolioTaskAttemptState;
  projectionVersion: number;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

/** Immutable packet snapshot used to prove the exact worker input. */
export interface PortfolioTaskPacket {
  id: string;
  projectId: string;
  workItemId: string;
  packetVersion: number;
  packetDigest: string;
  skillVersion: string;
  sourceWorkItemVersion: number;
  dossierVersion: number;
  canonicalPacket: Record<string, unknown>;
  manifestVersion: string;
  manifestDigest: string;
  createdBy: string;
  createdAt: Date;
}

export interface PortfolioPreparedTaskAttempt {
  packet: PortfolioTaskPacket;
  attempt: PortfolioTaskAttempt;
}

export interface PortfolioSessionAssignment {
  id: string;
  projectId: string;
  workItemId: string;
  attemptId: string;
  sessionId: string;
  adapter: string;
  leaseTokenDigest: string;
  leaseGeneration: number;
  leaseExpiresAt: Date;
  active: boolean;
  releasedReason: string | null;
  projectionVersion: number;
  createdAt: Date;
  updatedAt: Date;
  releasedAt: Date | null;
}

export interface ClaimedPortfolioSessionAssignment extends PortfolioSessionAssignment {
  leaseToken: string;
}

export type PortfolioWorkerSignalState = "expected" | "acknowledged" | "consumed" | "expired";

/** Durable record of a fixed worker lifecycle signal; never contains a raw capability. */
export interface PortfolioWorkerSignal {
  id: string;
  projectId: string;
  workItemId: string;
  attemptId: string;
  sessionId: string;
  assignmentId: string;
  commandId: string;
  adapter: string;
  signalType: string;
  leaseGeneration: number;
  packetDigest: string;
  capabilityDigest: string;
  state: PortfolioWorkerSignalState;
  expiresAt: Date;
  launchIssuedAt: Date | null;
  acknowledgedAt: Date | null;
  consumedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PortfolioWorkerSignalBinding {
  commandId: string;
  assignmentId: string;
  attemptId: string;
  sessionId: string;
  adapter: string;
  leaseGeneration: number;
  packetDigest: string;
}

export interface PortfolioEvidence {
  id: string;
  projectId: string;
  requestId: string | null;
  workItemId: string | null;
  attemptId: string | null;
  producer: string;
  sourceCategory: string;
  observedAt: Date;
  collectedAt: Date;
  digest: string;
  redactedSummary: string;
  confidence: string;
  freshness: string;
  isBlocker: boolean;
  verificationKey: string | null;
  createdAt: Date;
}

export interface PortfolioCompletionCandidate {
  id: string;
  projectId: string;
  workItemId: string;
  attemptId: string;
  requestId: string;
  summary: string;
  evidenceIds: string[];
  verifiedAt: Date | null;
  projectionVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PortfolioAcceptanceDecision {
  id: string;
  projectId: string;
  workItemId: string;
  requestId: string;
  attemptId: string;
  candidateId: string;
  decision: string;
  policyRule: string | null;
  evidenceIds: string[];
  state: PortfolioAcceptanceDecisionState;
  projectionVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PortfolioAuthorization {
  id: string;
  projectId: string;
  workItemId: string | null;
  attemptId: string | null;
  actionIntentId: string;
  authorizationTier: string;
  actionDigest: string;
  policyRule: string | null;
  state: PortfolioAuthorizationState;
  projectionVersion: number;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PortfolioWorkflowWakeup {
  id: string;
  projectId: string;
  workItemId: string;
  attemptId: string;
  reasonClass: string;
  state: PortfolioWakeupState;
  projectionVersion: number;
  dueAt: Date;
  coalescingKey: string;
  attemptCount: number;
  maxAttempts: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PortfolioHeartbeatSetting {
  enabled: boolean;
  cadenceMinutes: number | null;
  projectionVersion: number;
  lastReconciledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PortfolioActionIntent {
  id: string;
  projectId: string;
  workItemId: string | null;
  attemptId: string | null;
  sessionId: string | null;
  actionClass: string;
  resourceScope: Record<string, unknown>;
  payloadDigest: string;
  assignmentLeaseTokenDigest: string | null;
  policyRule: string | null;
  issuedAt: Date;
  expiresAt: Date;
  createdAt: Date;
}

export interface PortfolioCommand {
  id: string;
  projectId: string;
  workItemId: string;
  attemptId: string;
  assignmentId: string | null;
  authorizationId: string | null;
  actionIntentId: string;
  commandType: string;
  payloadDigest: string;
  state: string;
  dispatchReceiptDigest: string | null;
  observedAt: Date | null;
  projectionVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PortfolioDispatchPreparation {
  command: PortfolioCommand;
  assignment: PortfolioSessionAssignment;
  actionIntent: PortfolioActionIntent;
  authorization: PortfolioAuthorization;
  expectedSignal: PortfolioWorkerSignal;
  replayed: boolean;
}

export interface PortfolioPrepareDispatchInput {
  projectId: string;
  workItemId: string;
  attemptId: string;
  sessionId: string;
  assignmentId: string;
  leaseToken: string;
  expectedAttemptProjectionVersion: number;
  expectedAssignmentProjectionVersion: number;
  actionClass: string;
  resourceScope: Record<string, unknown>;
  policyRule: string;
  authorizationTier: "preauthorized" | "owner_confirmation";
  /** Existing owner-confirmed authorization, already consumed by its owner. */
  authorizationId?: string;
  authorizationActionDigest?: string;
  authorizationExpiresAt: Date;
  requestedAuthorizationExpiresAt?: Date;
  signalType: string;
  capabilityDigest: string;
  signalExpiresAt: Date;
  commandId: string;
  idempotencyKey: string;
  now?: Date;
}

export interface PortfolioFact {
  id: string;
  projectId: string | null;
  requestId: string | null;
  workItemId: string | null;
  attemptId: string | null;
  recordType: string;
  recordId: string;
  factType: string;
  correlationId: string | null;
  idempotencyKey: string | null;
  payload: Record<string, unknown>;
  payloadDigest: string;
  createdAt: Date;
}

export interface PortfolioStateTransitionResult {
  recordType: PortfolioStateRecordType;
  recordId: string;
  fromState: string;
  toState: string;
  projectionVersion: number;
}

interface Row extends Record<string, unknown> {}

interface StateRecordRow extends Row {
  id: string;
  state: string;
  projection_version: number;
  project_id: string;
  request_id?: string | null;
  work_item_id?: string | null;
  attempt_id?: string | null;
}

const stateTables: Record<PortfolioStateRecordType, string> = {
  request: "portfolio_requests",
  work_item: "portfolio_work_items",
  task_attempt: "portfolio_task_attempts",
  authorization: "portfolio_execution_authorizations",
  wakeup: "portfolio_workflow_wakeups",
  acceptance_decision: "portfolio_acceptance_decisions"
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Produces a deterministic digest for server-created Portfolio records. */
export function digestPortfolioValue(value: unknown): string {
  return sha256(stableJson(value));
}

/** Canonical digest shared by policy issuance and repository-side authorization checks. */
export function digestPortfolioActionIntent(input: {
  userId: string;
  projectId: string;
  workItemId: string | null;
  attemptId: string | null;
  sessionId: string | null;
  actionClass: string;
  resourceScope: Record<string, unknown>;
  payloadDigest: string;
  assignmentLeaseTokenDigest: string | null;
  policyRule: string | null;
  issuedAt: Date;
  expiresAt: Date;
}): string {
  return digestPortfolioValue({ ...input, issuedAt: input.issuedAt.getTime(), expiresAt: input.expiresAt.getTime() });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
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

function hasObservedStateContent(value: unknown): boolean {
  return Object.entries(asRecord(value)).some(([key, item]) => key !== "evidenceIds" && hasMaterialObservedValue(item));
}

function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    return asRecord(JSON.parse(value) as unknown);
  } catch {
    return {};
  }
}

function parseStrings(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function asDate(value: unknown): Date {
  return new Date(typeof value === "number" ? value : 0);
}

function asNullableDate(value: unknown): Date | null {
  return typeof value === "number" ? new Date(value) : null;
}

function stringValue(row: Row, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function numberValue(row: Row, key: string): number {
  const value = row[key];
  return typeof value === "number" ? value : 0;
}

function nullableString(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function redactAuditValue(value: unknown, key = ""): unknown {
  const sensitive = /(?:secret|token|password|credential|authorization|raw|terminal|transcript|content)/i.test(key);
  if (sensitive) return "[redacted]";
  if (Array.isArray(value)) return value.map((item) => redactAuditValue(item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [entryKey, redactAuditValue(entryValue, entryKey)]));
  }
  if (typeof value === "string") {
    const sanitized = value
      .replace(/-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/g, "[redacted credential material]")
      .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[redacted]")
      .replace(/\bBearer\s+[A-Za-z0-9._~+\-/=]+/gi, "Bearer [redacted]")
      .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
      .replace(/\braw\s+(?:terminal\s+)?(?:transcript|output)\b/gi, "[redacted terminal content]")
      .replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, (_match, name: string) => `${name}: [redacted]`);
    return sanitized.length > 1_024 ? `${sanitized.slice(0, 1_024)}…` : sanitized;
  }
  return value;
}

function redactSummary(value: string): string {
  if (/(?:terminal\s+(?:transcript|output)|raw\s+(?:terminal|output|transcript))/i.test(value)) {
    return "[redacted terminal content]";
  }
  return String(redactAuditValue(value));
}

/** Evidence keys bind one required criterion to one trusted, traceable observation. */
export function acceptanceEvidenceKey(criterion: string): string {
  return `acceptance:${criterion}`;
}

/** Verification requirements use a distinct namespace and cannot satisfy acceptance criteria. */
export function verificationEvidenceKey(requirement: string): string {
  return `verification:${requirement}`;
}

function isUniqueViolation(error: unknown, table: string): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed") && error.message.includes(table);
}

function isPortfolioStateRecordType(value: unknown): value is PortfolioStateRecordType {
  return typeof value === "string" && portfolioStateRecordTypes.some((recordType) => recordType === value);
}

function isStateTransitionResult(value: Record<string, unknown>): value is Record<string, unknown> & PortfolioStateTransitionResult {
  return isPortfolioStateRecordType(value.recordType)
    && typeof value.recordId === "string" && typeof value.fromState === "string"
    && typeof value.toState === "string" && typeof value.projectionVersion === "number";
}

export class PortfolioRepository {
  private lastFactCreatedAt = 0;

  constructor(
    private readonly db: Database,
    private readonly userId: string,
    private readonly clock: PortfolioClock = { now: () => new Date() }
  ) {}

  /** Groups related Portfolio facts and projections into one durable decision. */
  runInTransaction<T>(operation: () => T): T {
    return this.db.transaction(operation)();
  }

  /** Exposes the repository scope to server-owned policy construction only. */
  getUserId(): string {
    return this.userId;
  }

  createStateGate(): PortfolioStateGate {
    return createPortfolioStateGate(this, (input) => this.#applyStateTransition(input), (id, version, key) => this.#markCompletionCandidateVerified(id, version, key));
  }

  enrollProject(input: {
    projectId: string;
    objective: string;
    intendedOutcome: string;
    scopeJson?: Record<string, unknown>;
    observedState: Record<string, unknown>;
    evidenceIds: string[];
    initialEvidence: PortfolioEnrollmentEvidenceInput[];
    idempotencyKey: string;
  }): PortfolioProjectEnrollment {
    return this.withOperation("project_enrollment.enroll", input.idempotencyKey, input, () => {
      const evidenceIds = [...new Set(input.evidenceIds)];
      this.#assertObservedStateContent(input.observedState);
      if (evidenceIds.length === 0 || evidenceIds.length !== input.initialEvidence.length) {
        throw new Error("PORTFOLIO_ENROLLMENT_EVIDENCE_REQUIRED");
      }
      const evidenceById = new Map(input.initialEvidence.map((evidence) => [evidence.id, evidence]));
      if (evidenceById.size !== evidenceIds.length || evidenceIds.some((id) => !evidenceById.has(id))) {
        throw new Error("PORTFOLIO_ENROLLMENT_EVIDENCE_INVALID");
      }
      this.#prepareProjectEnrollment(input);
      for (const evidenceId of evidenceIds) {
        const evidence = evidenceById.get(evidenceId);
        if (!evidence) throw new Error("PORTFOLIO_ENROLLMENT_EVIDENCE_INVALID");
        this.#insertEnrollmentEvidence(input.projectId, evidence, input.idempotencyKey);
      }
      this.#activateProjectEnrollment({ ...input, evidenceIds });
      return this.getEnrollment(input.projectId) as PortfolioProjectEnrollment;
    });
  }

  getEnrollment(projectId: string): PortfolioProjectEnrollment | undefined {
    const row = this.db.prepare("SELECT * FROM portfolio_projects WHERE project_id = ? AND user_id = ?").get(projectId, this.userId) as Row | undefined;
    return row ? {
      projectId: stringValue(row, "project_id"), userId: stringValue(row, "user_id"), ownerUserId: stringValue(row, "owner_user_id"),
      enrollmentStatus: stringValue(row, "enrollment_status"), createdAt: asDate(row.created_at), updatedAt: asDate(row.updated_at)
    } : undefined;
  }

  getDossier(projectId: string): PortfolioDossier | undefined {
    return this.getCurrentDossier(projectId);
  }

  /** Display reads retain explicit source status even when a fact has expired. */
  getDossierDisplay(projectId: string): PortfolioDossierDisplay | undefined {
    const row = this.db.prepare(`SELECT dossier.*, project.owner_user_id
      FROM portfolio_project_dossiers dossier
      INNER JOIN portfolio_projects project ON project.user_id = dossier.user_id AND project.project_id = dossier.project_id
      WHERE dossier.project_id = ? AND dossier.user_id = ? AND project.enrollment_status = 'active'`).get(projectId, this.userId) as Row | undefined;
    if (!row) return undefined;
    return { ...this.toDossier(row), sources: portfolioObservationSources.map((source) => this.#dossierSourceDisplay(projectId, source)) };
  }

  /** Current reads use collection time windows; display freshness text is not authority. */
  getCurrentDossier(projectId: string, now = this.clock.now()): PortfolioCurrentDossier | undefined {
    const display = this.getDossierDisplay(projectId);
    if (!display) return undefined;
    const currentEvidence = this.#effectiveCurrentEvidence(projectId, now);
    if (!this.#hasCurrentDossierEvidence(display, currentEvidence)) return undefined;
    const { sources: _sources, ...dossier } = display;
    return { ...dossier, currentEvidence };
  }

  #getDossierById(id: string): PortfolioDossier | undefined {
    const row = this.db.prepare(`SELECT dossier.*, project.owner_user_id
      FROM portfolio_project_dossiers dossier
      INNER JOIN portfolio_projects project ON project.user_id = dossier.user_id AND project.project_id = dossier.project_id
      WHERE dossier.id = ? AND dossier.user_id = ? AND project.enrollment_status = 'active'`).get(id, this.userId) as Row | undefined;
    return row ? this.getCurrentDossier(stringValue(row, "project_id")) : undefined;
  }

  updateDossier(input: { projectId: string; expectedProjectionVersion: number; objective?: string; intendedOutcome?: string; scope?: Record<string, unknown>; observedState?: Record<string, unknown>; evidenceIds?: string[]; idempotencyKey: string }): PortfolioDossier {
    return this.withOperation("dossier.update", input.idempotencyKey, input, () => {
      this.requireEnrollment(input.projectId);
      const dossier = this.getDossier(input.projectId);
      if (!dossier) throw new Error("PORTFOLIO_DOSSIER_NOT_FOUND");
      const evidenceIds = [...new Set(input.evidenceIds ?? [])];
      const hasObservedState = Object.prototype.hasOwnProperty.call(input, "observedState");
      if (hasObservedState) {
        this.#assertObservedStateContent(input.observedState);
        this.assertCurrentProjectEvidence(input.projectId, evidenceIds);
      }
      const observedState = hasObservedState ? { ...(input.observedState ?? {}), evidenceIds } : dossier.observedState;
      const now = Date.now();
      const result = this.db.prepare(`UPDATE portfolio_project_dossiers SET objective = ?, intended_outcome = ?, scope_json = ?, observed_state_json = ?, projection_version = projection_version + 1, updated_at = ? WHERE project_id = ? AND user_id = ? AND projection_version = ?`)
        .run(input.objective ?? dossier.objective, input.intendedOutcome ?? dossier.intendedOutcome, JSON.stringify(input.scope ?? dossier.scope), JSON.stringify(observedState), now, input.projectId, this.userId, input.expectedProjectionVersion);
      if (result.changes !== 1) throw new Error("PORTFOLIO_STATE_CONFLICT");
      this.#insertFact({ projectId: input.projectId, recordType: "dossier", recordId: dossier.id, factType: "dossier_updated",
        idempotencyKey: `dossier:${input.idempotencyKey}`, payload: { updatedFields: [
          ...(input.objective !== undefined ? ["objective"] : []),
          ...(input.intendedOutcome !== undefined ? ["intendedOutcome"] : []),
          ...(input.scope !== undefined ? ["scope"] : []),
          ...(hasObservedState ? ["observedState"] : [])
        ] } });
      return this.getDossier(input.projectId) as PortfolioDossier;
    });
  }

  createRequest(input: {
    projectId?: string;
    source: string;
    sourceEventId?: string;
    requesterId?: string;
    requestText: string;
    correlationId: string;
    idempotencyKey: string;
    sourceMetadata?: Record<string, unknown>;
  }): PortfolioRequest {
    // Web requests name the authenticated owner; a bound channel identity is
    // external provenance and is intentionally retained without becoming authority.
    if (input.requesterId && input.source === "web" && input.requesterId !== this.userId) {
      throw new Error("PORTFOLIO_REQUESTER_SCOPE_MISMATCH");
    }
    if (input.sourceEventId) {
      const existing = this.db.prepare(`SELECT * FROM portfolio_requests WHERE user_id = ? AND source = ? AND source_event_id = ?`)
        .get(this.userId, input.source, input.sourceEventId) as Row | undefined;
      if (existing) {
        const request = this.toRequest(existing);
        const sameSourcePayload = request.projectId === (input.projectId ?? null) && request.requesterId === (input.requesterId ?? null)
          && request.requestText === input.requestText && stableJson(request.sourceMetadata) === stableJson(input.sourceMetadata ?? {});
        if (!sameSourcePayload) throw new Error("PORTFOLIO_IDEMPOTENCY_CONFLICT");
        return request;
      }
    }
    return this.withOperation("request.create", input.idempotencyKey, input, (id) => {
      if (input.projectId) this.requireEnrollment(input.projectId);
      const now = Date.now();
      this.db.prepare(`INSERT INTO portfolio_requests (id, user_id, project_id, requester_id, source, source_event_id, request_text, source_metadata_json,
          state, correlation_id, idempotency_key, input_digest, received_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?, ?, ?, ?, ?)`)
        .run(id, this.userId, input.projectId ?? null, input.requesterId ?? null, input.source, input.sourceEventId ?? null, input.requestText,
          JSON.stringify(input.sourceMetadata ?? {}), input.correlationId, input.idempotencyKey, sha256(stableJson(input)), now, now, now);
      this.#insertFact({ ...(input.projectId ? { projectId: input.projectId } : {}), requestId: id, recordType: "request", recordId: id, factType: "request_received",
        correlationId: input.correlationId, idempotencyKey: `request:${input.idempotencyKey}`,
        payload: { source: input.source, hasSourceEventId: Boolean(input.sourceEventId), hasRequester: Boolean(input.requesterId) } });
      return this.getRequest(id) as PortfolioRequest;
    });
  }

  getRequest(id: string): PortfolioRequest | undefined {
    const row = this.db.prepare("SELECT * FROM portfolio_requests WHERE id = ? AND user_id = ?").get(id, this.userId) as Row | undefined;
    return row ? this.toRequest(row) : undefined;
  }

  listRequests(input: { projectId?: string; limit?: number } = {}): PortfolioRequest[] {
    const values: unknown[] = [this.userId];
    const projectClause = input.projectId ? " AND project_id = ?" : "";
    if (input.projectId) values.push(input.projectId);
    values.push(Math.min(Math.max(input.limit ?? 100, 1), 500));
    const rows = this.db.prepare(`SELECT * FROM portfolio_requests WHERE user_id = ?${projectClause} ORDER BY created_at, id LIMIT ?`).all(...values) as Row[];
    return rows.map((row) => this.toRequest(row));
  }

  routeRequest(input: { requestId: string; projectId: string; expectedProjectionVersion: number; idempotencyKey: string }): PortfolioRequest {
    return this.withOperation("request.route", input.idempotencyKey, input, () => {
      this.requireEnrollment(input.projectId);
      const request = this.getRequest(input.requestId);
      if (!request) throw new Error("PORTFOLIO_REQUEST_NOT_FOUND");
      if (request.projectId && request.projectId !== input.projectId) throw new Error("PORTFOLIO_REQUEST_ROUTE_CONFLICT");
      if (request.projectId === input.projectId) return request;
      const now = Date.now();
      const result = this.db.prepare(`UPDATE portfolio_requests SET project_id = ?, projection_version = projection_version + 1, updated_at = ?
        WHERE id = ? AND user_id = ? AND project_id IS NULL AND projection_version = ?`)
        .run(input.projectId, now, input.requestId, this.userId, input.expectedProjectionVersion);
      if (result.changes !== 1) throw new Error("PORTFOLIO_STATE_CONFLICT");
      this.#insertFact({ projectId: input.projectId, requestId: input.requestId, recordType: "request", recordId: input.requestId,
        factType: "request_routed", correlationId: request.correlationId, idempotencyKey: `request-route:${input.idempotencyKey}`,
        payload: { projectId: input.projectId } });
      return this.getRequest(input.requestId) as PortfolioRequest;
    });
  }

  recordAwaitingOwnerIntakeDecision(input: {
    requestId: string;
    candidateProjectIds: string[];
    scopeAssessment: string;
    producer: string;
    evidenceIds?: string[];
    idempotencyKey: string;
  }): PortfolioIntakeDecision {
    return this.withOperation("intake_decision.await_owner", input.idempotencyKey, input, (id) => {
      const request = this.getRequest(input.requestId);
      if (!request || request.state !== "received") throw new Error("PORTFOLIO_INTAKE_STATE_INVALID");
      return this.#insertIntakeDecision({ ...input, evidenceIds: input.evidenceIds ?? [], id, state: "awaiting_owner" });
    });
  }

  acceptInBoundaryIntakeDecision(input: {
    requestId: string;
    projectId: string;
    candidateProjectIds: string[];
    producer: string;
    evidenceIds: string[];
    idempotencyKey: string;
  }): PortfolioIntakeDecision {
    return this.withOperation("intake_decision.accept_in_boundary", input.idempotencyKey, input, (id) => {
      const request = this.getRequest(input.requestId);
      if (!request || request.state !== "received") throw new Error("PORTFOLIO_INTAKE_STATE_INVALID");
      if (request.projectId && request.projectId !== input.projectId) throw new Error("PORTFOLIO_REQUEST_ROUTE_CONFLICT");
      const candidates = [...new Set(input.candidateProjectIds)];
      if (candidates.length !== 1 || candidates[0] !== input.projectId || !this.getDossier(input.projectId)) {
        throw new Error("PORTFOLIO_INTAKE_ROUTE_INVALID");
      }
      this.#assertCurrentRequestEvidence(request, input.projectId, input.evidenceIds);
      return this.#insertIntakeDecision({ id, requestId: input.requestId, selectedProjectId: input.projectId, candidateProjectIds: candidates,
        scopeAssessment: "in_boundary", producer: input.producer, evidenceIds: input.evidenceIds, state: "accepted", idempotencyKey: input.idempotencyKey });
    });
  }

  acceptOwnerIntakeDecision(input: {
    requestId: string;
    projectId: string;
    evidenceIds?: string[];
    idempotencyKey: string;
  }): PortfolioIntakeDecision {
    return this.withOperation("intake_decision.accept_owner", input.idempotencyKey, input, (id) => {
      const request = this.getRequest(input.requestId);
      const dossier = this.getDossier(input.projectId);
      if (!request || request.state !== "needs_owner_decision") throw new Error("PORTFOLIO_OWNER_DECISION_REQUIRED");
      if (!dossier || dossier.ownerUserId !== this.userId) throw new Error("PORTFOLIO_OWNER_REQUIRED");
      if (request.projectId && request.projectId !== input.projectId) throw new Error("PORTFOLIO_REQUEST_ROUTE_CONFLICT");
      return this.#insertIntakeDecision({ id, requestId: input.requestId, selectedProjectId: input.projectId,
        candidateProjectIds: [input.projectId], scopeAssessment: "owner_confirmed", producer: "owner",
        evidenceIds: input.evidenceIds ?? [], state: "accepted", idempotencyKey: input.idempotencyKey });
    });
  }

  getIntakeDecision(id: string): PortfolioIntakeDecision | undefined {
    const row = this.db.prepare("SELECT * FROM portfolio_intake_decisions WHERE id = ? AND user_id = ?").get(id, this.userId) as Row | undefined;
    return row ? this.toIntakeDecision(row) : undefined;
  }

  getIntakeDecisionByIdempotencyKey(idempotencyKey: string): PortfolioIntakeDecision | undefined {
    const row = this.db.prepare(`SELECT * FROM portfolio_intake_decisions
      WHERE user_id = ? AND idempotency_key = ?`).get(this.userId, idempotencyKey) as Row | undefined;
    return row ? this.toIntakeDecision(row) : undefined;
  }

  listIntakeDecisionsForRequest(requestId: string, limit = 100): PortfolioIntakeDecision[] {
    if (!this.getRequest(requestId)) throw new Error("PORTFOLIO_REQUEST_NOT_FOUND");
    const rows = this.db.prepare(`SELECT * FROM portfolio_intake_decisions WHERE user_id = ? AND request_id = ?
      ORDER BY created_at, id LIMIT ?`).all(this.userId, requestId, Math.min(Math.max(limit, 1), 500)) as Row[];
    return rows.map((row) => this.toIntakeDecision(row));
  }

  listRequestFacts(requestId: string, limit = 100): PortfolioFact[] {
    if (!this.getRequest(requestId)) throw new Error("PORTFOLIO_REQUEST_NOT_FOUND");
    const rows = this.db.prepare(`SELECT * FROM portfolio_facts WHERE user_id = ? AND request_id = ?
      ORDER BY created_at, id LIMIT ?`).all(this.userId, requestId, Math.min(Math.max(limit, 1), 500)) as Row[];
    return rows.map((row) => this.toFact(row));
  }

  listWorkItemsForRequest(requestId: string, limit = 100): PortfolioWorkItem[] {
    if (!this.getRequest(requestId)) throw new Error("PORTFOLIO_REQUEST_NOT_FOUND");
    const rows = this.db.prepare(`SELECT * FROM portfolio_work_items WHERE user_id = ? AND request_id = ?
      ORDER BY created_at, id LIMIT ?`).all(this.userId, requestId, Math.min(Math.max(limit, 1), 500)) as Row[];
    return rows.map((row) => this.toWorkItem(row));
  }

  /** Display-safe work item listing for the HTTP facade; always user-scoped. */
  listWorkItems(input: { projectId?: string; status?: PortfolioWorkItemState; limit?: number }): PortfolioWorkItem[] {
    const clauses = ["user_id = ?"];
    const values: unknown[] = [this.userId];
    if (input.projectId) { clauses.push("project_id = ?"); values.push(input.projectId); }
    if (input.status) { clauses.push("state = ?"); values.push(input.status); }
    values.push(Math.min(Math.max(input.limit ?? 100, 1), 500));
    const rows = this.db.prepare(`SELECT * FROM portfolio_work_items WHERE ${clauses.join(" AND ")}
      ORDER BY updated_at DESC, id LIMIT ?`).all(...values) as Row[];
    return rows.map((row) => this.toWorkItem(row));
  }

  createWorkItem(input: {
    projectId: string;
    requestId: string;
    ownerUserId?: string;
    title: string;
    description?: string;
    acceptanceCriteria?: string[];
    verificationRequirements?: string[];
    idempotencyKey: string;
  }): PortfolioWorkItem {
    if (!input.requestId) throw new Error("PORTFOLIO_REQUEST_REQUIRED");
    return this.withOperation("work_item.create", input.idempotencyKey, input, (id) => {
      const enrollment = this.requireEnrollment(input.projectId);
      this.requireAcceptedRequestIntake(input.requestId, input.projectId);
      const ownerUserId = input.ownerUserId ?? enrollment.ownerUserId;
      if (ownerUserId !== enrollment.ownerUserId) throw new Error("PORTFOLIO_OWNER_SCOPE_MISMATCH");
      const now = Date.now();
      this.db.prepare(`INSERT INTO portfolio_work_items (id, user_id, project_id, request_id, owner_user_id, title, description,
          acceptance_criteria_json, verification_requirements_json, state, idempotency_key, input_digest, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?)`)
        .run(id, this.userId, input.projectId, input.requestId, ownerUserId, input.title, input.description ?? null,
          JSON.stringify(input.acceptanceCriteria ?? []), JSON.stringify(input.verificationRequirements ?? []), input.idempotencyKey, sha256(stableJson(input)), now, now);
      this.#insertFact({ projectId: input.projectId, requestId: input.requestId, workItemId: id, recordType: "work_item", recordId: id,
        factType: "work_item_created", idempotencyKey: `work-item:${input.idempotencyKey}`,
        payload: { ownerUserId, state: "todo", acceptanceCriteriaCount: (input.acceptanceCriteria ?? []).length,
          verificationRequirementCount: (input.verificationRequirements ?? []).length } });
      return this.getWorkItem(id) as PortfolioWorkItem;
    });
  }

  getWorkItem(id: string): PortfolioWorkItem | undefined {
    const row = this.db.prepare("SELECT * FROM portfolio_work_items WHERE id = ? AND user_id = ?").get(id, this.userId) as Row | undefined;
    return row ? this.toWorkItem(row) : undefined;
  }

  createTaskPacket(input: {
    projectId: string;
    workItemId: string;
    packetVersion: number;
    packetDigest: string;
    skillVersion: string;
    sourceWorkItemVersion: number;
    dossierVersion: number;
    canonicalPacket: Record<string, unknown>;
    manifestVersion: string;
    manifestDigest: string;
    createdBy: string;
    idempotencyKey: string;
  }): PortfolioTaskPacket {
    this.#assertExecutableTaskPacketInput(input);
    return this.withOperation("task_packet.create", input.idempotencyKey, input, (id) => {
      const workItem = this.requireWorkItem(input.workItemId, input.projectId);
      const dossier = this.getDossier(input.projectId);
      if (!dossier || workItem.projectionVersion !== input.sourceWorkItemVersion || dossier.projectionVersion !== input.dossierVersion) {
        throw new Error("PORTFOLIO_PACKET_VERSION_CONFLICT");
      }
      const now = Date.now();
      this.db.prepare(`INSERT INTO portfolio_task_packets (id, user_id, project_id, work_item_id, packet_version, packet_digest,
        skill_version, source_work_item_version, dossier_version, canonical_packet_json, manifest_version, manifest_digest, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, this.userId, input.projectId, input.workItemId, input.packetVersion, input.packetDigest, input.skillVersion,
        input.sourceWorkItemVersion, input.dossierVersion, JSON.stringify(input.canonicalPacket), input.manifestVersion,
        input.manifestDigest, input.createdBy, now
      );
      this.#insertFact({ projectId: input.projectId, workItemId: input.workItemId, recordType: "task_packet", recordId: id,
        factType: "task_packet_created", idempotencyKey: `task-packet:${input.idempotencyKey}`,
        payload: { packetVersion: input.packetVersion, packetDigest: input.packetDigest, manifestVersion: input.manifestVersion,
          manifestDigest: input.manifestDigest, sourceWorkItemVersion: input.sourceWorkItemVersion, dossierVersion: input.dossierVersion } });
      return this.getTaskPacket(id) as PortfolioTaskPacket;
    });
  }

  getTaskPacket(id: string): PortfolioTaskPacket | undefined {
    const row = this.db.prepare("SELECT * FROM portfolio_task_packets WHERE id = ? AND user_id = ?").get(id, this.userId) as Row | undefined;
    return row ? this.toTaskPacket(row) : undefined;
  }

  findTaskPacketByDigest(workItemId: string, packetDigest: string): PortfolioTaskPacket | undefined {
    const row = this.db.prepare(`SELECT * FROM portfolio_task_packets WHERE user_id = ? AND work_item_id = ? AND packet_digest = ?`)
      .get(this.userId, workItemId, packetDigest) as Row | undefined;
    return row ? this.toTaskPacket(row) : undefined;
  }

  nextTaskPacketVersion(workItemId: string): number {
    const row = this.db.prepare(`SELECT COALESCE(MAX(packet_version), 0) AS value FROM portfolio_task_packets WHERE user_id = ? AND work_item_id = ?`)
      .get(this.userId, workItemId) as Row;
    return numberValue(row, "value") + 1;
  }

  /** Persists an immutable packet and its prepared attempt as one idempotent unit. */
  prepareTaskAttempt(input: {
    projectId: string;
    workItemId: string;
    packetDigest: string;
    skillVersion: string;
    sourceWorkItemVersion: number;
    dossierVersion: number;
    canonicalPacket: Record<string, unknown>;
    manifestVersion: string;
    manifestDigest: string;
    adapter: string;
    createdBy: string;
    idempotencyKey: string;
    requestId?: string;
    trackingEnabled?: boolean;
  }): PortfolioPreparedTaskAttempt {
    this.#assertExecutableTaskPacketInput(input);
    const transaction = this.db.transaction(() => {
      const replay = this.#loadPreparedAttemptReplay(input);
      if (replay) return replay;
      const workItem = this.requireWorkItem(input.workItemId, input.projectId);
      const dossier = this.getDossier(input.projectId);
      if (!dossier || workItem.projectionVersion !== input.sourceWorkItemVersion || dossier.projectionVersion !== input.dossierVersion) {
        throw new Error("PORTFOLIO_PACKET_VERSION_CONFLICT");
      }
      const requestId = input.requestId ?? workItem.requestId;
      if (requestId) this.requireRequest(requestId, input.projectId);
      const packetId = randomUUID();
      const attemptId = randomUUID();
      const now = Date.now();
      const packetVersion = this.nextTaskPacketVersion(input.workItemId);
      const attemptNumber = this.#nextAttemptNumber(input.workItemId);
      this.#insertPreparedPacket(input, packetId, packetVersion, now);
      this.#insertPreparedAttempt(input, { attemptId, packetId, packetVersion, attemptNumber, requestId }, now);
      this.#insertFact({ projectId: input.projectId, workItemId: input.workItemId, recordType: "task_packet", recordId: packetId,
        factType: "task_packet_created", payload: { packetVersion, packetDigest: input.packetDigest, manifestVersion: input.manifestVersion } });
      this.#insertFact({ projectId: input.projectId, workItemId: input.workItemId, attemptId, recordType: "task_attempt", recordId: attemptId,
        factType: "task_attempt_prepared", payload: { packetId, packetDigest: input.packetDigest, sourceWorkItemVersion: input.sourceWorkItemVersion } });
      this.#storePreparedAttemptOperation(input, { packetId, attemptId }, now);
      return { packet: this.getTaskPacket(packetId) as PortfolioTaskPacket, attempt: this.getTaskAttempt(attemptId) as PortfolioTaskAttempt };
    });
    return transaction();
  }

  createTaskAttempt(input: {
    projectId: string;
    workItemId: string;
    packetVersion: number;
    packetDigest: string;
    adapter: string;
    createdBy: string;
    sourceWorkItemVersion: number;
    idempotencyKey: string;
    requestId?: string;
    packetId: string;
    trackingEnabled?: boolean;
  }): PortfolioTaskAttempt {
    const packet = this.getTaskPacket(input.packetId);
    if (!packet) throw new Error("PORTFOLIO_PACKET_DRIFT");
    this.#assertExecutableTaskPacket(packet, input.adapter);
    return this.withOperation("task_attempt.create", input.idempotencyKey, input, (id) => {
      const workItem = this.requireWorkItem(input.workItemId, input.projectId);
      if (workItem.projectionVersion !== input.sourceWorkItemVersion) throw new Error("PORTFOLIO_PACKET_VERSION_CONFLICT");
      this.assertTaskPacketForAttempt(input.packetId, input, workItem);
      const requestId = input.requestId ?? workItem.requestId;
      if (requestId) {
        this.requireRequest(requestId, input.projectId);
        if (workItem.requestId && requestId !== workItem.requestId) throw new Error("PORTFOLIO_REQUEST_SCOPE_MISMATCH");
      }
      const now = Date.now();
      const numberRow = this.db.prepare("SELECT COALESCE(MAX(attempt_number), 0) AS value FROM portfolio_task_attempts WHERE user_id = ? AND work_item_id = ?").get(this.userId, input.workItemId) as { value: number };
      this.db.prepare(`INSERT INTO portfolio_task_attempts (id, user_id, project_id, work_item_id, request_id, packet_id, attempt_number, source_work_item_version,
          packet_version, packet_digest, adapter, created_by, tracking_enabled, state, idempotency_key, input_digest, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?, ?, ?)`)
        .run(id, this.userId, input.projectId, input.workItemId, requestId ?? null, input.packetId, numberRow.value + 1,
          input.sourceWorkItemVersion, input.packetVersion, input.packetDigest, input.adapter, input.createdBy, input.trackingEnabled ? 1 : 0,
          input.idempotencyKey, sha256(stableJson(input)), now, now);
      return this.getTaskAttempt(id) as PortfolioTaskAttempt;
    });
  }

  getTaskAttempt(id: string): PortfolioTaskAttempt | undefined {
    const row = this.db.prepare("SELECT * FROM portfolio_task_attempts WHERE id = ? AND user_id = ?").get(id, this.userId) as Row | undefined;
    return row ? this.toTaskAttempt(row) : undefined;
  }

  /** Latest attempt by attempt_number; used when a transition must name its attempt. */
  getLatestTaskAttemptForWorkItem(workItemId: string): PortfolioTaskAttempt | undefined {
    const row = this.db.prepare(`SELECT * FROM portfolio_task_attempts WHERE user_id = ? AND work_item_id = ?
      ORDER BY attempt_number DESC, id DESC LIMIT 1`).get(this.userId, workItemId) as Row | undefined;
    return row ? this.toTaskAttempt(row) : undefined;
  }

  claimSessionAssignment(input: {
    projectId: string;
    workItemId: string;
    attemptId: string;
    sessionId: string;
    adapter: string;
    leaseDurationMs: number;
    now?: Date;
  }): ClaimedPortfolioSessionAssignment {
    const claim = this.db.transaction(() => {
      const now = input.now?.getTime() ?? Date.now();
      const attempt = this.requireTaskAttempt(input.attemptId, input.projectId, input.workItemId);
      this.requireOwnedSession(input.sessionId, input.projectId);
      this.db.prepare(`UPDATE portfolio_session_assignments SET active_attempt_slot = NULL, active_session_slot = NULL,
          released_reason = 'lease_expired', released_at = ?, projection_version = projection_version + 1, updated_at = ?
        WHERE user_id = ? AND (active_attempt_slot = 'active' OR active_session_slot = 'active') AND lease_expires_at <= ?
          AND (attempt_id = ? OR session_id = ?)`).run(now, now, this.userId, now, input.attemptId, input.sessionId);
      const id = randomUUID();
      const leaseToken = randomUUID();
      try {
      this.db.prepare(`INSERT INTO portfolio_session_assignments (id, user_id, project_id, work_item_id, attempt_id, session_id, adapter,
          lease_token_digest, lease_generation, lease_expires_at, active_attempt_slot, active_session_slot, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'active', 'active', ?, ?)`)
          .run(id, this.userId, input.projectId, input.workItemId, attempt.id, input.sessionId, input.adapter, sha256(leaseToken), now + input.leaseDurationMs, now, now);
      } catch (error) {
        if (isUniqueViolation(error, "portfolio_session_assignments")) throw new Error("PORTFOLIO_ASSIGNMENT_CONFLICT");
        throw error;
      }
      this.#insertFact({ projectId: input.projectId, workItemId: input.workItemId, attemptId: input.attemptId, recordType: "session_assignment", recordId: id,
        factType: "assignment_claimed", payload: { assignmentId: id, leaseExpiresAt: now + input.leaseDurationMs, leaseTokenDigest: sha256(leaseToken) } });
      return { ...(this.getSessionAssignment(id) as PortfolioSessionAssignment), leaseToken };
    });
    try {
      return claim();
    } catch (error) {
      if (error instanceof Error && error.message.includes("database is locked")) throw new Error("SQLITE_BUSY");
      throw error;
    }
  }

  getSessionAssignment(id: string): PortfolioSessionAssignment | undefined {
    const row = this.db.prepare("SELECT * FROM portfolio_session_assignments WHERE id = ? AND user_id = ?").get(id, this.userId) as Row | undefined;
    return row ? this.toAssignment(row) : undefined;
  }

  getAssignment(id: string): PortfolioSessionAssignment | undefined {
    return this.getSessionAssignment(id);
  }

  getActiveSessionAssignment(sessionId: string, now = new Date()): PortfolioSessionAssignment | undefined {
    const row = this.db.prepare(`SELECT * FROM portfolio_session_assignments WHERE user_id = ? AND session_id = ?
      AND active_session_slot = 'active' AND lease_expires_at > ?`).get(this.userId, sessionId, now.getTime()) as Row | undefined;
    return row ? this.toAssignment(row) : undefined;
  }

  /** Read-only writer-fence lookup for a session's current Portfolio lease. */
  findActiveAssignment(input: { sessionId: string; now?: Date }): PortfolioSessionAssignment | undefined {
    return this.getActiveSessionAssignment(input.sessionId, input.now);
  }

  renewSessionAssignment(input: {
    assignmentId: string;
    leaseToken: string;
    expectedProjectionVersion: number;
    leaseDurationMs: number;
    now?: Date;
  }): ClaimedPortfolioSessionAssignment {
    const renew = this.db.transaction(() => {
      const now = input.now?.getTime() ?? Date.now();
      const assignment = this.getSessionAssignment(input.assignmentId);
      if (!assignment || !assignment.active || assignment.leaseExpiresAt.getTime() <= now || assignment.projectionVersion !== input.expectedProjectionVersion
        || assignment.leaseTokenDigest !== sha256(input.leaseToken)) throw new Error("PORTFOLIO_LEASE_MISMATCH");
      const leaseToken = randomUUID();
      const updated = this.db.prepare(`UPDATE portfolio_session_assignments SET lease_token_digest = ?, lease_generation = lease_generation + 1,
        lease_expires_at = ?, projection_version = projection_version + 1, updated_at = ?
        WHERE id = ? AND user_id = ? AND active_attempt_slot = 'active' AND projection_version = ? AND lease_token_digest = ? AND lease_expires_at > ?`)
        .run(sha256(leaseToken), now + input.leaseDurationMs, now, input.assignmentId, this.userId, input.expectedProjectionVersion, sha256(input.leaseToken), now);
      if (updated.changes !== 1) throw new Error("PORTFOLIO_LEASE_MISMATCH");
      const renewed = this.getSessionAssignment(input.assignmentId) as PortfolioSessionAssignment;
      this.#insertFact({ projectId: renewed.projectId, workItemId: renewed.workItemId, attemptId: renewed.attemptId,
        recordType: "session_assignment", recordId: renewed.id, factType: "assignment_renewed",
        payload: { leaseGeneration: renewed.leaseGeneration, leaseExpiresAt: renewed.leaseExpiresAt.getTime() } });
      return { ...renewed, leaseToken };
    });
    return renew();
  }

  releaseSessionAssignment(input: { assignmentId: string; leaseToken: string; reason: string; now?: Date }): PortfolioSessionAssignment {
    const now = input.now?.getTime() ?? Date.now();
    const result = this.db.prepare(`UPDATE portfolio_session_assignments SET active_attempt_slot = NULL, active_session_slot = NULL, released_reason = ?,
      released_at = ?, projection_version = projection_version + 1, updated_at = ?
      WHERE id = ? AND user_id = ? AND lease_token_digest = ? AND active_attempt_slot = 'active'`).run(
      input.reason, now, now, input.assignmentId, this.userId, sha256(input.leaseToken)
    );
    if (result.changes !== 1) throw new Error("PORTFOLIO_LEASE_MISMATCH");
    const assignment = this.getSessionAssignment(input.assignmentId) as PortfolioSessionAssignment;
    this.#insertFact({ projectId: assignment.projectId, workItemId: assignment.workItemId, attemptId: assignment.attemptId, recordType: "session_assignment",
      recordId: assignment.id, factType: "assignment_released", payload: { reason: input.reason } });
    return assignment;
  }

  createActionIntent(input: {
    projectId: string;
    workItemId?: string;
    attemptId?: string;
    sessionId?: string;
    actionClass: string;
    resourceScope?: Record<string, unknown>;
    payloadDigest: string;
    assignmentLeaseToken?: string;
    policyRule?: string;
    /** Preserves a policy-issued action digest across the durable insert. */
    issuedAt?: Date;
    expiresAt: Date;
    idempotencyKey: string;
  }): PortfolioActionIntent {
    return this.withOperation("action_intent.create", input.idempotencyKey, input, (id) => {
      this.requireEnrollment(input.projectId);
      const workItem = input.workItemId ? this.requireWorkItem(input.workItemId, input.projectId) : undefined;
      const attempt = input.attemptId
        ? this.requireTaskAttempt(input.attemptId, input.projectId, workItem?.id ?? "")
        : undefined;
      if (input.sessionId) this.requireOwnedSession(input.sessionId, input.projectId);
      if (input.assignmentLeaseToken) {
        if (!attempt || !input.sessionId) throw new Error("PORTFOLIO_LEASE_SCOPE_MISMATCH");
        const assignment = this.findActiveAssignmentByLeaseToken(input.assignmentLeaseToken, attempt.id, input.sessionId);
        if (!assignment) throw new Error("PORTFOLIO_LEASE_MISMATCH");
      }
      const now = input.issuedAt?.getTime() ?? Date.now();
      if (input.expiresAt.getTime() <= now) throw new Error("PORTFOLIO_AUTHORIZATION_EXPIRED");
      this.db.prepare(`INSERT INTO portfolio_action_intents (id, user_id, project_id, work_item_id, attempt_id, session_id, action_class,
        resource_scope_json, payload_digest, assignment_lease_token_digest, policy_rule, issued_at, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, this.userId, input.projectId, input.workItemId ?? null, input.attemptId ?? null, input.sessionId ?? null, input.actionClass,
          JSON.stringify(input.resourceScope ?? {}), input.payloadDigest, input.assignmentLeaseToken ? sha256(input.assignmentLeaseToken) : null,
          input.policyRule ?? null, now, input.expiresAt.getTime(), now);
      return this.getActionIntent(id) as PortfolioActionIntent;
    });
  }

  getActionIntent(id: string): PortfolioActionIntent | undefined {
    const row = this.db.prepare("SELECT * FROM portfolio_action_intents WHERE id = ? AND user_id = ?").get(id, this.userId) as Row | undefined;
    return row ? this.toActionIntent(row) : undefined;
  }

  /** Returns the canonical server digest; callers cannot supply a substitute. */
  getActionIntentDigest(id: string): string | undefined {
    const intent = this.getActionIntent(id);
    return intent ? this.#actionIntentDigest(intent) : undefined;
  }

  createAuthorization(input: {
    projectId: string;
    workItemId?: string;
    attemptId?: string;
    actionIntentId: string;
    authorizationTier: "preauthorized" | "owner_confirmation" | "protected";
    actionDigest: string;
    policyRule?: string;
    expiresAt: Date;
    idempotencyKey: string;
  }): PortfolioAuthorization {
    return this.withOperation("authorization.create", input.idempotencyKey, input, (id) => {
      const intent = this.getActionIntent(input.actionIntentId);
      if (!intent || intent.projectId !== input.projectId) throw new Error("PORTFOLIO_ACTION_INTENT_NOT_FOUND");
      if ((input.workItemId ?? null) !== intent.workItemId || (input.attemptId ?? null) !== intent.attemptId) {
        throw new Error("PORTFOLIO_ACTION_INTENT_SCOPE_MISMATCH");
      }
      const now = Date.now();
      if (input.expiresAt.getTime() <= now || input.expiresAt.getTime() !== intent.expiresAt.getTime()
        || input.actionDigest !== this.#actionIntentDigest(intent)) {
        throw new Error("PORTFOLIO_AUTHORIZATION_DIGEST_MISMATCH");
      }
      const expectedPolicy = this.#policyRuleForTier(input.authorizationTier, intent.actionClass);
      if (input.policyRule !== expectedPolicy) throw new Error("PORTFOLIO_AUTHORIZATION_POLICY_MISMATCH");
      const state = input.authorizationTier === "preauthorized" ? "preauthorized" : "awaiting_owner";
      this.db.prepare(`INSERT INTO portfolio_execution_authorizations (id, user_id, project_id, work_item_id, attempt_id, action_intent_id,
        authorization_tier, action_digest, policy_rule, state, expires_at, idempotency_key, input_digest, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, this.userId, input.projectId, input.workItemId ?? null, input.attemptId ?? null, input.actionIntentId, input.authorizationTier,
          input.actionDigest, input.policyRule, state, input.expiresAt.getTime(), input.idempotencyKey, sha256(stableJson(input)), now, now);
      const authorization = this.getAuthorization(id) as PortfolioAuthorization;
      this.#insertFact({ projectId: input.projectId, ...(input.workItemId ? { workItemId: input.workItemId } : {}),
        ...(input.attemptId ? { attemptId: input.attemptId } : {}), recordType: "authorization", recordId: id,
        factType: "authorization_issued", payload: { tier: input.authorizationTier, policyRule: input.policyRule, state } });
      return authorization;
    });
  }

  getAuthorization(id: string): PortfolioAuthorization | undefined {
    const row = this.db.prepare("SELECT * FROM portfolio_execution_authorizations WHERE id = ? AND user_id = ?").get(id, this.userId) as Row | undefined;
    return row ? this.toAuthorization(row) : undefined;
  }

  approveAuthorization(input: { authorizationId: string; expectedProjectionVersion: number; actionDigest: string; actorId: string; now?: Date }): PortfolioAuthorization {
    const transaction = this.db.transaction(() => {
      const now = input.now?.getTime() ?? Date.now();
      const authorization = this.getAuthorization(input.authorizationId);
      const intent = authorization ? this.getActionIntent(authorization.actionIntentId) : undefined;
      const workItem = authorization?.workItemId ? this.getWorkItem(authorization.workItemId) : undefined;
      if (!authorization || !intent || !workItem || workItem.ownerUserId !== input.actorId || authorization.state !== "awaiting_owner"
        || authorization.authorizationTier !== "owner_confirmation" || authorization.expiresAt.getTime() <= now || intent.expiresAt.getTime() <= now
        || authorization.projectionVersion !== input.expectedProjectionVersion || authorization.actionDigest !== input.actionDigest
        || input.actionDigest !== this.#actionIntentDigest(intent)
        || authorization.policyRule !== this.#policyRuleForTier("owner_confirmation", intent.actionClass)) throw new Error("PORTFOLIO_AUTHORIZATION_APPROVAL_REJECTED");
      const updated = this.db.prepare(`UPDATE portfolio_execution_authorizations SET state = 'approved', projection_version = projection_version + 1, updated_at = ?
        WHERE id = ? AND user_id = ? AND state = 'awaiting_owner' AND projection_version = ? AND action_digest = ?`).run(
        now, authorization.id, this.userId, input.expectedProjectionVersion, input.actionDigest
      );
      if (updated.changes !== 1) throw new Error("PORTFOLIO_STATE_CONFLICT");
      this.#insertFact({ projectId: authorization.projectId, ...(authorization.workItemId ? { workItemId: authorization.workItemId } : {}),
        ...(authorization.attemptId ? { attemptId: authorization.attemptId } : {}), recordType: "authorization", recordId: authorization.id,
        factType: "authorization_owner_approved", payload: { tier: authorization.authorizationTier, actionDigest: authorization.actionDigest } });
      return this.getAuthorization(authorization.id) as PortfolioAuthorization;
    });
    return transaction();
  }

  /** Checks the durable policy binding before an owner-confirmation approval. */
  canApproveAuthorization(authorizationId: string, actorId: string, nowDate?: Date): boolean {
    const authorization = this.getAuthorization(authorizationId);
    const intent = authorization ? this.getActionIntent(authorization.actionIntentId) : undefined;
    const workItem = authorization?.workItemId ? this.getWorkItem(authorization.workItemId) : undefined;
    const now = nowDate?.getTime() ?? Date.now();
    if (!authorization || !intent || !workItem || workItem.ownerUserId !== actorId || authorization.state !== "awaiting_owner"
      || authorization.authorizationTier !== "owner_confirmation" || authorization.expiresAt.getTime() <= now || intent.expiresAt.getTime() <= now) return false;
    return authorization.actionDigest === this.#actionIntentDigest(intent)
      && authorization.policyRule === this.#policyRuleForTier("owner_confirmation", intent.actionClass);
  }

  /**
   * Only a current Work Item owner may consume an owner-confirmed action. A
   * preauthorized packet dispatch is consumed atomically by prepareDispatch,
   * and protected actions remain unavailable in this phase.
   */
  canConsumeAuthorization(authorizationId: string, actorId: string, nowDate?: Date): boolean {
    const authorization = this.getAuthorization(authorizationId);
    const intent = authorization ? this.getActionIntent(authorization.actionIntentId) : undefined;
    const workItem = authorization?.workItemId ? this.getWorkItem(authorization.workItemId) : undefined;
    const now = nowDate?.getTime() ?? Date.now();
    if (!authorization || !intent || !workItem || workItem.ownerUserId !== actorId || authorization.state !== "approved"
      || authorization.authorizationTier !== "owner_confirmation" || authorization.expiresAt.getTime() <= now || intent.expiresAt.getTime() <= now) return false;
    return authorization.actionDigest === this.#actionIntentDigest(intent)
      && authorization.policyRule === this.#policyRuleForTier("owner_confirmation", intent.actionClass);
  }

  createCommand(input: {
    projectId: string;
    workItemId: string;
    attemptId: string;
    actionIntentId: string;
    assignmentId?: string;
    authorizationId?: string;
    commandType: string;
    payloadDigest: string;
    idempotencyKey: string;
  }): PortfolioCommand {
    return this.withOperation("command.create", input.idempotencyKey, input, (id) => {
      this.requireTaskAttempt(input.attemptId, input.projectId, input.workItemId);
      const intent = this.getActionIntent(input.actionIntentId);
      if (input.assignmentId) {
        const assignment = this.getSessionAssignment(input.assignmentId);
        if (!assignment || assignment.projectId !== input.projectId || assignment.workItemId !== input.workItemId || assignment.attemptId !== input.attemptId) {
          throw new Error("PORTFOLIO_ASSIGNMENT_SCOPE_MISMATCH");
        }
      }
      if (!intent || intent.projectId !== input.projectId || intent.workItemId !== input.workItemId || intent.attemptId !== input.attemptId
        || intent.payloadDigest !== input.payloadDigest || input.commandType !== intent.actionClass) {
        throw new Error("PORTFOLIO_ACTION_INTENT_SCOPE_MISMATCH");
      }
      if (!input.authorizationId) throw new Error("PORTFOLIO_AUTHORIZATION_SCOPE_MISMATCH");
      const authorization = this.getAuthorization(input.authorizationId);
      if (!authorization || authorization.projectId !== input.projectId || authorization.workItemId !== input.workItemId
        || authorization.attemptId !== input.attemptId || authorization.actionIntentId !== input.actionIntentId
        || authorization.actionDigest !== this.#actionIntentDigest(intent) || authorization.expiresAt.getTime() <= Date.now()
        || intent.expiresAt.getTime() <= Date.now() || authorization.state !== "consumed") {
        throw new Error("PORTFOLIO_AUTHORIZATION_SCOPE_MISMATCH");
      }
      const now = Date.now();
      this.db.prepare(`INSERT INTO portfolio_commands (id, user_id, project_id, work_item_id, attempt_id, assignment_id, authorization_id, action_intent_id,
        command_type, payload_digest, state, idempotency_key, input_digest, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`)
        .run(id, this.userId, input.projectId, input.workItemId, input.attemptId, input.assignmentId ?? null, input.authorizationId ?? null,
          input.actionIntentId, input.commandType, input.payloadDigest, input.idempotencyKey, sha256(stableJson(input)), now, now);
      return this.getCommand(id) as PortfolioCommand;
    });
  }

  getCommand(id: string): PortfolioCommand | undefined {
    const row = this.db.prepare("SELECT * FROM portfolio_commands WHERE id = ? AND user_id = ?").get(id, this.userId) as Row | undefined;
    return row ? this.toCommand(row) : undefined;
  }

  getWorkerSignalForCommand(commandId: string, signalType = "session_start_ready"): PortfolioWorkerSignal | undefined {
    const row = this.db.prepare(`SELECT * FROM portfolio_worker_signals WHERE user_id = ? AND command_id = ? AND signal_type = ?`)
      .get(this.userId, commandId, signalType) as Row | undefined;
    return row ? this.toWorkerSignal(row) : undefined;
  }

  listWorkerSignalsForAttempt(attemptId: string): PortfolioWorkerSignal[] {
    const rows = this.db.prepare(`SELECT * FROM portfolio_worker_signals WHERE user_id = ? AND attempt_id = ? ORDER BY created_at, id`)
      .all(this.userId, attemptId) as Row[];
    return rows.map((row) => this.toWorkerSignal(row));
  }

  acknowledgeWorkerSignal(input: {
    commandId: string;
    assignmentId: string;
    attemptId: string;
    sessionId: string;
    adapter: string;
    leaseGeneration: number;
    packetDigest: string;
    capabilityDigest: string;
    now?: Date;
  }): PortfolioWorkerSignal {
    return this.#consumeWorkerSignalTransition(input, "expected", "acknowledged", input.now);
  }

  consumeAcknowledgedWorkerSignal(input: {
    commandId: string;
    assignmentId: string;
    attemptId: string;
    sessionId: string;
    adapter: string;
    leaseGeneration: number;
    packetDigest: string;
    capabilityDigest: string;
    now?: Date;
  }): PortfolioWorkerSignal {
    return this.#consumeWorkerSignalTransition(input, "acknowledged", "consumed", input.now);
  }

  /**
   * Atomically marks the one permitted worker launch without storing its raw
   * capability. A process crash after this claim is reconciliation-only.
   */
  claimWorkerSignalLaunch(input: PortfolioWorkerSignalBinding & { capabilityDigest: string; now?: Date }): PortfolioWorkerSignal {
    const transaction = this.db.transaction(() => {
      const now = input.now?.getTime() ?? Date.now();
      const signal = this.getWorkerSignalForCommand(input.commandId);
      const assignment = this.getSessionAssignment(input.assignmentId);
      const command = this.getCommand(input.commandId);
      if (!signal || !assignment || !command || signal.assignmentId !== input.assignmentId || signal.attemptId !== input.attemptId
        || signal.sessionId !== input.sessionId || signal.adapter !== input.adapter || signal.leaseGeneration !== input.leaseGeneration
        || signal.packetDigest !== input.packetDigest || signal.capabilityDigest !== input.capabilityDigest
        || !assignment.active || assignment.attemptId !== input.attemptId || assignment.sessionId !== input.sessionId
        || assignment.adapter !== input.adapter || assignment.leaseGeneration !== input.leaseGeneration) {
        throw new Error("PORTFOLIO_WRITER_FENCE_REJECTED");
      }
      if (signal.state !== "expected" || command.state !== "awaiting_readiness" || signal.expiresAt.getTime() <= now
        || assignment.leaseExpiresAt.getTime() <= now || signal.launchIssuedAt) {
        throw new Error("PORTFOLIO_WORKER_LAUNCH_UNKNOWN");
      }
      const claimed = this.db.prepare(`UPDATE portfolio_worker_signals SET launch_issued_at = ?, updated_at = ?
        WHERE id = ? AND user_id = ? AND state = 'expected' AND launch_issued_at IS NULL AND command_id = ?
          AND assignment_id = ? AND attempt_id = ? AND session_id = ? AND adapter = ? AND lease_generation = ?
          AND packet_digest = ? AND capability_digest = ? AND expires_at > ?`).run(
        now, now, signal.id, this.userId, input.commandId, input.assignmentId, input.attemptId, input.sessionId,
        input.adapter, input.leaseGeneration, input.packetDigest, input.capabilityDigest, now
      );
      if (claimed.changes !== 1) throw new Error("PORTFOLIO_WORKER_LAUNCH_UNKNOWN");
      const updated = this.getWorkerSignalForCommand(input.commandId) as PortfolioWorkerSignal;
      this.#insertFact({ projectId: updated.projectId, workItemId: updated.workItemId, attemptId: updated.attemptId,
        recordType: "worker_signal", recordId: updated.id, factType: "worker_launch_material_issued",
        payload: { commandId: updated.commandId, leaseGeneration: updated.leaseGeneration, signalType: updated.signalType } });
      return updated;
    });
    return transaction();
  }

  /** Atomically fences a command before any worker, CLI, or tmux side effect. */
  prepareDispatch(input: PortfolioPrepareDispatchInput): PortfolioDispatchPreparation {
    const transaction = this.db.transaction(() => {
      const replay = this.#loadDispatchReplay(input);
      if (replay) return replay;
      return this.#createPreparedDispatch(input);
    });
    return transaction();
  }

  recordWorkerDispatchReceipt(input: {
    commandId: string;
    assignmentId: string;
    expectedCommandProjectionVersion: number;
    receiptDigest: string;
    idempotencyKey: string;
    now?: Date;
  }): { command: PortfolioCommand; attempt: PortfolioTaskAttempt; receiptRecorded: true } {
    const transaction = this.db.transaction(() => {
      const replay = this.#loadWorkerReceiptReplay(input);
      if (replay) return replay;
      const result = this.#recordWorkerDispatchReceipt(input);
      this.db.prepare(`INSERT INTO portfolio_operation_records (id, user_id, operation, idempotency_key, payload_digest, result_json, created_at)
        VALUES (?, ?, 'command.worker_dispatch_receipt', ?, ?, ?, ?)`).run(
        randomUUID(), this.userId, input.idempotencyKey, digestPortfolioValue(this.#receiptPayload(input)),
        JSON.stringify({ commandId: result.command.id }), input.now?.getTime() ?? Date.now()
      );
      return result;
    });
    return transaction();
  }

  recordDispatchReceipt(input: {
    commandId: string;
    assignmentId: string;
    leaseToken: string;
    receiptDigest: string;
    observedAt?: Date;
    expectedProjectionVersion: number;
    idempotencyKey: string;
  }): PortfolioCommand {
    const operation = "command.dispatch_receipt";
    const result = this.db.transaction(() => this.withOperation(operation, input.idempotencyKey, input, () => {
      const command = this.getCommand(input.commandId);
      if (!command || command.assignmentId !== input.assignmentId) throw new Error("PORTFOLIO_COMMAND_NOT_FOUND");
      const assignment = this.getSessionAssignment(input.assignmentId);
      const observedAt = input.observedAt?.getTime() ?? Date.now();
      if (!assignment || !assignment.active || assignment.projectId !== command.projectId || assignment.workItemId !== command.workItemId
        || assignment.attemptId !== command.attemptId || assignment.leaseExpiresAt.getTime() <= observedAt
        || assignment.leaseTokenDigest !== sha256(input.leaseToken)) throw new Error("PORTFOLIO_LEASE_MISMATCH");
      const update = this.db.prepare(`UPDATE portfolio_commands SET state = 'observed', dispatch_receipt_digest = ?, observed_at = ?,
        projection_version = projection_version + 1, updated_at = ?
        WHERE id = ? AND user_id = ? AND projection_version = ? AND state = 'pending'`)
        .run(input.receiptDigest, observedAt, observedAt, command.id, this.userId, input.expectedProjectionVersion);
      if (update.changes !== 1) throw new Error("PORTFOLIO_STATE_CONFLICT");
      this.#insertFact({ projectId: command.projectId, workItemId: command.workItemId, attemptId: command.attemptId, recordType: "task_attempt",
        recordId: command.attemptId, factType: "validated_dispatch_receipt", idempotencyKey: `receipt:${input.idempotencyKey}`,
        payload: { commandId: command.id, assignmentId: assignment.id, receiptDigest: input.receiptDigest, leaseTokenDigest: assignment.leaseTokenDigest } });
      return this.getCommand(command.id) as PortfolioCommand;
    }));
    return result();
  }

  createEvidence(input: {
    id?: string;
    projectId: string;
    workItemId?: string;
    attemptId?: string;
    requestId?: string;
    producer: string;
    sourceCategory: string;
    observedAt: Date;
    collectedAt?: Date;
    digest: string;
    summary: string;
    confidence: string;
    freshness: string;
    isBlocker?: boolean;
    verificationKey?: string;
    idempotencyKey: string;
  }): PortfolioEvidence {
    return this.withOperation("evidence.create", input.idempotencyKey, input, (operationId) => {
      this.requireEnrollment(input.projectId);
      if (input.requestId) {
        const request = this.getRequest(input.requestId);
        // Intake Evidence may establish the candidate project before a Request is routed.
        if (!request || (request.projectId && request.projectId !== input.projectId)) {
          throw new Error("PORTFOLIO_REQUEST_NOT_FOUND");
        }
      }
      const workItem = input.workItemId ? this.requireWorkItem(input.workItemId, input.projectId) : undefined;
      if (input.attemptId) {
        const attempt = this.getTaskAttempt(input.attemptId);
        if (!attempt || attempt.projectId !== input.projectId || (workItem && attempt.workItemId !== workItem.id)) {
          throw new Error("PORTFOLIO_ATTEMPT_NOT_FOUND");
        }
      }
      const id = input.id ?? operationId;
      const now = Date.now();
      const summary = isPortfolioObservationSource(input.sourceCategory)
        ? redactSummary(input.summary).slice(0, 1_024)
        : redactSummary(input.summary);
      this.db.prepare(`INSERT INTO portfolio_evidence (id, user_id, project_id, request_id, work_item_id, attempt_id, producer, source_category,
        observed_at, collected_at, digest, redacted_summary, confidence, freshness, is_blocker, verification_key, idempotency_key, input_digest, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, this.userId, input.projectId, input.requestId ?? null, input.workItemId ?? null, input.attemptId ?? null, input.producer,
          input.sourceCategory, input.observedAt.getTime(), input.collectedAt?.getTime() ?? now, input.digest, summary,
          input.confidence, input.freshness, input.isBlocker ? 1 : 0, input.verificationKey ?? null, input.idempotencyKey, sha256(stableJson(input)), now);
      return this.getEvidence(id) as PortfolioEvidence;
    });
  }

  getEvidence(id: string): PortfolioEvidence | undefined {
    const row = this.db.prepare("SELECT * FROM portfolio_evidence WHERE id = ? AND user_id = ?").get(id, this.userId) as Row | undefined;
    return row ? this.toEvidence(row) : undefined;
  }

  /** Activates only a server-validated root identity and fixed V1 probes. */
  activateObservationProfile(input: {
    projectId: string;
    approvedRoot: ApprovedProjectRootIdentity;
    idempotencyKey: string;
    now?: Date;
  }): PortfolioObservationProfile {
    return this.withOperation("observation_profile.activate", input.idempotencyKey, input, () => {
      this.requireEnrollment(input.projectId);
      const now = (input.now ?? this.clock.now()).getTime();
      const existing = this.db.prepare(`SELECT id FROM portfolio_observation_profiles
        WHERE user_id = ? AND project_id = ?`).get(this.userId, input.projectId) as Row | undefined;
      const id = existing ? stringValue(existing, "id") : randomUUID();
      this.db.prepare(`INSERT INTO portfolio_observation_profiles (id, user_id, project_id, status, approved_root_path, approved_root_device,
        approved_root_inode, projection_version, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?, ?, 1, ?, ?)
        ON CONFLICT(user_id, project_id) DO UPDATE SET status = 'active', approved_root_path = excluded.approved_root_path,
          approved_root_device = excluded.approved_root_device, approved_root_inode = excluded.approved_root_inode,
          projection_version = portfolio_observation_profiles.projection_version + 1, updated_at = excluded.updated_at`)
        .run(id, this.userId, input.projectId, input.approvedRoot.canonicalPath, input.approvedRoot.device, input.approvedRoot.inode, now, now);
      for (const source of portfolioObservationSources) {
        this.db.prepare(`INSERT INTO portfolio_observation_probes (id, user_id, profile_id, source_category, operation, root_ref, arguments_json,
          timeout_ms, max_output_bytes, redaction_policy, freshness_ms, enabled, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'project_root', '{}', 5000, 16384, 'v1', ?, 1, ?, ?)
          ON CONFLICT(user_id, profile_id, operation) DO UPDATE SET source_category = excluded.source_category, root_ref = excluded.root_ref,
            arguments_json = excluded.arguments_json, timeout_ms = excluded.timeout_ms, max_output_bytes = excluded.max_output_bytes,
            redaction_policy = excluded.redaction_policy, freshness_ms = excluded.freshness_ms, enabled = 1, updated_at = excluded.updated_at`)
          .run(randomUUID(), this.userId, id, source, source, source === "platform_lifecycle_v1" ? 300_000 : 900_000, now, now);
      }
      this.#insertFact({ projectId: input.projectId, recordType: "observation_profile", recordId: id, factType: "observation_profile_activated",
        idempotencyKey: `observation-profile:${input.idempotencyKey}`, payload: { sources: portfolioObservationSources } });
      return this.getObservationProfile(input.projectId) as PortfolioObservationProfile;
    });
  }

  getObservationProfile(projectId: string): PortfolioObservationProfile | undefined {
    const row = this.db.prepare(`SELECT * FROM portfolio_observation_profiles WHERE user_id = ? AND project_id = ?`)
      .get(this.userId, projectId) as Row | undefined;
    if (!row) return undefined;
    const device = row.approved_root_device;
    const inode = row.approved_root_inode;
    const path = nullableString(row, "approved_root_path");
    const approvedRoot = typeof device === "number" && typeof inode === "number" && path
      ? { canonicalPath: path, device, inode }
      : null;
    return {
      id: stringValue(row, "id"), projectId: stringValue(row, "project_id"), status: stringValue(row, "status") === "active" ? "active" : "inactive",
      approvedRoot, projectionVersion: numberValue(row, "projection_version"), createdAt: asDate(row.created_at), updatedAt: asDate(row.updated_at)
    };
  }

  getObservationProbe(projectId: string, source: PortfolioObservationSource): PortfolioObservationProbe | undefined {
    const row = this.db.prepare(`SELECT probe.* FROM portfolio_observation_probes probe
      INNER JOIN portfolio_observation_profiles profile ON profile.user_id = probe.user_id AND profile.id = probe.profile_id
      WHERE probe.user_id = ? AND profile.project_id = ? AND probe.source_category = ? AND probe.operation = ?`)
      .get(this.userId, projectId, source, source) as Row | undefined;
    if (!row || stringValue(row, "root_ref") !== "project_root") return undefined;
    return {
      id: stringValue(row, "id"), profileId: stringValue(row, "profile_id"), source: stringValue(row, "source_category") as PortfolioObservationSource,
      enabled: numberValue(row, "enabled") === 1, rootRef: "project_root", timeoutMs: numberValue(row, "timeout_ms"),
      maxOutputBytes: numberValue(row, "max_output_bytes"), freshnessMs: numberValue(row, "freshness_ms"),
      createdAt: asDate(row.created_at), updatedAt: asDate(row.updated_at)
    };
  }

  /** Provides only an active declared V1 probe and its approved root identity. */
  getObservationRequest(projectId: string, source: PortfolioObservationSource): {
    projectRoot: string;
    active: boolean;
    approvedRoot: ApprovedProjectRootIdentity | null;
  } | undefined {
    const row = this.db.prepare(`SELECT project.path, profile.status, profile.approved_root_path, profile.approved_root_device,
      profile.approved_root_inode, probe.enabled
      FROM portfolio_projects enrollment
      INNER JOIN projects project ON project.user_id = enrollment.user_id AND project.id = enrollment.project_id
      INNER JOIN portfolio_observation_profiles profile ON profile.user_id = enrollment.user_id AND profile.project_id = enrollment.project_id
      INNER JOIN portfolio_observation_probes probe ON probe.user_id = profile.user_id AND probe.profile_id = profile.id
      WHERE enrollment.user_id = ? AND enrollment.project_id = ? AND enrollment.enrollment_status = 'active'
        AND probe.source_category = ? AND probe.operation = ? LIMIT 1`)
      .get(this.userId, projectId, source, source) as Row | undefined;
    if (!row) return undefined;
    const approvedPath = nullableString(row, "approved_root_path");
    const device = row.approved_root_device;
    const inode = row.approved_root_inode;
    const approvedRoot = approvedPath && typeof device === "number" && typeof inode === "number"
      ? { canonicalPath: approvedPath, device, inode }
      : null;
    return {
      projectRoot: stringValue(row, "path"),
      active: stringValue(row, "status") === "active" && numberValue(row, "enabled") === 1 && approvedRoot !== null,
      approvedRoot
    };
  }

  /** Platform lifecycle facts are derived only from tenant-scoped persisted state. */
  readPlatformLifecycleSnapshot(projectId: string): Record<string, unknown> {
    const enrollment = this.getEnrollment(projectId);
    const display = this.getDossierDisplay(projectId);
    if (!enrollment || !display) throw new Error("PORTFOLIO_OBSERVATION_PROFILE_INACTIVE");
    const counts = this.db.prepare(`SELECT state, COUNT(*) AS count FROM portfolio_work_items
      WHERE user_id = ? AND project_id = ? GROUP BY state`).all(this.userId, projectId) as Row[];
    return {
      enrollmentStatus: enrollment.enrollmentStatus,
      dossierVersion: display.projectionVersion,
      workItems: Object.fromEntries(counts.map((row) => [stringValue(row, "state"), numberValue(row, "count")]))
    };
  }

  createRiskSignal(input: {
    projectId: string;
    evidenceId?: string;
    workItemId?: string;
    attemptId?: string;
    severity: "low" | "medium" | "high";
    rationale: string;
    idempotencyKey: string;
  }): { id: string; evidenceId: string | null; severity: string; rationale: string; createdAt: Date } {
    return this.withOperation("risk_signal.create", input.idempotencyKey, input, (id) => {
      this.requireEnrollment(input.projectId);
      const evidence = input.evidenceId ? this.getEvidence(input.evidenceId) : undefined;
      if (input.evidenceId && (!evidence || evidence.projectId !== input.projectId)) throw new Error("PORTFOLIO_EVIDENCE_NOT_FOUND");
      const workItem = input.workItemId ? this.requireWorkItem(input.workItemId, input.projectId) : undefined;
      const attempt = input.attemptId ? this.getTaskAttempt(input.attemptId) : undefined;
      if (attempt && (!workItem || attempt.workItemId !== workItem.id || attempt.projectId !== input.projectId)) throw new Error("PORTFOLIO_ATTEMPT_NOT_FOUND");
      const now = Date.now();
      this.db.prepare(`INSERT INTO portfolio_risk_signals (id, user_id, project_id, work_item_id, attempt_id, evidence_id, severity, rationale,
        state, idempotency_key, input_digest, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`)
        .run(id, this.userId, input.projectId, input.workItemId ?? null, input.attemptId ?? null, input.evidenceId ?? null, input.severity,
          redactSummary(input.rationale), input.idempotencyKey, digestPortfolioValue(input), now);
      return { id, evidenceId: input.evidenceId ?? null, severity: input.severity, rationale: redactSummary(input.rationale), createdAt: new Date(now) };
    });
  }

  createCompletionCandidate(input: {
    projectId: string;
    workItemId: string;
    attemptId: string;
    requestId?: string;
    summary: string;
    evidenceIds?: string[];
    idempotencyKey: string;
  }): PortfolioCompletionCandidate {
    return this.withOperation("completion_candidate.create", input.idempotencyKey, input, (id) => {
      if (!input.attemptId.trim()) throw new Error("PORTFOLIO_COMPLETION_ATTEMPT_REQUIRED");
      const workItem = this.requireWorkItem(input.workItemId, input.projectId);
      const requestId = input.requestId ?? workItem.requestId;
      this.requireRequest(requestId, input.projectId);
      if (requestId !== workItem.requestId) throw new Error("PORTFOLIO_COMPLETION_REQUEST_SCOPE_MISMATCH");
      const attempt = this.requireTaskAttempt(input.attemptId, input.projectId, workItem.id);
      if (attempt.requestId !== requestId) throw new Error("PORTFOLIO_COMPLETION_ATTEMPT_SCOPE_MISMATCH");
      const now = Date.now();
      this.db.prepare(`INSERT INTO portfolio_completion_candidates (id, user_id, project_id, request_id, work_item_id, attempt_id, summary,
        evidence_ids_json, state, verified_at, idempotency_key, input_digest, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'candidate', NULL, ?, ?, ?, ?)`)
        .run(id, this.userId, input.projectId, requestId, input.workItemId, input.attemptId, redactSummary(input.summary),
          JSON.stringify(input.evidenceIds ?? []), input.idempotencyKey, sha256(stableJson(input)), now, now);
      return this.getCompletionCandidate(id) as PortfolioCompletionCandidate;
    });
  }

  getCompletionCandidate(id: string): PortfolioCompletionCandidate | undefined {
    const row = this.db.prepare("SELECT * FROM portfolio_completion_candidates WHERE id = ? AND user_id = ?").get(id, this.userId) as Row | undefined;
    return row ? this.toCandidate(row) : undefined;
  }

  #markCompletionCandidateVerified(id: string, expectedProjectionVersion: number, idempotencyKey: string): PortfolioCompletionCandidate {
    const current = this.getCompletionCandidate(id);
    if (!current) throw new Error("PORTFOLIO_CANDIDATE_NOT_FOUND");
    this.#assertCompletionCandidateExecutionBinding(current);
    if (!this.hasCompletionCandidateEvidence(current.id)) throw new Error("PORTFOLIO_COMPLETION_EVIDENCE_INSUFFICIENT");
    return this.withOperation("completion_candidate.verify", idempotencyKey, { id, expectedProjectionVersion }, () => {
      const candidate = this.getCompletionCandidate(id);
      if (!candidate) throw new Error("PORTFOLIO_CANDIDATE_NOT_FOUND");
      const now = Date.now();
      const result = this.db.prepare(`UPDATE portfolio_completion_candidates SET verified_at = ?, projection_version = projection_version + 1, updated_at = ?
        WHERE id = ? AND user_id = ? AND projection_version = ? AND verified_at IS NULL`).run(now, now, id, this.userId, expectedProjectionVersion);
      if (result.changes !== 1) throw new Error("PORTFOLIO_STATE_CONFLICT");
      this.#insertFact({ ...this.factScope(candidate.requestId, candidate.workItemId, candidate.attemptId), projectId: candidate.projectId,
        recordType: "completion_candidate", recordId: candidate.id, factType: "completion_candidate_verified", payload: {} });
      return this.getCompletionCandidate(id) as PortfolioCompletionCandidate;
    });
  }

  createAcceptanceDecision(input: {
    projectId: string;
    workItemId: string;
    attemptId: string;
    requestId?: string;
    candidateId: string;
    decision: string;
    policyRule?: string;
    evidenceIds?: string[];
    idempotencyKey: string;
  }): PortfolioAcceptanceDecision {
    return this.withOperation("acceptance_decision.create", input.idempotencyKey, input, (id) => {
      if (!input.attemptId.trim()) throw new Error("PORTFOLIO_ACCEPTANCE_ATTEMPT_REQUIRED");
      if (!input.candidateId.trim()) throw new Error("PORTFOLIO_ACCEPTANCE_CANDIDATE_REQUIRED");
      const workItem = this.requireWorkItem(input.workItemId, input.projectId);
      const requestId = input.requestId ?? workItem.requestId;
      this.requireRequest(requestId, input.projectId);
      if (requestId !== workItem.requestId) throw new Error("PORTFOLIO_ACCEPTANCE_REQUEST_SCOPE_MISMATCH");
      const attempt = this.requireTaskAttempt(input.attemptId, input.projectId, workItem.id);
      if (attempt.requestId !== requestId) throw new Error("PORTFOLIO_ACCEPTANCE_ATTEMPT_SCOPE_MISMATCH");
      const candidate = this.getCompletionCandidate(input.candidateId);
      if (!candidate) throw new Error("PORTFOLIO_CANDIDATE_NOT_FOUND");
      if (candidate.projectId !== input.projectId || candidate.workItemId !== input.workItemId
        || candidate.requestId !== requestId || candidate.attemptId !== input.attemptId) {
        throw new Error("PORTFOLIO_CANDIDATE_SCOPE_MISMATCH");
      }
      const now = Date.now();
      this.db.prepare(`INSERT INTO portfolio_acceptance_decisions (id, user_id, project_id, request_id, work_item_id, attempt_id, candidate_id,
        decision, policy_rule, evidence_ids_json, state, idempotency_key, input_digest, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, this.userId, input.projectId, requestId, input.workItemId, input.attemptId, input.candidateId,
          input.decision, input.policyRule ?? null, JSON.stringify(input.evidenceIds ?? []), "candidate", input.idempotencyKey,
          sha256(stableJson(input)), now, now);
      return this.getAcceptanceDecision(id) as PortfolioAcceptanceDecision;
    });
  }

  getAcceptanceDecision(id: string): PortfolioAcceptanceDecision | undefined {
    const row = this.db.prepare("SELECT * FROM portfolio_acceptance_decisions WHERE id = ? AND user_id = ?").get(id, this.userId) as Row | undefined;
    return row ? this.toAcceptanceDecision(row) : undefined;
  }

  createWorkflowWakeup(input: {
    projectId: string;
    workItemId: string;
    attemptId: string;
    reasonClass: string;
    dueAt: Date;
    coalescingKey: string;
    maxAttempts: number;
    idempotencyKey: string;
  }): PortfolioWorkflowWakeup {
    void input;
    throw new Error("PORTFOLIO_WAKEUP_SCHEDULER_REQUIRED");
  }

  getWorkflowWakeup(id: string): PortfolioWorkflowWakeup | undefined {
    const row = this.db.prepare("SELECT * FROM portfolio_workflow_wakeups WHERE id = ? AND user_id = ?").get(id, this.userId) as Row | undefined;
    return row ? this.toWakeup(row) : undefined;
  }

  listFacts(input: { projectId: string; workItemId?: string; recordId?: string; limit?: number }): PortfolioFact[] {
    this.requireEnrollment(input.projectId);
    const clauses = ["user_id = ?", "project_id = ?"];
    const values: unknown[] = [this.userId, input.projectId];
    if (input.workItemId) { clauses.push("work_item_id = ?"); values.push(input.workItemId); }
    if (input.recordId) { clauses.push("record_id = ?"); values.push(input.recordId); }
    values.push(Math.min(Math.max(input.limit ?? 100, 1), 500));
    const rows = this.db.prepare(`SELECT * FROM portfolio_facts WHERE ${clauses.join(" AND ")} ORDER BY created_at, id LIMIT ?`).all(...values) as Row[];
    return rows.map((row) => this.toFact(row));
  }

  getStateRecord(recordType: PortfolioStateRecordType, recordId: string): StateRecordRow | undefined {
    const table = stateTables[recordType];
    return this.db.prepare(`SELECT * FROM ${table} WHERE id = ? AND user_id = ?`).get(recordId, this.userId) as StateRecordRow | undefined;
  }

  #applyStateTransition(input: PortfolioStateTransitionCommit): PortfolioStateTransitionResult {
    if (input.recordType === "wakeup") throw new Error("PORTFOLIO_WAKEUP_SCHEDULER_REQUIRED");
    const operation = `state_transition.${input.recordType}`;
    const transaction = this.db.transaction(() => this.withOperation(operation, input.idempotencyKey, this.stateOperationPayload(input), () => {
      const current = this.getStateRecord(input.recordType, input.recordId);
      if (!current) throw new Error("PORTFOLIO_RECORD_NOT_FOUND");
      if (current.state !== input.fromState || current.projection_version !== input.expectedProjectionVersion) throw new Error("PORTFOLIO_STATE_CONFLICT");
      const now = input.now?.getTime() ?? Date.now();
      const consumption = input.recordType === "authorization" && input.toState === "consumed" ? ", consumed_at = ?" : "";
      const updated = this.db.prepare(`UPDATE ${stateTables[input.recordType]} SET state = ?, projection_version = projection_version + 1,
        updated_at = ?${consumption}
        WHERE id = ? AND user_id = ? AND state = ? AND projection_version = ?`)
        .run(input.toState, now, ...(consumption ? [now] : []), input.recordId, this.userId, input.fromState, input.expectedProjectionVersion);
      if (updated.changes !== 1) throw new Error("PORTFOLIO_STATE_CONFLICT");
      const factRequestId = input.recordType === "request" ? current.id : current.request_id ?? null;
      const factWorkItemId = input.recordType === "work_item" ? current.id : current.work_item_id ?? null;
      const factAttemptId = input.recordType === "task_attempt" ? current.id : current.attempt_id ?? null;
      this.#insertFact({ ...this.factScope(factRequestId, factWorkItemId, factAttemptId, input.correlationId), projectId: current.project_id ?? undefined,
        recordType: input.recordType, recordId: input.recordId, factType: "state_transition",
        idempotencyKey: `transition-fact:${input.idempotencyKey}`, payload: { fromState: input.fromState, toState: input.toState, actorId: input.actorId } });
      return { recordType: input.recordType, recordId: input.recordId, fromState: input.fromState, toState: input.toState,
        projectionVersion: input.expectedProjectionVersion + 1 };
    }));
    return transaction();
  }

  getStateTransitionReplay(input: {
    recordType: PortfolioStateRecordType;
    recordId: string;
    toState: string;
    actorId: string;
    attemptId?: string;
    expectedProjectionVersion: number;
    idempotencyKey: string;
    correlationId?: string;
  }): PortfolioStateTransitionResult | undefined {
    const operation = `state_transition.${input.recordType}`;
    const row = this.db.prepare(`SELECT payload_digest, result_json FROM portfolio_operation_records
      WHERE user_id = ? AND operation = ? AND idempotency_key = ?`).get(this.userId, operation, input.idempotencyKey) as Row | undefined;
    if (!row) return undefined;
    if (stringValue(row, "payload_digest") !== sha256(stableJson(this.stateOperationPayload(input)))) {
      throw new Error("PORTFOLIO_IDEMPOTENCY_CONFLICT");
    }
    const result = parseObject(row.result_json);
    if (typeof result.recordType !== "string" || typeof result.recordId !== "string" || typeof result.fromState !== "string"
      || typeof result.toState !== "string" || typeof result.projectionVersion !== "number") throw new Error("PORTFOLIO_IDEMPOTENCY_RESULT_INVALID");
    return isStateTransitionResult(result) ? result : (() => { throw new Error("PORTFOLIO_IDEMPOTENCY_RESULT_INVALID"); })();
  }

  hasObservedDispatchReceipt(workItemId: string, attemptId: string): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM portfolio_commands AS command JOIN portfolio_session_assignments AS assignment
      ON assignment.id = command.assignment_id AND assignment.user_id = command.user_id
      JOIN portfolio_facts AS fact ON fact.user_id = command.user_id AND fact.work_item_id = command.work_item_id
        AND fact.attempt_id = command.attempt_id AND fact.fact_type = 'validated_dispatch_receipt'
      WHERE command.user_id = ? AND command.work_item_id = ? AND command.state = 'observed'
        AND assignment.project_id = command.project_id AND assignment.work_item_id = command.work_item_id AND assignment.attempt_id = command.attempt_id
        AND command.attempt_id = ? LIMIT 1`).get(this.userId, workItemId, attemptId));
  }

  hasObservedDispatchReceiptSinceLastBlock(workItemId: string, attemptId: string): boolean {
    const blocked = this.db.prepare(`SELECT created_at FROM portfolio_facts WHERE user_id = ? AND work_item_id = ?
      AND fact_type = 'state_transition' AND json_extract(payload_json, '$.toState') = 'blocked' ORDER BY created_at DESC, id DESC LIMIT 1`)
      .get(this.userId, workItemId) as { created_at: number } | undefined;
    if (!blocked) return this.hasObservedDispatchReceipt(workItemId, attemptId);
    return Boolean(this.db.prepare(`SELECT 1 FROM portfolio_facts WHERE user_id = ? AND work_item_id = ? AND fact_type = 'validated_dispatch_receipt'
      AND created_at > ? AND attempt_id = ? LIMIT 1`).get(this.userId, workItemId, blocked.created_at, attemptId));
  }

  hasFollowUpTaskAttempt(workItemId: string): boolean {
    const row = this.db.prepare(`SELECT MAX(attempt_number) AS latest_attempt FROM portfolio_task_attempts
      WHERE user_id = ? AND work_item_id = ?`).get(this.userId, workItemId) as { latest_attempt: number | null };
    const reviewed = this.db.prepare(`SELECT MAX(attempt.attempt_number) AS reviewed_attempt
      FROM portfolio_completion_candidates AS candidate
      JOIN portfolio_task_attempts AS attempt ON attempt.id = candidate.attempt_id AND attempt.user_id = candidate.user_id
      WHERE candidate.user_id = ? AND candidate.work_item_id = ? AND candidate.verified_at IS NOT NULL`).get(this.userId, workItemId) as { reviewed_attempt: number | null };
    const baseline = reviewed.reviewed_attempt ?? 1;
    return (row.latest_attempt ?? 0) > baseline;
  }

  hasBlockerEvidence(workItemId: string): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM portfolio_evidence WHERE user_id = ? AND work_item_id = ? AND is_blocker = 1 LIMIT 1`)
      .get(this.userId, workItemId));
  }

  hasVerifiedCompletionCandidate(workItemId: string, attemptId?: string): boolean {
    const rows = this.db.prepare(`SELECT id FROM portfolio_completion_candidates WHERE user_id = ? AND work_item_id = ?
      AND verified_at IS NOT NULL${attemptId ? " AND attempt_id = ?" : ""}`)
      .all(this.userId, workItemId, ...(attemptId ? [attemptId] : [])) as Array<{ id: string }>;
    return rows.some((row) => this.hasCompletionCandidateEvidence(row.id));
  }

  hasRequiredVerificationEvidence(workItemId: string, requirements: string[]): boolean {
    if (requirements.length === 0) return true;
    const workItem = this.getWorkItem(workItemId);
    if (!workItem) return false;
    const rows = this.db.prepare(`SELECT * FROM portfolio_evidence WHERE user_id = ? AND work_item_id = ?
      AND verification_key IS NOT NULL`).all(this.userId, workItemId) as Row[];
    const currentEvidenceIds = this.#effectiveCurrentEvidenceIds(workItem.projectId, this.clock.now());
    const seen = new Set(rows.map((row) => this.toEvidence(row))
      .filter((evidence) => currentEvidenceIds.has(evidence.id))
      .map((evidence) => evidence.verificationKey).filter((key): key is string => key !== null));
    return requirements.every((requirement) => seen.has(requirement));
  }

  hasAcceptedDecision(workItemId: string, attemptId?: string): boolean {
    const rows = this.db.prepare(`SELECT id FROM portfolio_acceptance_decisions WHERE user_id = ? AND work_item_id = ?
      AND state = 'accepted' AND decision = 'accepted' AND policy_rule IS NOT NULL${attemptId ? " AND attempt_id = ?" : ""}`)
      .all(this.userId, workItemId, ...(attemptId ? [attemptId] : [])) as Array<{ id: string }>;
    return rows.some((row) => {
      const decision = this.getAcceptanceDecision(row.id);
      const candidate = decision ? this.getCompletionCandidate(decision.candidateId) : undefined;
      const workItem = candidate ? this.getWorkItem(candidate.workItemId) : undefined;
      return Boolean(decision && candidate && workItem && candidate.verifiedAt
        && this.#isAcceptanceDecisionExecutionBound(decision, candidate, workItem)
        && this.#hasCandidateRequirements(candidate, workItem, decision.evidenceIds));
    });
  }

  hasTrustedCandidateEvidence(candidateId: string): boolean {
    return this.hasCompletionCandidateEvidence(candidateId);
  }

  hasCompletionCandidateEvidence(candidateId: string): boolean {
    const candidate = this.getCompletionCandidate(candidateId);
    const workItem = candidate ? this.getWorkItem(candidate.workItemId) : undefined;
    if (!candidate || !workItem || !this.#isCompletionCandidateExecutionBound(candidate, workItem)) return false;
    return this.#hasCandidateRequirements(candidate, workItem, candidate.evidenceIds);
  }

  canAcceptDecision(decisionId: string, actorId: string): boolean {
    const decision = this.getAcceptanceDecision(decisionId);
    const candidate = decision ? this.getCompletionCandidate(decision.candidateId) : undefined;
    const workItem = candidate ? this.getWorkItem(candidate.workItemId) : undefined;
    if (!decision || !candidate || !workItem || workItem.ownerUserId !== actorId || decision.decision !== "accepted"
      || !decision.policyRule || !candidate.verifiedAt || !this.#isAcceptanceDecisionExecutionBound(decision, candidate, workItem)) return false;
    return this.#hasCandidateRequirements(candidate, workItem, decision.evidenceIds);
  }

  private withOperation<T>(operation: string, idempotencyKey: string, payload: unknown, create: (id: string) => T): T {
    const transaction = this.db.transaction(() => this.withOperationInTransaction(operation, idempotencyKey, payload, create));
    return transaction();
  }

  private withOperationInTransaction<T>(operation: string, idempotencyKey: string, payload: unknown, create: (id: string) => T): T {
    const digest = sha256(stableJson(payload));
    const existing = this.db.prepare(`SELECT payload_digest, result_json FROM portfolio_operation_records
      WHERE user_id = ? AND operation = ? AND idempotency_key = ?`).get(this.userId, operation, idempotencyKey) as Row | undefined;
    if (existing) {
      if (stringValue(existing, "payload_digest") !== digest) throw new Error("PORTFOLIO_IDEMPOTENCY_CONFLICT");
      const result = parseObject(existing.result_json);
      if (operation.startsWith("state_transition.")) return result as T;
      const id = result.id;
      if (typeof id !== "string") throw new Error("PORTFOLIO_IDEMPOTENCY_RESULT_INVALID");
      return this.loadOperationResult<T>(operation, id, result);
    }
    const id = randomUUID();
    const created = create(id);
    const createdRecord = asRecord(created);
    const createdId = typeof createdRecord.id === "string" ? createdRecord.id : createdRecord.projectId;
    const storedResult = operation.startsWith("state_transition.")
      ? created
      : { id: typeof createdId === "string" ? createdId : id };
    try {
      this.db.prepare(`INSERT INTO portfolio_operation_records (id, user_id, operation, idempotency_key, payload_digest, result_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), this.userId, operation, idempotencyKey, digest, JSON.stringify(storedResult), Date.now());
    } catch (error) {
      if (!isUniqueViolation(error, "portfolio_operation_records")) throw error;
      const replay = this.db.prepare(`SELECT payload_digest, result_json FROM portfolio_operation_records
        WHERE user_id = ? AND operation = ? AND idempotency_key = ?`).get(this.userId, operation, idempotencyKey) as Row | undefined;
      if (!replay || stringValue(replay, "payload_digest") !== digest) throw new Error("PORTFOLIO_IDEMPOTENCY_CONFLICT");
      const result = parseObject(replay.result_json);
      if (operation.startsWith("state_transition.")) return result as T;
      const replayId = result.id;
      if (typeof replayId !== "string") throw new Error("PORTFOLIO_IDEMPOTENCY_RESULT_INVALID");
      return this.loadOperationResult<T>(operation, replayId, result);
    }
    return created;
  }

  private loadOperationResult<T>(operation: string, id: string, fallback: Record<string, unknown>): T {
    const entity = operation.split(".")[0] ?? "";
    const loaders: Record<string, (value: string) => unknown> = {
      project_enrollment: (value) => this.getEnrollment(value),
      dossier: (value) => this.#getDossierById(value),
      request: (value) => this.getRequest(value),
      intake_decision: (value) => this.getIntakeDecision(value),
      work_item: (value) => this.getWorkItem(value),
      task_packet: (value) => this.getTaskPacket(value),
      task_attempt: (value) => this.getTaskAttempt(value),
      action_intent: (value) => this.getActionIntent(value),
      authorization: (value) => this.getAuthorization(value),
      command: (value) => this.getCommand(value),
      evidence: (value) => this.getEvidence(value),
      completion_candidate: (value) => this.getCompletionCandidate(value),
      acceptance_decision: (value) => this.getAcceptanceDecision(value),
      workflow_wakeup: (value) => this.getWorkflowWakeup(value),
      state_transition: () => fallback
    };
    const loader = loaders[entity];
    if (!loader) throw new Error("PORTFOLIO_IDEMPOTENCY_RESULT_NOT_FOUND");
    const loaded = loader(id);
    if (loaded === undefined || loaded === null) throw new Error("PORTFOLIO_IDEMPOTENCY_RESULT_NOT_FOUND");
    return loaded as T;
  }

  #insertIntakeDecision(input: {
    id: string;
    requestId: string;
    selectedProjectId?: string;
    candidateProjectIds: string[];
    scopeAssessment: string;
    producer: string;
    evidenceIds: string[];
    state: PortfolioIntakeDecisionState;
    idempotencyKey: string;
  }): PortfolioIntakeDecision {
    const request = this.getRequest(input.requestId);
    if (!request) throw new Error("PORTFOLIO_REQUEST_NOT_FOUND");
    const candidateProjectIds = [...new Set(input.candidateProjectIds)];
    const evidenceIds = [...new Set(input.evidenceIds)];
    const now = Date.now();
    this.db.prepare(`INSERT INTO portfolio_intake_decisions (id, user_id, request_id, selected_project_id, candidate_project_ids_json,
      scope_assessment, producer, evidence_ids_json, state, idempotency_key, input_digest, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(input.id, this.userId, input.requestId, input.selectedProjectId ?? null, JSON.stringify(candidateProjectIds), input.scopeAssessment,
        input.producer, JSON.stringify(evidenceIds), input.state, input.idempotencyKey, sha256(stableJson(input)), now, now);
    this.#insertFact({ ...(request.projectId ? { projectId: request.projectId } : {}), requestId: input.requestId,
      recordType: "intake_decision", recordId: input.id, factType: "intake_decision_recorded",
      correlationId: request.correlationId, idempotencyKey: `intake-decision:${input.idempotencyKey}`,
      payload: { candidateProjectCount: candidateProjectIds.length, selectedProjectId: input.selectedProjectId ?? null,
        scopeAssessment: input.scopeAssessment, producer: input.producer, state: input.state, evidenceCount: evidenceIds.length } });
    return this.getIntakeDecision(input.id) as PortfolioIntakeDecision;
  }

  #assertCurrentRequestEvidence(request: PortfolioRequest, projectId: string, evidenceIds: string[]): void {
    const uniqueEvidenceIds = [...new Set(evidenceIds)];
    if (uniqueEvidenceIds.length === 0) throw new Error("PORTFOLIO_INTAKE_EVIDENCE_REQUIRED");
    const currentEvidenceIds = this.#effectiveCurrentEvidenceIds(projectId, this.clock.now());
    for (const evidenceId of uniqueEvidenceIds) {
      const evidence = this.getEvidence(evidenceId);
      if (!evidence || evidence.projectId !== projectId || evidence.requestId !== request.id || !currentEvidenceIds.has(evidence.id)) {
        throw new Error("PORTFOLIO_INTAKE_EVIDENCE_INVALID");
      }
    }
  }

  #prepareProjectEnrollment(input: {
    projectId: string;
    objective: string;
    intendedOutcome: string;
    scopeJson?: Record<string, unknown>;
    idempotencyKey: string;
  }): void {
    this.requireOwnedProject(input.projectId);
    if (this.getEnrollment(input.projectId)) throw new Error("PORTFOLIO_ENROLLMENT_ALREADY_EXISTS");
    const now = Date.now();
    this.db.prepare(`INSERT INTO portfolio_projects (project_id, user_id, owner_user_id, enrollment_status, created_at, updated_at)
      VALUES (?, ?, ?, 'pending_evidence', ?, ?)`).run(input.projectId, this.userId, this.userId, now, now);
    this.db.prepare(`INSERT INTO portfolio_project_dossiers (id, user_id, project_id, objective, intended_outcome, scope_json, observed_state_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, '{"status":"pending_evidence"}', ?, ?)`).run(
      randomUUID(), this.userId, input.projectId, input.objective, input.intendedOutcome, JSON.stringify(input.scopeJson ?? {}), now, now
    );
    this.#insertFact({ projectId: input.projectId, recordType: "project_enrollment", recordId: input.projectId,
      factType: "project_enrollment_prepared", idempotencyKey: `project-enrollment:${input.idempotencyKey}`,
      payload: { ownerUserId: this.userId, enrollmentStatus: "pending_evidence" } });
  }

  #insertEnrollmentEvidence(projectId: string, evidence: PortfolioEnrollmentEvidenceInput, enrollmentKey: string): void {
    if (!evidence.id.trim() || !evidence.producer.trim() || !evidence.sourceCategory.trim()
      || !evidence.digest.trim() || !evidence.summary.trim() || !Number.isFinite(evidence.observedAt.getTime())) {
      throw new Error("PORTFOLIO_ENROLLMENT_EVIDENCE_INVALID");
    }
    const now = Date.now();
    this.db.prepare(`INSERT INTO portfolio_evidence (id, user_id, project_id, request_id, work_item_id, attempt_id, producer, source_category,
      observed_at, collected_at, digest, redacted_summary, confidence, freshness, is_blocker, verification_key, idempotency_key, input_digest, created_at)
      VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)`)
      .run(evidence.id, this.userId, projectId, evidence.producer, evidence.sourceCategory, evidence.observedAt.getTime(), now,
        evidence.digest, redactSummary(evidence.summary), evidence.confidence, evidence.freshness,
        `enrollment-evidence:${enrollmentKey}:${evidence.id}`, sha256(stableJson(evidence)), now);
  }

  #activateProjectEnrollment(input: {
    projectId: string;
    objective: string;
    intendedOutcome: string;
    scopeJson?: Record<string, unknown>;
    observedState: Record<string, unknown>;
    evidenceIds: string[];
    idempotencyKey: string;
  }): void {
    const enrollment = this.getEnrollment(input.projectId);
    const dossier = this.#findDossier(input.projectId);
    if (!enrollment || !dossier || enrollment.enrollmentStatus !== "pending_evidence") {
      throw new Error("PORTFOLIO_ENROLLMENT_STATE_CONFLICT");
    }
    this.#assertObservedStateContent(input.observedState);
    this.assertCurrentProjectEvidence(input.projectId, input.evidenceIds);
    const now = Date.now();
    const observedState = { ...input.observedState, evidenceIds: [...new Set(input.evidenceIds)] };
    const updated = this.db.prepare(`UPDATE portfolio_project_dossiers SET objective = ?, intended_outcome = ?, scope_json = ?,
      observed_state_json = ?, projection_version = projection_version + 1, updated_at = ?
      WHERE project_id = ? AND user_id = ? AND projection_version = ?`)
      .run(input.objective, input.intendedOutcome, JSON.stringify(input.scopeJson ?? {}), JSON.stringify(observedState), now,
        input.projectId, this.userId, numberValue(dossier, "projection_version"));
    if (updated.changes !== 1) throw new Error("PORTFOLIO_STATE_CONFLICT");
    const activated = this.db.prepare(`UPDATE portfolio_projects SET enrollment_status = 'active', updated_at = ?
      WHERE project_id = ? AND user_id = ? AND enrollment_status = 'pending_evidence'`).run(now, input.projectId, this.userId);
    if (activated.changes !== 1) throw new Error("PORTFOLIO_ENROLLMENT_STATE_CONFLICT");
    this.#insertFact({ projectId: input.projectId, recordType: "project_enrollment", recordId: input.projectId,
      factType: "project_enrolled", idempotencyKey: `project-enrollment-activate:${input.idempotencyKey}`,
      payload: { ownerUserId: enrollment.ownerUserId, evidenceCount: input.evidenceIds.length } });
  }

  #findDossier(projectId: string): Row | undefined {
    return this.db.prepare(`SELECT dossier.*, project.owner_user_id
      FROM portfolio_project_dossiers dossier
      INNER JOIN portfolio_projects project ON project.user_id = dossier.user_id AND project.project_id = dossier.project_id
      WHERE dossier.project_id = ? AND dossier.user_id = ?`).get(projectId, this.userId) as Row | undefined;
  }

  #hasCurrentDossierEvidence(dossier: PortfolioDossier, currentEvidence: PortfolioEvidence[]): boolean {
    if (!hasObservedStateContent(dossier.observedState) || currentEvidence.length === 0) return false;
    return this.#dossierEvidenceIds(dossier.observedState).every((id) => currentEvidence.some((evidence) => evidence.id === id));
  }

  #dossierEvidenceIds(observedState: Record<string, unknown>): string[] {
    const evidenceIds = observedState.evidenceIds;
    return Array.isArray(evidenceIds) ? evidenceIds.filter((id): id is string => typeof id === "string") : [];
  }

  #dossierSourceDisplay(projectId: string, source: PortfolioObservationSource): PortfolioDossierSourceDisplay {
    const row = this.db.prepare(`SELECT * FROM portfolio_evidence
      WHERE user_id = ? AND project_id = ? AND source_category = ?
      ORDER BY observed_at DESC, collected_at DESC, created_at DESC, id DESC LIMIT 1`).get(this.userId, projectId, source) as Row | undefined;
    const evidence = row ? this.toEvidence(row) : null;
    return { source, status: this.#displayStatus(evidence), evidence };
  }

  #displayStatus(evidence: PortfolioEvidence | null): PortfolioDossierDisplayStatus {
    if (!evidence) return "unknown";
    if (evidence.freshness === "fresh" || evidence.freshness === "stale" || evidence.freshness === "unknown"
      || evidence.freshness === "timeout" || evidence.freshness === "failed") return evidence.freshness;
    return "unknown";
  }

  /** Returns the single collection all project-level current-evidence gates authorize. */
  #effectiveCurrentEvidence(projectId: string, now: Date): PortfolioEvidence[] {
    const rows = this.db.prepare(`SELECT * FROM portfolio_evidence WHERE user_id = ? AND project_id = ?
      ORDER BY observed_at DESC, collected_at DESC, created_at DESC, id DESC`).all(this.userId, projectId) as Row[];
    const latestObservationSources = new Set<PortfolioObservationSource>();
    return rows.map((row) => this.toEvidence(row)).filter((evidence) => {
      if (isPortfolioObservationSource(evidence.sourceCategory)) {
        // A newer failed V1 result must invalidate, rather than reveal, an older fresh fact.
        if (latestObservationSources.has(evidence.sourceCategory)) return false;
        latestObservationSources.add(evidence.sourceCategory);
      }
      return isCurrentPortfolioEvidence(evidence, now);
    });
  }

  #effectiveCurrentEvidenceIds(projectId: string, now: Date): ReadonlySet<string> {
    return new Set(this.#effectiveCurrentEvidence(projectId, now).map((evidence) => evidence.id));
  }

  #assertObservedStateContent(observedState: unknown): void {
    if (!hasObservedStateContent(observedState)) throw new Error("PORTFOLIO_OBSERVED_STATE_REQUIRED");
  }

  #hasCandidateRequirements(candidate: PortfolioCompletionCandidate, workItem: PortfolioWorkItem, evidenceIds: string[]): boolean {
    if (!this.#isCompletionCandidateExecutionBound(candidate, workItem)) return false;
    const requiredKeys = [
      ...workItem.acceptanceCriteria.map((criterion) => acceptanceEvidenceKey(criterion)),
      ...workItem.verificationRequirements.map((requirement) => verificationEvidenceKey(requirement))
    ];
    if (requiredKeys.length === 0) return false;
    const expectedRequestId = candidate.requestId;
    const currentEvidenceIds = this.#effectiveCurrentEvidenceIds(candidate.projectId, this.clock.now());
    return requiredKeys.every((key) => evidenceIds.some((id) => this.#isCandidateEvidenceForKey(
      id, candidate, expectedRequestId, key, currentEvidenceIds
    )));
  }

  #isCandidateEvidenceForKey(
    evidenceId: string,
    candidate: PortfolioCompletionCandidate,
    requestId: string,
    key: string,
    currentEvidenceIds: ReadonlySet<string>
  ): boolean {
    const evidence = this.getEvidence(evidenceId);
    if (!evidence || evidence.projectId !== candidate.projectId || evidence.workItemId !== candidate.workItemId || evidence.requestId !== requestId
      || evidence.verificationKey !== key || evidence.confidence !== "trusted_platform" || !currentEvidenceIds.has(evidence.id)
      || !this.#isTraceableEvidence(evidence)) return false;
    return evidence.attemptId === candidate.attemptId;
  }

  #assertCompletionCandidateExecutionBinding(candidate: PortfolioCompletionCandidate): void {
    const workItem = this.getWorkItem(candidate.workItemId);
    if (!candidate.attemptId) throw new Error("PORTFOLIO_COMPLETION_ATTEMPT_REQUIRED");
    if (!candidate.requestId) throw new Error("PORTFOLIO_COMPLETION_REQUEST_REQUIRED");
    if (!workItem || candidate.projectId !== workItem.projectId || candidate.requestId !== workItem.requestId) {
      throw new Error("PORTFOLIO_COMPLETION_CANDIDATE_SCOPE_MISMATCH");
    }
    const attempt = this.getTaskAttempt(candidate.attemptId);
    if (!attempt || attempt.projectId !== candidate.projectId || attempt.workItemId !== candidate.workItemId
      || attempt.requestId !== candidate.requestId) throw new Error("PORTFOLIO_COMPLETION_ATTEMPT_SCOPE_MISMATCH");
  }

  #isCompletionCandidateExecutionBound(candidate: PortfolioCompletionCandidate, workItem: PortfolioWorkItem): boolean {
    if (!candidate.attemptId || !candidate.requestId || candidate.projectId !== workItem.projectId || candidate.requestId !== workItem.requestId) return false;
    const attempt = this.getTaskAttempt(candidate.attemptId);
    return Boolean(attempt && attempt.projectId === candidate.projectId && attempt.workItemId === candidate.workItemId
      && attempt.requestId === candidate.requestId);
  }

  #isAcceptanceDecisionExecutionBound(
    decision: PortfolioAcceptanceDecision,
    candidate: PortfolioCompletionCandidate,
    workItem: PortfolioWorkItem
  ): boolean {
    return decision.projectId === candidate.projectId && decision.workItemId === candidate.workItemId
      && decision.requestId === candidate.requestId && decision.requestId === workItem.requestId
      && decision.attemptId === candidate.attemptId && decision.candidateId === candidate.id
      && this.#isCompletionCandidateExecutionBound(candidate, workItem);
  }

  /** Completion evidence needs an attributable producer and immutable observation digest. */
  #isTraceableEvidence(evidence: PortfolioEvidence): boolean {
    return evidence.producer.trim().length > 0 && evidence.sourceCategory.trim().length > 0
      && evidence.digest.trim().length > 0 && evidence.redactedSummary.trim().length > 0
      && Number.isFinite(evidence.observedAt.getTime()) && Number.isFinite(evidence.collectedAt.getTime());
  }

  /** Only aggregate paths may append redacted ledger facts. */
  #insertFact(input: {
    id?: string;
    projectId?: string;
    requestId?: string;
    workItemId?: string;
    attemptId?: string;
    recordType: string;
    recordId: string;
    factType: string;
    correlationId?: string;
    idempotencyKey?: string;
    payload: Record<string, unknown>;
  }): PortfolioFact {
    // Request-only facts can intentionally remain outside a project, but a work item
    // or attempt is meaningful only inside its exact project/work-item chain.
    if (input.workItemId && !input.projectId) throw new Error("PORTFOLIO_FACT_SCOPE_MISMATCH");
    if (input.attemptId && (!input.projectId || !input.workItemId)) throw new Error("PORTFOLIO_FACT_SCOPE_MISMATCH");
    if (input.projectId) {
      const preparedEnrollmentFact = input.recordType === "project_enrollment" && input.factType === "project_enrollment_prepared";
      if (preparedEnrollmentFact) {
        if (!this.getEnrollment(input.projectId)) throw new Error("PORTFOLIO_PROJECT_NOT_FOUND");
      } else {
        this.requireEnrollment(input.projectId);
      }
    }
    if (input.requestId) { const request = this.getRequest(input.requestId); if (!request || request.projectId !== (input.projectId ?? null)) throw new Error("PORTFOLIO_REQUEST_NOT_FOUND"); }
    const workItem = input.workItemId ? this.requireWorkItem(input.workItemId, input.projectId as string) : undefined;
    if (input.attemptId) {
      const attempt = this.getTaskAttempt(input.attemptId);
      if (!attempt || attempt.projectId !== input.projectId || (workItem && attempt.workItemId !== workItem.id)) {
        throw new Error("PORTFOLIO_ATTEMPT_NOT_FOUND");
      }
    }
    const id = input.id ?? randomUUID();
    const safePayload = asRecord(redactAuditValue(input.payload));
    const createdAt = Math.max(Date.now(), this.lastFactCreatedAt + 1);
    this.lastFactCreatedAt = createdAt;
    this.db.prepare(`INSERT INTO portfolio_facts (id, user_id, project_id, request_id, work_item_id, attempt_id, record_type, record_id,
      fact_type, correlation_id, idempotency_key, payload_json, payload_digest, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, this.userId, input.projectId, input.requestId ?? null, input.workItemId ?? null, input.attemptId ?? null, input.recordType,
        input.recordId, input.factType, input.correlationId ?? null, input.idempotencyKey ?? null, JSON.stringify(safePayload), sha256(stableJson(safePayload)), createdAt);
    return this.#getFact(id) as PortfolioFact;
  }

  #getFact(id: string): PortfolioFact | undefined {
    const row = this.db.prepare("SELECT * FROM portfolio_facts WHERE id = ? AND user_id = ?").get(id, this.userId) as Row | undefined;
    return row ? this.toFact(row) : undefined;
  }

  private requireOwnedProject(projectId: string): void {
    const row = this.db.prepare("SELECT id FROM projects WHERE id = ? AND user_id = ?").get(projectId, this.userId);
    if (!row) throw new Error("PORTFOLIO_PROJECT_NOT_FOUND");
  }

  private requireEnrollment(projectId: string): PortfolioProjectEnrollment {
    const enrollment = this.getEnrollment(projectId);
    if (!enrollment || enrollment.enrollmentStatus !== "active") throw new Error("PORTFOLIO_PROJECT_NOT_FOUND");
    return enrollment;
  }

  private requireWorkItem(workItemId: string, projectId: string): PortfolioWorkItem {
    const workItem = this.getWorkItem(workItemId);
    if (!workItem || workItem.projectId !== projectId) throw new Error("PORTFOLIO_WORK_ITEM_NOT_FOUND");
    return workItem;
  }

  private requireRequest(requestId: string, projectId: string): PortfolioRequest {
    const request = this.getRequest(requestId);
    if (!request || request.projectId !== projectId) throw new Error("PORTFOLIO_REQUEST_NOT_FOUND");
    return request;
  }

  private requireAcceptedRequestIntake(requestId: string, projectId: string): PortfolioRequest {
    const request = this.requireRequest(requestId, projectId);
    if (request.state !== "accepted") throw new Error("PORTFOLIO_REQUEST_INTAKE_NOT_ACCEPTED");
    const decision = this.db.prepare(`SELECT id FROM portfolio_intake_decisions
      WHERE user_id = ? AND request_id = ? AND selected_project_id = ? AND state = 'accepted'
      ORDER BY created_at DESC, id DESC LIMIT 1`).get(this.userId, requestId, projectId);
    if (!decision) throw new Error("PORTFOLIO_REQUEST_INTAKE_NOT_ACCEPTED");
    return request;
  }

  private assertCurrentProjectEvidence(projectId: string, evidenceIds: string[]): void {
    const uniqueEvidenceIds = [...new Set(evidenceIds)];
    if (uniqueEvidenceIds.length === 0) throw new Error("PORTFOLIO_ENROLLMENT_EVIDENCE_REQUIRED");
    const currentEvidenceIds = this.#effectiveCurrentEvidenceIds(projectId, this.clock.now());
    for (const evidenceId of uniqueEvidenceIds) {
      const evidence = this.getEvidence(evidenceId);
      if (!evidence || evidence.projectId !== projectId || !currentEvidenceIds.has(evidence.id)) {
        throw new Error("PORTFOLIO_ENROLLMENT_EVIDENCE_INVALID");
      }
    }
  }

  private requireTaskAttempt(attemptId: string, projectId: string, workItemId: string): PortfolioTaskAttempt {
    const attempt = this.getTaskAttempt(attemptId);
    if (!attempt || attempt.projectId !== projectId || attempt.workItemId !== workItemId) throw new Error("PORTFOLIO_ATTEMPT_NOT_FOUND");
    return attempt;
  }

  private requireOwnedSession(sessionId: string, projectId: string): void {
    const row = this.db.prepare("SELECT id FROM sessions WHERE id = ? AND user_id = ? AND project_id = ?").get(sessionId, this.userId, projectId);
    if (!row) throw new Error("PORTFOLIO_SESSION_NOT_FOUND");
  }

  private findActiveAssignmentByLeaseToken(leaseToken: string, attemptId: string, sessionId: string): PortfolioSessionAssignment | undefined {
    const row = this.db.prepare(`SELECT * FROM portfolio_session_assignments WHERE user_id = ? AND attempt_id = ? AND session_id = ?
      AND lease_token_digest = ? AND active_attempt_slot = 'active' AND lease_expires_at > ?`).get(
      this.userId, attemptId, sessionId, sha256(leaseToken), Date.now()
    ) as Row | undefined;
    return row ? this.toAssignment(row) : undefined;
  }

  #actionIntentDigest(intent: PortfolioActionIntent): string {
    return digestPortfolioActionIntent({ userId: this.userId, projectId: intent.projectId, workItemId: intent.workItemId,
      attemptId: intent.attemptId, sessionId: intent.sessionId, actionClass: intent.actionClass, resourceScope: intent.resourceScope,
      payloadDigest: intent.payloadDigest, assignmentLeaseTokenDigest: intent.assignmentLeaseTokenDigest, policyRule: intent.policyRule,
      issuedAt: intent.issuedAt, expiresAt: intent.expiresAt });
  }

  #policyRuleForTier(tier: "preauthorized" | "owner_confirmation" | "protected", actionClass: string): string {
    if (tier === "preauthorized") return `preauthorized:${actionClass}/v1`;
    return tier === "protected" ? "protected-action/v1" : "owner-confirmation/v1";
  }

  /** Repository-side guard prevents direct writers from creating a dispatchable packet without the approved manifest. */
  #assertExecutableTaskPacketInput(input: {
    projectId: string;
    workItemId: string;
    packetDigest: string;
    skillVersion: string;
    sourceWorkItemVersion: number;
    dossierVersion: number;
    canonicalPacket: Record<string, unknown>;
    manifestVersion: string;
    manifestDigest: string;
    adapter?: string;
  }): void {
    const packet = input.canonicalPacket;
    const project = asRecord(packet.project);
    const workItem = asRecord(packet.workItem);
    const execution = asRecord(packet.execution);
    const skill = asRecord(packet.skill);
    const platformTools = asRecord(packet.platformTools);
    const toolIds = Array.isArray(skill.toolIds) ? skill.toolIds.filter((value): value is string => typeof value === "string") : [];
    const declaredTools = Array.isArray(platformTools.tools) ? platformTools.tools.map((value) => asRecord(value)) : [];
    if (input.skillVersion !== PORTFOLIO_EXECUTION_SKILL_VERSION || skill.version !== PORTFOLIO_EXECUTION_SKILL_VERSION) {
      throw new Error("PORTFOLIO_EXECUTABLE_SKILL_REQUIRED");
    }
    if (toolIds.length === 0) throw new Error("PORTFOLIO_EXECUTABLE_TOOLS_REQUIRED");
    if (toolIds.length !== PORTFOLIO_EXECUTION_TOOL_IDS.length
      || toolIds.some((id) => !PORTFOLIO_EXECUTION_TOOL_IDS.includes(id as (typeof PORTFOLIO_EXECUTION_TOOL_IDS)[number]))) {
      throw new Error("PORTFOLIO_EXECUTABLE_TOOL_UNREGISTERED");
    }
    if (!input.manifestVersion.trim() || !input.manifestDigest.trim() || platformTools.manifestVersion !== input.manifestVersion
      || platformTools.manifestDigest !== input.manifestDigest || declaredTools.length !== toolIds.length
      || declaredTools.some((tool) => tool.id !== PORTFOLIO_EXECUTION_TOOL_IDS[0]
        || tool.version !== PORTFOLIO_EXECUTION_TOOL_VERSION || tool.actionClass !== "packet_submit")) {
      throw new Error("PORTFOLIO_EXECUTABLE_MANIFEST_REQUIRED");
    }
    if (project.id !== input.projectId || project.dossierVersion !== input.dossierVersion || workItem.id !== input.workItemId
      || workItem.projectionVersion !== input.sourceWorkItemVersion || typeof execution.adapter !== "string" || !execution.adapter.trim()
      || (input.adapter !== undefined && execution.adapter !== input.adapter)) {
      throw new Error("PORTFOLIO_PACKET_SCOPE_MISMATCH");
    }
    if (digestPortfolioValue(packet) !== input.packetDigest) throw new Error("PORTFOLIO_PACKET_DIGEST_MISMATCH");
  }

  #assertExecutableTaskPacket(packet: PortfolioTaskPacket, adapter?: string): void {
    this.#assertExecutableTaskPacketInput({ projectId: packet.projectId, workItemId: packet.workItemId, packetDigest: packet.packetDigest,
      skillVersion: packet.skillVersion, sourceWorkItemVersion: packet.sourceWorkItemVersion, dossierVersion: packet.dossierVersion,
      canonicalPacket: packet.canonicalPacket, manifestVersion: packet.manifestVersion, manifestDigest: packet.manifestDigest,
      ...(adapter !== undefined ? { adapter } : {}) });
  }

  private assertTaskPacketForAttempt(packetId: string, input: {
    projectId: string;
    workItemId: string;
    packetVersion: number;
    packetDigest: string;
    sourceWorkItemVersion: number;
    adapter: string;
  }, workItem: PortfolioWorkItem): void {
    const packet = this.getTaskPacket(packetId);
    if (!packet || packet.projectId !== input.projectId || packet.workItemId !== input.workItemId
      || packet.packetVersion !== input.packetVersion || packet.packetDigest !== input.packetDigest
      || packet.sourceWorkItemVersion !== input.sourceWorkItemVersion || packet.sourceWorkItemVersion !== workItem.projectionVersion) {
      throw new Error("PORTFOLIO_PACKET_DRIFT");
    }
    this.#assertExecutableTaskPacket(packet, input.adapter);
  }

  #loadPreparedAttemptReplay(input: {
    projectId: string; workItemId: string; packetDigest: string; skillVersion: string; sourceWorkItemVersion: number; dossierVersion: number;
    canonicalPacket: Record<string, unknown>; manifestVersion: string; manifestDigest: string; adapter: string; createdBy: string; idempotencyKey: string; requestId?: string; trackingEnabled?: boolean;
  }): PortfolioPreparedTaskAttempt | undefined {
    const row = this.db.prepare(`SELECT payload_digest, result_json FROM portfolio_operation_records
      WHERE user_id = ? AND operation = 'task_attempt.prepare' AND idempotency_key = ?`).get(this.userId, input.idempotencyKey) as Row | undefined;
    if (!row) return undefined;
    if (stringValue(row, "payload_digest") !== digestPortfolioValue(this.#preparedAttemptPayload(input))) throw new Error("PORTFOLIO_IDEMPOTENCY_CONFLICT");
    const result = parseObject(row.result_json);
    const packet = typeof result.packetId === "string" ? this.getTaskPacket(result.packetId) : undefined;
    const attempt = typeof result.attemptId === "string" ? this.getTaskAttempt(result.attemptId) : undefined;
    if (!packet || !attempt || attempt.packetId !== packet.id) throw new Error("PORTFOLIO_IDEMPOTENCY_RESULT_INVALID");
    return { packet, attempt };
  }

  #nextAttemptNumber(workItemId: string): number {
    const row = this.db.prepare(`SELECT COALESCE(MAX(attempt_number), 0) AS value FROM portfolio_task_attempts WHERE user_id = ? AND work_item_id = ?`)
      .get(this.userId, workItemId) as Row;
    return numberValue(row, "value") + 1;
  }

  #insertPreparedPacket(input: {
    projectId: string; workItemId: string; packetDigest: string; skillVersion: string; sourceWorkItemVersion: number; dossierVersion: number;
    canonicalPacket: Record<string, unknown>; manifestVersion: string; manifestDigest: string; createdBy: string;
  }, packetId: string, packetVersion: number, now: number): void {
    this.db.prepare(`INSERT INTO portfolio_task_packets (id, user_id, project_id, work_item_id, packet_version, packet_digest,
      skill_version, source_work_item_version, dossier_version, canonical_packet_json, manifest_version, manifest_digest, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      packetId, this.userId, input.projectId, input.workItemId, packetVersion, input.packetDigest, input.skillVersion,
      input.sourceWorkItemVersion, input.dossierVersion, JSON.stringify(input.canonicalPacket), input.manifestVersion, input.manifestDigest, input.createdBy, now
    );
  }

  #insertPreparedAttempt(input: {
    projectId: string; workItemId: string; packetDigest: string; skillVersion: string; sourceWorkItemVersion: number; dossierVersion: number;
    canonicalPacket: Record<string, unknown>; manifestVersion: string; manifestDigest: string; adapter: string; createdBy: string; idempotencyKey: string; requestId?: string; trackingEnabled?: boolean;
  }, ids: { attemptId: string; packetId: string; packetVersion: number; attemptNumber: number; requestId: string | null }, now: number): void {
    this.db.prepare(`INSERT INTO portfolio_task_attempts (id, user_id, project_id, work_item_id, request_id, packet_id, attempt_number,
      source_work_item_version, packet_version, packet_digest, adapter, created_by, tracking_enabled, state, idempotency_key, input_digest, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?, ?, ?)`).run(
      ids.attemptId, this.userId, input.projectId, input.workItemId, ids.requestId, ids.packetId, ids.attemptNumber, input.sourceWorkItemVersion,
      ids.packetVersion, input.packetDigest, input.adapter, input.createdBy, input.trackingEnabled ? 1 : 0, `prepare-attempt:${input.idempotencyKey}`,
      digestPortfolioValue(this.#preparedAttemptPayload(input)), now, now
    );
  }

  #storePreparedAttemptOperation(input: {
    projectId: string; workItemId: string; packetDigest: string; skillVersion: string; sourceWorkItemVersion: number; dossierVersion: number;
    canonicalPacket: Record<string, unknown>; manifestVersion: string; manifestDigest: string; adapter: string; createdBy: string; idempotencyKey: string; requestId?: string; trackingEnabled?: boolean;
  }, ids: { packetId: string; attemptId: string }, now: number): void {
    this.db.prepare(`INSERT INTO portfolio_operation_records (id, user_id, operation, idempotency_key, payload_digest, result_json, created_at)
      VALUES (?, ?, 'task_attempt.prepare', ?, ?, ?, ?)`).run(
      randomUUID(), this.userId, input.idempotencyKey, digestPortfolioValue(this.#preparedAttemptPayload(input)), JSON.stringify(ids), now
    );
  }

  #preparedAttemptPayload(input: {
    projectId: string; workItemId: string; packetDigest: string; skillVersion: string; sourceWorkItemVersion: number; dossierVersion: number;
    canonicalPacket: Record<string, unknown>; manifestVersion: string; manifestDigest: string; adapter: string; createdBy: string; idempotencyKey: string; requestId?: string; trackingEnabled?: boolean;
  }): Record<string, unknown> {
    return { ...input, requestId: input.requestId ?? null };
  }

  #consumeWorkerSignalTransition(input: PortfolioWorkerSignalBinding & { capabilityDigest: string }, from: PortfolioWorkerSignalState, to: PortfolioWorkerSignalState, nowDate?: Date): PortfolioWorkerSignal {
    const transition = this.db.transaction(() => {
      const now = nowDate?.getTime() ?? Date.now();
      const signal = this.getWorkerSignalForCommand(input.commandId);
      const assignment = this.getSessionAssignment(input.assignmentId);
      if (!signal || !assignment || !assignment.active || assignment.leaseExpiresAt.getTime() <= now
        || assignment.attemptId !== input.attemptId || assignment.sessionId !== input.sessionId || assignment.adapter !== input.adapter
        || assignment.leaseGeneration !== input.leaseGeneration) throw new Error("PORTFOLIO_WORKER_SIGNAL_BINDING_MISMATCH");
      const changes = this.db.prepare(`UPDATE portfolio_worker_signals SET state = ?, acknowledged_at = CASE WHEN ? = 'acknowledged' THEN ? ELSE acknowledged_at END,
        consumed_at = CASE WHEN ? = 'consumed' THEN ? ELSE consumed_at END, updated_at = ?
        WHERE id = ? AND user_id = ? AND state = ? AND command_id = ? AND assignment_id = ? AND attempt_id = ? AND session_id = ?
          AND adapter = ? AND lease_generation = ? AND packet_digest = ? AND capability_digest = ? AND expires_at > ?`).run(
        to, to, now, to, now, now, signal.id, this.userId, from, input.commandId, input.assignmentId, input.attemptId, input.sessionId,
        input.adapter, input.leaseGeneration, input.packetDigest, input.capabilityDigest, now
      );
      if (changes.changes !== 1) throw new Error(from === "expected" ? "PORTFOLIO_WORKER_SIGNAL_ACK_REJECTED" : "PORTFOLIO_DISPATCH_UNKNOWN");
      const updated = this.getWorkerSignalForCommand(input.commandId) as PortfolioWorkerSignal;
      this.#insertFact({ projectId: updated.projectId, workItemId: updated.workItemId, attemptId: updated.attemptId,
        recordType: "worker_signal", recordId: updated.id, factType: to === "acknowledged" ? "worker_readiness_acknowledged" : "worker_packet_write_started",
        payload: { commandId: updated.commandId, assignmentId: updated.assignmentId, leaseGeneration: updated.leaseGeneration,
          packetDigest: updated.packetDigest, signalType: updated.signalType } });
      return updated;
    });
    return transition();
  }

  #loadDispatchReplay(input: PortfolioPrepareDispatchInput): PortfolioDispatchPreparation | undefined {
    const row = this.db.prepare(`SELECT payload_digest, result_json FROM portfolio_operation_records
      WHERE user_id = ? AND operation = 'execution.prepare_dispatch' AND idempotency_key = ?`).get(this.userId, input.idempotencyKey) as Row | undefined;
    if (!row) return undefined;
    if (stringValue(row, "payload_digest") !== digestPortfolioValue(this.#dispatchPayload(input))) throw new Error("PORTFOLIO_IDEMPOTENCY_CONFLICT");
    const result = parseObject(row.result_json);
    const command = typeof result.commandId === "string" ? this.getCommand(result.commandId) : undefined;
    const assignment = typeof result.assignmentId === "string" ? this.getSessionAssignment(result.assignmentId) : undefined;
    const actionIntent = typeof result.actionIntentId === "string" ? this.getActionIntent(result.actionIntentId) : undefined;
    const authorization = typeof result.authorizationId === "string" ? this.getAuthorization(result.authorizationId) : undefined;
    const expectedSignal = typeof result.signalId === "string" ? this.#getWorkerSignalById(result.signalId) : undefined;
    if (!command || !assignment || !actionIntent || !authorization || !expectedSignal) throw new Error("PORTFOLIO_IDEMPOTENCY_RESULT_INVALID");
    return { command, assignment, actionIntent, authorization, expectedSignal, replayed: true };
  }

  #createPreparedDispatch(input: PortfolioPrepareDispatchInput): PortfolioDispatchPreparation {
    const now = input.now?.getTime() ?? Date.now();
    const context = this.#validateDispatchPreparation(input, now);
    const ids = { actionIntentId: context.actionIntent?.id ?? randomUUID(), authorizationId: context.authorization?.id ?? randomUUID(), commandId: input.commandId, signalId: randomUUID() };
    if (input.authorizationTier === "preauthorized") {
      this.#insertDispatchAction(input, context.assignment, ids.actionIntentId, now);
      const actionIntent = this.getActionIntent(ids.actionIntentId) as PortfolioActionIntent;
      this.#insertDispatchAuthorization(input, ids.authorizationId, ids.actionIntentId, this.#actionIntentDigest(actionIntent), now);
    }
    this.#insertDispatchCommand(input, ids.commandId, ids.actionIntentId, ids.authorizationId, now);
    this.#insertExpectedWorkerSignal(input, context.assignment, ids, now);
    this.#transitionAttemptToDispatching(input, context.attempt, now);
    this.#appendDispatchFacts(input, context.assignment, ids, now);
    this.#storeDispatchOperation(input, ids, now);
    return {
      command: this.getCommand(ids.commandId) as PortfolioCommand,
      assignment: this.getSessionAssignment(input.assignmentId) as PortfolioSessionAssignment,
      actionIntent: this.getActionIntent(ids.actionIntentId) as PortfolioActionIntent,
      authorization: this.getAuthorization(ids.authorizationId) as PortfolioAuthorization,
      expectedSignal: this.#getWorkerSignalById(ids.signalId) as PortfolioWorkerSignal,
      replayed: false
    };
  }

  #validateDispatchPreparation(input: PortfolioPrepareDispatchInput, now: number): {
    attempt: PortfolioTaskAttempt;
    assignment: PortfolioSessionAssignment;
    actionIntent?: PortfolioActionIntent;
    authorization?: PortfolioAuthorization;
  } {
    const workItem = this.requireWorkItem(input.workItemId, input.projectId);
    const attempt = this.requireTaskAttempt(input.attemptId, input.projectId, input.workItemId);
    const packet = attempt.packetId ? this.getTaskPacket(attempt.packetId) : this.findTaskPacketByDigest(input.workItemId, attempt.packetDigest);
    const dossier = this.getDossier(input.projectId);
    if (!packet || !dossier || digestPortfolioValue(packet.canonicalPacket) !== packet.packetDigest
      || packet.packetDigest !== attempt.packetDigest || packet.sourceWorkItemVersion !== attempt.sourceWorkItemVersion
      || workItem.projectionVersion !== attempt.sourceWorkItemVersion || dossier.projectionVersion !== packet.dossierVersion) {
      throw new Error("PORTFOLIO_PACKET_DRIFT");
    }
    this.#assertExecutableTaskPacket(packet, attempt.adapter);
    const assignment = this.getSessionAssignment(input.assignmentId);
    const session = this.db.prepare(`SELECT ai_tool FROM sessions WHERE id = ? AND user_id = ? AND project_id = ?`).get(input.sessionId, this.userId, input.projectId) as Row | undefined;
    if (!assignment || !session || !assignment.active || assignment.attemptId !== attempt.id || assignment.sessionId !== input.sessionId
      || assignment.adapter !== attempt.adapter || stringValue(session, "ai_tool") !== attempt.adapter || assignment.leaseExpiresAt.getTime() <= now
      || assignment.leaseGeneration < 1 || assignment.projectionVersion !== input.expectedAssignmentProjectionVersion
      || assignment.leaseTokenDigest !== sha256(input.leaseToken)) throw new Error("PORTFOLIO_LEASE_MISMATCH");
    if (attempt.projectionVersion !== input.expectedAttemptProjectionVersion || attempt.state !== "prepared") throw new Error("PORTFOLIO_STATE_CONFLICT");
    if (input.authorizationExpiresAt.getTime() <= now || input.signalExpiresAt.getTime() <= now) throw new Error("PORTFOLIO_AUTHORIZATION_EXPIRED");
    if (input.actionClass !== "packet_submit" || input.resourceScope.toolId !== "portfolio.submit_canonical_task_packet"
      || Object.keys(input.resourceScope).length !== 1) throw new Error("PORTFOLIO_AUTHORIZATION_POLICY_MISMATCH");
    if (input.authorizationTier === "preauthorized") {
      if (input.authorizationId || input.authorizationActionDigest || input.policyRule !== "preauthorized:packet_submit/v1") {
        throw new Error("PORTFOLIO_AUTHORIZATION_POLICY_MISMATCH");
      }
      return { attempt, assignment };
    }
    const authorization = input.authorizationId ? this.getAuthorization(input.authorizationId) : undefined;
    const actionIntent = authorization ? this.getActionIntent(authorization.actionIntentId) : undefined;
    if (!authorization || !actionIntent || authorization.projectId !== input.projectId || authorization.workItemId !== input.workItemId
      || authorization.attemptId !== input.attemptId || authorization.authorizationTier !== "owner_confirmation"
      || authorization.state !== "consumed" || authorization.expiresAt.getTime() <= now || actionIntent.expiresAt.getTime() <= now
      || actionIntent.projectId !== input.projectId || actionIntent.workItemId !== input.workItemId || actionIntent.attemptId !== input.attemptId
      || actionIntent.sessionId !== input.sessionId || actionIntent.actionClass !== input.actionClass
      || stableJson(actionIntent.resourceScope) !== stableJson(input.resourceScope) || actionIntent.payloadDigest !== attempt.packetDigest
      || actionIntent.assignmentLeaseTokenDigest !== assignment.leaseTokenDigest || actionIntent.policyRule !== input.policyRule
      || input.policyRule !== "owner-confirmation/v1" || authorization.actionDigest !== input.authorizationActionDigest
      || authorization.actionDigest !== this.#actionIntentDigest(actionIntent)) {
      throw new Error("PORTFOLIO_AUTHORIZATION_SCOPE_MISMATCH");
    }
    return { attempt, assignment, actionIntent, authorization };
  }

  #insertDispatchAction(input: PortfolioPrepareDispatchInput, assignment: PortfolioSessionAssignment, id: string, now: number): void {
    this.db.prepare(`INSERT INTO portfolio_action_intents (id, user_id, project_id, work_item_id, attempt_id, session_id, action_class,
      resource_scope_json, payload_digest, assignment_lease_token_digest, policy_rule, issued_at, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, this.userId, input.projectId, input.workItemId, input.attemptId, input.sessionId, input.actionClass,
      JSON.stringify(input.resourceScope), (this.getTaskAttempt(input.attemptId) as PortfolioTaskAttempt).packetDigest,
      assignment.leaseTokenDigest, input.policyRule, now, input.authorizationExpiresAt.getTime(), now
    );
  }

  #insertDispatchAuthorization(input: PortfolioPrepareDispatchInput, id: string, actionIntentId: string, actionDigest: string, now: number): void {
    this.db.prepare(`INSERT INTO portfolio_execution_authorizations (id, user_id, project_id, work_item_id, attempt_id, action_intent_id,
      authorization_tier, action_digest, policy_rule, state, expires_at, consumed_at, idempotency_key, input_digest, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'consumed', ?, ?, ?, ?, ?, ?)`).run(
      id, this.userId, input.projectId, input.workItemId, input.attemptId, actionIntentId, input.authorizationTier, actionDigest,
      input.policyRule, input.authorizationExpiresAt.getTime(), now, `prepare-dispatch:${input.idempotencyKey}`,
      digestPortfolioValue(this.#dispatchPayload(input)), now, now
    );
  }

  #insertDispatchCommand(input: PortfolioPrepareDispatchInput, id: string, actionIntentId: string, authorizationId: string, now: number): void {
    const attempt = this.getTaskAttempt(input.attemptId) as PortfolioTaskAttempt;
    this.db.prepare(`INSERT INTO portfolio_commands (id, user_id, project_id, work_item_id, attempt_id, assignment_id, authorization_id, action_intent_id,
      command_type, payload_digest, state, idempotency_key, input_digest, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'dispatch_packet', ?, 'awaiting_readiness', ?, ?, ?, ?)`).run(
      id, this.userId, input.projectId, input.workItemId, input.attemptId, input.assignmentId, authorizationId, actionIntentId,
      attempt.packetDigest, `prepare-dispatch:${input.idempotencyKey}`, digestPortfolioValue(this.#dispatchPayload(input)), now, now
    );
  }

  #insertExpectedWorkerSignal(input: PortfolioPrepareDispatchInput, assignment: PortfolioSessionAssignment, ids: { commandId: string; signalId: string }, now: number): void {
    const attempt = this.getTaskAttempt(input.attemptId) as PortfolioTaskAttempt;
    this.db.prepare(`INSERT INTO portfolio_worker_signals (id, user_id, project_id, work_item_id, attempt_id, session_id, assignment_id, command_id,
      adapter, signal_type, lease_generation, packet_digest, capability_digest, state, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'expected', ?, ?, ?)`).run(
      ids.signalId, this.userId, input.projectId, input.workItemId, input.attemptId, input.sessionId, input.assignmentId, ids.commandId,
      attempt.adapter, input.signalType, assignment.leaseGeneration, attempt.packetDigest, input.capabilityDigest, input.signalExpiresAt.getTime(), now, now
    );
  }

  #transitionAttemptToDispatching(input: PortfolioPrepareDispatchInput, attempt: PortfolioTaskAttempt, now: number): void {
    const changed = this.db.prepare(`UPDATE portfolio_task_attempts SET state = 'dispatching', projection_version = projection_version + 1, updated_at = ?
      WHERE id = ? AND user_id = ? AND state = 'prepared' AND projection_version = ?`).run(now, attempt.id, this.userId, input.expectedAttemptProjectionVersion);
    if (changed.changes !== 1) throw new Error("PORTFOLIO_STATE_CONFLICT");
  }

  #appendDispatchFacts(input: PortfolioPrepareDispatchInput, assignment: PortfolioSessionAssignment, ids: { actionIntentId: string; authorizationId: string; commandId: string; signalId: string }, now: number): void {
    const scope = { projectId: input.projectId, workItemId: input.workItemId, attemptId: input.attemptId };
    this.#insertFact({ ...scope, recordType: "action_intent", recordId: ids.actionIntentId, factType: "action_intent_created", payload: { actionClass: input.actionClass, policyRule: input.policyRule } });
    this.#insertFact({ ...scope, recordType: "authorization", recordId: ids.authorizationId, factType: "authorization_consumed", payload: { tier: input.authorizationTier, policyRule: input.policyRule, consumedAt: now } });
    this.#insertFact({ ...scope, recordType: "command", recordId: ids.commandId, factType: "dispatch_command_prepared", payload: { assignmentId: assignment.id, packetDigest: (this.getTaskAttempt(input.attemptId) as PortfolioTaskAttempt).packetDigest } });
    this.#insertFact({ ...scope, recordType: "worker_signal", recordId: ids.signalId, factType: "worker_readiness_expected", payload: { commandId: ids.commandId, leaseGeneration: assignment.leaseGeneration, signalType: input.signalType } });
    this.#insertFact({ ...scope, recordType: "task_attempt", recordId: input.attemptId, factType: "state_transition", payload: { fromState: "prepared", toState: "dispatching", actorId: "portfolio_execution" } });
  }

  #storeDispatchOperation(input: PortfolioPrepareDispatchInput, ids: { actionIntentId: string; authorizationId: string; commandId: string; signalId: string }, now: number): void {
    this.db.prepare(`INSERT INTO portfolio_operation_records (id, user_id, operation, idempotency_key, payload_digest, result_json, created_at)
      VALUES (?, ?, 'execution.prepare_dispatch', ?, ?, ?, ?)`).run(
      randomUUID(), this.userId, input.idempotencyKey, digestPortfolioValue(this.#dispatchPayload(input)),
      JSON.stringify({ ...ids, assignmentId: input.assignmentId }), now
    );
  }

  #dispatchPayload(input: PortfolioPrepareDispatchInput): Record<string, unknown> {
    const { authorizationExpiresAt: _authorizationExpiresAt, signalExpiresAt: _signalExpiresAt, now: _now,
      requestedAuthorizationExpiresAt, ...businessInput } = input;
    return { ...businessInput, leaseToken: sha256(input.leaseToken),
      requestedAuthorizationExpiresAt: requestedAuthorizationExpiresAt?.getTime() ?? null };
  }

  #getWorkerSignalById(id: string): PortfolioWorkerSignal | undefined {
    const row = this.db.prepare(`SELECT * FROM portfolio_worker_signals WHERE id = ? AND user_id = ?`).get(id, this.userId) as Row | undefined;
    return row ? this.toWorkerSignal(row) : undefined;
  }

  #loadWorkerReceiptReplay(input: { commandId: string; assignmentId: string; expectedCommandProjectionVersion: number; receiptDigest: string; idempotencyKey: string; now?: Date }): { command: PortfolioCommand; attempt: PortfolioTaskAttempt; receiptRecorded: true } | undefined {
    const row = this.db.prepare(`SELECT payload_digest, result_json FROM portfolio_operation_records
      WHERE user_id = ? AND operation = 'command.worker_dispatch_receipt' AND idempotency_key = ?`).get(this.userId, input.idempotencyKey) as Row | undefined;
    if (!row) return undefined;
    if (stringValue(row, "payload_digest") !== digestPortfolioValue(this.#receiptPayload(input))) throw new Error("PORTFOLIO_IDEMPOTENCY_CONFLICT");
    const result = parseObject(row.result_json);
    const command = typeof result.commandId === "string" ? this.getCommand(result.commandId) : undefined;
    const attempt = command ? this.getTaskAttempt(command.attemptId) : undefined;
    if (!command || !attempt) throw new Error("PORTFOLIO_IDEMPOTENCY_RESULT_INVALID");
    return { command, attempt, receiptRecorded: true };
  }

  #recordWorkerDispatchReceipt(input: { commandId: string; assignmentId: string; expectedCommandProjectionVersion: number; receiptDigest: string; now?: Date }): { command: PortfolioCommand; attempt: PortfolioTaskAttempt; receiptRecorded: true } {
    const now = input.now?.getTime() ?? Date.now();
    const command = this.getCommand(input.commandId);
    const signal = this.getWorkerSignalForCommand(input.commandId);
    const assignment = this.getSessionAssignment(input.assignmentId);
    if (!command || !signal || !assignment || command.assignmentId !== assignment.id || signal.assignmentId !== assignment.id
      || signal.state !== "consumed" || command.state !== "awaiting_readiness") throw new Error("PORTFOLIO_DISPATCH_UNKNOWN");
    if (command.projectionVersion !== input.expectedCommandProjectionVersion || assignment.leaseExpiresAt.getTime() <= now) {
      throw new Error("PORTFOLIO_STATE_CONFLICT");
    }
    const commandUpdate = this.db.prepare(`UPDATE portfolio_commands SET state = 'observed', dispatch_receipt_digest = ?, observed_at = ?,
      projection_version = projection_version + 1, updated_at = ? WHERE id = ? AND user_id = ? AND state = 'awaiting_readiness' AND projection_version = ?`)
      .run(input.receiptDigest, now, now, command.id, this.userId, input.expectedCommandProjectionVersion);
    if (commandUpdate.changes !== 1) throw new Error("PORTFOLIO_STATE_CONFLICT");
    const attempt = this.getTaskAttempt(command.attemptId) as PortfolioTaskAttempt;
    const attemptUpdate = this.db.prepare(`UPDATE portfolio_task_attempts SET state = 'running', projection_version = projection_version + 1, updated_at = ?
      WHERE id = ? AND user_id = ? AND state = 'dispatching' AND projection_version = ?`).run(now, attempt.id, this.userId, attempt.projectionVersion);
    if (attemptUpdate.changes !== 1) throw new Error("PORTFOLIO_STATE_CONFLICT");
    this.#insertFact({ projectId: command.projectId, workItemId: command.workItemId, attemptId: command.attemptId,
      recordType: "dispatch_receipt", recordId: command.id, factType: "validated_dispatch_receipt",
      payload: { commandId: command.id, assignmentId: assignment.id, receiptDigest: input.receiptDigest, leaseGeneration: assignment.leaseGeneration } });
    this.#insertFact({ projectId: command.projectId, workItemId: command.workItemId, attemptId: command.attemptId,
      recordType: "task_attempt", recordId: attempt.id, factType: "state_transition", payload: { fromState: "dispatching", toState: "running", actorId: "portfolio_worker" } });
    return { command: this.getCommand(command.id) as PortfolioCommand, attempt: this.getTaskAttempt(attempt.id) as PortfolioTaskAttempt, receiptRecorded: true };
  }

  #receiptPayload(input: { commandId: string; assignmentId: string; expectedCommandProjectionVersion: number; receiptDigest: string; idempotencyKey: string; now?: Date }): Record<string, unknown> {
    return { ...input, now: input.now?.getTime() ?? null };
  }

  private stateOperationPayload(input: {
    recordType: PortfolioStateRecordType;
    recordId: string;
    toState: string;
    actorId: string;
    attemptId?: string;
    expectedProjectionVersion: number;
    idempotencyKey: string;
    correlationId?: string;
  }): Record<string, unknown> {
    return {
      recordType: input.recordType,
      recordId: input.recordId,
      toState: input.toState,
      actorId: input.actorId,
      attemptId: input.attemptId ?? null,
      expectedProjectionVersion: input.expectedProjectionVersion,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId ?? null
    };
  }

  private factScope(requestId: string | null, workItemId: string | null, attemptId: string | null, correlationId?: string): {
    requestId?: string;
    workItemId?: string;
    attemptId?: string;
    correlationId?: string;
  } {
    return {
      ...(requestId ? { requestId } : {}),
      ...(workItemId ? { workItemId } : {}),
      ...(attemptId ? { attemptId } : {}),
      ...(correlationId ? { correlationId } : {})
    };
  }

  private toDossier(row: Row): PortfolioDossier {
    return { id: stringValue(row, "id"), projectId: stringValue(row, "project_id"), ownerUserId: stringValue(row, "owner_user_id"), objective: stringValue(row, "objective"),
      intendedOutcome: stringValue(row, "intended_outcome"), scope: parseObject(row.scope_json), observedState: parseObject(row.observed_state_json),
      projectionVersion: numberValue(row, "projection_version"), createdAt: asDate(row.created_at), updatedAt: asDate(row.updated_at) };
  }

  private toRequest(row: Row): PortfolioRequest {
    return { id: stringValue(row, "id"), projectId: nullableString(row, "project_id"), requesterId: nullableString(row, "requester_id"),
      source: stringValue(row, "source"), sourceEventId: nullableString(row, "source_event_id"), requestText: stringValue(row, "request_text"),
      sourceMetadata: parseObject(row.source_metadata_json), state: stringValue(row, "state") as PortfolioRequestState,
      projectionVersion: numberValue(row, "projection_version"), correlationId: stringValue(row, "correlation_id"), idempotencyKey: stringValue(row, "idempotency_key"),
      receivedAt: asDate(row.received_at), createdAt: asDate(row.created_at), updatedAt: asDate(row.updated_at) };
  }

  private toIntakeDecision(row: Row): PortfolioIntakeDecision {
    return { id: stringValue(row, "id"), requestId: stringValue(row, "request_id"), selectedProjectId: nullableString(row, "selected_project_id"),
      candidateProjectIds: parseStrings(row.candidate_project_ids_json), scopeAssessment: stringValue(row, "scope_assessment"),
      producer: stringValue(row, "producer"), evidenceIds: parseStrings(row.evidence_ids_json),
      state: stringValue(row, "state") as PortfolioIntakeDecisionState, projectionVersion: numberValue(row, "projection_version"),
      idempotencyKey: stringValue(row, "idempotency_key"), createdAt: asDate(row.created_at), updatedAt: asDate(row.updated_at) };
  }

  private toWorkItem(row: Row): PortfolioWorkItem {
    return { id: stringValue(row, "id"), projectId: stringValue(row, "project_id"), requestId: stringValue(row, "request_id"),
      ownerUserId: stringValue(row, "owner_user_id"), title: stringValue(row, "title"), description: nullableString(row, "description"),
      acceptanceCriteria: parseStrings(row.acceptance_criteria_json), verificationRequirements: parseStrings(row.verification_requirements_json),
      state: stringValue(row, "state") as PortfolioWorkItemState, projectionVersion: numberValue(row, "projection_version"),
      idempotencyKey: stringValue(row, "idempotency_key"), createdAt: asDate(row.created_at), updatedAt: asDate(row.updated_at) };
  }

  private toTaskPacket(row: Row): PortfolioTaskPacket {
    return { id: stringValue(row, "id"), projectId: stringValue(row, "project_id"), workItemId: stringValue(row, "work_item_id"),
      packetVersion: numberValue(row, "packet_version"), packetDigest: stringValue(row, "packet_digest"), skillVersion: stringValue(row, "skill_version"),
      sourceWorkItemVersion: numberValue(row, "source_work_item_version"), dossierVersion: numberValue(row, "dossier_version"),
      canonicalPacket: parseObject(row.canonical_packet_json), manifestVersion: stringValue(row, "manifest_version"),
      manifestDigest: stringValue(row, "manifest_digest"), createdBy: stringValue(row, "created_by"), createdAt: asDate(row.created_at) };
  }

  private toTaskAttempt(row: Row): PortfolioTaskAttempt {
    return { id: stringValue(row, "id"), projectId: stringValue(row, "project_id"), workItemId: stringValue(row, "work_item_id"),
      requestId: nullableString(row, "request_id"), packetId: nullableString(row, "packet_id"), attemptNumber: numberValue(row, "attempt_number"),
      sourceWorkItemVersion: numberValue(row, "source_work_item_version"), packetVersion: numberValue(row, "packet_version"),
      packetDigest: stringValue(row, "packet_digest"), adapter: stringValue(row, "adapter"), createdBy: stringValue(row, "created_by"),
      trackingEnabled: numberValue(row, "tracking_enabled") === 1,
      state: stringValue(row, "state") as PortfolioTaskAttemptState, projectionVersion: numberValue(row, "projection_version"),
      idempotencyKey: stringValue(row, "idempotency_key"), createdAt: asDate(row.created_at), updatedAt: asDate(row.updated_at), completedAt: asNullableDate(row.completed_at) };
  }

  private toAssignment(row: Row): PortfolioSessionAssignment {
    return { id: stringValue(row, "id"), projectId: stringValue(row, "project_id"), workItemId: stringValue(row, "work_item_id"),
      attemptId: stringValue(row, "attempt_id"), sessionId: stringValue(row, "session_id"), adapter: stringValue(row, "adapter"),
      leaseTokenDigest: stringValue(row, "lease_token_digest"), leaseGeneration: numberValue(row, "lease_generation"), leaseExpiresAt: asDate(row.lease_expires_at), active: nullableString(row, "active_attempt_slot") === "active",
      releasedReason: nullableString(row, "released_reason"), projectionVersion: numberValue(row, "projection_version"),
      createdAt: asDate(row.created_at), updatedAt: asDate(row.updated_at), releasedAt: asNullableDate(row.released_at) };
  }

  private toActionIntent(row: Row): PortfolioActionIntent {
    return { id: stringValue(row, "id"), projectId: stringValue(row, "project_id"), workItemId: nullableString(row, "work_item_id"),
      attemptId: nullableString(row, "attempt_id"), sessionId: nullableString(row, "session_id"), actionClass: stringValue(row, "action_class"),
      resourceScope: parseObject(row.resource_scope_json), payloadDigest: stringValue(row, "payload_digest"),
      assignmentLeaseTokenDigest: nullableString(row, "assignment_lease_token_digest"), policyRule: nullableString(row, "policy_rule"),
      issuedAt: asDate(row.issued_at), expiresAt: asDate(row.expires_at), createdAt: asDate(row.created_at) };
  }

  private toAuthorization(row: Row): PortfolioAuthorization {
    return { id: stringValue(row, "id"), projectId: stringValue(row, "project_id"), workItemId: nullableString(row, "work_item_id"),
      attemptId: nullableString(row, "attempt_id"), actionIntentId: stringValue(row, "action_intent_id"), authorizationTier: stringValue(row, "authorization_tier"),
      actionDigest: stringValue(row, "action_digest"), policyRule: nullableString(row, "policy_rule"), state: stringValue(row, "state") as PortfolioAuthorizationState,
      projectionVersion: numberValue(row, "projection_version"), expiresAt: asDate(row.expires_at), consumedAt: asNullableDate(row.consumed_at),
      createdAt: asDate(row.created_at), updatedAt: asDate(row.updated_at) };
  }

  private toCommand(row: Row): PortfolioCommand {
    return { id: stringValue(row, "id"), projectId: stringValue(row, "project_id"), workItemId: stringValue(row, "work_item_id"),
      attemptId: stringValue(row, "attempt_id"), assignmentId: nullableString(row, "assignment_id"), authorizationId: nullableString(row, "authorization_id"),
      actionIntentId: stringValue(row, "action_intent_id"), commandType: stringValue(row, "command_type"), payloadDigest: stringValue(row, "payload_digest"),
      state: stringValue(row, "state"), dispatchReceiptDigest: nullableString(row, "dispatch_receipt_digest"), observedAt: asNullableDate(row.observed_at),
      projectionVersion: numberValue(row, "projection_version"), createdAt: asDate(row.created_at), updatedAt: asDate(row.updated_at) };
  }

  private toWorkerSignal(row: Row): PortfolioWorkerSignal {
    return { id: stringValue(row, "id"), projectId: stringValue(row, "project_id"), workItemId: stringValue(row, "work_item_id"),
      attemptId: stringValue(row, "attempt_id"), sessionId: stringValue(row, "session_id"), assignmentId: stringValue(row, "assignment_id"),
      commandId: stringValue(row, "command_id"), adapter: stringValue(row, "adapter"), signalType: stringValue(row, "signal_type"),
      leaseGeneration: numberValue(row, "lease_generation"), packetDigest: stringValue(row, "packet_digest"),
      capabilityDigest: stringValue(row, "capability_digest"), state: stringValue(row, "state") as PortfolioWorkerSignalState,
      expiresAt: asDate(row.expires_at), launchIssuedAt: asNullableDate(row.launch_issued_at), acknowledgedAt: asNullableDate(row.acknowledged_at), consumedAt: asNullableDate(row.consumed_at),
      createdAt: asDate(row.created_at), updatedAt: asDate(row.updated_at) };
  }

  private toEvidence(row: Row): PortfolioEvidence {
    return { id: stringValue(row, "id"), projectId: stringValue(row, "project_id"), requestId: nullableString(row, "request_id"),
      workItemId: nullableString(row, "work_item_id"), attemptId: nullableString(row, "attempt_id"), producer: stringValue(row, "producer"),
      sourceCategory: stringValue(row, "source_category"), observedAt: asDate(row.observed_at), collectedAt: asDate(row.collected_at),
      digest: stringValue(row, "digest"), redactedSummary: stringValue(row, "redacted_summary"), confidence: stringValue(row, "confidence"),
      freshness: stringValue(row, "freshness"), isBlocker: numberValue(row, "is_blocker") === 1, verificationKey: nullableString(row, "verification_key"), createdAt: asDate(row.created_at) };
  }

  private toCandidate(row: Row): PortfolioCompletionCandidate {
    return { id: stringValue(row, "id"), projectId: stringValue(row, "project_id"), workItemId: stringValue(row, "work_item_id"),
      attemptId: stringValue(row, "attempt_id"), requestId: stringValue(row, "request_id"), summary: stringValue(row, "summary"),
      evidenceIds: parseStrings(row.evidence_ids_json), verifiedAt: asNullableDate(row.verified_at), projectionVersion: numberValue(row, "projection_version"),
      createdAt: asDate(row.created_at), updatedAt: asDate(row.updated_at) };
  }

  private toAcceptanceDecision(row: Row): PortfolioAcceptanceDecision {
    return { id: stringValue(row, "id"), projectId: stringValue(row, "project_id"), workItemId: stringValue(row, "work_item_id"),
      requestId: stringValue(row, "request_id"), attemptId: stringValue(row, "attempt_id"), candidateId: stringValue(row, "candidate_id"), decision: stringValue(row, "decision"),
      policyRule: nullableString(row, "policy_rule"), evidenceIds: parseStrings(row.evidence_ids_json), state: stringValue(row, "state") as PortfolioAcceptanceDecisionState,
      projectionVersion: numberValue(row, "projection_version"), createdAt: asDate(row.created_at), updatedAt: asDate(row.updated_at) };
  }

  private toWakeup(row: Row): PortfolioWorkflowWakeup {
    return { id: stringValue(row, "id"), projectId: stringValue(row, "project_id"), workItemId: stringValue(row, "work_item_id"),
      attemptId: stringValue(row, "attempt_id"), reasonClass: stringValue(row, "reason_class"), state: stringValue(row, "state") as PortfolioWakeupState,
      projectionVersion: numberValue(row, "projection_version"), dueAt: asDate(row.due_at), coalescingKey: stringValue(row, "coalescing_key"),
      attemptCount: numberValue(row, "attempt_count"),
      maxAttempts: numberValue(row, "max_attempts"), createdAt: asDate(row.created_at), updatedAt: asDate(row.updated_at) };
  }

  private toFact(row: Row): PortfolioFact {
    return { id: stringValue(row, "id"), projectId: nullableString(row, "project_id"), requestId: nullableString(row, "request_id"),
      workItemId: nullableString(row, "work_item_id"), attemptId: nullableString(row, "attempt_id"), recordType: stringValue(row, "record_type"),
      recordId: stringValue(row, "record_id"), factType: stringValue(row, "fact_type"), correlationId: nullableString(row, "correlation_id"),
      idempotencyKey: nullableString(row, "idempotency_key"), payload: parseObject(row.payload_json), payloadDigest: stringValue(row, "payload_digest"), createdAt: asDate(row.created_at) };
  }
}
