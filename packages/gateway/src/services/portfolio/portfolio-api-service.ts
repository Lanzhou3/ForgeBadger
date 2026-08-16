import type { Database } from "../../db/types.js";
import {
  PortfolioRepository,
  type PortfolioStateRecordType
} from "../../db/repositories/portfolio-repository.js";
import { PortfolioSchedulerRepository } from "../../db/repositories/portfolio-scheduler-repository.js";
import { OpenForgeEventBus } from "../event-bus.js";
import { PortfolioIntakeService, type CreateRequestInput, type DecideIntakeInput, type EnrollProjectInput, type ResolveOwnerDecisionInput, type UpdateDossierInput } from "./intake-service.js";
import { createPlatformToolManifestService } from "./platform-tool-manifest.js";
import { createTaskPacketService } from "./task-packet-service.js";
import { createPortfolioFeishuControlFacade } from "./feishu/control-facade.js";

export type PortfolioProjectionKind =
  | "request"
  | "intake_decision"
  | "dossier"
  | "work_item"
  | "task_attempt"
  | "authorization"
  | "observation"
  | "risk"
  | "wakeup"
  | "heartbeat";

export interface PortfolioProjectionEventInput {
  kind: PortfolioProjectionKind;
  recordId: string;
  projectId?: string | undefined;
  state?: string | undefined;
  projectionVersion?: number | undefined;
  correlationId?: string | undefined;
  summary?: string | undefined;
}

/**
 * The event facade deliberately accepts only a small projection allowlist.
 * It never receives worker capabilities, terminal writers, or runtime ports.
 */
export interface PortfolioEventFacade {
  publish(userId: string, event: PortfolioProjectionEventInput): void;
}

export interface PortfolioApiFacade {
  forUser(userId: string): PortfolioUserApi;
}

export interface PortfolioUserApi {
  getOverview(input: { projectId?: string; limit?: number }): unknown;
  enrollProject(input: EnrollProjectInput): unknown;
  updateDossier(input: UpdateDossierInput): unknown;
  getDossier(projectId: string): unknown;
  createRequest(input: CreateRequestInput): unknown;
  listRequests(input: { projectId?: string; limit?: number }): unknown[];
  getRequestTimeline(requestId: string): unknown;
  decideIntake(input: DecideIntakeInput): unknown;
  resolveOwnerDecision(input: ResolveOwnerDecisionInput): unknown;
  getWorkItem(workItemId: string): unknown;
  prepareAttempt(input: { projectId: string; workItemId: string; adapter: string; idempotencyKey: string; skillVersion: string; toolIds: string[]; trackingEnabled?: boolean }): unknown;
  getAttempt(attemptId: string): unknown;
  getAuthorization(authorizationId: string): unknown;
  transition(input: { recordType: PortfolioStateRecordType; recordId: string; toState: string; expectedProjectionVersion: number; attemptId?: string; correlationId?: string; idempotencyKey: string }): unknown;
  getObservation(projectId: string): unknown;
  getRisk(riskId: string): unknown;
  getWakeup(wakeupId: string): unknown;
  getHeartbeat(): unknown;
  setHeartbeat(input: { enabled: boolean; cadenceMinutes?: number; idempotencyKey: string }): unknown;
  provisionFeishuBinding(input: { providerAccountId: string; externalIdentity: string; conversationId: string; isOwner: boolean; projectId?: string; idempotencyKey: string }): unknown;
}

/**
 * Builds the sole HTTP/WebSocket-safe Portfolio boundary.  Its per-user
 * methods are composed from durable domain services and repositories only.
 */
export function createPortfolioApiFacade(input: {
  db: Database;
  events: PortfolioEventFacade;
}): PortfolioApiFacade {
  return Object.freeze({
    forUser(userId: string): PortfolioUserApi {
      const repository = new PortfolioRepository(input.db, userId);
      const intake = new PortfolioIntakeService(input.db, userId);
      const scheduler = new PortfolioSchedulerRepository(input.db, userId);
      const packets = createTaskPacketService(repository, createPlatformToolManifestService());
      const feishu = createPortfolioFeishuControlFacade(input.db).forOwner({ userId, actorUserId: userId });

      function publish(event: PortfolioProjectionEventInput): void {
        input.events.publish(userId, event);
      }

      return Object.freeze<PortfolioUserApi>({
        getOverview(value) {
          return buildOverview(input.db, userId, repository, scheduler, value);
        },
        enrollProject(value) {
          const result = intake.enrollProject(value);
          publish({ kind: "dossier", recordId: result.dossier.id, projectId: value.projectId, projectionVersion: result.dossier.projectionVersion, summary: "project_enrolled" });
          return result;
        },
        updateDossier(value) {
          const dossier = intake.updateDossier(value);
          publish({ kind: "dossier", recordId: dossier.id, projectId: dossier.projectId, projectionVersion: dossier.projectionVersion, summary: "dossier_updated" });
          return dossier;
        },
        getDossier: (projectId) => repository.getDossierDisplay(projectId),
        createRequest(value) {
          const request = intake.createRequest(value);
          publish({ kind: "request", recordId: request.id, ...(request.projectId ? { projectId: request.projectId } : {}), state: request.state, projectionVersion: request.projectionVersion, correlationId: request.correlationId, summary: "request_created" });
          return request;
        },
        listRequests: (value) => repository.listRequests(value),
        getRequestTimeline: (requestId) => intake.getRequestTimeline(requestId),
        decideIntake(value) {
          const outcome = intake.decideIntake(value);
          publish({ kind: "intake_decision", recordId: outcome.decision.id, ...(outcome.request.projectId ? { projectId: outcome.request.projectId } : {}), state: outcome.request.state, projectionVersion: outcome.request.projectionVersion, correlationId: outcome.request.correlationId, summary: "intake_decided" });
          return outcome;
        },
        resolveOwnerDecision(value) {
          const outcome = intake.resolveOwnerDecision(value);
          publish({ kind: "work_item", recordId: outcome.workItem?.id ?? outcome.request.id, projectId: outcome.request.projectId ?? value.projectId, state: outcome.request.state, projectionVersion: outcome.request.projectionVersion, correlationId: outcome.request.correlationId, summary: "owner_decision_recorded" });
          return outcome;
        },
        getWorkItem: (workItemId) => repository.getWorkItem(workItemId),
        prepareAttempt(value) {
          const prepared = packets.prepareAttempt({ ...value, createdBy: userId });
          publish({ kind: "task_attempt", recordId: prepared.attempt.id, projectId: prepared.attempt.projectId, state: prepared.attempt.state, projectionVersion: prepared.attempt.projectionVersion, summary: "attempt_prepared" });
          return prepared;
        },
        getAttempt: (attemptId) => repository.getTaskAttempt(attemptId),
        getAuthorization: (authorizationId) => repository.getAuthorization(authorizationId),
        transition(value) {
          const transition = repository.createStateGate().transition({ ...value, actorId: userId, toState: value.toState as never });
          publish({ kind: projectionKindFor(value.recordType), recordId: value.recordId, state: transition.toState, projectionVersion: transition.projectionVersion, ...(value.correlationId ? { correlationId: value.correlationId } : {}), summary: "state_transitioned" });
          return transition;
        },
        getObservation(projectId) {
          const profile = repository.getObservationProfile(projectId);
          return profile ? { profile, probes: ["platform_lifecycle_v1", "git_state_v1"].map((source) => repository.getObservationProbe(projectId, source as "platform_lifecycle_v1" | "git_state_v1")) } : undefined;
        },
        getRisk: (riskId) => readRows(input.db, "SELECT id, project_id, severity, state, projection_version, created_at FROM portfolio_risk_signals WHERE id = ? AND user_id = ?", [riskId, userId])[0],
        getWakeup: (wakeupId) => repository.getWorkflowWakeup(wakeupId),
        getHeartbeat: () => scheduler.getHeartbeat(),
        setHeartbeat(value) {
          const heartbeat = scheduler.setHeartbeat({ ...value, now: new Date() });
          publish({ kind: "heartbeat", recordId: userId, state: heartbeat.enabled ? "enabled" : "disabled", projectionVersion: heartbeat.projectionVersion, summary: "heartbeat_updated" });
          return heartbeat;
        },
        provisionFeishuBinding(value) {
          return feishu.provisionActiveBinding(value);
        }
      });
    }
  });
}

type SqlRow = Record<string, unknown>;

/** Read projection intentionally selects only display-safe Portfolio columns. */
function buildOverview(
  db: Database,
  userId: string,
  repository: PortfolioRepository,
  scheduler: PortfolioSchedulerRepository,
  input: { projectId?: string; limit?: number }
): Record<string, unknown> {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
  const projectClause = input.projectId ? " AND project_id = ?" : "";
  const projectParams = input.projectId ? [userId, input.projectId, limit] : [userId, limit];
  const requests = repository.listRequests({ ...(input.projectId ? { projectId: input.projectId } : {}), limit });
  return {
    projectionVersion: Math.max(0, ...requests.map((request) => request.projectionVersion)),
    dossiers: readRows(db, `SELECT id, project_id, objective, intended_outcome, projection_version, created_at, updated_at
      FROM portfolio_project_dossiers WHERE user_id = ?${projectClause} ORDER BY updated_at DESC LIMIT ?`, projectParams),
    requests: requests.map((request) => ({ id: request.id, projectId: request.projectId, source: request.source, state: request.state, projectionVersion: request.projectionVersion, correlationId: request.correlationId, receivedAt: request.receivedAt, createdAt: request.createdAt, updatedAt: request.updatedAt })),
    workItems: readRows(db, `SELECT id, project_id, request_id, title, state, projection_version, created_at, updated_at
      FROM portfolio_work_items WHERE user_id = ?${projectClause} ORDER BY updated_at DESC LIMIT ?`, projectParams),
    attempts: readRows(db, `SELECT id, project_id, work_item_id, request_id, adapter, tracking_enabled, state, projection_version, created_at, updated_at
      FROM portfolio_task_attempts WHERE user_id = ?${projectClause} ORDER BY updated_at DESC LIMIT ?`, projectParams),
    evidence: readRows(db, `SELECT id, project_id, request_id, work_item_id, attempt_id, producer, source_category, observed_at,
      collected_at, digest, redacted_summary, confidence, freshness, is_blocker, created_at
      FROM portfolio_evidence WHERE user_id = ?${projectClause} ORDER BY collected_at DESC LIMIT ?`, projectParams),
    risks: readRows(db, `SELECT id, project_id, work_item_id, attempt_id, severity, state, projection_version, created_at
      FROM portfolio_risk_signals WHERE user_id = ?${projectClause} ORDER BY created_at DESC LIMIT ?`, projectParams),
    authorizations: readRows(db, `SELECT id, project_id, work_item_id, attempt_id, authorization_tier, state, projection_version,
      expires_at, consumed_at, created_at, updated_at FROM portfolio_execution_authorizations
      WHERE user_id = ?${projectClause} ORDER BY updated_at DESC LIMIT ?`, projectParams),
    wakeups: readRows(db, `SELECT id, project_id, work_item_id, attempt_id, reason_class, state, projection_version, due_at,
      attempt_count, max_attempts, created_at, updated_at FROM portfolio_workflow_wakeups
      WHERE user_id = ?${projectClause} ORDER BY due_at ASC LIMIT ?`, projectParams),
    heartbeat: scheduler.getHeartbeat() ?? { enabled: false, cadenceMinutes: null, projectionVersion: 0 }
  };
}

function readRows(db: Database, sql: string, parameters: unknown[]): SqlRow[] {
  return db.prepare(sql).all(...parameters) as SqlRow[];
}

export function createPortfolioEventFacade(eventBus: OpenForgeEventBus): PortfolioEventFacade {
  return Object.freeze<PortfolioEventFacade>({
    publish(userId, event) {
      eventBus.emitEvent({
        type: "portfolio_projection_updated",
        userId,
        ...event,
        occurredAt: new Date()
      });
    }
  });
}

function projectionKindFor(recordType: PortfolioStateRecordType): PortfolioProjectionKind {
  const kinds: Record<PortfolioStateRecordType, PortfolioProjectionKind> = {
    request: "request",
    work_item: "work_item",
    task_attempt: "task_attempt",
    authorization: "authorization",
    wakeup: "wakeup",
    acceptance_decision: "authorization"
  };
  return kinds[recordType];
}
