export type PortfolioFeishuTransport = "webhook" | "long_connection";
export type PortfolioFeishuIngressState = "admitted" | "denied" | "processed";
export type PortfolioFeishuDeliveryState = "pending" | "claimed" | "retry_scheduled" | "delivered" | "failed";

export interface PortfolioFeishuBinding {
  id: string;
  userId: string;
  provider: string;
  providerAccountId: string;
  externalIdentity: string;
  conversationId: string;
  isOwner: boolean;
  status: "active" | "disabled";
  projectionVersion: number;
}

export interface PortfolioCanonicalDecision {
  recordType: "authorization" | "intake_decision" | "acceptance_decision";
  recordId: string;
  ownerUserId: string;
  projectionVersion: number;
  payloadDigest: string;
  allowedActionTypes: readonly string[];
}

export interface PortfolioSafeDeliverySummary {
  title: string;
  status: string;
  summary: string;
  recordUrl?: string;
}
