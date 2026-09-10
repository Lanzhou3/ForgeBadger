/**
 * Copilot automation repository — the durable store for scheduled automations
 * and their runs, plus the catalog suggestions the owner accepts to create one.
 *
 * Mirrors the feishu-channel-repository lease pattern: runs are claimed with a
 * `claim_token` + `claim_expires_at` so overlapping scheduler ticks never
 * double-execute a slot. All access is scoped by user_id.
 */
import { randomUUID } from "node:crypto";

import type { Database } from "../../db/types.js";
import { encryptSecret, decryptSecret, type EncryptedSecret } from "../../crypto/secret-box.js";
import type { ScheduleKind } from "./schedule-parser.js";

export type AutomationStatus = "draft" | "enabled" | "paused";
export type AutomationRunStatus = "pending" | "claimed" | "running" | "completed" | "failed" | "cancelled";

export interface Automation {
  id: string;
  userId: string;
  name: string;
  status: AutomationStatus;
  scopeType: "global" | "project";
  scopePolicy: string;
  prompt: string;
  scheduleKind: ScheduleKind;
  scheduleExpression: string;
  timezone: string;
  deliveryPlan: string;
  authoritySnapshot: string;
  revision: number;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAutomationInput {
  name: string;
  scopeType: "global" | "project";
  scopePolicy: Record<string, unknown>;
  prompt: string;
  scheduleKind: ScheduleKind;
  scheduleExpression: string;
  timezone: string;
  deliveryPlan: { notify: boolean; conversation: boolean };
  authoritySnapshot: { readOnly: boolean; tools: string[] };
}

export interface AutomationRun {
  id: string;
  userId: string;
  automationId: string;
  executionId: string | null;
  scheduledSlot: string;
  triggerKind: "schedule" | "manual";
  status: AutomationRunStatus;
  notBefore: Date;
  claimToken: string | null;
  claimExpiresAt: Date | null;
  attemptCount: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AutomationSuggestion {
  id: string;
  userId: string;
  source: string;
  dedupKey: string;
  status: "pending" | "accepted" | "dismissed";
  jobSpec: string;
  createdAt: Date;
  updatedAt: Date;
}

interface AutomationRow {
  id: string;
  user_id: string;
  name: string;
  status: string;
  scope_type: string;
  scope_policy: string;
  prompt: string;
  schedule_kind: string;
  schedule_expression: string;
  timezone: string;
  delivery_plan: string;
  authority_snapshot: string;
  revision: number;
  next_run_at: number | null;
  last_run_at: number | null;
  created_at: number;
  updated_at: number;
}

interface RunRow {
  id: string;
  user_id: string;
  automation_id: string;
  execution_id: string | null;
  scheduled_slot: string;
  trigger_kind: string;
  status: string;
  not_before: number;
  claim_token: string | null;
  claim_expires_at: number | null;
  attempt_count: number;
  scope_snapshot: string | null;
  generated_content_encrypted: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

interface SuggestionRow {
  id: string;
  user_id: string;
  source: string;
  dedup_key: string;
  status: string;
  job_spec: string;
  created_at: number;
  updated_at: number;
}

export class AutomationRepository {
  constructor(
    private readonly db: Database,
    private readonly userId: string,
    private readonly masterKey: string
  ) {}

  // ── automations ──────────────────────────────────────────────────────────

  create(input: CreateAutomationInput): Automation {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO copilot_automations (
        id, user_id, name, status, scope_type, scope_policy, prompt,
        schedule_kind, schedule_expression, timezone, delivery_plan,
        authority_snapshot, revision, next_run_at, last_run_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, NULL, ?, ?)
    `).run(
      id, this.userId, input.name, input.scopeType, JSON.stringify(input.scopePolicy),
      input.prompt, input.scheduleKind, input.scheduleExpression, input.timezone,
      JSON.stringify(input.deliveryPlan), JSON.stringify(input.authoritySnapshot), now, now
    );
    return this.get(id)!;
  }

  get(id: string): Automation | undefined {
    const row = this.db.prepare(`SELECT * FROM copilot_automations WHERE id = ? AND user_id = ?`)
      .get(id, this.userId) as AutomationRow | undefined;
    return row ? toAutomation(row) : undefined;
  }

  list(): Automation[] {
    const rows = this.db.prepare(`SELECT * FROM copilot_automations WHERE user_id = ? ORDER BY created_at DESC`)
      .all(this.userId) as AutomationRow[];
    return rows.map(toAutomation);
  }

  /** Enabled automations whose next run is due at or before `now`. */
  listDue(now: Date): Automation[] {
    const rows = this.db.prepare(`
      SELECT * FROM copilot_automations
      WHERE user_id = ? AND status = 'enabled' AND next_run_at IS NOT NULL AND next_run_at <= ?
      ORDER BY next_run_at ASC
    `).all(this.userId, now.getTime()) as AutomationRow[];
    return rows.map(toAutomation);
  }

  setStatus(id: string, status: AutomationStatus): Automation | undefined {
    const result = this.db.prepare(`
      UPDATE copilot_automations SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?
    `).run(status, Date.now(), id, this.userId);
    return result.changes === 1 ? this.get(id) : undefined;
  }

  /** Advance the automation's next_run_at and record last_run_at for the slot. */
  advanceSchedule(id: string, lastRunAt: Date, nextRunAt: Date | null): void {
    this.db.prepare(`
      UPDATE copilot_automations SET last_run_at = ?, next_run_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(lastRunAt.getTime(), nextRunAt?.getTime() ?? null, Date.now(), id, this.userId);
  }

  /** Update the schedule fields and next run time (used by edit/enable). */
  updateSchedule(id: string, kind: ScheduleKind, expression: string, timezone: string, nextRunAt: Date | null): void {
    this.db.prepare(`
      UPDATE copilot_automations SET schedule_kind = ?, schedule_expression = ?,
        timezone = ?, next_run_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(kind, expression, timezone, nextRunAt?.getTime() ?? null, Date.now(), id, this.userId);
  }

  delete(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM copilot_automations WHERE id = ? AND user_id = ?`).run(id, this.userId);
    return result.changes > 0;
  }

  // ── runs ─────────────────────────────────────────────────────────────────

  /**
   * Create the slot's run row and claim it in one transaction. Returns the
   * claimed run, or undefined when the slot already exists (idempotent no-op)
   * or the automation no longer matches.
   */
  claimSlot(input: {
    automation: Automation;
    scheduledSlot: string;
    triggerKind: "schedule" | "manual";
    now: Date;
    leaseMs: number;
  }): AutomationRun | undefined {
    const claim = this.db.transaction(() => {
      const now = input.now.getTime();
      const id = randomUUID();
      const token = randomUUID();
      try {
        this.db.prepare(`
          INSERT INTO copilot_automation_runs (
            id, user_id, automation_id, execution_id, scheduled_slot, trigger_kind,
            status, not_before, claim_token, claim_expires_at, attempt_count,
            created_at, updated_at
          ) VALUES (?, ?, ?, NULL, ?, ?, 'claimed', ?, ?, ?, 1, ?, ?)
        `).run(
          id, this.userId, input.automation.id, input.scheduledSlot, input.triggerKind,
          now, token, now + input.leaseMs, now, now
        );
      } catch (error) {
        if (isUniqueViolation(error, "copilot_automation_runs")) return undefined;
        throw error;
      }
      return this.getRun(id);
    });
    return claim();
  }

  getRun(id: string): AutomationRun | undefined {
    const row = this.db.prepare(`SELECT * FROM copilot_automation_runs WHERE id = ? AND user_id = ?`)
      .get(id, this.userId) as RunRow | undefined;
    return row ? toRun(row) : undefined;
  }

  listRuns(automationId: string, limit = 50): AutomationRun[] {
    const rows = this.db.prepare(`
      SELECT * FROM copilot_automation_runs WHERE user_id = ? AND automation_id = ?
      ORDER BY created_at DESC LIMIT ?
    `).all(this.userId, automationId, limit) as RunRow[];
    return rows.map(toRun);
  }

  markRunRunning(id: string): void {
    this.db.prepare(`UPDATE copilot_automation_runs SET status = 'running', updated_at = ? WHERE id = ? AND user_id = ?`)
      .run(Date.now(), id, this.userId);
  }

  /** Record a completed run with its (encrypted) generated content. */
  completeRun(id: string, content: string): void {
    const encrypted = JSON.stringify(encryptSecret(content, { key: this.masterKey }));
    this.db.prepare(`
      UPDATE copilot_automation_runs SET status = 'completed', generated_content_encrypted = ?,
        claim_token = NULL, claim_expires_at = NULL, completed_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(encrypted, Date.now(), Date.now(), id, this.userId);
  }

  failRun(id: string, code: string, message: string): void {
    this.db.prepare(`
      UPDATE copilot_automation_runs SET status = 'failed', last_error_code = ?,
        last_error_message = ?, claim_token = NULL, claim_expires_at = NULL,
        completed_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(code, message, Date.now(), Date.now(), id, this.userId);
  }

  /** Release a claimed run whose lease expired so a later tick may retry it. */
  releaseExpiredClaims(now: Date): void {
    this.db.prepare(`
      UPDATE copilot_automation_runs SET status = 'failed', last_error_code = 'AUTOMATION_LEASE_EXPIRED',
        last_error_message = 'Run lease expired before completion', completed_at = ?, updated_at = ?
      WHERE user_id = ? AND status = 'claimed' AND claim_expires_at <= ?
    `).run(now.getTime(), Date.now(), this.userId, now.getTime());
  }

  decryptContent(id: string): string {
    const row = this.db.prepare(`SELECT generated_content_encrypted FROM copilot_automation_runs WHERE id = ? AND user_id = ?`)
      .get(id, this.userId) as { generated_content_encrypted: string | null } | undefined;
    if (!row?.generated_content_encrypted) return "";
    return decryptSecret(JSON.parse(row.generated_content_encrypted) as EncryptedSecret, { key: this.masterKey });
  }

  // ── suggestions ──────────────────────────────────────────────────────────

  seedSuggestion(input: { source: string; dedupKey: string; jobSpec: Record<string, unknown> }): void {
    const existing = this.getSuggestionByDedupKey(input.dedupKey);
    if (existing) return;
    const id = randomUUID();
    const now = Date.now();
    try {
      this.db.prepare(`
        INSERT INTO copilot_automation_suggestions (id, user_id, source, dedup_key, status, job_spec, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
      `).run(id, this.userId, input.source, input.dedupKey, JSON.stringify(input.jobSpec), now, now);
    } catch (error) {
      if (isUniqueViolation(error, "copilot_automation_suggestions")) return;
      throw error;
    }
  }

  listSuggestions(): AutomationSuggestion[] {
    const rows = this.db.prepare(`
      SELECT * FROM copilot_automation_suggestions WHERE user_id = ? AND status = 'pending'
      ORDER BY created_at ASC
    `).all(this.userId) as SuggestionRow[];
    return rows.map(toSuggestion);
  }

  getSuggestion(id: string): AutomationSuggestion | undefined {
    const row = this.db.prepare(`SELECT * FROM copilot_automation_suggestions WHERE id = ? AND user_id = ?`)
      .get(id, this.userId) as SuggestionRow | undefined;
    return row ? toSuggestion(row) : undefined;
  }

  decideSuggestion(id: string, decision: "accepted" | "dismissed"): AutomationSuggestion | undefined {
    const result = this.db.prepare(`
      UPDATE copilot_automation_suggestions SET status = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status = 'pending'
    `).run(decision, Date.now(), id, this.userId);
    return result.changes === 1 ? this.getSuggestion(id) : undefined;
  }

  private getSuggestionByDedupKey(dedupKey: string): AutomationSuggestion | undefined {
    const row = this.db.prepare(`SELECT * FROM copilot_automation_suggestions WHERE user_id = ? AND dedup_key = ?`)
      .get(this.userId, dedupKey) as SuggestionRow | undefined;
    return row ? toSuggestion(row) : undefined;
  }
}

function toAutomation(row: AutomationRow): Automation {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    status: row.status as AutomationStatus,
    scopeType: row.scope_type as Automation["scopeType"],
    scopePolicy: row.scope_policy,
    prompt: row.prompt,
    scheduleKind: row.schedule_kind as ScheduleKind,
    scheduleExpression: row.schedule_expression,
    timezone: row.timezone,
    deliveryPlan: row.delivery_plan,
    authoritySnapshot: row.authority_snapshot,
    revision: row.revision,
    nextRunAt: row.next_run_at !== null ? new Date(row.next_run_at) : null,
    lastRunAt: row.last_run_at !== null ? new Date(row.last_run_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

function toRun(row: RunRow): AutomationRun {
  return {
    id: row.id,
    userId: row.user_id,
    automationId: row.automation_id,
    executionId: row.execution_id,
    scheduledSlot: row.scheduled_slot,
    triggerKind: row.trigger_kind as AutomationRun["triggerKind"],
    status: row.status as AutomationRunStatus,
    notBefore: new Date(row.not_before),
    claimToken: row.claim_token,
    claimExpiresAt: row.claim_expires_at !== null ? new Date(row.claim_expires_at) : null,
    attemptCount: row.attempt_count,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    completedAt: row.completed_at !== null ? new Date(row.completed_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

function toSuggestion(row: SuggestionRow): AutomationSuggestion {
  return {
    id: row.id,
    userId: row.user_id,
    source: row.source,
    dedupKey: row.dedup_key,
    status: row.status as AutomationSuggestion["status"],
    jobSpec: row.job_spec,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

function isUniqueViolation(error: unknown, table: string): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed")
    && error.message.includes(table);
}
