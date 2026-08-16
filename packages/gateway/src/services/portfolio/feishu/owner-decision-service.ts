import type { Database } from "../../../db/types.js";
import { PortfolioRepository } from "../../../db/repositories/portfolio-repository.js";
import type { PortfolioFeishuChannelAction, PortfolioFeishuChannelRepository } from "../../../db/repositories/portfolio-feishu-channel-repository.js";
import type { PortfolioFeishuBinding } from "./contracts.js";

/** Applies only pre-stored owner decisions; it cannot accept replacement payloads or write a terminal. */
export class PortfolioFeishuOwnerDecisionService {
  private readonly portfolio: PortfolioRepository;

  constructor(private readonly dependencies: { db: Database; userId: string; channel: PortfolioFeishuChannelRepository }) {
    this.portfolio = new PortfolioRepository(dependencies.db, dependencies.userId);
  }

  apply(action: PortfolioFeishuChannelAction, binding: PortfolioFeishuBinding): { commandType: string; recordType: string; recordId: string; recordVersion: number } {
    if (!binding.isOwner || binding.userId !== this.dependencies.userId || binding.status !== "active") {
      throw new Error("PORTFOLIO_FEISHU_ACTION_BINDING_DENIED");
    }
    const result = action.recordType === "authorization"
      ? this.approveAuthorization(action)
      : action.recordType === "intake_decision"
        ? this.approveSingleIntakeRoute(action)
        : this.acceptDecision(action);
    const fact = this.latestDecisionFact(result.recordType, result.recordId);
    if (!fact) throw new Error("PORTFOLIO_FEISHU_DECISION_FACT_MISSING");
    this.dependencies.channel.enqueueDelivery({
      bindingId: binding.id, factId: fact.id, canonicalRecordType: result.recordType, canonicalRecordId: result.recordId,
      canonicalRecordVersion: result.recordVersion, eventType: "portfolio.owner_decision",
      summary: { title: "Portfolio owner decision", status: result.commandType, summary: "A stored Portfolio decision was confirmed." },
      idempotencyKey: `feishu-delivery:${action.id}`
    });
    // This intent can be observed post-commit by an authorized command runner;
    // this channel service never executes it and never reaches terminal input.
    this.dependencies.channel.enqueueCanonicalCommand({
      channelActionId: action.id, bindingId: binding.id, canonicalRecordType: result.recordType,
      canonicalRecordId: result.recordId, canonicalRecordVersion: result.recordVersion, factId: fact.id,
      commandType: result.commandType
    });
    return result;
  }

  private approveAuthorization(action: PortfolioFeishuChannelAction) {
    if (action.actionType !== "approve") throw new Error("PORTFOLIO_FEISHU_ACTION_TYPE_DENIED");
    const current = this.portfolio.getAuthorization(action.recordId);
    if (!current || current.projectionVersion !== action.recordVersion) throw new Error("PORTFOLIO_FEISHU_ACTION_RECORD_DRIFT");
    const approved = this.portfolio.approveAuthorization({ authorizationId: current.id, expectedProjectionVersion: current.projectionVersion,
      actionDigest: current.actionDigest, actorId: this.dependencies.userId });
    return { commandType: "portfolio.authorization.approved", recordType: "authorization", recordId: approved.id, recordVersion: approved.projectionVersion };
  }

  private approveSingleIntakeRoute(action: PortfolioFeishuChannelAction) {
    if (action.actionType !== "approve_single_candidate") throw new Error("PORTFOLIO_FEISHU_ACTION_TYPE_DENIED");
    const current = this.portfolio.getIntakeDecision(action.recordId);
    if (!current || current.projectionVersion !== action.recordVersion || current.candidateProjectIds.length !== 1) {
      throw new Error("PORTFOLIO_FEISHU_ACTION_RECORD_DRIFT");
    }
    const decision = this.portfolio.acceptOwnerIntakeDecision({ requestId: current.requestId, projectId: current.candidateProjectIds[0] as string,
      evidenceIds: current.evidenceIds, idempotencyKey: `feishu:${action.id}:intake` });
    return { commandType: "portfolio.intake.owner_approved", recordType: "intake_decision", recordId: decision.id, recordVersion: decision.projectionVersion };
  }

  private acceptDecision(action: PortfolioFeishuChannelAction) {
    if (action.actionType !== "accept") throw new Error("PORTFOLIO_FEISHU_ACTION_TYPE_DENIED");
    const current = this.portfolio.getAcceptanceDecision(action.recordId);
    if (!current || current.projectionVersion !== action.recordVersion) throw new Error("PORTFOLIO_FEISHU_ACTION_RECORD_DRIFT");
    const transition = this.portfolio.createStateGate().transition({ recordType: "acceptance_decision", recordId: current.id,
      toState: "accepted", expectedProjectionVersion: current.projectionVersion, actorId: this.dependencies.userId,
      idempotencyKey: `feishu:${action.id}:acceptance` });
    return { commandType: "portfolio.acceptance.owner_accepted", recordType: "acceptance_decision", recordId: transition.recordId, recordVersion: transition.projectionVersion };
  }

  private latestDecisionFact(recordType: string, recordId: string): { id: string } | undefined {
    return this.dependencies.db.prepare(`SELECT id FROM portfolio_facts
      WHERE user_id = ? AND record_type = ? AND record_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`)
      .get(this.dependencies.userId, recordType, recordId) as { id: string } | undefined;
  }
}
