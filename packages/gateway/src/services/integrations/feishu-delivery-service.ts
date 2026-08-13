import type {
  FeishuChannelRepository,
  FeishuOutboxItem
} from "../../db/repositories/feishu-channel-repository.js";
import type { FeishuTrustedCard } from "./feishu-card-renderer.js";

export type FeishuDeliveryPart =
  | { type: "text"; content: string }
  | { type: "card"; content: FeishuTrustedCard };

export interface FeishuDeliveryPlan {
  accountId: string;
  idempotencyKey: string;
  chatId: string;
  threadId?: string;
  parts: FeishuDeliveryPart[];
}

export class FeishuDeliveryError extends Error {
  readonly retryable: boolean;
  readonly accepted: boolean;

  constructor(message: string, options: { retryable: boolean; accepted: boolean }) {
    super(message);
    this.name = "FeishuDeliveryError";
    this.retryable = options.retryable;
    this.accepted = options.accepted;
  }
}

export class FeishuDeliveryService {
  constructor(private readonly repository: FeishuChannelRepository) {}

  enqueue(plan: FeishuDeliveryPlan): FeishuOutboxItem {
    if (!plan.parts.length || plan.parts.length > 20) throw new Error("FEISHU_DELIVERY_PARTS_INVALID");
    return this.repository.enqueueOutbox({
      accountId: plan.accountId,
      idempotencyKey: bounded(plan.idempotencyKey, 256, "FEISHU_IDEMPOTENCY_KEY_INVALID"),
      chatId: bounded(plan.chatId, 128, "FEISHU_CHAT_ID_INVALID"),
      ...(plan.threadId ? { threadId: bounded(plan.threadId, 128, "FEISHU_THREAD_ID_INVALID") } : {}),
      payload: JSON.stringify({ version: 1, parts: plan.parts })
    });
  }
}

function bounded(value: string, max: number, code: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(code);
  return normalized;
}
