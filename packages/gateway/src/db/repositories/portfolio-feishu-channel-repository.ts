import { randomUUID } from "node:crypto";

import type { Database } from "../types.js";
import type { PortfolioFeishuBinding, PortfolioFeishuDeliveryState, PortfolioFeishuIngressState, PortfolioFeishuTransport } from "../../services/portfolio/feishu/contracts.js";
import { redactSummary, sha256, stableJson } from "../../services/portfolio/feishu/codec.js";

export interface PortfolioFeishuChannelAction {
  id: string;
  bindingId: string;
  recordType: "authorization" | "intake_decision" | "acceptance_decision";
  recordId: string;
  actionType: string;
  payloadDigest: string;
  recordVersion: number;
  ownerUserId: string;
  signatureDigest: string;
  state: "pending" | "consumed" | "expired";
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface PortfolioFeishuIngressEvent {
  id: string;
  providerAccountId: string;
  providerEventId: string;
  transport: PortfolioFeishuTransport;
  handlerKind: PortfolioFeishuIngressHandlerKind;
  eventDigest: string;
  state: PortfolioFeishuIngressState;
}

/** Handler kinds sharing one durable ingress ledger; copilot reuses it for provider-retry dedup. */
export type PortfolioFeishuIngressHandlerKind = "portfolio" | "copilot";

export interface PortfolioFeishuDeliveryRecord {
  id: string;
  bindingId: string;
  factId: string | null;
  canonicalRecordType: string;
  canonicalRecordId: string;
  canonicalRecordVersion: number;
  summary: Record<string, unknown>;
  state: PortfolioFeishuDeliveryState;
  attemptCount: number;
  nextAttemptAt: Date;
  claimToken: string | null;
  claimExpiresAt: Date | null;
  providerResultDigest: string | null;
  providerErrorCode: string | null;
}

interface Row extends Record<string, unknown> {}
const retryDelays = [30_000, 120_000, 600_000] as const;

/** Tenant-scoped persistence only; it has no SDK, webhook, or terminal dependency. */
export class PortfolioFeishuChannelRepository {
  constructor(private readonly db: Database, private readonly userId: string) {}

  createBinding(input: {
    provider: string;
    providerAccountId: string;
    externalIdentity: string;
    conversationId: string;
    isOwner: boolean;
    projectId?: string;
    now?: Date;
  }): PortfolioFeishuBinding {
    const now = input.now?.getTime() ?? Date.now();
    const id = randomUUID();
    try {
      const insert = this.db.transaction(() => {
        this.db.prepare(`INSERT INTO portfolio_channel_bindings (
        id, user_id, provider, provider_account_id, external_identity, conversation_id,
        project_id, is_owner, status, projection_version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)`)
        .run(id, this.userId, bounded(input.provider, 64, "PORTFOLIO_FEISHU_PROVIDER_INVALID"), input.providerAccountId,
          bounded(input.externalIdentity, 256, "PORTFOLIO_FEISHU_EXTERNAL_IDENTITY_INVALID"), bounded(input.conversationId, 256, "PORTFOLIO_FEISHU_CONVERSATION_INVALID"),
          input.projectId ?? null, input.isOwner ? 1 : 0, now, now);
      this.db.prepare(`INSERT INTO portfolio_channel_allowed_conversations (
        id, user_id, provider_account_id, binding_id, conversation_id, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`)
        .run(randomUUID(), this.userId, input.providerAccountId, id, input.conversationId, now, now);
      });
      insert();
      return this.getBinding(id) as PortfolioFeishuBinding;
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error("PORTFOLIO_FEISHU_BINDING_ALREADY_EXISTS");
      throw error;
    }
  }

  getBinding(id: string): PortfolioFeishuBinding | undefined {
    const row = this.db.prepare("SELECT * FROM portfolio_channel_bindings WHERE id = ? AND user_id = ?").get(id, this.userId) as Row | undefined;
    return row ? toBinding(row) : undefined;
  }

  resolveActiveBinding(input: { providerAccountId: string; externalIdentity: string; conversationId: string }): PortfolioFeishuBinding | undefined {
    const rows = this.db.prepare(`SELECT b.* FROM portfolio_channel_bindings b
      JOIN portfolio_channel_allowed_conversations c ON c.binding_id = b.id AND c.user_id = b.user_id
      WHERE b.user_id = ? AND b.provider_account_id = ? AND b.external_identity = ? AND b.conversation_id = ?
        AND b.status = 'active' AND c.status = 'active' AND c.provider_account_id = ? AND c.conversation_id = ?`)
      .all(this.userId, input.providerAccountId, input.externalIdentity, input.conversationId, input.providerAccountId, input.conversationId) as Row[];
    if (rows.length > 1) throw new Error("PORTFOLIO_FEISHU_BINDING_AMBIGUOUS");
    return rows[0] ? toBinding(rows[0]) : undefined;
  }

  admitIngress(input: {
    providerAccountId: string;
    providerEventId: string;
    transport: PortfolioFeishuTransport;
    handlerKind: PortfolioFeishuIngressHandlerKind;
    safeEnvelope: Record<string, unknown>;
    now?: Date;
  }): { admitted: true; event: PortfolioFeishuIngressEvent } | { admitted: false; reason: "duplicate_event" } {
    return this.recordIngress(input, "admitted");
  }

  denyIngress(input: {
    providerAccountId: string;
    providerEventId: string;
    transport: PortfolioFeishuTransport;
    handlerKind: PortfolioFeishuIngressHandlerKind;
    safeEnvelope: Record<string, unknown>;
    rejectionCode: string;
    now?: Date;
  }): { admitted: true; event: PortfolioFeishuIngressEvent } | { admitted: false; reason: "duplicate_event" } {
    return this.recordIngress(input, "denied", input.rejectionCode);
  }

  private recordIngress(input: {
    providerAccountId: string;
    providerEventId: string;
    transport: PortfolioFeishuTransport;
    handlerKind: PortfolioFeishuIngressHandlerKind;
    safeEnvelope: Record<string, unknown>;
    now?: Date;
  }, state: "admitted" | "denied", rejectionCode?: string): { admitted: true; event: PortfolioFeishuIngressEvent } | { admitted: false; reason: "duplicate_event" } {
    const digest = sha256(stableJson(input.safeEnvelope));
    const existing = this.db.prepare(`SELECT * FROM portfolio_feishu_ingress_events
      WHERE provider_account_id = ? AND provider_event_id = ?`).get(input.providerAccountId, input.providerEventId) as Row | undefined;
    if (existing) {
      if (String(existing.event_digest) !== digest) throw new Error("PORTFOLIO_FEISHU_EVENT_ID_DRIFT");
      return { admitted: false, reason: "duplicate_event" };
    }
    const now = input.now?.getTime() ?? Date.now();
    const id = randomUUID();
    try {
      this.db.prepare(`INSERT INTO portfolio_feishu_ingress_events (
        id, user_id, provider_account_id, provider_event_id, transport, handler_kind,
        event_digest, state, rejection_code, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, this.userId, input.providerAccountId, bounded(input.providerEventId, 256, "PORTFOLIO_FEISHU_EVENT_ID_INVALID"),
          input.transport, input.handlerKind, digest, state, rejectionCode ?? null, now, now);
      return { admitted: true, event: this.getIngressEvent(id) as PortfolioFeishuIngressEvent };
    } catch (error) {
      if (isUniqueViolation(error)) return { admitted: false, reason: "duplicate_event" };
      throw error;
    }
  }

  createChannelAction(input: {
    id?: string;
    bindingId: string;
    recordType: PortfolioFeishuChannelAction["recordType"];
    recordId: string;
    actionType: string;
    payloadDigest: string;
    recordVersion: number;
    ownerUserId: string;
    signatureDigest: string;
    expiresAt: Date;
    idempotencyKey: string;
    now?: Date;
  }): PortfolioFeishuChannelAction {
    const binding = this.getBinding(input.bindingId);
    if (!binding?.isOwner || binding.userId !== input.ownerUserId || binding.status !== "active") throw new Error("PORTFOLIO_FEISHU_ACTION_BINDING_DENIED");
    const replay = this.db.prepare(`SELECT * FROM portfolio_channel_actions
      WHERE user_id = ? AND binding_id = ? AND idempotency_key = ?`).get(this.userId, input.bindingId, input.idempotencyKey) as Row | undefined;
    if (replay) {
      const action = toAction(replay);
      if (action.recordType !== input.recordType || action.recordId !== input.recordId || action.actionType !== input.actionType
        || action.payloadDigest !== input.payloadDigest || action.recordVersion !== input.recordVersion || action.ownerUserId !== input.ownerUserId
        || action.signatureDigest !== input.signatureDigest || action.expiresAt.getTime() !== input.expiresAt.getTime()) {
        throw new Error("PORTFOLIO_FEISHU_ACTION_IDEMPOTENCY_DRIFT");
      }
      return action;
    }
    const now = input.now?.getTime() ?? Date.now();
    const id = input.id ?? randomUUID();
    this.db.prepare(`INSERT INTO portfolio_channel_actions (
      id, user_id, binding_id, record_type, record_id, action_type, payload_digest,
      record_version, owner_user_id, signature_digest, state, projection_version,
      expires_at, consumed_at, idempotency_key, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, NULL, ?, ?, ?)`)
      .run(id, this.userId, input.bindingId, input.recordType, input.recordId, bounded(input.actionType, 96, "PORTFOLIO_FEISHU_ACTION_TYPE_INVALID"),
        input.payloadDigest, input.recordVersion, input.ownerUserId, input.signatureDigest, input.expiresAt.getTime(), input.idempotencyKey, now, now);
    return this.getChannelAction(id) as PortfolioFeishuChannelAction;
  }

  getChannelAction(id: string): PortfolioFeishuChannelAction | undefined {
    const row = this.db.prepare("SELECT * FROM portfolio_channel_actions WHERE id = ? AND user_id = ?").get(id, this.userId) as Row | undefined;
    return row ? toAction(row) : undefined;
  }

  findChannelActionByIdempotency(bindingId: string, idempotencyKey: string): PortfolioFeishuChannelAction | undefined {
    const row = this.db.prepare(`SELECT * FROM portfolio_channel_actions
      WHERE user_id = ? AND binding_id = ? AND idempotency_key = ?`)
      .get(this.userId, bindingId, idempotencyKey) as Row | undefined;
    return row ? toAction(row) : undefined;
  }

  consumeChannelAction(input: {
    id: string;
    bindingId: string;
    recordVersion: number;
    ownerUserId: string;
    now?: Date;
    validateCanonical(action: PortfolioFeishuChannelAction): boolean;
  }): PortfolioFeishuChannelAction {
    const now = input.now?.getTime() ?? Date.now();
    return this.db.transaction(() => {
      const action = this.getChannelAction(input.id);
      const activeOwnerBinding = this.db.prepare(`SELECT 1 FROM portfolio_channel_bindings
        WHERE id = ? AND user_id = ? AND status = 'active' AND is_owner = 1`).get(input.bindingId, this.userId);
      if (!action || !activeOwnerBinding || action.bindingId !== input.bindingId || action.recordVersion !== input.recordVersion
        || action.ownerUserId !== input.ownerUserId || !input.validateCanonical(action)) {
        throw new Error("PORTFOLIO_FEISHU_ACTION_RECORD_DRIFT");
      }
      const result = this.db.prepare(`UPDATE portfolio_channel_actions SET state = 'consumed', consumed_at = ?,
        projection_version = projection_version + 1, updated_at = ?
        WHERE id = ? AND user_id = ? AND binding_id = ? AND state = 'pending'
          AND expires_at > ? AND record_version = ? AND owner_user_id = ?`)
        .run(now, now, input.id, this.userId, input.bindingId, now, input.recordVersion, input.ownerUserId);
      if (result.changes !== 1) throw new Error("PORTFOLIO_FEISHU_ACTION_NOT_CONSUMABLE");
      return this.getChannelAction(input.id) as PortfolioFeishuChannelAction;
    })();
  }

  consumeChannelActionWithDecision<T>(input: {
    id: string;
    bindingId: string;
    recordVersion: number;
    ownerUserId: string;
    now?: Date;
    validateCanonical(action: PortfolioFeishuChannelAction): boolean;
    applyOwnerDecision(action: PortfolioFeishuChannelAction): T;
  }): { action: PortfolioFeishuChannelAction; result: T } {
    const now = input.now?.getTime() ?? Date.now();
    return this.db.transaction(() => {
      const action = this.getChannelAction(input.id);
      const activeOwnerBinding = this.db.prepare(`SELECT 1 FROM portfolio_channel_bindings
        WHERE id = ? AND user_id = ? AND status = 'active' AND is_owner = 1`).get(input.bindingId, this.userId);
      if (!action || !activeOwnerBinding || action.bindingId !== input.bindingId || action.recordVersion !== input.recordVersion
        || action.ownerUserId !== input.ownerUserId || !input.validateCanonical(action)) {
        throw new Error("PORTFOLIO_FEISHU_ACTION_RECORD_DRIFT");
      }
      const result = input.applyOwnerDecision(action);
      const consumed = this.db.prepare(`UPDATE portfolio_channel_actions SET state = 'consumed', consumed_at = ?,
        projection_version = projection_version + 1, updated_at = ?
        WHERE id = ? AND user_id = ? AND binding_id = ? AND state = 'pending'
          AND expires_at > ? AND record_version = ? AND owner_user_id = ?`)
        .run(now, now, input.id, this.userId, input.bindingId, now, input.recordVersion, input.ownerUserId);
      if (consumed.changes !== 1) throw new Error("PORTFOLIO_FEISHU_ACTION_NOT_CONSUMABLE");
      return { action: this.getChannelAction(input.id) as PortfolioFeishuChannelAction, result };
    })();
  }

  enqueueDelivery(input: {
    bindingId: string;
    factId?: string;
    canonicalRecordType: string;
    canonicalRecordId: string;
    canonicalRecordVersion: number;
    eventType: string;
    summary: Record<string, unknown>;
    idempotencyKey: string;
    now?: Date;
  }): PortfolioFeishuDeliveryRecord {
    const binding = this.getBinding(input.bindingId);
    if (!binding || binding.status !== "active") throw new Error("PORTFOLIO_FEISHU_DELIVERY_BINDING_NOT_FOUND");
    if (input.factId && !this.db.prepare("SELECT 1 FROM portfolio_facts WHERE id = ? AND user_id = ?").get(input.factId, this.userId)) {
      throw new Error("PORTFOLIO_FEISHU_FACT_NOT_FOUND");
    }
    const existing = this.db.prepare(`SELECT * FROM portfolio_delivery_records WHERE user_id = ? AND binding_id = ?
      AND canonical_record_type = ? AND canonical_record_id = ? AND canonical_record_version = ?`)
      .get(this.userId, input.bindingId, input.canonicalRecordType, input.canonicalRecordId, input.canonicalRecordVersion) as Row | undefined;
    if (existing) return toDelivery(existing);
    const now = input.now?.getTime() ?? Date.now();
    const id = randomUUID();
    const summary = redactDeliverySummary(input.summary);
    try {
      this.db.prepare(`INSERT INTO portfolio_delivery_records (
        id, user_id, binding_id, fact_id, event_type, event_version, summary_json, state,
        projection_version, attempt_count, next_attempt_at, claim_token, claim_expires_at,
        provider_result_json, canonical_record_type, canonical_record_id, canonical_record_version,
        provider_result_digest, provider_error_code, idempotency_key, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 1, 0, ?, NULL, NULL, NULL, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL)`)
        .run(id, this.userId, input.bindingId, input.factId ?? null, input.eventType, input.canonicalRecordVersion,
          JSON.stringify(summary), now, input.canonicalRecordType, input.canonicalRecordId, input.canonicalRecordVersion,
          input.idempotencyKey, now, now);
      return this.getDelivery(id) as PortfolioFeishuDeliveryRecord;
    } catch (error) {
      if (isUniqueViolation(error)) return this.enqueueDelivery(input);
      throw error;
    }
  }

  enqueueCanonicalCommand(input: {
    channelActionId: string;
    bindingId: string;
    canonicalRecordType: string;
    canonicalRecordId: string;
    canonicalRecordVersion: number;
    factId?: string;
    commandType: string;
    now?: Date;
  }): void {
    const existing = this.db.prepare(`SELECT 1 FROM portfolio_feishu_command_intents
      WHERE channel_action_id = ?`).get(input.channelActionId);
    if (existing) return;
    const now = input.now?.getTime() ?? Date.now();
    this.db.prepare(`INSERT INTO portfolio_feishu_command_intents (
      id, user_id, channel_action_id, binding_id, canonical_record_type,
      canonical_record_id, canonical_record_version, fact_id, command_type, state, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
      .run(randomUUID(), this.userId, input.channelActionId, input.bindingId, input.canonicalRecordType,
        input.canonicalRecordId, input.canonicalRecordVersion, input.factId ?? null, bounded(input.commandType, 96, "PORTFOLIO_FEISHU_COMMAND_TYPE_INVALID"), now);
  }

  claimDueDeliveries(now = new Date(), limit = 20): PortfolioFeishuDeliveryRecord[] {
    const rows = this.db.prepare(`SELECT id FROM portfolio_delivery_records
      WHERE user_id = ? AND state IN ('pending', 'retry_scheduled') AND next_attempt_at <= ?
      ORDER BY next_attempt_at ASC LIMIT ?`).all(this.userId, now.getTime(), Math.min(limit, 20)) as Array<{ id: string }>;
    return rows.flatMap(({ id }) => {
      const token = randomUUID(); const expiry = now.getTime() + 60_000;
      const claimed = this.db.prepare(`UPDATE portfolio_delivery_records SET state = 'claimed', claim_token = ?,
        claim_expires_at = ?, attempt_count = attempt_count + 1, updated_at = ?
        WHERE id = ? AND user_id = ? AND state IN ('pending', 'retry_scheduled') AND next_attempt_at <= ?`)
        .run(token, expiry, now.getTime(), id, this.userId, now.getTime());
      const delivery = claimed.changes === 1 ? this.getDelivery(id) : undefined;
      return delivery ? [delivery] : [];
    });
  }

  finalizeDelivery(input: { id: string; claimToken: string; providerResult: Record<string, unknown>; errorCode?: string; retryable: boolean; now?: Date }): PortfolioFeishuDeliveryRecord {
    const now = input.now?.getTime() ?? Date.now();
    const current = this.getDelivery(input.id);
    if (!current || current.state !== "claimed" || current.claimToken !== input.claimToken) throw new Error("PORTFOLIO_FEISHU_DELIVERY_CLAIM_MISMATCH");
    const succeeded = !input.errorCode;
    const exhausted = !succeeded && (!input.retryable || current.attemptCount >= 4);
    const state: PortfolioFeishuDeliveryState = succeeded ? "delivered" : exhausted ? "failed" : "retry_scheduled";
    const retryDelay = retryDelays[Math.min(current.attemptCount - 1, retryDelays.length - 1)] ?? 600_000;
    this.db.prepare(`UPDATE portfolio_delivery_records SET state = ?, claim_token = NULL, claim_expires_at = NULL,
      next_attempt_at = ?, provider_result_digest = ?, provider_error_code = ?, updated_at = ?,
      completed_at = CASE WHEN ? IN ('delivered', 'failed') THEN ? ELSE NULL END
      WHERE id = ? AND user_id = ? AND state = 'claimed' AND claim_token = ?`)
      .run(state, succeeded || exhausted ? now : now + retryDelay, sha256(stableJson(redactDeliverySummary(input.providerResult))),
        input.errorCode ?? null, now, state, now, input.id, this.userId, input.claimToken);
    return this.getDelivery(input.id) as PortfolioFeishuDeliveryRecord;
  }

  private getIngressEvent(id: string): PortfolioFeishuIngressEvent | undefined {
    const row = this.db.prepare("SELECT * FROM portfolio_feishu_ingress_events WHERE id = ? AND user_id = ?").get(id, this.userId) as Row | undefined;
    if (!row || stringValue(row, "handler_kind") !== "portfolio") return undefined;
    return { id: stringValue(row, "id"), providerAccountId: stringValue(row, "provider_account_id"), providerEventId: stringValue(row, "provider_event_id"), transport: stringValue(row, "transport") as PortfolioFeishuTransport, handlerKind: stringValue(row, "handler_kind") as PortfolioFeishuIngressHandlerKind, eventDigest: stringValue(row, "event_digest"), state: stringValue(row, "state") as PortfolioFeishuIngressState };
  }
  private getDelivery(id: string): PortfolioFeishuDeliveryRecord | undefined {
    const row = this.db.prepare("SELECT * FROM portfolio_delivery_records WHERE id = ? AND user_id = ?").get(id, this.userId) as Row | undefined;
    return row ? toDelivery(row) : undefined;
  }
}

function toBinding(row: Row): PortfolioFeishuBinding { return { id: stringValue(row, "id"), userId: stringValue(row, "user_id"), provider: stringValue(row, "provider"), providerAccountId: stringValue(row, "provider_account_id"), externalIdentity: stringValue(row, "external_identity"), conversationId: stringValue(row, "conversation_id"), isOwner: numberValue(row, "is_owner") === 1, status: stringValue(row, "status") as "active" | "disabled", projectionVersion: numberValue(row, "projection_version") }; }
function toAction(row: Row): PortfolioFeishuChannelAction { return { id: stringValue(row, "id"), bindingId: stringValue(row, "binding_id"), recordType: stringValue(row, "record_type") as PortfolioFeishuChannelAction["recordType"], recordId: stringValue(row, "record_id"), actionType: stringValue(row, "action_type"), payloadDigest: stringValue(row, "payload_digest"), recordVersion: numberValue(row, "record_version"), ownerUserId: stringValue(row, "owner_user_id"), signatureDigest: stringValue(row, "signature_digest"), state: stringValue(row, "state") as PortfolioFeishuChannelAction["state"], expiresAt: new Date(numberValue(row, "expires_at")), consumedAt: nullableDate(row.consumed_at) }; }
function toDelivery(row: Row): PortfolioFeishuDeliveryRecord { return { id: stringValue(row, "id"), bindingId: stringValue(row, "binding_id"), factId: nullableString(row, "fact_id"), canonicalRecordType: stringValue(row, "canonical_record_type"), canonicalRecordId: stringValue(row, "canonical_record_id"), canonicalRecordVersion: numberValue(row, "canonical_record_version"), summary: parseObject(row.summary_json), state: stringValue(row, "state") as PortfolioFeishuDeliveryState, attemptCount: numberValue(row, "attempt_count"), nextAttemptAt: new Date(numberValue(row, "next_attempt_at")), claimToken: nullableString(row, "claim_token"), claimExpiresAt: nullableDate(row.claim_expires_at), providerResultDigest: nullableString(row, "provider_result_digest"), providerErrorCode: nullableString(row, "provider_error_code") }; }
function redactDeliverySummary(value: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|credential|password|authorization|signature|raw/i.test(key)) continue;
    if (typeof item === "string") safe[key] = redactSummary(item);
    else if (typeof item === "number" || typeof item === "boolean" || item === null) safe[key] = item;
  }
  return safe;
}
function parseObject(value: unknown): Record<string, unknown> { try { const parsed = typeof value === "string" ? JSON.parse(value) : {}; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; } }
function bounded(value: string, max: number, code: string): string { const normalized = value.trim(); if (!normalized || normalized.length > max) throw new Error(code); return normalized; }
function stringValue(row: Row, key: string): string { return typeof row[key] === "string" ? row[key] : ""; }
function numberValue(row: Row, key: string): number { return typeof row[key] === "number" ? row[key] : 0; }
function nullableString(row: Row, key: string): string | null { return typeof row[key] === "string" ? row[key] : null; }
function nullableDate(value: unknown): Date | null { return typeof value === "number" ? new Date(value) : null; }
function isUniqueViolation(error: unknown): boolean { return error instanceof Error && error.message.includes("UNIQUE constraint failed"); }
