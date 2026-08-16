import { fetchJson } from "@/lib/api";

export const portfolioQueryKeys = {
  root: ["portfolio"] as const,
  projection: ["portfolio", "projection"] as const,
  timeline: (requestId: string) => ["portfolio", "request", requestId, "timeline"] as const,
};

export type PortfolioWorkItemState =
  | "todo"
  | "in_progress"
  | "blocked"
  | "ready_for_review"
  | "done"
  | "cancelled";

export interface PortfolioDossier {
  id: string;
  projectId: string;
  projectName: string;
  objective: string;
  intendedOutcome?: string | null;
  scope?: string | null;
  ownerRef?: string | null;
  observedState?: PortfolioObservedState | null;
  projectionVersion: number;
  updatedAt: string;
}

export interface PortfolioObservedState {
  summary: string;
  freshness?: "fresh" | "stale" | "unknown" | string;
  observedAt?: string | null;
  evidenceCount?: number;
}

export interface PortfolioRequest {
  id: string;
  projectId?: string | null;
  source: string;
  originalText: string;
  status: string;
  correlationId: string;
  receivedAt: string;
  projectionVersion: number;
}

export interface PortfolioWorkItem {
  id: string;
  requestId: string;
  projectId: string;
  title: string;
  description?: string | null;
  state: PortfolioWorkItemState;
  projectionVersion: number;
  updatedAt: string;
}

export interface PortfolioAttempt {
  id: string;
  requestId: string;
  workItemId: string;
  projectId: string;
  attemptNumber: number;
  state: string;
  projectionVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface PortfolioEvidence {
  id: string;
  requestId?: string | null;
  workItemId?: string | null;
  attemptId?: string | null;
  projectId: string;
  producer: string;
  sourceCategory: string;
  redactedSummary: string;
  confidence: string;
  freshness: string;
  observedAt: string;
  projectionVersion: number;
}

export interface PortfolioRiskSignal {
  id: string;
  projectId: string;
  requestId?: string | null;
  workItemId?: string | null;
  summary: string;
  severity: string;
  state: string;
  projectionVersion: number;
  updatedAt: string;
}

export interface PortfolioAuthorization {
  id: string;
  projectId: string;
  requestId?: string | null;
  workItemId?: string | null;
  actionClass: string;
  state: string;
  authorizationTier: string;
  expiresAt?: string | null;
  projectionVersion: number;
  updatedAt: string;
}

export interface PortfolioWorkflowWakeup {
  id: string;
  projectId: string;
  requestId?: string | null;
  workItemId?: string | null;
  attemptId?: string | null;
  reasonClass: string;
  state: string;
  dueAt: string;
  attemptCount: number;
  maxAttempts: number;
  projectionVersion: number;
}

export interface PortfolioHeartbeat {
  enabled: boolean;
  cadenceMinutes?: number | null;
  lastObservedAt?: string | null;
  state?: string | null;
  projectionVersion: number;
}

export interface PortfolioTimelineEvent {
  id: string;
  kind: "request" | "intake_decision" | "work_item";
  state?: string | null;
  occurredAt: string;
  projectionVersion: number;
}

/** A bounded, redacted read model. It deliberately excludes execution and terminal content. */
export interface PortfolioWorkspaceProjection {
  projectionVersion: number;
  dossiers: PortfolioDossier[];
  requests: PortfolioRequest[];
  workItems: PortfolioWorkItem[];
  attempts: PortfolioAttempt[];
  evidence: PortfolioEvidence[];
  risks: PortfolioRiskSignal[];
  authorizations: PortfolioAuthorization[];
  wakeups: PortfolioWorkflowWakeup[];
  heartbeat: PortfolioHeartbeat | null;
}

export interface PortfolioRequestTimeline {
  projectionVersion: number;
  request: PortfolioRequest;
  events: PortfolioTimelineEvent[];
}

export interface CreatePortfolioRequestInput {
  originalText: string;
  projectId?: string;
  correlationId?: string;
}

export interface CreatePortfolioRequestOptions {
  /** Reuse this exact key after an interrupted request; do not mint one per retry. */
  idempotencyKey: string;
}

export interface PortfolioOwnerDecisionInput {
  requestId: string;
  projectId: string;
}

export interface PortfolioHeartbeatInput {
  enabled: boolean;
  cadenceMinutes?: number;
}

function portfolioPath(path: string): string {
  return `/api/v1/portfolio${path}`;
}

export async function getPortfolioWorkspaceProjection(): Promise<PortfolioWorkspaceProjection> {
  const overview = await fetchJson<Record<string, unknown>>(portfolioPath("/overview"));
  return normalizeOverview(overview);
}

export async function getPortfolioRequestTimeline(requestId: string): Promise<PortfolioRequestTimeline> {
  const timeline = await fetchJson<Record<string, unknown>>(
    portfolioPath(`/requests/${encodeURIComponent(requestId)}/timeline`)
  );
  return normalizeTimeline(timeline);
}

export async function createPortfolioRequest(
  input: CreatePortfolioRequestInput,
  options: CreatePortfolioRequestOptions
): Promise<PortfolioRequest> {
  const request = await fetchJson<Record<string, unknown>>(portfolioPath("/requests"), {
    method: "POST",
    headers: { "Idempotency-Key": options.idempotencyKey },
    body: JSON.stringify({
      projectId: input.projectId,
      source: "web",
      requestText: input.originalText,
      correlationId: input.correlationId ?? options.idempotencyKey,
    }),
  });
  return normalizeRequest(request);
}

export async function resolvePortfolioOwnerDecision(
  input: PortfolioOwnerDecisionInput,
  options: CreatePortfolioRequestOptions
): Promise<void> {
  await fetchJson<unknown>(portfolioPath(`/requests/${encodeURIComponent(input.requestId)}/owner-decision`), {
    method: "POST",
    headers: { "Idempotency-Key": options.idempotencyKey },
    body: JSON.stringify({ projectId: input.projectId }),
  });
}

export async function updatePortfolioHeartbeat(
  input: PortfolioHeartbeatInput,
  options: CreatePortfolioRequestOptions
): Promise<PortfolioHeartbeat> {
  const heartbeat = await fetchJson<Record<string, unknown>>(portfolioPath("/heartbeat"), {
    method: "PUT",
    headers: { "Idempotency-Key": options.idempotencyKey },
    body: JSON.stringify({
      enabled: input.enabled,
      ...(input.cadenceMinutes === undefined ? {} : { cadenceMinutes: input.cadenceMinutes }),
    }),
  });
  return normalizeHeartbeat(heartbeat);
}

function normalizeOverview(value: Record<string, unknown>): PortfolioWorkspaceProjection {
  const dossiers = records(value.dossiers).map(normalizeDossier);
  const requests = records(value.requests).map(normalizeRequest);
  const workItems = records(value.workItems).map(normalizeWorkItem);
  const attempts = records(value.attempts).map((item, index) => normalizeAttempt(item, index + 1));
  const evidence = records(value.evidence).map(normalizeEvidence);
  const risks = records(value.risks).map(normalizeRisk);
  const authorizations = records(value.authorizations).map(normalizeAuthorization);
  const wakeups = records(value.wakeups).map(normalizeWakeup);
  const heartbeat = isRecord(value.heartbeat) ? normalizeHeartbeat(value.heartbeat) : null;
  return {
    projectionVersion: number(value.projectionVersion),
    dossiers, requests, workItems, attempts, evidence, risks, authorizations, wakeups, heartbeat,
  };
}

function normalizeTimeline(value: Record<string, unknown>): PortfolioRequestTimeline {
  const request = normalizeRequest(record(value.request));
  const events: PortfolioTimelineEvent[] = [
    { id: request.id, kind: "request" as const, state: request.status, occurredAt: request.receivedAt, projectionVersion: request.projectionVersion },
    ...records(value.decisions).map((item) => timelineEvent(item, "intake_decision")),
    ...records(value.workItems).map((item) => timelineEvent(item, "work_item")),
  ].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  return { projectionVersion: Math.max(number(value.projectionVersion), ...events.map((event) => event.projectionVersion)), request, events };
}

function normalizeDossier(value: Record<string, unknown>): PortfolioDossier {
  const projectId = string(value.projectId ?? value.project_id, "unknown-project");
  return { id: string(value.id), projectId, projectName: string(value.projectName ?? value.project_name, projectId), objective: string(value.objective, ""), intendedOutcome: nullableString(value.intendedOutcome ?? value.intended_outcome), projectionVersion: number(value.projectionVersion ?? value.projection_version), updatedAt: timestamp(value.updatedAt ?? value.updated_at) };
}

function normalizeRequest(value: Record<string, unknown>): PortfolioRequest {
  const id = string(value.id);
  return { id, projectId: nullableString(value.projectId ?? value.project_id), source: string(value.source, "unknown"), originalText: string(value.originalText ?? value.requestText, ""), status: string(value.status ?? value.state, "received"), correlationId: string(value.correlationId ?? value.correlation_id, "—"), receivedAt: timestamp(value.receivedAt ?? value.received_at ?? value.createdAt ?? value.created_at), projectionVersion: number(value.projectionVersion ?? value.projection_version) };
}

function normalizeWorkItem(value: Record<string, unknown>): PortfolioWorkItem {
  return { id: string(value.id), requestId: string(value.requestId ?? value.request_id), projectId: string(value.projectId ?? value.project_id), title: string(value.title, ""), description: nullableString(value.description), state: string(value.state, "todo") as PortfolioWorkItemState, projectionVersion: number(value.projectionVersion ?? value.projection_version), updatedAt: timestamp(value.updatedAt ?? value.updated_at) };
}

function normalizeAttempt(value: Record<string, unknown>, attemptNumber: number): PortfolioAttempt {
  return { id: string(value.id), requestId: string(value.requestId ?? value.request_id), workItemId: string(value.workItemId ?? value.work_item_id), projectId: string(value.projectId ?? value.project_id), attemptNumber: number(value.attemptNumber ?? value.attempt_number, attemptNumber), state: string(value.state), projectionVersion: number(value.projectionVersion ?? value.projection_version), createdAt: timestamp(value.createdAt ?? value.created_at), updatedAt: timestamp(value.updatedAt ?? value.updated_at) };
}

function normalizeEvidence(value: Record<string, unknown>): PortfolioEvidence {
  return { id: string(value.id), requestId: nullableString(value.requestId ?? value.request_id), workItemId: nullableString(value.workItemId ?? value.work_item_id), attemptId: nullableString(value.attemptId ?? value.attempt_id), projectId: string(value.projectId ?? value.project_id), producer: string(value.producer), sourceCategory: string(value.sourceCategory ?? value.source_category), redactedSummary: string(value.redactedSummary ?? value.redacted_summary, ""), confidence: string(value.confidence), freshness: string(value.freshness), observedAt: timestamp(value.observedAt ?? value.observed_at), projectionVersion: number(value.projectionVersion ?? value.projection_version) };
}

function normalizeRisk(value: Record<string, unknown>): PortfolioRiskSignal {
  const id = string(value.id);
  return { id, projectId: string(value.projectId ?? value.project_id), workItemId: nullableString(value.workItemId ?? value.work_item_id), summary: string(value.summary, ""), severity: string(value.severity, "unknown"), state: string(value.state, "recorded"), projectionVersion: number(value.projectionVersion ?? value.projection_version), updatedAt: timestamp(value.updatedAt ?? value.updated_at ?? value.createdAt ?? value.created_at) };
}

function normalizeAuthorization(value: Record<string, unknown>): PortfolioAuthorization {
  const id = string(value.id);
  return { id, projectId: string(value.projectId ?? value.project_id), workItemId: nullableString(value.workItemId ?? value.work_item_id), actionClass: string(value.actionClass ?? value.action_class, ""), state: string(value.state), authorizationTier: string(value.authorizationTier ?? value.authorization_tier), expiresAt: nullableTimestamp(value.expiresAt ?? value.expires_at), projectionVersion: number(value.projectionVersion ?? value.projection_version), updatedAt: timestamp(value.updatedAt ?? value.updated_at ?? value.createdAt ?? value.created_at) };
}

function normalizeWakeup(value: Record<string, unknown>): PortfolioWorkflowWakeup {
  return { id: string(value.id), projectId: string(value.projectId ?? value.project_id), workItemId: nullableString(value.workItemId ?? value.work_item_id), attemptId: nullableString(value.attemptId ?? value.attempt_id), reasonClass: string(value.reasonClass ?? value.reason_class), state: string(value.state), dueAt: timestamp(value.dueAt ?? value.due_at), attemptCount: number(value.attemptCount ?? value.attempt_count), maxAttempts: number(value.maxAttempts ?? value.max_attempts), projectionVersion: number(value.projectionVersion ?? value.projection_version) };
}

function normalizeHeartbeat(value: Record<string, unknown>): PortfolioHeartbeat {
  return { enabled: value.enabled === true, cadenceMinutes: numberOrNull(value.cadenceMinutes ?? value.cadence_minutes), lastObservedAt: nullableTimestamp(value.lastObservedAt ?? value.last_observed_at), state: nullableString(value.state), projectionVersion: number(value.projectionVersion ?? value.projection_version) };
}

function timelineEvent(value: Record<string, unknown>, kind: "intake_decision" | "work_item"): PortfolioTimelineEvent {
  return { id: string(value.id), kind, state: nullableString(value.state), occurredAt: timestamp(value.createdAt ?? value.created_at ?? value.updatedAt ?? value.updated_at), projectionVersion: number(value.projectionVersion ?? value.projection_version) };
}

function records(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.filter(isRecord) : []; }
function record(value: unknown): Record<string, unknown> { return isRecord(value) ? value : {}; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function string(value: unknown, fallback = "unknown"): string { return typeof value === "string" && value.length > 0 ? value : fallback; }
function nullableString(value: unknown): string | null { return typeof value === "string" && value.length > 0 ? value : null; }
function number(value: unknown, fallback = 0): number { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
function numberOrNull(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function timestamp(value: unknown): string { return typeof value === "string" && value.length > 0 ? value : ""; }
function nullableTimestamp(value: unknown): string | null { const result = timestamp(value); return result || null; }
