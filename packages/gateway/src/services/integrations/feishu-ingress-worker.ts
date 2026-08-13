import type { FeishuInboxItem } from "../../db/repositories/feishu-channel-repository.js";
import { CopilotLiveRunConflictError } from "../../db/repositories/copilot-repository.js";

interface IngressWorkerRepository {
  claimNextInbox(now?: Date, leaseMs?: number): FeishuInboxItem | undefined;
  decryptInboxContent(id: string): string;
  hasLogicalMessageClaim(id: string, claimToken: string): boolean;
  completeInbox(id: string, claimToken: string, conversationId: string, now?: Date): FeishuInboxItem;
  failInbox(id: string, claimToken: string, input: {
    retryable: boolean;
    errorCode: string;
    retryAt?: Date;
  }): FeishuInboxItem;
}

export type FeishuIngressWorkerOutcome = "idle" | "completed" | "duplicate" | "retrying" | "dead_letter";

export class FeishuIngressWorker {
  constructor(
    private readonly repository: IngressWorkerRepository,
    private readonly options: {
      process(item: FeishuInboxItem & { content: string }): Promise<{ conversationId: string }>;
      leaseMs?: number;
      retryDelayMs?: number;
      maxAttempts?: number;
    }
  ) {}

  async runOnce(now = new Date()): Promise<FeishuIngressWorkerOutcome> {
    const item = this.repository.claimNextInbox(now, this.options.leaseMs ?? 30_000);
    if (!item?.claimToken) return "idle";
    if (this.repository.hasLogicalMessageClaim(item.id, item.claimToken)) {
      this.repository.completeInbox(item.id, item.claimToken, "duplicate", now);
      return "duplicate";
    }
    try {
      const result = await this.options.process({
        ...item,
        content: this.repository.decryptInboxContent(item.id)
      });
      this.repository.completeInbox(item.id, item.claimToken, result.conversationId, now);
      return "completed";
    } catch (error) {
      const retryable = item.attemptCount < (this.options.maxAttempts ?? 5);
      this.repository.failInbox(item.id, item.claimToken, {
        retryable,
        errorCode: classifyError(error),
        retryAt: new Date(now.getTime() + (this.options.retryDelayMs ?? 1_000))
      });
      return retryable ? "retrying" : "dead_letter";
    }
  }
}

function classifyError(error: unknown): string {
  if (error instanceof CopilotLiveRunConflictError) return "COPILOT_BUSY";
  if (error instanceof Error && error.message.includes("COPILOT_BUSY")) return "COPILOT_BUSY";
  return "FEISHU_INGRESS_PROCESSING_FAILED";
}
