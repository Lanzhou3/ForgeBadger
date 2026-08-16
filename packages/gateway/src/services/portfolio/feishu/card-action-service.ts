import { randomUUID } from "node:crypto";

import type { PortfolioFeishuChannelAction, PortfolioFeishuChannelRepository } from "../../../db/repositories/portfolio-feishu-channel-repository.js";
import type { PortfolioCanonicalDecision } from "./contracts.js";
import { hmac, secureEqual, sha256 } from "./codec.js";

export interface PortfolioCanonicalDecisionResolver {
  resolve(recordType: PortfolioCanonicalDecision["recordType"], recordId: string): PortfolioCanonicalDecision | undefined;
}

/** Signed cards refer to an immutable stored record; the card cannot introduce a payload. */
export class PortfolioFeishuCardActionService {
  constructor(private readonly dependencies: { repository: PortfolioFeishuChannelRepository; decisions: PortfolioCanonicalDecisionResolver; hmacSecret: string }) {}

  create(input: { bindingId: string; recordType: PortfolioCanonicalDecision["recordType"]; recordId: string; actionType: string; expiresAt: Date; idempotencyKey: string }) {
    const record = this.dependencies.decisions.resolve(input.recordType, input.recordId);
    if (!record) throw new Error("PORTFOLIO_FEISHU_CANONICAL_RECORD_NOT_FOUND");
    if (!record.allowedActionTypes.includes(input.actionType)) throw new Error("PORTFOLIO_FEISHU_ACTION_TYPE_DENIED");
    const replay = this.dependencies.repository.findChannelActionByIdempotency(input.bindingId, input.idempotencyKey);
    if (replay) {
      const signature = this.signature(replay.id, input.bindingId, record, input.actionType, input.expiresAt);
      if (replay.recordType !== record.recordType || replay.recordId !== record.recordId || replay.actionType !== input.actionType
        || replay.payloadDigest !== record.payloadDigest || replay.recordVersion !== record.projectionVersion
        || replay.ownerUserId !== record.ownerUserId || replay.signatureDigest !== sha256(signature)) {
        throw new Error("PORTFOLIO_FEISHU_ACTION_IDEMPOTENCY_DRIFT");
      }
      return { action: replay, token: `v1.${replay.id}.${input.expiresAt.getTime()}.${signature}` };
    }
    const actionId = randomUUID();
    const signature = this.signature(actionId, input.bindingId, record, input.actionType, input.expiresAt);
    const action = this.dependencies.repository.createChannelAction({
      ...input, id: actionId, bindingId: input.bindingId, recordType: record.recordType, recordId: record.recordId,
      payloadDigest: record.payloadDigest, recordVersion: record.projectionVersion, ownerUserId: record.ownerUserId,
      signatureDigest: sha256(signature), idempotencyKey: input.idempotencyKey
    });
    return { action, token: `v1.${action.id}.${input.expiresAt.getTime()}.${signature}` };
  }

  consumeAndApply<T>(input: { token: string; bindingId: string; now?: Date }, applyOwnerDecision: (action: PortfolioFeishuChannelAction) => T): { action: PortfolioFeishuChannelAction; result: T } {
    return this.consumePrepared(input, (action, record) => this.dependencies.repository.consumeChannelActionWithDecision({
      id: action.id, bindingId: input.bindingId, recordVersion: record.projectionVersion, ownerUserId: record.ownerUserId,
      ...(input.now ? { now: input.now } : {}),
      validateCanonical: (stored) => this.isCurrent(stored), applyOwnerDecision
    }));
  }

  private consumePrepared<T>(
    input: { token: string; bindingId: string; now?: Date },
    consume: (action: PortfolioFeishuChannelAction, record: PortfolioCanonicalDecision) => T
  ): T {
    const [version, actionId, expiresRaw, suppliedSignature] = input.token.split(".");
    if (version !== "v1" || !/^[0-9]+$/.test(expiresRaw ?? "") || !actionId || !suppliedSignature) throw new Error("PORTFOLIO_FEISHU_ACTION_TOKEN_INVALID");
    const action = this.dependencies.repository.getChannelAction(actionId);
    const now = input.now ?? new Date();
    if (!action || action.bindingId !== input.bindingId || action.expiresAt.getTime() !== Number(expiresRaw) || action.expiresAt <= now) {
      throw new Error("PORTFOLIO_FEISHU_ACTION_NOT_CONSUMABLE");
    }
    const record = this.dependencies.decisions.resolve(action.recordType, action.recordId);
    if (!record || !record.allowedActionTypes.includes(action.actionType) || record.ownerUserId !== action.ownerUserId || record.projectionVersion !== action.recordVersion || record.payloadDigest !== action.payloadDigest) {
      throw new Error("PORTFOLIO_FEISHU_ACTION_RECORD_DRIFT");
    }
    const expected = this.signature(action.id, input.bindingId, record, action.actionType, action.expiresAt);
    if (!secureEqual(expected, suppliedSignature) || !secureEqual(sha256(suppliedSignature), action.signatureDigest)) {
      throw new Error("PORTFOLIO_FEISHU_ACTION_SIGNATURE_INVALID");
    }
    return consume(action, record);
  }

  private isCurrent(stored: PortfolioFeishuChannelAction): boolean {
    const current = this.dependencies.decisions.resolve(stored.recordType, stored.recordId);
    return Boolean(current && current.allowedActionTypes.includes(stored.actionType) && current.ownerUserId === stored.ownerUserId
      && current.projectionVersion === stored.recordVersion && current.payloadDigest === stored.payloadDigest);
  }

  private signature(actionId: string, bindingId: string, record: PortfolioCanonicalDecision, actionType: string, expiresAt: Date): string {
    return hmac(this.dependencies.hmacSecret, ["portfolio-feishu-action-v1", actionId, bindingId, record.recordType, record.recordId, actionType, record.projectionVersion, record.payloadDigest, expiresAt.getTime()].join(":"));
  }
}
