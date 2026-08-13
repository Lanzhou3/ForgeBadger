import { createHash, randomUUID } from "node:crypto";

import { decryptSecret, encryptSecret, type EncryptedSecret } from "../../crypto/secret-box.js";
import type { Database } from "../types.js";

export interface CopilotAutomation {
  id: string;
  userId: string;
  name: string;
  status: string;
  scopeType: string;
  scopePolicy: Record<string, unknown>;
  prompt: string;
  scheduleKind: string;
  scheduleExpression: string;
  timezone: string;
  deliveryPlan: Record<string, unknown>;
  authoritySnapshot: Record<string, unknown>;
  revision: number;
  nextRunAt: Date | null;
}

export interface CopilotAutomationRun {
  id: string;
  automationId: string;
  executionId: string;
  scheduledSlot: string;
  triggerKind: string;
  status: string;
  claimToken: string | null;
  claimExpiresAt: Date | null;
  attemptCount: number;
  generatedContentPresent: boolean;
  outboxId: string | null;
  lastErrorCode: string | null;
}

interface AutomationRow {
  id: string; user_id: string; name: string; status: string; scope_type: string;
  scope_policy: string; prompt: string; schedule_kind: string; schedule_expression: string;
  timezone: string; delivery_plan: string; authority_snapshot: string; revision: number;
  next_run_at: number | null;
}

interface RunRow {
  id: string; automation_id: string; execution_id: string; scheduled_slot: string;
  trigger_kind: string; status: string; claim_token: string | null;
  claim_expires_at: number | null; attempt_count: number;
  generated_content_encrypted: string | null; outbox_id: string | null;
  last_error_code: string | null;
}

export class CopilotAutomationRepository {
  constructor(
    private readonly db: Database,
    private readonly userId: string,
    private readonly masterKey?: string
  ) {}

  create(input: {
    name: string; status: string; scopeType: string; scopePolicy: Record<string, unknown>;
    prompt: string; scheduleKind: string; scheduleExpression: string; timezone: string;
    deliveryPlan: Record<string, unknown>; authoritySnapshot: Record<string, unknown>;
    nextRunAt?: Date | null;
  }): CopilotAutomation {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO copilot_automations (
        id, user_id, name, status, scope_type, scope_policy, prompt, schedule_kind,
        schedule_expression, timezone, delivery_plan, authority_snapshot, revision,
        next_run_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(id, this.userId, input.name, input.status, input.scopeType,
      JSON.stringify(input.scopePolicy), input.prompt, input.scheduleKind,
      input.scheduleExpression, input.timezone, JSON.stringify(input.deliveryPlan),
      JSON.stringify(input.authoritySnapshot), input.nextRunAt?.getTime() ?? null, now, now);
    return this.get(id) as CopilotAutomation;
  }

  get(id: string): CopilotAutomation | undefined {
    const row = this.db.prepare("SELECT * FROM copilot_automations WHERE id = ? AND user_id = ?")
      .get(id, this.userId) as AutomationRow | undefined;
    return row ? toAutomation(row) : undefined;
  }

  list(): CopilotAutomation[] {
    const rows = this.db.prepare("SELECT * FROM copilot_automations WHERE user_id = ? ORDER BY created_at")
      .all(this.userId) as AutomationRow[];
    return rows.map(toAutomation);
  }

  updateWithRevision(id: string, expectedRevision: number, patch: {
    name?: string; status?: string; scopeType?: string; scopePolicy?: Record<string, unknown>;
    prompt?: string; scheduleKind?: string; scheduleExpression?: string; timezone?: string;
    deliveryPlan?: Record<string, unknown>; authoritySnapshot?: Record<string, unknown>;
    nextRunAt?: Date | null;
  }): CopilotAutomation {
    const existing = this.get(id);
    if (!existing) throw new Error("AUTOMATION_NOT_FOUND");
    const result = this.db.prepare(`
      UPDATE copilot_automations SET name = ?, status = ?, scope_type = ?, scope_policy = ?,
        prompt = ?, schedule_kind = ?, schedule_expression = ?, timezone = ?,
        delivery_plan = ?, authority_snapshot = ?, next_run_at = ?,
        revision = revision + 1, updated_at = ?
      WHERE id = ? AND user_id = ? AND revision = ?
    `).run(patch.name ?? existing.name, patch.status ?? existing.status,
      patch.scopeType ?? existing.scopeType, JSON.stringify(patch.scopePolicy ?? existing.scopePolicy),
      patch.prompt ?? existing.prompt, patch.scheduleKind ?? existing.scheduleKind,
      patch.scheduleExpression ?? existing.scheduleExpression, patch.timezone ?? existing.timezone,
      JSON.stringify(patch.deliveryPlan ?? existing.deliveryPlan),
      JSON.stringify(patch.authoritySnapshot ?? existing.authoritySnapshot),
      patch.nextRunAt === undefined ? existing.nextRunAt?.getTime() ?? null : patch.nextRunAt?.getTime() ?? null,
      Date.now(), id, this.userId, expectedRevision);
    if (result.changes !== 1) throw new Error("AUTOMATION_REVISION_CONFLICT");
    return this.get(id) as CopilotAutomation;
  }

  createOrGetRun(automationId: string, scheduledSlot: string, triggerKind: string): CopilotAutomationRun {
    if (!this.get(automationId)) throw new Error("AUTOMATION_NOT_FOUND");
    const existing = this.getRunBySlot(automationId, scheduledSlot);
    if (existing) return existing;
    const id = randomUUID();
    const executionId = createHash("sha256").update(`${automationId}:${scheduledSlot}`).digest("hex");
    const now = Date.now();
    const notBefore = triggerKind === "scheduled" ? Date.parse(scheduledSlot) : now;
    this.db.prepare(`
      INSERT INTO copilot_automation_runs (
        id, user_id, automation_id, execution_id, scheduled_slot, trigger_kind,
        status, not_before, attempt_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?, ?)
    `).run(id, this.userId, automationId, executionId, scheduledSlot, triggerKind, notBefore, now, now);
    return this.getRun(id) as CopilotAutomationRun;
  }

  claimDueRun(now = new Date(), leaseMs = 60_000): CopilotAutomationRun | undefined {
    const claim = this.db.transaction(() => {
      const timestamp = now.getTime();
      // Expired leases are recoverable; completed generation is handled by a later delivery-only phase.
      this.db.prepare(`
        UPDATE copilot_automation_runs SET status = 'pending', claim_token = NULL,
          claim_expires_at = NULL, updated_at = ?
        WHERE user_id = ? AND status = 'claimed' AND claim_expires_at <= ?
      `).run(timestamp, this.userId, timestamp);
      const row = this.db.prepare(`
        SELECT * FROM copilot_automation_runs
        WHERE user_id = ? AND status = 'pending' AND not_before <= ?
        ORDER BY not_before, created_at LIMIT 1
      `).get(this.userId, timestamp) as RunRow | undefined;
      if (!row) return undefined;
      const token = randomUUID();
      const result = this.db.prepare(`
        UPDATE copilot_automation_runs SET status = 'claimed', claim_token = ?,
          claim_expires_at = ?, attempt_count = attempt_count + 1, updated_at = ?
        WHERE id = ? AND user_id = ? AND status = 'pending'
      `).run(token, timestamp + leaseMs, timestamp, row.id, this.userId);
      return result.changes === 1 ? this.getRun(row.id) : undefined;
    });
    return claim();
  }

  claimRun(id: string, now = new Date(), leaseMs = 60_000): CopilotAutomationRun {
    const claim = this.db.transaction(() => {
      const timestamp = now.getTime();
      const current = this.getRun(id);
      if (!current) throw new Error("AUTOMATION_RUN_NOT_FOUND");
      if (current.status === "claimed" && current.claimToken && (current.claimExpiresAt?.getTime() ?? 0) > timestamp) {
        return current;
      }
      this.db.prepare(`
        UPDATE copilot_automation_runs SET status = 'pending', claim_token = NULL,
          claim_expires_at = NULL, updated_at = ?
        WHERE id = ? AND user_id = ? AND status = 'claimed' AND claim_expires_at <= ?
      `).run(timestamp, id, this.userId, timestamp);
      const token = randomUUID();
      const result = this.db.prepare(`
        UPDATE copilot_automation_runs SET status = 'claimed', claim_token = ?,
          claim_expires_at = ?, attempt_count = attempt_count + 1, updated_at = ?
        WHERE id = ? AND user_id = ? AND status = 'pending' AND not_before <= ?
      `).run(token, timestamp + leaseMs, timestamp, id, this.userId, timestamp);
      if (result.changes !== 1) throw new Error("AUTOMATION_RUN_NOT_CLAIMABLE");
      return this.getRun(id) as CopilotAutomationRun;
    });
    return claim();
  }

  saveProjectSnapshot(runId: string, claimToken: string, projects: Array<{ projectId: string; name: string }>): void {
    const write = this.db.transaction(() => {
      this.requireClaimedRun(runId, claimToken);
      this.db.prepare("DELETE FROM copilot_automation_run_projects WHERE run_id = ? AND user_id = ?")
        .run(runId, this.userId);
      const insert = this.db.prepare(`
        INSERT INTO copilot_automation_run_projects (run_id, project_id, user_id, project_name, ordinal)
        VALUES (?, ?, ?, ?, ?)
      `);
      projects.forEach((project, ordinal) => insert.run(runId, project.projectId, this.userId, project.name, ordinal));
      this.db.prepare("UPDATE copilot_automation_runs SET scope_snapshot = ?, updated_at = ? WHERE id = ? AND user_id = ?")
        .run(JSON.stringify(projects), Date.now(), runId, this.userId);
    });
    write();
  }

  listProjectSnapshots(runId: string): Array<{ projectId: string; name: string }> {
    const rows = this.db.prepare(`
      SELECT project_id, project_name FROM copilot_automation_run_projects
      WHERE run_id = ? AND user_id = ? ORDER BY ordinal
    `).all(runId, this.userId) as Array<{ project_id: string; project_name: string }>;
    return rows.map((row) => ({ projectId: row.project_id, name: row.project_name }));
  }

  listRuns(automationId: string): CopilotAutomationRun[] {
    const rows = this.db.prepare(`
      SELECT * FROM copilot_automation_runs WHERE automation_id = ? AND user_id = ? ORDER BY created_at
    `).all(automationId, this.userId) as RunRow[];
    return rows.map(toRun);
  }

  getRun(id: string): CopilotAutomationRun | undefined {
    const row = this.db.prepare("SELECT * FROM copilot_automation_runs WHERE id = ? AND user_id = ?")
      .get(id, this.userId) as RunRow | undefined;
    return row ? toRun(row) : undefined;
  }

  saveGeneratedContent(runId: string, claimToken: string, content: string): CopilotAutomationRun {
    this.requireClaimedRun(runId, claimToken);
    if (!this.masterKey) throw new Error("AUTOMATION_MASTER_KEY_REQUIRED");
    const encrypted = JSON.stringify(encryptSecret(content, { key: this.masterKey }));
    const result = this.db.prepare(`
      UPDATE copilot_automation_runs SET generated_content_encrypted = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND status = 'claimed' AND claim_token = ?
        AND generated_content_encrypted IS NULL
    `).run(encrypted, Date.now(), runId, this.userId, claimToken);
    if (result.changes !== 1 && !this.getRun(runId)?.generatedContentPresent) {
      throw new Error("AUTOMATION_RUN_CLAIM_MISMATCH");
    }
    return this.getRun(runId) as CopilotAutomationRun;
  }

  decryptGeneratedContent(runId: string): string | undefined {
    if (!this.masterKey) throw new Error("AUTOMATION_MASTER_KEY_REQUIRED");
    const row = this.db.prepare(`
      SELECT generated_content_encrypted FROM copilot_automation_runs WHERE id = ? AND user_id = ?
    `).get(runId, this.userId) as { generated_content_encrypted: string | null } | undefined;
    if (!row) throw new Error("AUTOMATION_RUN_NOT_FOUND");
    if (!row.generated_content_encrypted) return undefined;
    return decryptSecret(JSON.parse(row.generated_content_encrypted) as EncryptedSecret, { key: this.masterKey });
  }

  completeRun(runId: string, claimToken: string, outboxId: string, now = new Date()): CopilotAutomationRun {
    const result = this.db.prepare(`
      UPDATE copilot_automation_runs SET status = 'delivery_pending', outbox_id = ?,
        claim_token = NULL, claim_expires_at = NULL, last_error_code = NULL,
        last_error_message = NULL, completed_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND status = 'claimed' AND claim_token = ?
        AND generated_content_encrypted IS NOT NULL
    `).run(outboxId, now.getTime(), now.getTime(), runId, this.userId, claimToken);
    if (result.changes !== 1) throw new Error("AUTOMATION_RUN_CLAIM_MISMATCH");
    return this.getRun(runId) as CopilotAutomationRun;
  }

  failRun(runId: string, claimToken: string, input: {
    retryable: boolean;
    errorCode: string;
    errorMessage: string;
    retryAt?: Date;
    now?: Date;
  }): CopilotAutomationRun {
    const now = input.now ?? new Date();
    const result = this.db.prepare(`
      UPDATE copilot_automation_runs SET status = ?, not_before = ?, claim_token = NULL,
        claim_expires_at = NULL, last_error_code = ?, last_error_message = ?,
        completed_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND status = 'claimed' AND claim_token = ?
    `).run(input.retryable ? "pending" : "failed", input.retryAt?.getTime() ?? now.getTime(),
      input.errorCode.slice(0, 128), input.errorMessage.slice(0, 500),
      input.retryable ? null : now.getTime(), now.getTime(), runId, this.userId, claimToken);
    if (result.changes !== 1) throw new Error("AUTOMATION_RUN_CLAIM_MISMATCH");
    return this.getRun(runId) as CopilotAutomationRun;
  }

  cancelRun(runId: string, now = new Date()): CopilotAutomationRun {
    const result = this.db.prepare(`
      UPDATE copilot_automation_runs SET status = 'cancelled', claim_token = NULL,
        claim_expires_at = NULL, completed_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND status IN ('pending', 'claimed')
    `).run(now.getTime(), now.getTime(), runId, this.userId);
    if (result.changes !== 1) {
      if (!this.getRun(runId)) throw new Error("AUTOMATION_RUN_NOT_FOUND");
      throw new Error("AUTOMATION_RUN_NOT_CANCELLABLE");
    }
    return this.getRun(runId) as CopilotAutomationRun;
  }

  private getRunBySlot(automationId: string, slot: string): CopilotAutomationRun | undefined {
    const row = this.db.prepare(`
      SELECT * FROM copilot_automation_runs
      WHERE automation_id = ? AND scheduled_slot = ? AND user_id = ?
    `).get(automationId, slot, this.userId) as RunRow | undefined;
    return row ? toRun(row) : undefined;
  }

  private requireClaimedRun(id: string, token: string): void {
    const row = this.db.prepare(`
      SELECT id FROM copilot_automation_runs
      WHERE id = ? AND user_id = ? AND status = 'claimed' AND claim_token = ?
    `).get(id, this.userId, token);
    if (!row) throw new Error("AUTOMATION_RUN_CLAIM_MISMATCH");
  }
}

function toAutomation(row: AutomationRow): CopilotAutomation {
  return {
    id: row.id, userId: row.user_id, name: row.name, status: row.status,
    scopeType: row.scope_type, scopePolicy: JSON.parse(row.scope_policy) as Record<string, unknown>,
    prompt: row.prompt, scheduleKind: row.schedule_kind, scheduleExpression: row.schedule_expression,
    timezone: row.timezone, deliveryPlan: JSON.parse(row.delivery_plan) as Record<string, unknown>,
    authoritySnapshot: JSON.parse(row.authority_snapshot) as Record<string, unknown>,
    revision: row.revision, nextRunAt: row.next_run_at === null ? null : new Date(row.next_run_at)
  };
}

function toRun(row: RunRow): CopilotAutomationRun {
  return {
    id: row.id, automationId: row.automation_id, executionId: row.execution_id,
    scheduledSlot: row.scheduled_slot, triggerKind: row.trigger_kind, status: row.status,
    claimToken: row.claim_token,
    claimExpiresAt: row.claim_expires_at === null ? null : new Date(row.claim_expires_at),
    attemptCount: row.attempt_count,
    generatedContentPresent: row.generated_content_encrypted !== null,
    outboxId: row.outbox_id,
    lastErrorCode: row.last_error_code
  };
}
