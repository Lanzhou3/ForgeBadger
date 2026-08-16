import type { PortfolioFeishuChannelRepository } from "../../../db/repositories/portfolio-feishu-channel-repository.js";
import type { PortfolioFeishuRegistryRepository, PortfolioFeishuProviderAccount } from "../../../db/repositories/portfolio-feishu-registry-repository.js";
import type { PortfolioFeishuBinding, PortfolioFeishuTransport } from "./contracts.js";
import { sha256, stableJson } from "./codec.js";

export interface VerifiedFeishuIngress {
  provider: string;
  providerAccountId: string;
  providerEventId: string;
  transport: PortfolioFeishuTransport;
  signatureVerified: boolean;
  externalIdentity: string;
  conversationId: string;
  eventType: "message" | "card_action";
  /** This digest must cover provider metadata only, never a raw provider body. */
  safeEventMetadata: Record<string, unknown>;
}

export interface FeishuIngressSelection {
  handlerKind: "portfolio";
  account: PortfolioFeishuProviderAccount;
  binding: PortfolioFeishuBinding;
}

/**
 * This is the single selector contract that an existing Gateway transport must
 * call after provider verification. It intentionally cannot create a Feishu
 * client, register a callback, or dispatch terminal input.
 */
export class PortfolioFeishuIngressSelector {
  constructor(private readonly dependencies: {
    registry: PortfolioFeishuRegistryRepository;
    channelRepositoryFor(userId: string): PortfolioFeishuChannelRepository;
  }) {}

  select(event: VerifiedFeishuIngress): FeishuIngressSelection {
    if (!event.signatureVerified) throw new Error("PORTFOLIO_FEISHU_SIGNATURE_INVALID");
    const account = this.dependencies.registry.resolve(event.provider, event.providerAccountId);
    if (!account || account.lifecycleState !== "verified") throw new Error("PORTFOLIO_FEISHU_ACCOUNT_NOT_ELIGIBLE");
    try {
      const candidates = this.selectPortfolio(account, event);
      if (candidates.length !== 1) throw new Error("PORTFOLIO_FEISHU_HANDLER_AMBIGUOUS");
      return candidates[0]!;
    } catch (error) {
      const code = error instanceof Error ? error.message : "PORTFOLIO_FEISHU_HANDLER_REJECTED";
      this.dependencies.channelRepositoryFor(account.userId).denyIngress({
        providerAccountId: account.id, providerEventId: event.providerEventId, transport: event.transport,
        handlerKind: account.handlerKind, rejectionCode: code,
        safeEnvelope: this.safeEnvelope(event)
      });
      throw error;
    }
  }

  admit(event: VerifiedFeishuIngress, selection: FeishuIngressSelection) {
    if (selection.account.id !== this.dependencies.registry.resolve(event.provider, event.providerAccountId)?.id) {
      throw new Error("PORTFOLIO_FEISHU_SELECTOR_ACCOUNT_CHANGED");
    }
    const repository = this.dependencies.channelRepositoryFor(selection.account.userId);
    return repository.admitIngress({
      providerAccountId: selection.account.id,
      providerEventId: event.providerEventId,
      transport: event.transport,
      handlerKind: selection.handlerKind,
      safeEnvelope: this.safeEnvelope(event)
    });
  }

  private selectPortfolio(account: PortfolioFeishuProviderAccount, event: VerifiedFeishuIngress): FeishuIngressSelection[] {
    const binding = this.dependencies.channelRepositoryFor(account.userId).resolveActiveBinding({
      providerAccountId: account.id, externalIdentity: event.externalIdentity, conversationId: event.conversationId
    });
    return binding ? [{ handlerKind: "portfolio", account, binding }] : [];
  }

  private safeEnvelope(event: VerifiedFeishuIngress): Record<string, unknown> {
    return { provider: event.provider, providerAccountId: event.providerAccountId, providerEventId: event.providerEventId,
      transport: event.transport, eventType: event.eventType, externalIdentityDigest: sha256(event.externalIdentity),
      conversationDigest: sha256(event.conversationId), metadataDigest: sha256(stableJson(event.safeEventMetadata)) };
  }
}
