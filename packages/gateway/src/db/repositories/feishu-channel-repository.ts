import { randomUUID } from "node:crypto";

import { decryptSecret, encryptSecret, type EncryptedSecret } from "../../crypto/secret-box.js";
import type { Database } from "../types.js";

export interface FeishuAccountSummary {
  id: string;
  appId: string;
  enabled: boolean;
  secretConfigured: boolean;
  connectionState: string;
  configRevision: number;
  updatedAt: Date;
}

export interface FeishuInboxItem {
  id: string;
  accountId: string;
  eventId: string;
  messageId: string | null;
  eventType: string;
  laneKey: string;
  chatId: string;
  threadId: string | null;
  senderOpenId: string | null;
  status: string;
  claimToken: string | null;
  claimExpiresAt: Date | null;
  attemptCount: number;
}

export interface FeishuCardAction {
  id: string;
  status: string;
  accountId: string;
  chatId: string;
  threadId: string | null;
  operatorOpenId: string;
  actionType: string;
  resourceId: string;
  payloadDigest: string;
  resourceRevision: number;
  permissionSnapshot: Record<string, unknown>;
  expiresAt: Date;
  cardMessageId: string | null;
}

export interface FeishuOutboxItem {
  id: string;
  accountId: string;
  idempotencyKey: string;
  chatId: string;
  threadId: string | null;
  status: "pending" | "claimed" | "delivered" | "failed" | "accepted_receipt_missing";
  nextPartIndex: number;
  providerMessageIds: string[];
  claimToken: string | null;
  claimExpiresAt: Date | null;
  attemptCount: number;
}

interface AccountRow {
  id: string;
  app_id: string;
  app_secret_encrypted: string;
  enabled: number;
  connection_state: string;
  config_revision: number;
  updated_at: number;
}

interface InboxRow {
  id: string;
  account_id: string;
  event_id: string;
  message_id: string | null;
  event_type: string;
  lane_key: string;
  chat_id: string;
  thread_id: string | null;
  sender_open_id: string | null;
  status: string;
  claim_token: string | null;
  claim_expires_at: number | null;
  attempt_count: number;
}

interface CardActionRow {
  id: string;
  account_id: string;
  chat_id: string;
  thread_id: string | null;
  operator_open_id: string;
  action_type: string;
  resource_id: string;
  payload_digest: string;
  resource_revision: number;
  permission_snapshot: string;
  status: string;
  expires_at: number;
  card_message_id: string | null;
}

interface OutboxRow {
  id: string;
  account_id: string;
  idempotency_key: string;
  chat_id: string;
  thread_id: string | null;
  status: FeishuOutboxItem["status"];
  next_part_index: number;
  provider_message_ids: string;
  claim_token: string | null;
  claim_expires_at: number | null;
  attempt_count: number;
}

export class FeishuChannelRepository {
  constructor(
    private readonly db: Database,
    private readonly userId: string,
    private readonly masterKey: string
  ) {}

  upsertAccount(input: { appId: string; appSecret?: string; enabled: boolean }): FeishuAccountSummary {
    const existing = this.getAccountRow();
    if (!existing && !input.appSecret) throw new Error("FEISHU_APP_SECRET_REQUIRED");
    const encrypted = input.appSecret
      ? JSON.stringify(encryptSecret(input.appSecret, { key: this.masterKey }))
      : existing!.app_secret_encrypted;
    const now = Date.now();
    if (existing) {
      this.db.prepare(`
        UPDATE feishu_channel_accounts
        SET app_id = ?, app_secret_encrypted = ?, enabled = ?, connection_state = ?,
            config_revision = config_revision + 1, updated_at = ?
        WHERE id = ? AND user_id = ?
      `).run(input.appId.trim(), encrypted, input.enabled ? 1 : 0, input.enabled ? "pending" : "disabled", now, existing.id, this.userId);
      return this.getAccount(existing.id) as FeishuAccountSummary;
    }
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO feishu_channel_accounts (
        id, user_id, app_id, app_secret_encrypted, enabled, connection_state,
        config_revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, this.userId, input.appId.trim(), encrypted, input.enabled ? 1 : 0, input.enabled ? "pending" : "disabled", now, now);
    return this.getAccount(id) as FeishuAccountSummary;
  }

  getAccount(id?: string): FeishuAccountSummary | undefined {
    const row = id
      ? this.db.prepare("SELECT * FROM feishu_channel_accounts WHERE id = ? AND user_id = ?").get(id, this.userId) as AccountRow | undefined
      : this.getAccountRow();
    return row ? toAccount(row) : undefined;
  }

  updateAccountHealth(id: string, input: {
    state: string;
    lastConnectedAt?: Date | null;
    errorCode?: string | null;
    errorMessage?: string | null;
  }): FeishuAccountSummary {
    const result = this.db.prepare(`
      UPDATE feishu_channel_accounts SET connection_state = ?, last_connected_at = ?,
        last_error_code = ?, last_error_message = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(input.state.slice(0, 64), input.lastConnectedAt?.getTime() ?? null,
      input.errorCode?.slice(0, 128) ?? null, input.errorMessage?.slice(0, 500) ?? null,
      Date.now(), id, this.userId);
    if (result.changes !== 1) throw new Error("FEISHU_ACCOUNT_NOT_FOUND");
    return this.getAccount(id) as FeishuAccountSummary;
  }

  decryptAccountCredentials(id: string): { appId: string; appSecret: string } {
    const row = this.db.prepare(
      "SELECT * FROM feishu_channel_accounts WHERE id = ? AND user_id = ?"
    ).get(id, this.userId) as AccountRow | undefined;
    if (!row) throw new Error("FEISHU_ACCOUNT_NOT_FOUND");
    return {
      appId: row.app_id,
      appSecret: decryptSecret(JSON.parse(row.app_secret_encrypted) as EncryptedSecret, { key: this.masterKey })
    };
  }

  decryptInboxContent(id: string): string {
    const row = this.db.prepare(`
      SELECT content_encrypted FROM feishu_channel_inbox WHERE id = ? AND user_id = ?
    `).get(id, this.userId) as { content_encrypted: string } | undefined;
    if (!row) throw new Error("FEISHU_INBOX_NOT_FOUND");
    return decryptSecret(JSON.parse(row.content_encrypted) as EncryptedSecret, { key: this.masterKey });
  }

  hasLogicalMessageClaim(id: string, claimToken: string): boolean {
    const row = this.requireClaimedInbox(id, claimToken);
    if (!row.message_id) return false;
    return Boolean(this.db.prepare(`
      SELECT 1 FROM feishu_channel_logical_claims
      WHERE user_id = ? AND account_id = ? AND message_id = ?
    `).get(this.userId, row.account_id, row.message_id));
  }

  admitInbox(input: {
    accountId: string;
    eventId: string;
    messageId?: string;
    eventType: string;
    laneKey: string;
    chatId: string;
    threadId?: string;
    senderOpenId?: string;
    content: string;
    retentionUntil: Date;
  }): { admitted: true; id: string } | { admitted: false; reason: "duplicate_event" } {
    const accountId = this.resolveAccountId(input.accountId);
    const id = randomUUID();
    const now = Date.now();
    const encryptedContent = JSON.stringify(encryptSecret(input.content, { key: this.masterKey }));
    try {
      this.db.prepare(`
        INSERT INTO feishu_channel_inbox (
          id, user_id, account_id, event_id, message_id, event_type, lane_key, chat_id,
          thread_id, sender_open_id, content_encrypted, status, not_before,
          retention_until, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
      `).run(id, this.userId, accountId, input.eventId, input.messageId ?? null, input.eventType,
        input.laneKey, input.chatId, input.threadId ?? null, input.senderOpenId ?? null,
        encryptedContent, now, input.retentionUntil.getTime(), now, now);
      return { admitted: true, id };
    } catch (error) {
      if (isUniqueViolation(error, "feishu_channel_inbox")) return { admitted: false, reason: "duplicate_event" };
      throw error;
    }
  }

  claimNextInbox(now = new Date(), leaseMs = 30_000): FeishuInboxItem | undefined {
    const claim = this.db.transaction(() => {
      const timestamp = now.getTime();
      // Recovery is tenant-scoped so one account cannot steal another tenant's expired work.
      this.db.prepare(`
        UPDATE feishu_channel_inbox SET status = 'pending', claim_token = NULL,
          claim_expires_at = NULL, updated_at = ?
        WHERE user_id = ? AND status = 'claimed' AND claim_expires_at <= ?
      `).run(timestamp, this.userId, timestamp);
      const row = this.db.prepare(`
        SELECT candidate.* FROM feishu_channel_inbox candidate
        WHERE candidate.user_id = ? AND candidate.status = 'pending' AND candidate.not_before <= ?
          AND NOT EXISTS (
            SELECT 1 FROM feishu_channel_inbox blocker
            WHERE blocker.user_id = candidate.user_id AND blocker.account_id = candidate.account_id
              AND blocker.lane_key = candidate.lane_key AND blocker.status = 'claimed'
          )
          AND NOT EXISTS (
            SELECT 1 FROM feishu_channel_inbox earlier
            WHERE earlier.user_id = candidate.user_id AND earlier.account_id = candidate.account_id
              AND earlier.lane_key = candidate.lane_key AND earlier.status = 'pending'
              AND (earlier.created_at < candidate.created_at OR (earlier.created_at = candidate.created_at AND earlier.rowid < candidate.rowid))
          )
        ORDER BY candidate.not_before, candidate.created_at, candidate.rowid LIMIT 1
      `).get(this.userId, timestamp) as InboxRow | undefined;
      if (!row) return undefined;
      const token = randomUUID();
      const result = this.db.prepare(`
        UPDATE feishu_channel_inbox SET status = 'claimed', claim_token = ?, claim_expires_at = ?,
          attempt_count = attempt_count + 1, updated_at = ?
        WHERE id = ? AND user_id = ? AND status = 'pending'
      `).run(token, timestamp + leaseMs, timestamp, row.id, this.userId);
      return result.changes === 1 ? this.getInbox(row.id) : undefined;
    });
    return claim();
  }

  adoptLogicalMessage(id: string, claimToken: string): boolean {
    const row = this.requireClaimedInbox(id, claimToken);
    if (!row.message_id) return true;
    try {
      this.db.prepare(`
        INSERT INTO feishu_channel_logical_claims (id, user_id, account_id, message_id, inbox_id, adopted_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), this.userId, row.account_id, row.message_id, id, Date.now());
      return true;
    } catch (error) {
      if (isUniqueViolation(error, "feishu_channel_logical_claims")) return false;
      throw error;
    }
  }

  completeInbox(id: string, claimToken: string, conversationId: string, now = new Date()): FeishuInboxItem {
    const complete = this.db.transaction(() => {
      this.adoptLogicalMessage(id, claimToken);
      const result = this.db.prepare(`
        UPDATE feishu_channel_inbox SET status = 'completed', claim_token = NULL,
          claim_expires_at = NULL, conversation_id = ?, completed_at = ?, updated_at = ?
        WHERE id = ? AND user_id = ? AND status = 'claimed' AND claim_token = ?
      `).run(conversationId, now.getTime(), now.getTime(), id, this.userId, claimToken);
      if (result.changes !== 1) throw new Error("FEISHU_INBOX_CLAIM_MISMATCH");
      return this.getInbox(id) as FeishuInboxItem;
    });
    return complete();
  }

  failInbox(id: string, claimToken: string, input: {
    retryable: boolean;
    errorCode: string;
    retryAt?: Date;
  }): FeishuInboxItem {
    this.requireClaimedInbox(id, claimToken);
    const now = Date.now();
    const result = this.db.prepare(`
      UPDATE feishu_channel_inbox SET status = ?, not_before = ?, claim_token = NULL,
        claim_expires_at = NULL, last_error_code = ?, completed_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND status = 'claimed' AND claim_token = ?
    `).run(input.retryable ? "pending" : "failed", input.retryAt?.getTime() ?? now,
      input.errorCode.slice(0, 128), input.retryable ? null : now, now, id, this.userId, claimToken);
    if (result.changes !== 1) throw new Error("FEISHU_INBOX_CLAIM_MISMATCH");
    return this.getInbox(id) as FeishuInboxItem;
  }

  createCardAction(input: {
    accountId: string;
    chatId: string;
    threadId?: string;
    operatorOpenId: string;
    actionType: string;
    resourceId: string;
    payloadDigest: string;
    resourceRevision: number;
    permissionSnapshot: Record<string, unknown>;
    expiresAt: Date;
  }): FeishuCardAction {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO feishu_card_actions (
        id, user_id, account_id, chat_id, thread_id, operator_open_id, action_type,
        resource_id, payload_digest, resource_revision, permission_snapshot, nonce,
        status, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(id, this.userId, this.resolveAccountId(input.accountId), input.chatId,
      input.threadId ?? null, input.operatorOpenId, input.actionType, input.resourceId,
      input.payloadDigest, input.resourceRevision, JSON.stringify(input.permissionSnapshot),
      randomUUID(), input.expiresAt.getTime(), now, now);
    return this.getCardAction(id) as FeishuCardAction;
  }

  findPendingCardAction(input: {
    accountId: string;
    chatId: string;
    threadId?: string;
    operatorOpenId: string;
    actionType: string;
    resourceId: string;
  }): FeishuCardAction | undefined {
    const row = this.db.prepare(`
      SELECT * FROM feishu_card_actions
      WHERE user_id = ? AND account_id = ? AND chat_id = ?
        AND thread_id IS ? AND operator_open_id = ? AND action_type = ?
        AND resource_id = ? AND status = 'pending'
      ORDER BY created_at DESC LIMIT 1
    `).get(
      this.userId,
      this.resolveAccountId(input.accountId),
      input.chatId,
      input.threadId ?? null,
      input.operatorOpenId,
      input.actionType,
      input.resourceId
    ) as CardActionRow | undefined;
    return row ? toCardAction(row) : undefined;
  }

  findCardActionByMessage(input: {
    accountId: string;
    chatId: string;
    operatorOpenId: string;
    cardMessageId: string;
  }): FeishuCardAction | undefined {
    const row = this.db.prepare(`
      SELECT * FROM feishu_card_actions
      WHERE user_id = ? AND account_id = ? AND chat_id = ?
        AND operator_open_id = ? AND card_message_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(
      this.userId,
      this.resolveAccountId(input.accountId),
      input.chatId,
      input.operatorOpenId,
      input.cardMessageId
    ) as CardActionRow | undefined;
    return row ? toCardAction(row) : undefined;
  }

  getQueueSummary(): { inbox: Record<string, number>; outbox: Record<string, number> } {
    return {
      inbox: countStatuses(this.db, "feishu_channel_inbox", this.userId),
      outbox: countStatuses(this.db, "feishu_channel_outbox", this.userId)
    };
  }

  claimCardAction(id: string, input: {
    operatorOpenId: string;
    chatId: string;
    threadId?: string;
    payloadDigest: string;
    resourceRevision: number;
    cardMessageId?: string;
    now?: Date;
  }): FeishuCardAction {
    const row = this.getCardActionRow(id);
    if (!row) throw new Error("CARD_ACTION_NOT_FOUND");
    if (row.status !== "pending") throw new Error("CARD_ACTION_ALREADY_CLAIMED");
    const threadId = input.threadId ?? null;
    if (row.operator_open_id !== input.operatorOpenId || row.chat_id !== input.chatId
      || row.thread_id !== threadId || row.payload_digest !== input.payloadDigest
      || row.resource_revision !== input.resourceRevision
      || (row.card_message_id !== null && row.card_message_id !== (input.cardMessageId ?? null))) {
      throw new Error("CARD_ACTION_CONTEXT_MISMATCH");
    }
    const now = input.now ?? new Date();
    if (row.expires_at <= now.getTime()) throw new Error("CARD_ACTION_EXPIRED");
    // The status predicate is the replay barrier even with concurrent callbacks.
    const result = this.db.prepare(`
      UPDATE feishu_card_actions SET status = 'claimed', claimed_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND status = 'pending'
    `).run(now.getTime(), now.getTime(), id, this.userId);
    if (result.changes !== 1) throw new Error("CARD_ACTION_ALREADY_CLAIMED");
    return this.getCardAction(id) as FeishuCardAction;
  }

  bindCardActionMessageIds(actionIds: string[], messageId: string): void {
    if (!actionIds.length) return;
    const update = this.db.prepare(`
      UPDATE feishu_card_actions SET card_message_id = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND status = 'pending' AND card_message_id IS NULL
    `);
    const bind = this.db.transaction(() => {
      for (const actionId of actionIds) update.run(messageId, Date.now(), actionId, this.userId);
    });
    bind();
  }

  enqueueOutbox(input: {
    accountId: string;
    idempotencyKey: string;
    chatId: string;
    threadId?: string;
    payload: string;
    notBefore?: Date;
  }): FeishuOutboxItem {
    const accountId = this.resolveAccountId(input.accountId);
    const existing = this.getOutboxByKey(accountId, input.idempotencyKey);
    if (existing) return existing;
    const id = randomUUID();
    const now = Date.now();
    const encrypted = JSON.stringify(encryptSecret(input.payload, { key: this.masterKey }));
    try {
      this.db.prepare(`
        INSERT INTO feishu_channel_outbox (
          id, user_id, account_id, idempotency_key, chat_id, thread_id,
          payload_encrypted, status, next_part_index, provider_message_ids,
          not_before, attempt_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, '[]', ?, 0, ?, ?)
      `).run(id, this.userId, accountId, input.idempotencyKey, input.chatId,
        input.threadId ?? null, encrypted, input.notBefore?.getTime() ?? now, now, now);
    } catch (error) {
      if (isUniqueViolation(error, "feishu_channel_outbox")) {
        return this.getOutboxByKey(accountId, input.idempotencyKey) as FeishuOutboxItem;
      }
      throw error;
    }
    return this.getOutbox(id) as FeishuOutboxItem;
  }

  getOutbox(id: string): FeishuOutboxItem | undefined {
    const row = this.db.prepare("SELECT * FROM feishu_channel_outbox WHERE id = ? AND user_id = ?")
      .get(id, this.userId) as OutboxRow | undefined;
    return row ? toOutbox(row) : undefined;
  }

  decryptOutboxPayload(id: string): string {
    const row = this.db.prepare(`
      SELECT payload_encrypted FROM feishu_channel_outbox WHERE id = ? AND user_id = ?
    `).get(id, this.userId) as { payload_encrypted: string } | undefined;
    if (!row) throw new Error("FEISHU_OUTBOX_NOT_FOUND");
    return decryptSecret(JSON.parse(row.payload_encrypted) as EncryptedSecret, { key: this.masterKey });
  }

  claimNextOutbox(now = new Date(), leaseMs = 30_000): FeishuOutboxItem | undefined {
    const claim = this.db.transaction(() => {
      const timestamp = now.getTime();
      this.db.prepare(`
        UPDATE feishu_channel_outbox SET status = 'pending', claim_token = NULL,
          claim_expires_at = NULL, updated_at = ?
        WHERE user_id = ? AND status = 'claimed' AND claim_expires_at <= ?
      `).run(timestamp, this.userId, timestamp);
      const row = this.db.prepare(`
        SELECT * FROM feishu_channel_outbox
        WHERE user_id = ? AND status = 'pending' AND not_before <= ?
        ORDER BY not_before, created_at LIMIT 1
      `).get(this.userId, timestamp) as OutboxRow | undefined;
      if (!row) return undefined;
      const token = randomUUID();
      const result = this.db.prepare(`
        UPDATE feishu_channel_outbox SET status = 'claimed', claim_token = ?,
          claim_expires_at = ?, attempt_count = attempt_count + 1, updated_at = ?
        WHERE id = ? AND user_id = ? AND status = 'pending'
      `).run(token, timestamp + leaseMs, timestamp, row.id, this.userId);
      return result.changes === 1 ? this.getOutbox(row.id) : undefined;
    });
    return claim();
  }

  recordOutboxPartDelivered(id: string, claimToken: string, partIndex: number, messageId: string): FeishuOutboxItem {
    const existing = this.requireClaimedOutbox(id, claimToken);
    if (existing.next_part_index !== partIndex) throw new Error("FEISHU_OUTBOX_PART_MISMATCH");
    const messageIds = parseStringArray(existing.provider_message_ids);
    messageIds.push(messageId);
    const result = this.db.prepare(`
      UPDATE feishu_channel_outbox SET next_part_index = ?, provider_message_ids = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND status = 'claimed' AND claim_token = ? AND next_part_index = ?
    `).run(partIndex + 1, JSON.stringify(messageIds), Date.now(), id, this.userId, claimToken, partIndex);
    if (result.changes !== 1) throw new Error("FEISHU_OUTBOX_PART_MISMATCH");
    return this.getOutbox(id) as FeishuOutboxItem;
  }

  completeOutbox(id: string, claimToken: string, now = new Date()): FeishuOutboxItem {
    return this.finishOutbox(id, claimToken, "delivered", null, now);
  }

  markOutboxReceiptMissing(id: string, claimToken: string, now = new Date()): FeishuOutboxItem {
    return this.finishOutbox(id, claimToken, "accepted_receipt_missing", "FEISHU_RECEIPT_MISSING", now);
  }

  failOutbox(id: string, claimToken: string, input: {
    retryable: boolean;
    errorCode: string;
    retryAt?: Date;
    now?: Date;
  }): FeishuOutboxItem {
    this.requireClaimedOutbox(id, claimToken);
    const now = input.now ?? new Date();
    const result = this.db.prepare(`
      UPDATE feishu_channel_outbox SET status = ?, not_before = ?, claim_token = NULL,
        claim_expires_at = NULL, last_error_code = ?, completed_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND status = 'claimed' AND claim_token = ?
    `).run(input.retryable ? "pending" : "failed", input.retryAt?.getTime() ?? now.getTime(),
      input.errorCode.slice(0, 128), input.retryable ? null : now.getTime(), now.getTime(),
      id, this.userId, claimToken);
    if (result.changes !== 1) throw new Error("FEISHU_OUTBOX_CLAIM_MISMATCH");
    return this.getOutbox(id) as FeishuOutboxItem;
  }

  private getAccountRow(): AccountRow | undefined {
    return this.db.prepare("SELECT * FROM feishu_channel_accounts WHERE user_id = ?")
      .get(this.userId) as AccountRow | undefined;
  }

  private resolveAccountId(accountId: string): string {
    if (accountId !== "default") {
      const owned = this.getAccount(accountId);
      if (!owned) throw new Error("FEISHU_ACCOUNT_NOT_FOUND");
      return accountId;
    }
    const account = this.getAccountRow();
    if (!account) throw new Error("FEISHU_ACCOUNT_NOT_FOUND");
    return account.id;
  }

  private getInbox(id: string): FeishuInboxItem | undefined {
    const row = this.db.prepare("SELECT * FROM feishu_channel_inbox WHERE id = ? AND user_id = ?")
      .get(id, this.userId) as InboxRow | undefined;
    return row ? toInbox(row) : undefined;
  }

  private requireClaimedInbox(id: string, claimToken: string): InboxRow {
    const row = this.db.prepare(`
      SELECT * FROM feishu_channel_inbox
      WHERE id = ? AND user_id = ? AND status = 'claimed' AND claim_token = ?
    `).get(id, this.userId, claimToken) as InboxRow | undefined;
    if (!row) throw new Error("FEISHU_INBOX_CLAIM_MISMATCH");
    return row;
  }

  private getCardActionRow(id: string): CardActionRow | undefined {
    return this.db.prepare("SELECT * FROM feishu_card_actions WHERE id = ? AND user_id = ?")
      .get(id, this.userId) as CardActionRow | undefined;
  }

  private getOutboxByKey(accountId: string, idempotencyKey: string): FeishuOutboxItem | undefined {
    const row = this.db.prepare(`
      SELECT * FROM feishu_channel_outbox
      WHERE user_id = ? AND account_id = ? AND idempotency_key = ?
    `).get(this.userId, accountId, idempotencyKey) as OutboxRow | undefined;
    return row ? toOutbox(row) : undefined;
  }

  private requireClaimedOutbox(id: string, claimToken: string): OutboxRow {
    const row = this.db.prepare(`
      SELECT * FROM feishu_channel_outbox
      WHERE id = ? AND user_id = ? AND status = 'claimed' AND claim_token = ?
    `).get(id, this.userId, claimToken) as OutboxRow | undefined;
    if (!row) throw new Error("FEISHU_OUTBOX_CLAIM_MISMATCH");
    return row;
  }

  private finishOutbox(
    id: string,
    claimToken: string,
    status: "delivered" | "accepted_receipt_missing",
    errorCode: string | null,
    now: Date
  ): FeishuOutboxItem {
    const result = this.db.prepare(`
      UPDATE feishu_channel_outbox SET status = ?, claim_token = NULL,
        claim_expires_at = NULL, last_error_code = ?, completed_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND status = 'claimed' AND claim_token = ?
    `).run(status, errorCode, now.getTime(), now.getTime(), id, this.userId, claimToken);
    if (result.changes !== 1) throw new Error("FEISHU_OUTBOX_CLAIM_MISMATCH");
    return this.getOutbox(id) as FeishuOutboxItem;
  }

  getCardAction(id: string): FeishuCardAction | undefined {
    const row = this.getCardActionRow(id);
    return row ? toCardAction(row) : undefined;
  }
}

function toCardAction(row: CardActionRow): FeishuCardAction {
  return {
    id: row.id,
    status: row.status,
    accountId: row.account_id,
    chatId: row.chat_id,
    threadId: row.thread_id,
    operatorOpenId: row.operator_open_id,
    actionType: row.action_type,
    resourceId: row.resource_id,
    payloadDigest: row.payload_digest,
    resourceRevision: row.resource_revision,
    permissionSnapshot: JSON.parse(row.permission_snapshot) as Record<string, unknown>,
    expiresAt: new Date(row.expires_at),
    cardMessageId: row.card_message_id
  };
}

function toAccount(row: AccountRow): FeishuAccountSummary {
  return {
    id: row.id,
    appId: row.app_id,
    enabled: row.enabled === 1,
    secretConfigured: row.app_secret_encrypted.length > 0,
    connectionState: row.connection_state,
    configRevision: row.config_revision,
    updatedAt: new Date(row.updated_at)
  };
}

function toInbox(row: InboxRow): FeishuInboxItem {
  return {
    id: row.id,
    accountId: row.account_id,
    eventId: row.event_id,
    messageId: row.message_id,
    eventType: row.event_type,
    laneKey: row.lane_key,
    chatId: row.chat_id,
    threadId: row.thread_id,
    senderOpenId: row.sender_open_id,
    status: row.status,
    claimToken: row.claim_token,
    claimExpiresAt: row.claim_expires_at === null ? null : new Date(row.claim_expires_at),
    attemptCount: row.attempt_count
  };
}

function countStatuses(db: Database, table: "feishu_channel_inbox" | "feishu_channel_outbox", userId: string): Record<string, number> {
  // Table is an internal literal union; status and tenant remain parameterized values.
  const rows = db.prepare(`SELECT status, COUNT(*) AS count FROM ${table} WHERE user_id = ? GROUP BY status`)
    .all(userId) as Array<{ status: string; count: number }>;
  return Object.fromEntries(rows.map((row) => [row.status, row.count]));
}

function toOutbox(row: OutboxRow): FeishuOutboxItem {
  return {
    id: row.id,
    accountId: row.account_id,
    idempotencyKey: row.idempotency_key,
    chatId: row.chat_id,
    threadId: row.thread_id,
    status: row.status,
    nextPartIndex: row.next_part_index,
    providerMessageIds: parseStringArray(row.provider_message_ids),
    claimToken: row.claim_token,
    claimExpiresAt: row.claim_expires_at === null ? null : new Date(row.claim_expires_at),
    attemptCount: row.attempt_count
  };
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function isUniqueViolation(error: unknown, table: string): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed")
    && error.message.includes(table);
}
