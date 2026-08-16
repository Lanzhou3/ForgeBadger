import type { PortfolioFeishuChannelRepository, PortfolioFeishuIngressEvent } from "../../../db/repositories/portfolio-feishu-channel-repository.js";
import type { FeishuIngressSelection, VerifiedFeishuIngress } from "./ingress-selector.js";

export interface PortfolioRequestCapturePort {
  createRequest(input: {
    source: string;
    sourceEventId: string;
    requesterId: string;
    requestText: string;
    correlationId: string;
    idempotencyKey: string;
    sourceMetadata: Record<string, unknown>;
  }): { id: string; correlationId: string };
}

/** Captures text as an immutable requirement only; it has no approval or execution port. */
export class PortfolioFeishuRequirementCaptureService {
  constructor(private readonly dependencies: { channelRepository: PortfolioFeishuChannelRepository; requests: PortfolioRequestCapturePort }) {}

  capture(input: {
    selection: FeishuIngressSelection;
    event: VerifiedFeishuIngress;
    text: string;
    admission?: PortfolioFeishuIngressEvent;
  }) {
    if (input.selection.handlerKind !== "portfolio" || input.event.eventType !== "message") throw new Error("PORTFOLIO_FEISHU_REQUIREMENT_NOT_ELIGIBLE");
    const text = input.text.trim();
    if (!text || text.length > 8_000) throw new Error("PORTFOLIO_FEISHU_REQUEST_TEXT_INVALID");
    const admission = input.admission ? { admitted: true as const, event: input.admission } : this.dependencies.channelRepository.admitIngress({
      providerAccountId: input.selection.account.id, providerEventId: input.event.providerEventId,
      transport: input.event.transport, handlerKind: "portfolio",
      safeEnvelope: {
        eventType: "message", externalIdentity: input.selection.binding.externalIdentity,
        conversationId: input.selection.binding.conversationId, provider: input.selection.account.provider
      }
    });
    if (!admission.admitted) return { duplicate: true as const };
    const request = this.dependencies.requests.createRequest({
      source: "feishu", sourceEventId: input.event.providerEventId, requesterId: input.selection.binding.externalIdentity,
      requestText: text, correlationId: `feishu:${admission.event.id}`, idempotencyKey: `feishu:${input.selection.account.id}:${input.event.providerEventId}`,
      sourceMetadata: { provider: input.selection.account.provider, providerAccountId: input.selection.account.id, bindingId: input.selection.binding.id, conversationId: input.selection.binding.conversationId }
    });
    return { duplicate: false as const, request };
  }
}
