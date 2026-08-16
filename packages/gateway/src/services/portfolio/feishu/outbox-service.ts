import type { PortfolioFeishuChannelRepository, PortfolioFeishuDeliveryRecord } from "../../../db/repositories/portfolio-feishu-channel-repository.js";
import type { PortfolioSafeDeliverySummary } from "./contracts.js";

/** Delivery retries mutate only the outbox projection and never invoke workflow services. */
export class PortfolioFeishuOutboxService {
  constructor(private readonly repository: PortfolioFeishuChannelRepository) {}

  enqueue(input: { bindingId: string; factId?: string; canonicalRecordType: string; canonicalRecordId: string; canonicalRecordVersion: number; eventType: string; summary: PortfolioSafeDeliverySummary; idempotencyKey: string }) {
    return this.repository.enqueueDelivery({ ...input, summary: { ...input.summary } });
  }

  claim(now = new Date()): PortfolioFeishuDeliveryRecord[] { return this.repository.claimDueDeliveries(now); }

  recordProviderResult(input: { id: string; claimToken: string; providerResult: Record<string, unknown>; errorCode?: string; retryable: boolean; now?: Date }) {
    return this.repository.finalizeDelivery(input);
  }
}
