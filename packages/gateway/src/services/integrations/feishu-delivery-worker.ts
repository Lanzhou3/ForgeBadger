import type {
  FeishuChannelRepository,
  FeishuOutboxItem
} from "../../db/repositories/feishu-channel-repository.js";
import {
  FeishuDeliveryError,
  type FeishuDeliveryPart
} from "./feishu-delivery-service.js";

export type FeishuDeliveryOutcome =
  | "idle"
  | "delivered"
  | "retrying"
  | "failed"
  | "accepted_receipt_missing";

export class FeishuDeliveryWorker {
  constructor(
    private readonly repository: FeishuChannelRepository,
    private readonly options: {
      send(part: FeishuDeliveryPart, target: {
        accountId: string;
        chatId: string;
        threadId: string | null;
      }): Promise<{ accepted: boolean; messageId?: string }>;
      leaseMs?: number;
      retryDelayMs?: number;
      maxAttempts?: number;
    }
  ) {}

  async runOnce(now = new Date()): Promise<FeishuDeliveryOutcome> {
    const item = this.repository.claimNextOutbox(now, this.options.leaseMs ?? 30_000);
    if (!item?.claimToken) return "idle";
    const parts = parseParts(this.repository.decryptOutboxPayload(item.id));
    try {
      for (let index = item.nextPartIndex; index < parts.length; index += 1) {
        const part = parts[index]!;
        const result = await this.options.send(part, target(item));
        if (!result.accepted || !result.messageId) {
          this.repository.markOutboxReceiptMissing(item.id, item.claimToken, now);
          return "accepted_receipt_missing";
        }
        this.repository.recordOutboxPartDelivered(item.id, item.claimToken, index, result.messageId);
        if (part.type === "card") {
          // Callback authorization uses the provider-issued card message ID, not the source thread ID.
          this.repository.bindCardActionMessageIds(cardActionIds(part), result.messageId);
        }
      }
      this.repository.completeOutbox(item.id, item.claimToken, now);
      return "delivered";
    } catch (error) {
      const classified = error instanceof FeishuDeliveryError
        ? error
        : new FeishuDeliveryError("delivery failed", { retryable: true, accepted: false });
      if (classified.accepted) {
        this.repository.markOutboxReceiptMissing(item.id, item.claimToken, now);
        return "accepted_receipt_missing";
      }
      const retryable = classified.retryable && item.attemptCount < (this.options.maxAttempts ?? 5);
      this.repository.failOutbox(item.id, item.claimToken, {
        retryable,
        errorCode: retryable ? "FEISHU_DELIVERY_RETRYABLE" : "FEISHU_DELIVERY_PERMANENT",
        retryAt: new Date(now.getTime() + (this.options.retryDelayMs ?? 1_000)),
        now
      });
      return retryable ? "retrying" : "failed";
    }
  }
}

function parseParts(payload: string): FeishuDeliveryPart[] {
  const parsed = JSON.parse(payload) as { version?: unknown; parts?: unknown };
  if (parsed.version !== 1 || !Array.isArray(parsed.parts)) throw new Error("FEISHU_OUTBOX_PAYLOAD_INVALID");
  return parsed.parts as FeishuDeliveryPart[];
}

function target(item: FeishuOutboxItem) {
  return { accountId: item.accountId, chatId: item.chatId, threadId: item.threadId };
}

function cardActionIds(part: FeishuDeliveryPart): string[] {
  if (part.type !== "card") return [];
  const rows = part.content.elements.filter((element) => element.tag === "action");
  return rows.flatMap((row) => {
    const actions = Array.isArray(row.actions) ? row.actions : [];
    return actions.flatMap((action) => {
      if (!action || typeof action !== "object") return [];
      const value = (action as { value?: unknown }).value;
      if (!value || typeof value !== "object") return [];
      const id = (value as { action_id?: unknown }).action_id;
      return typeof id === "string" ? [id] : [];
    });
  });
}
