import { createHash, randomUUID } from "node:crypto";

import type { Database } from "../types.js";
import type { PortfolioEvidence, PortfolioHeartbeatSetting, PortfolioWorkflowWakeup } from "./portfolio-repository.js";
import { type ObservationDraft } from "../../services/portfolio/observation-contract.js";

export type ReconciliationSource = "wakeup" | "heartbeat";
export type ReconciliationRunState = "scheduled" | "claimed" | "completed" | "retry_scheduled" | "exhausted" | "cancelled" | "unknown";

export class PortfolioSchedulerError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PortfolioSchedulerError";
  }
}

export interface PortfolioReconciliationClaim {
  runId: string;
  source: ReconciliationSource;
  sourceRecordId: string;
  projectId: string | null;
  attemptId: string | null;
  claimToken: string;
  claimLeaseExpiresAt: Date;
  attemptCount: number;
}

export interface PortfolioReconciliationRun {
  id: string;
  source: ReconciliationSource;
  sourceRecordId: string;
  idempotencySlot: string;
  state: ReconciliationRunState;
  projectionVersion: number;
  claimTokenDigest: string | null;
  claimLeaseExpiresAt: Date | null;
  attemptCount: number;
  retryBudget: number;
  resultDigest: string | null;
  errorCode: string | null;
  errorDigest: string | null;
  wakeupId: string | null;
  heartbeatUserId: string | null;
  scheduledAt: Date;
  claimedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PortfolioReconciliationFinalization {
  status: "completed" | "retry_scheduled" | "exhausted";
  evidence: PortfolioEvidence[];
}

interface Row extends Record<string, unknown> {}

const CLAIM_LEASE_MS = 60_000;
const WAKEUP_RETRY_BUDGET = 3;
const HEARTBEAT_RETRY_BUDGET = 3;
const MAX_DUE_CLAIMS = 20;
const retryDelays = [60_000, 300_000, 1_800_000] as const;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function digestValue(value: unknown): string {
  return digest(JSON.stringify(value));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function asDate(value: unknown): Date {
  return new Date(typeof value === "number" ? value : 0);
}

function nullableDate(value: unknown): Date | null {
  return typeof value === "number" ? new Date(value) : null;
}

function asString(row: Row, key: string): string {
  return typeof row[key] === "string" ? row[key] : "";
}

function nullableString(row: Row, key: string): string | null {
  return typeof row[key] === "string" ? row[key] as string : null;
}

function asNumber(row: Row, key: string): number {
  return typeof row[key] === "number" ? row[key] : 0;
}

function isClaimableState(value: string): value is "scheduled" | "retry_scheduled" {
  return value === "scheduled" || value === "retry_scheduled";
}

function retryDelay(attemptCount: number): number | null {
  return retryDelays[attemptCount - 1] ?? null;
}

/**
 * Tenant-scoped durable reconciliation authority. Raw legacy Wakeup claims
 * are deliberately absent: ledger CAS and finalization are the sole owner.
 */
export class PortfolioSchedulerRepository {
  constructor(private readonly db: Database, private readonly userId: string) {}

  scheduleWakeup(input: {
    projectId: string;
    workItemId: string;
    attemptId: string;
    reasonClass: string;
    dueAt: Date;
    coalescingKey: string;
    idempotencyKey: string;
    now: Date;
  }): PortfolioWorkflowWakeup {
    return this.db.transaction(() => this.scheduleOrCoalesceWakeup(input))();
  }

  claimDue(now: Date, limit: number): PortfolioReconciliationClaim[] {
    const boundedLimit = Math.min(Math.max(limit, 1), MAX_DUE_CLAIMS);
    const rows = this.db.prepare(`SELECT run.id FROM portfolio_reconciliation_runs run
      LEFT JOIN portfolio_workflow_wakeups wakeup ON run.source = 'wakeup'
        AND wakeup.user_id = run.user_id AND wakeup.id = run.wakeup_id
      LEFT JOIN portfolio_heartbeat_settings heartbeat ON run.source = 'heartbeat'
        AND heartbeat.user_id = run.heartbeat_user_id
      WHERE run.user_id = ? AND run.state IN ('scheduled', 'retry_scheduled')
        AND ((run.source = 'wakeup' AND wakeup.state IN ('scheduled', 'retry_scheduled') AND wakeup.due_at <= ?)
          OR (run.source = 'heartbeat' AND heartbeat.enabled = 1 AND run.scheduled_at <= ?))
      ORDER BY run.scheduled_at, run.created_at, run.id LIMIT ?`)
      .all(this.userId, now.getTime(), now.getTime(), boundedLimit) as Row[];
    return rows.map((row) => this.claimRun(asString(row, "id"), now)).filter((claim): claim is PortfolioReconciliationClaim => claim !== undefined);
  }

  /**
   * Persists all V1 evidence, advisory risks, the safe reconciliation fact,
   * and source projections atomically after checking the ledger claim token.
   */
  finalizeClaim(input: {
    claim: PortfolioReconciliationClaim;
    drafts: readonly ObservationDraft[];
    now: Date;
  }): PortfolioReconciliationFinalization {
    return this.db.transaction(() => this.finalizeClaimTransaction(input))();
  }

  /** Startup writes unknown before a later transaction schedules a new read-only successor. */
  recoverExpired(now: Date): PortfolioReconciliationClaim[] {
    const rows = this.db.prepare(`SELECT * FROM portfolio_reconciliation_runs
      WHERE user_id = ? AND state = 'claimed' AND claim_lease_expires_at IS NOT NULL
        AND claim_lease_expires_at <= ?`).all(this.userId, now.getTime()) as Row[];
    const recovered: PortfolioReconciliationClaim[] = [];
    for (const row of rows) {
      const unknown = this.db.transaction(() => this.markUnknown(row, now))();
      if (!unknown) continue;
      this.db.transaction(() => this.scheduleRecoverySuccessor(unknown, now))();
      recovered.push({
        runId: unknown.id,
        source: unknown.source,
        sourceRecordId: unknown.sourceRecordId,
        projectId: this.projectIdForRun(unknown),
        attemptId: this.attemptIdForRun(unknown),
        claimToken: "",
        claimLeaseExpiresAt: now,
        attemptCount: unknown.attemptCount
      });
    }
    return recovered;
  }

  /** A user mutation, so replay is scoped by the durable Portfolio operation key. */
  setHeartbeat(input: { enabled: boolean; cadenceMinutes?: number; idempotencyKey: string; now: Date }): PortfolioHeartbeatSetting {
    if (input.enabled && !isCadence(input.cadenceMinutes)) throw new PortfolioSchedulerError("PORTFOLIO_HEARTBEAT_CADENCE_INVALID");
    if (!input.enabled && input.cadenceMinutes !== undefined && !isCadence(input.cadenceMinutes)) {
      throw new PortfolioSchedulerError("PORTFOLIO_HEARTBEAT_CADENCE_INVALID");
    }
    return this.db.transaction(() => this.setHeartbeatIdempotently(input))();
  }

  private setHeartbeatIdempotently(input: { enabled: boolean; cadenceMinutes?: number; idempotencyKey: string; now: Date }): PortfolioHeartbeatSetting {
    const operation = "heartbeat.set";
    const payloadDigest = digest(stableJson({ enabled: input.enabled, cadenceMinutes: input.cadenceMinutes ?? null }));
    const existingOperation = this.db.prepare(`SELECT payload_digest, result_json FROM portfolio_operation_records
      WHERE user_id = ? AND operation = ? AND idempotency_key = ?`).get(this.userId, operation, input.idempotencyKey) as Row | undefined;
    if (existingOperation) {
      if (asString(existingOperation, "payload_digest") !== payloadDigest) throw new PortfolioSchedulerError("PORTFOLIO_IDEMPOTENCY_CONFLICT");
      return heartbeatFromOperationResult(existingOperation.result_json);
    }
    const existing = this.getHeartbeat();
    const cadence = input.cadenceMinutes ?? existing?.cadenceMinutes ?? null;
    this.db.prepare(`INSERT INTO portfolio_heartbeat_settings (user_id, enabled, cadence_minutes, projection_version, last_reconciled_at, created_at, updated_at)
      VALUES (?, ?, ?, 1, NULL, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET enabled = excluded.enabled, cadence_minutes = excluded.cadence_minutes,
        projection_version = portfolio_heartbeat_settings.projection_version + 1, updated_at = excluded.updated_at`)
      .run(this.userId, input.enabled ? 1 : 0, cadence, input.now.getTime(), input.now.getTime());
    const heartbeat = this.getHeartbeat() as PortfolioHeartbeatSetting;
    this.db.prepare(`INSERT INTO portfolio_operation_records (id, user_id, operation, idempotency_key, payload_digest, result_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), this.userId, operation, input.idempotencyKey, payloadDigest, JSON.stringify(heartbeatOperationResult(heartbeat)), input.now.getTime());
    return heartbeat;
  }

  scheduleDueHeartbeat(now: Date): void {
    const heartbeat = this.getHeartbeat();
    if (!heartbeat?.enabled || !heartbeat.cadenceMinutes || !isHeartbeatDue(heartbeat, now)) return;
    if (this.listObservableProjectIds().length === 0) return;
    const idempotencySlot = heartbeat.lastReconciledAt ? `heartbeat:${heartbeat.lastReconciledAt.getTime()}` : "heartbeat:initial";
    this.db.prepare(`INSERT OR IGNORE INTO portfolio_reconciliation_runs (id, user_id, source, source_record_id, idempotency_slot, state,
      projection_version, attempt_count, retry_budget, heartbeat_user_id, scheduled_at, created_at, updated_at)
      VALUES (?, ?, 'heartbeat', ?, ?, 'scheduled', 1, 0, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), this.userId, this.userId, idempotencySlot, HEARTBEAT_RETRY_BUDGET, this.userId, now.getTime(), now.getTime(), now.getTime());
  }

  getHeartbeat(): PortfolioHeartbeatSetting | undefined {
    const row = this.db.prepare("SELECT * FROM portfolio_heartbeat_settings WHERE user_id = ?").get(this.userId) as Row | undefined;
    return row ? toHeartbeat(row) : undefined;
  }

  getRun(runId: string): PortfolioReconciliationRun | undefined {
    const row = this.db.prepare("SELECT * FROM portfolio_reconciliation_runs WHERE id = ? AND user_id = ?").get(runId, this.userId) as Row | undefined;
    return row ? toRun(row) : undefined;
  }

  listObservableProjectIds(): string[] {
    const rows = this.db.prepare(`SELECT DISTINCT enrollment.project_id FROM portfolio_projects enrollment
      INNER JOIN portfolio_observation_profiles profile ON profile.user_id = enrollment.user_id AND profile.project_id = enrollment.project_id
      WHERE enrollment.user_id = ? AND enrollment.enrollment_status = 'active' AND profile.status = 'active'
        AND profile.approved_root_path IS NOT NULL AND profile.approved_root_device IS NOT NULL AND profile.approved_root_inode IS NOT NULL`)
      .all(this.userId) as Row[];
    return rows.map((row) => asString(row, "project_id")).filter(Boolean);
  }

  private scheduleOrCoalesceWakeup(input: {
    projectId: string; workItemId: string; attemptId: string; reasonClass: string; dueAt: Date; coalescingKey: string; idempotencyKey: string; now: Date;
  }): PortfolioWorkflowWakeup {
    const existingByKey = this.db.prepare(`SELECT * FROM portfolio_workflow_wakeups WHERE user_id = ? AND idempotency_key = ?`)
      .get(this.userId, input.idempotencyKey) as Row | undefined;
    if (existingByKey) {
      if (asString(existingByKey, "input_digest") !== digestValue(wakeupInputDigest(input))) throw new PortfolioSchedulerError("PORTFOLIO_IDEMPOTENCY_CONFLICT");
      return toWakeup(existingByKey);
    }
    const attempt = this.db.prepare(`SELECT id FROM portfolio_task_attempts WHERE id = ? AND user_id = ? AND project_id = ? AND work_item_id = ?
      AND tracking_enabled = 1`).get(input.attemptId, this.userId, input.projectId, input.workItemId) as Row | undefined;
    if (!attempt) throw new PortfolioSchedulerError("PORTFOLIO_WAKEUP_TRACKING_REQUIRED");
    const compatible = this.db.prepare(`SELECT * FROM portfolio_workflow_wakeups WHERE user_id = ? AND attempt_id = ? AND reason_class = ?
      AND coalescing_key = ? AND state IN ('scheduled', 'retry_scheduled') AND active_slot = 'active' LIMIT 1`)
      .get(this.userId, input.attemptId, input.reasonClass, input.coalescingKey) as Row | undefined;
    if (compatible) return this.coalesceWakeup(compatible, input);
    const id = randomUUID();
    this.db.prepare(`INSERT INTO portfolio_workflow_wakeups (id, user_id, project_id, work_item_id, attempt_id, reason_class, state, due_at,
      coalescing_key, active_slot, attempt_count, max_attempts, idempotency_key, input_digest, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, 'active', 0, 4, ?, ?, ?, ?)`)
      .run(id, this.userId, input.projectId, input.workItemId, input.attemptId, input.reasonClass, input.dueAt.getTime(), input.coalescingKey,
        input.idempotencyKey, digestValue(wakeupInputDigest(input)), input.now.getTime(), input.now.getTime());
    this.insertWakeupRun(id, input.dueAt, input.now, "primary");
    return this.getWakeup(id) as PortfolioWorkflowWakeup;
  }

  private coalesceWakeup(compatible: Row, input: {
    projectId: string; workItemId: string; attemptId: string; reasonClass: string; dueAt: Date; coalescingKey: string; idempotencyKey: string; now: Date;
  }): PortfolioWorkflowWakeup {
    const dueAt = Math.min(asNumber(compatible, "due_at"), input.dueAt.getTime());
    const wakeupId = asString(compatible, "id");
    const update = this.db.prepare(`UPDATE portfolio_workflow_wakeups SET due_at = ?, projection_version = projection_version + 1, updated_at = ?
      WHERE id = ? AND user_id = ? AND projection_version = ?`).run(dueAt, input.now.getTime(), wakeupId, this.userId, asNumber(compatible, "projection_version"));
    if (update.changes !== 1) throw new PortfolioSchedulerError("PORTFOLIO_RECONCILIATION_CLAIM_LOST");
    const existingRun = this.db.prepare(`SELECT id FROM portfolio_reconciliation_runs
      WHERE user_id = ? AND source = 'wakeup' AND wakeup_id = ? AND state IN ('scheduled', 'retry_scheduled') LIMIT 1`)
      .get(this.userId, wakeupId) as Row | undefined;
    if (!existingRun) this.insertWakeupRun(wakeupId, new Date(dueAt), input.now, `coalesced:${input.idempotencyKey}`);
    this.db.prepare(`UPDATE portfolio_reconciliation_runs SET scheduled_at = ?, projection_version = projection_version + 1, updated_at = ?
      WHERE user_id = ? AND source = 'wakeup' AND wakeup_id = ? AND state IN ('scheduled', 'retry_scheduled')`)
      .run(dueAt, input.now.getTime(), this.userId, wakeupId);
    return this.getWakeup(wakeupId) as PortfolioWorkflowWakeup;
  }

  private insertWakeupRun(wakeupId: string, dueAt: Date, now: Date, slot: string): void {
    this.db.prepare(`INSERT INTO portfolio_reconciliation_runs (id, user_id, source, source_record_id, idempotency_slot, state,
      projection_version, attempt_count, retry_budget, wakeup_id, scheduled_at, created_at, updated_at)
      VALUES (?, ?, 'wakeup', ?, ?, 'scheduled', 1, 0, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), this.userId, wakeupId, slot, WAKEUP_RETRY_BUDGET, wakeupId, dueAt.getTime(), now.getTime(), now.getTime());
  }

  private claimRun(runId: string, now: Date): PortfolioReconciliationClaim | undefined {
    return this.db.transaction(() => {
      const run = this.getRun(runId);
      if (!run || !isClaimableState(run.state) || run.attemptCount >= run.retryBudget + 1) return undefined;
      const token = randomUUID();
      const expiresAt = new Date(now.getTime() + CLAIM_LEASE_MS);
      const update = this.db.prepare(`UPDATE portfolio_reconciliation_runs SET state = 'claimed', projection_version = projection_version + 1,
        claim_token_digest = ?, claim_lease_expires_at = ?, attempt_count = attempt_count + 1, claimed_at = ?, updated_at = ?
        WHERE id = ? AND user_id = ? AND projection_version = ? AND state IN ('scheduled', 'retry_scheduled')
          AND attempt_count < retry_budget + 1`)
        .run(digest(token), expiresAt.getTime(), now.getTime(), now.getTime(), run.id, this.userId, run.projectionVersion);
      if (update.changes !== 1) return undefined;
      if (run.source === "wakeup") this.claimWakeupProjection(run.wakeupId, now);
      const claimed = this.getRun(run.id) as PortfolioReconciliationRun;
      return {
        runId: claimed.id,
        source: claimed.source,
        sourceRecordId: claimed.sourceRecordId,
        projectId: this.projectIdForRun(claimed),
        attemptId: this.attemptIdForRun(claimed),
        claimToken: token,
        claimLeaseExpiresAt: expiresAt,
        attemptCount: claimed.attemptCount
      };
    })();
  }

  private claimWakeupProjection(wakeupId: string | null, now: Date): void {
    if (!wakeupId) throw new PortfolioSchedulerError("PORTFOLIO_RECONCILIATION_SOURCE_INVALID");
    const result = this.db.prepare(`UPDATE portfolio_workflow_wakeups SET state = 'claimed', projection_version = projection_version + 1,
      attempt_count = attempt_count + 1, updated_at = ? WHERE id = ? AND user_id = ? AND state IN ('scheduled', 'retry_scheduled')`)
      .run(now.getTime(), wakeupId, this.userId);
    if (result.changes !== 1) throw new PortfolioSchedulerError("PORTFOLIO_RECONCILIATION_CLAIM_LOST");
  }

  private finalizeClaimTransaction(input: {
    claim: PortfolioReconciliationClaim; drafts: readonly ObservationDraft[]; now: Date;
  }): PortfolioReconciliationFinalization {
    const run = this.assertLiveClaim(input.claim, input.now);
    this.assertDraftScope(run, input.drafts);
    const evidence = input.drafts.flatMap((draft) => this.persistDraftIfEligible(run, draft, input.now));
    const failedDraft = input.drafts.find((draft) => draft.errorCode !== undefined);
    for (const draft of input.drafts) {
      if (!draft.errorCode) continue;
      const persisted = evidence.find((item) => item.projectId === draft.projectId && item.sourceCategory === draft.source);
      if (persisted) this.persistAdvisoryRisk(run, persisted, draft.errorCode, input.now);
    }
    const failed = failedDraft?.errorCode;
    const exhausted = Boolean(failed) && run.attemptCount >= run.retryBudget + 1;
    const state: "completed" | "retry_scheduled" | "exhausted" = failed ? (exhausted ? "exhausted" : "retry_scheduled") : "completed";
    const scheduledAt = state === "retry_scheduled" ? input.now.getTime() + (retryDelay(run.attemptCount) ?? 0) : input.now.getTime();
    const resultDigest = failed ? null : digestValue({ evidence: evidence.map((item) => item.id) });
    const errorDigest = failed ? digestValue({ code: failed, evidence: evidence.map((item) => item.id) }) : null;
    const update = this.db.prepare(`UPDATE portfolio_reconciliation_runs SET state = ?, projection_version = projection_version + 1,
      claim_token_digest = NULL, claim_lease_expires_at = NULL, result_digest = ?, error_code = ?, error_digest = ?, scheduled_at = ?,
      completed_at = CASE WHEN ? IN ('completed', 'exhausted') THEN ? ELSE completed_at END, updated_at = ?
      WHERE id = ? AND user_id = ? AND projection_version = ? AND state = 'claimed' AND claim_token_digest = ?`)
      .run(state, resultDigest, failed ?? null, errorDigest, scheduledAt, state, input.now.getTime(), input.now.getTime(),
        run.id, this.userId, run.projectionVersion, digest(input.claim.claimToken));
    if (update.changes !== 1) throw new PortfolioSchedulerError("PORTFOLIO_RECONCILIATION_CLAIM_LOST");
    if (run.source === "wakeup") this.completeWakeupProjection(run.wakeupId, state, scheduledAt, failed, input.now);
    if (run.source === "heartbeat" && state === "completed") this.markHeartbeatReconciled(input.now);
    this.appendReconciliationFact(run, input.claim, evidence, state, failed, input.now);
    return { status: state, evidence };
  }

  private assertLiveClaim(claim: PortfolioReconciliationClaim, now: Date): PortfolioReconciliationRun {
    const run = this.getRun(claim.runId);
    if (!run || run.state !== "claimed" || run.claimTokenDigest !== digest(claim.claimToken)
      || !run.claimLeaseExpiresAt || run.claimLeaseExpiresAt.getTime() < now.getTime()) {
      throw new PortfolioSchedulerError("PORTFOLIO_RECONCILIATION_CLAIM_LOST");
    }
    return run;
  }

  private assertDraftScope(run: PortfolioReconciliationRun, drafts: readonly ObservationDraft[]): void {
    if (drafts.length === 0) throw new PortfolioSchedulerError("PORTFOLIO_RECONCILIATION_NO_OBSERVABLE_PROJECT");
    const projectId = this.projectIdForRun(run);
    if (projectId && drafts.some((draft) => draft.projectId !== projectId)) {
      throw new PortfolioSchedulerError("PORTFOLIO_RECONCILIATION_SOURCE_INVALID");
    }
  }

  private persistDraftIfEligible(run: PortfolioReconciliationRun, draft: ObservationDraft, now: Date): PortfolioEvidence[] {
    if (!this.hasActiveObservationProfile(draft.projectId, draft.source)) return [];
    const id = randomUUID();
    const idempotencyKey = `reconciliation:${run.id}:${run.attemptCount}:${draft.projectId}:${draft.source}`;
    const summary = draft.redactedSummary.slice(0, 1_024);
    this.db.prepare(`INSERT INTO portfolio_evidence (id, user_id, project_id, request_id, work_item_id, attempt_id, producer, source_category,
      observed_at, collected_at, digest, redacted_summary, confidence, freshness, is_blocker, verification_key, idempotency_key, input_digest, created_at)
      VALUES (?, ?, ?, NULL, NULL, ?, 'portfolio_reconciliation_v1', ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)`)
      .run(id, this.userId, draft.projectId, this.attemptIdForRun(run), draft.source, draft.observedAt.getTime(), draft.collectedAt.getTime(),
        draft.digest, summary, draft.freshness === "fresh" ? "trusted_platform" : "low", draft.freshness, idempotencyKey,
        digestValue({ runId: run.id, draft }), now.getTime());
    const row = this.db.prepare("SELECT * FROM portfolio_evidence WHERE id = ? AND user_id = ?").get(id, this.userId) as Row | undefined;
    return row ? [toEvidence(row)] : [];
  }

  private hasActiveObservationProfile(projectId: string, source: ObservationDraft["source"]): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM portfolio_projects enrollment
      INNER JOIN portfolio_observation_profiles profile ON profile.user_id = enrollment.user_id AND profile.project_id = enrollment.project_id
      INNER JOIN portfolio_observation_probes probe ON probe.user_id = profile.user_id AND probe.profile_id = profile.id
      WHERE enrollment.user_id = ? AND enrollment.project_id = ? AND enrollment.enrollment_status = 'active' AND profile.status = 'active'
        AND profile.approved_root_path IS NOT NULL AND profile.approved_root_device IS NOT NULL AND profile.approved_root_inode IS NOT NULL
        AND probe.source_category = ? AND probe.operation = ? AND probe.enabled = 1 LIMIT 1`)
      .get(this.userId, projectId, source, source));
  }

  private persistAdvisoryRisk(run: PortfolioReconciliationRun, evidence: PortfolioEvidence, errorCode: string, now: Date): void {
    const id = randomUUID();
    const idempotencyKey = `reconciliation-risk:${run.id}:${run.attemptCount}:${evidence.id}`;
    this.db.prepare(`INSERT INTO portfolio_risk_signals (id, user_id, project_id, work_item_id, attempt_id, evidence_id, severity, rationale, state,
      projection_version, idempotency_key, input_digest, created_at)
      VALUES (?, ?, ?, NULL, ?, ?, 'low', ?, 'open', 1, ?, ?, ?)`)
      .run(id, this.userId, evidence.projectId, this.attemptIdForRun(run), evidence.id, `Observation failure: ${errorCode}`,
        idempotencyKey, digestValue({ runId: run.id, evidenceId: evidence.id, errorCode }), now.getTime());
  }

  private appendReconciliationFact(
    run: PortfolioReconciliationRun,
    claim: PortfolioReconciliationClaim,
    evidence: PortfolioEvidence[],
    state: "completed" | "retry_scheduled" | "exhausted",
    errorCode: string | undefined,
    now: Date
  ): void {
    const payload = { source: run.source, state, errorCode: errorCode ?? null, evidenceIds: evidence.map((item) => item.id) };
    const factProjectId = claim.projectId ?? evidence[0]?.projectId ?? null;
    this.db.prepare(`INSERT INTO portfolio_facts (id, user_id, project_id, request_id, work_item_id, attempt_id, record_type, record_id,
      fact_type, correlation_id, idempotency_key, payload_json, payload_digest, created_at)
      VALUES (?, ?, ?, NULL, NULL, ?, 'reconciliation_run', ?, 'reconciliation_finalized', ?, ?, ?, ?, ?)`)
      .run(randomUUID(), this.userId, factProjectId, claim.attemptId, run.id, run.sourceRecordId,
        `reconciliation-fact:${run.id}:${run.attemptCount}`, JSON.stringify(payload), digestValue(payload), now.getTime());
  }

  private completeWakeupProjection(
    wakeupId: string | null,
    state: "completed" | "retry_scheduled" | "exhausted",
    dueAt: number,
    errorCode: string | undefined,
    now: Date
  ): void {
    if (!wakeupId) throw new PortfolioSchedulerError("PORTFOLIO_RECONCILIATION_SOURCE_INVALID");
    const terminal = state === "completed" || state === "exhausted";
    const result = this.db.prepare(`UPDATE portfolio_workflow_wakeups SET state = ?, projection_version = projection_version + 1,
      due_at = ?, active_slot = CASE WHEN ? THEN NULL ELSE active_slot END, last_error_code = ?,
      completed_at = CASE WHEN ? THEN ? ELSE completed_at END, updated_at = ?
      WHERE id = ? AND user_id = ? AND state = 'claimed'`)
      .run(state, dueAt, terminal ? 1 : 0, errorCode ?? null, terminal ? 1 : 0, now.getTime(), now.getTime(), wakeupId, this.userId);
    if (result.changes !== 1) throw new PortfolioSchedulerError("PORTFOLIO_RECONCILIATION_CLAIM_LOST");
  }

  private markUnknown(row: Row, now: Date): PortfolioReconciliationRun | undefined {
    const run = toRun(row);
    const update = this.db.prepare(`UPDATE portfolio_reconciliation_runs SET state = 'unknown', projection_version = projection_version + 1,
      claim_token_digest = NULL, claim_lease_expires_at = NULL, error_code = 'PORTFOLIO_RECONCILIATION_RECOVERY_UNKNOWN', error_digest = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND projection_version = ? AND state = 'claimed'
        AND claim_lease_expires_at IS NOT NULL AND claim_lease_expires_at <= ?`)
      .run(digestValue({ runId: run.id, attemptCount: run.attemptCount, state: "unknown" }), now.getTime(), run.id, this.userId,
        run.projectionVersion, now.getTime());
    if (update.changes !== 1) return undefined;
    if (run.source === "wakeup" && run.wakeupId) {
      this.db.prepare(`UPDATE portfolio_workflow_wakeups SET state = 'retry_scheduled', projection_version = projection_version + 1,
        due_at = ?, last_error_code = 'PORTFOLIO_RECONCILIATION_RECOVERY_UNKNOWN', updated_at = ?
        WHERE id = ? AND user_id = ? AND state = 'claimed'`).run(now.getTime(), now.getTime(), run.wakeupId, this.userId);
    }
    return this.getRun(run.id);
  }

  private scheduleRecoverySuccessor(run: PortfolioReconciliationRun, now: Date): void {
    const slot = `recovery:${run.id}:${run.attemptCount}`;
    if (run.source === "wakeup" && run.wakeupId) {
      this.insertWakeupRun(run.wakeupId, now, now, slot);
      return;
    }
    if (run.source === "heartbeat" && run.heartbeatUserId === this.userId && this.getHeartbeat()?.enabled) {
      this.db.prepare(`INSERT OR IGNORE INTO portfolio_reconciliation_runs (id, user_id, source, source_record_id, idempotency_slot, state,
        projection_version, attempt_count, retry_budget, heartbeat_user_id, scheduled_at, created_at, updated_at)
        VALUES (?, ?, 'heartbeat', ?, ?, 'scheduled', 1, 0, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), this.userId, this.userId, slot, HEARTBEAT_RETRY_BUDGET, this.userId, now.getTime(), now.getTime(), now.getTime());
    }
  }

  private projectIdForRun(run: PortfolioReconciliationRun): string | null {
    if (!run.wakeupId) return null;
    const row = this.db.prepare("SELECT project_id FROM portfolio_workflow_wakeups WHERE id = ? AND user_id = ?")
      .get(run.wakeupId, this.userId) as Row | undefined;
    return row ? asString(row, "project_id") : null;
  }

  private attemptIdForRun(run: PortfolioReconciliationRun): string | null {
    if (!run.wakeupId) return null;
    const row = this.db.prepare("SELECT attempt_id FROM portfolio_workflow_wakeups WHERE id = ? AND user_id = ?")
      .get(run.wakeupId, this.userId) as Row | undefined;
    return row ? asString(row, "attempt_id") : null;
  }

  private getWakeup(id: string): PortfolioWorkflowWakeup | undefined {
    const row = this.db.prepare("SELECT * FROM portfolio_workflow_wakeups WHERE id = ? AND user_id = ?").get(id, this.userId) as Row | undefined;
    return row ? toWakeup(row) : undefined;
  }

  private markHeartbeatReconciled(now: Date): void {
    this.db.prepare(`UPDATE portfolio_heartbeat_settings SET last_reconciled_at = ?, projection_version = projection_version + 1,
      updated_at = ? WHERE user_id = ? AND enabled = 1`).run(now.getTime(), now.getTime(), this.userId);
  }
}

export interface PortfolioSchedulerRepositoryFactory {
  forUser(userId: string): PortfolioSchedulerRepository;
  dueUserIds(now: Date): string[];
  recoverExpired(now: Date): PortfolioReconciliationClaim[];
}

/** The factory is the runtime's only global scheduler persistence dependency. */
export function createPortfolioSchedulerRepositoryFactory(db: Database): PortfolioSchedulerRepositoryFactory {
  return {
    forUser: (userId) => new PortfolioSchedulerRepository(db, userId),
    dueUserIds(now) {
      const rows = db.prepare(`SELECT DISTINCT user_id FROM portfolio_workflow_wakeups
        WHERE state IN ('scheduled', 'retry_scheduled') AND due_at <= ?
        UNION
        SELECT user_id FROM portfolio_heartbeat_settings
        WHERE enabled = 1 AND cadence_minutes BETWEEN 5 AND 1440
          AND (last_reconciled_at IS NULL OR last_reconciled_at + cadence_minutes * 60000 <= ?)`)
        .all(now.getTime(), now.getTime()) as Row[];
      return rows.map((row) => asString(row, "user_id")).filter(Boolean);
    },
    recoverExpired(now) {
      const rows = db.prepare(`SELECT DISTINCT user_id FROM portfolio_reconciliation_runs
        WHERE state = 'claimed' AND claim_lease_expires_at IS NOT NULL AND claim_lease_expires_at <= ?`)
        .all(now.getTime()) as Row[];
      return rows.flatMap((row) => new PortfolioSchedulerRepository(db, asString(row, "user_id")).recoverExpired(now));
    }
  };
}

function wakeupInputDigest(input: {
  projectId: string; workItemId: string; attemptId: string; reasonClass: string; dueAt: Date; coalescingKey: string; idempotencyKey: string;
}): Record<string, unknown> {
  return { ...input, dueAt: input.dueAt.getTime() };
}

function isCadence(value: number | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 5 && value <= 1_440;
}

function isHeartbeatDue(heartbeat: PortfolioHeartbeatSetting, now: Date): boolean {
  if (!heartbeat.cadenceMinutes) return false;
  return !heartbeat.lastReconciledAt
    || heartbeat.lastReconciledAt.getTime() + heartbeat.cadenceMinutes * 60_000 <= now.getTime();
}

function toWakeup(row: Row): PortfolioWorkflowWakeup {
  return {
    id: asString(row, "id"), projectId: asString(row, "project_id"), workItemId: asString(row, "work_item_id"),
    attemptId: asString(row, "attempt_id"), reasonClass: asString(row, "reason_class"), state: asString(row, "state") as PortfolioWorkflowWakeup["state"],
    projectionVersion: asNumber(row, "projection_version"), dueAt: asDate(row.due_at), coalescingKey: asString(row, "coalescing_key"),
    attemptCount: asNumber(row, "attempt_count"), maxAttempts: asNumber(row, "max_attempts"),
    createdAt: asDate(row.created_at), updatedAt: asDate(row.updated_at)
  };
}

function toHeartbeat(row: Row): PortfolioHeartbeatSetting {
  return {
    enabled: asNumber(row, "enabled") === 1,
    cadenceMinutes: typeof row.cadence_minutes === "number" ? row.cadence_minutes : null,
    projectionVersion: asNumber(row, "projection_version"), lastReconciledAt: nullableDate(row.last_reconciled_at),
    createdAt: asDate(row.created_at), updatedAt: asDate(row.updated_at)
  };
}

function heartbeatOperationResult(heartbeat: PortfolioHeartbeatSetting): Record<string, unknown> {
  return {
    enabled: heartbeat.enabled,
    cadenceMinutes: heartbeat.cadenceMinutes,
    projectionVersion: heartbeat.projectionVersion,
    lastReconciledAt: heartbeat.lastReconciledAt?.getTime() ?? null,
    createdAt: heartbeat.createdAt.getTime(),
    updatedAt: heartbeat.updatedAt.getTime()
  };
}

function heartbeatFromOperationResult(value: unknown): PortfolioHeartbeatSetting {
  if (typeof value !== "string") throw new PortfolioSchedulerError("PORTFOLIO_IDEMPOTENCY_RESULT_INVALID");
  let result: unknown;
  try { result = JSON.parse(value); } catch { throw new PortfolioSchedulerError("PORTFOLIO_IDEMPOTENCY_RESULT_INVALID"); }
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new PortfolioSchedulerError("PORTFOLIO_IDEMPOTENCY_RESULT_INVALID");
  const row = result as Row;
  if (typeof row.enabled !== "boolean" || (row.cadenceMinutes !== null && typeof row.cadenceMinutes !== "number")) {
    throw new PortfolioSchedulerError("PORTFOLIO_IDEMPOTENCY_RESULT_INVALID");
  }
  return {
    enabled: row.enabled,
    cadenceMinutes: typeof row.cadenceMinutes === "number" ? row.cadenceMinutes : null,
    projectionVersion: asNumber(row, "projectionVersion"),
    lastReconciledAt: nullableDate(row.lastReconciledAt),
    createdAt: asDate(row.createdAt),
    updatedAt: asDate(row.updatedAt)
  };
}

function toRun(row: Row): PortfolioReconciliationRun {
  return {
    id: asString(row, "id"), source: asString(row, "source") as ReconciliationSource, sourceRecordId: asString(row, "source_record_id"),
    idempotencySlot: asString(row, "idempotency_slot"), state: asString(row, "state") as ReconciliationRunState,
    projectionVersion: asNumber(row, "projection_version"), claimTokenDigest: nullableString(row, "claim_token_digest"),
    claimLeaseExpiresAt: nullableDate(row.claim_lease_expires_at), attemptCount: asNumber(row, "attempt_count"), retryBudget: asNumber(row, "retry_budget"),
    resultDigest: nullableString(row, "result_digest"), errorCode: nullableString(row, "error_code"), errorDigest: nullableString(row, "error_digest"),
    wakeupId: nullableString(row, "wakeup_id"), heartbeatUserId: nullableString(row, "heartbeat_user_id"), scheduledAt: asDate(row.scheduled_at),
    claimedAt: nullableDate(row.claimed_at), completedAt: nullableDate(row.completed_at), createdAt: asDate(row.created_at), updatedAt: asDate(row.updated_at)
  };
}

function toEvidence(row: Row): PortfolioEvidence {
  return {
    id: asString(row, "id"), projectId: asString(row, "project_id"), requestId: nullableString(row, "request_id"),
    workItemId: nullableString(row, "work_item_id"), attemptId: nullableString(row, "attempt_id"), producer: asString(row, "producer"),
    sourceCategory: asString(row, "source_category"), observedAt: asDate(row.observed_at), collectedAt: asDate(row.collected_at),
    digest: asString(row, "digest"), redactedSummary: asString(row, "redacted_summary"), confidence: asString(row, "confidence"),
    freshness: asString(row, "freshness"), isBlocker: asNumber(row, "is_blocker") === 1, verificationKey: nullableString(row, "verification_key"),
    createdAt: asDate(row.created_at)
  };
}
