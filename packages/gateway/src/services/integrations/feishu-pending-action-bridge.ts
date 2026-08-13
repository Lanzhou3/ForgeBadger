import { createHash } from "node:crypto";

import type {
  CopilotPendingAction,
  CopilotRepository
} from "../../db/repositories/copilot-repository.js";
import type {
  FeishuCardAction,
  FeishuChannelRepository
} from "../../db/repositories/feishu-channel-repository.js";
import { renderFeishuApprovalCard } from "./feishu-card-renderer.js";
import { FeishuCardActionService } from "./feishu-card-action-service.js";
import type { FeishuDeliveryPart } from "./feishu-delivery-service.js";
import type {
  FeishuInboundCardAction,
  FeishuInboundMessage
} from "./feishu-event-normalizer.js";

const approvalWords = new Set(["可以", "确认", "同意", "批准", "执行"]);
const rejectionWords = new Set(["取消", "拒绝", "不同意"]);
const approvalTtlMs = 24 * 60 * 60 * 1_000;

export interface FeishuPendingDecisionResult extends Record<string, unknown> {
  handled: true;
  decision: "approved" | "rejected" | "waiting";
  runId: string;
  actionId: string;
  parts: FeishuDeliveryPart[];
}

export class FeishuPendingActionBridge {
  constructor(private readonly dependencies: {
    userId: string;
    channelRepository: FeishuChannelRepository;
    copilotRepository: CopilotRepository;
    executePendingAction(action: CopilotPendingAction): Promise<Record<string, unknown>>;
    describePendingAction?(action: CopilotPendingAction): string;
    continueRun?(input: {
      action: CopilotPendingAction;
      result: Record<string, unknown>;
    }): Promise<{ runId: string; status: string; assistantMessages: string[] }>;
  }) {}

  createApprovalParts(event: FeishuInboundMessage, runId: string): FeishuDeliveryPart[] {
    const action = this.singlePendingAction(runId);
    if (!action) return [];
    const resource = pendingResource(action);
    const approveActionId = this.createCardBinding(event, action, resource, "approve_pending_action");
    const rejectActionId = this.createCardBinding(event, action, resource, "reject_pending_action");
    return [{
      type: "card",
      content: renderFeishuApprovalCard({
        title: "OpenForge 操作审批",
        summary: this.dependencies.describePendingAction?.(action) ?? pendingActionSummary(action),
        approveActionId,
        rejectActionId
      })
    }];
  }

  async handleMessageDecision(
    binding: { conversationId: string },
    event: FeishuInboundMessage
  ): Promise<FeishuPendingDecisionResult | undefined> {
    // A retried Inbox item first repairs its already-decided delivery instead of executing again.
    const recovered = this.recoverClaimedDecision(event);
    if (recovered) return recovered;
    const actions = this.dependencies.copilotRepository
      .listPendingActionsByConversation(binding.conversationId);
    if (actions.length === 0) return undefined;
    const decision = parseTextDecision(event.text);
    // Exact phrases plus one pending action are the entire natural-language approval surface.
    if (!decision || actions.length !== 1) return waitingResult(actions[0]!, actions.length);
    const actionType = decision === "approved" ? "approve_pending_action" : "reject_pending_action";
    const resource = pendingResource(actions[0]!);
    const opaqueActionId = this.createCardBinding(event, actions[0]!, resource, actionType);
    this.dependencies.channelRepository.bindCardActionMessageIds([opaqueActionId], event.messageId);
    return await this.handleCardAction({
      kind: "card_action",
      accountId: event.accountId,
      eventId: event.eventId,
      chatId: event.chatId,
      messageId: event.messageId,
      senderOpenId: event.senderOpenId,
      actionId: opaqueActionId,
      laneKey: event.laneKey
    });
  }

  async handleCardAction(event: FeishuInboundCardAction): Promise<FeishuPendingDecisionResult> {
    const recovered = this.recoverClaimedDecision(event);
    if (recovered) return recovered;
    const service = new FeishuCardActionService(this.dependencies.channelRepository, {
      resolveResource: (binding) => this.resolveCardResource(binding),
      executePendingAction: async (binding) => await this.executeCardDecision(binding)
    });
    const handled = await service.handle({
      actionId: event.actionId,
      operatorOpenId: event.senderOpenId,
      chatId: event.chatId,
      ...(event.messageId ? { messageId: event.messageId } : {})
    });
    return handled.result as unknown as FeishuPendingDecisionResult;
  }

  private recoverClaimedDecision(
    event: Pick<FeishuInboundMessage | FeishuInboundCardAction, "accountId" | "chatId" | "senderOpenId" | "messageId">
  ): FeishuPendingDecisionResult | undefined {
    if (!event.messageId) return undefined;
    const binding = this.dependencies.channelRepository.findCardActionByMessage({
      accountId: event.accountId,
      chatId: event.chatId,
      operatorOpenId: event.senderOpenId,
      cardMessageId: event.messageId
    });
    if (!binding || binding.status !== "claimed") return undefined;
    // Claimed card/text bindings are the durable replay barrier around external side effects.
    const action = this.dependencies.copilotRepository.getPendingAction(binding.resourceId);
    if (!action || (action.status !== "approved" && action.status !== "rejected")) {
      throw new Error("COPILOT_PENDING_ACTION_EXECUTION_UNCERTAIN");
    }
    const decision = action.status === "approved" ? "approved" : "rejected";
    const messages = decision === "approved" ? continuationMessages(this.dependencies.copilotRepository, action) : [];
    return {
      handled: true,
      decision,
      runId: action.runId,
      actionId: action.id,
      parts: messages.length
        ? messages.map((content) => ({ type: "text", content }))
        : [{
            type: "text",
            content: decision === "approved"
              ? approvalReceipt(action, action.result ?? {})
              : "已拒绝该操作，未向目标会话发送任何输入。"
          }]
    };
  }

  private singlePendingAction(runId: string): CopilotPendingAction | undefined {
    const actions = this.dependencies.copilotRepository
      .listPendingActions(runId)
      .filter((action) => action.status === "pending");
    return actions.length === 1 ? actions[0] : undefined;
  }

  private createCardBinding(
    event: FeishuInboundMessage,
    action: CopilotPendingAction,
    resource: { payloadDigest: string; revision: number },
    actionType: "approve_pending_action" | "reject_pending_action"
  ): string {
    const existing = this.dependencies.channelRepository.findPendingCardAction({
      accountId: event.accountId,
      chatId: event.chatId,
      operatorOpenId: event.senderOpenId,
      actionType,
      resourceId: action.id
    });
    if (existing) return existing.id;
    return new FeishuCardActionService(this.dependencies.channelRepository, {
      resolveResource: () => resource,
      executePendingAction: async () => ({})
    }).createBinding({
      accountId: event.accountId,
      chatId: event.chatId,
      operatorOpenId: event.senderOpenId,
      actionType,
      resourceId: action.id,
      payloadDigest: resource.payloadDigest,
      resourceRevision: resource.revision,
      permissionSnapshot: { canApprove: true },
      expiresAt: new Date(Date.now() + approvalTtlMs)
    });
  }

  private resolveCardResource(binding: FeishuCardAction): { payloadDigest: string; revision: number } | undefined {
    const action = this.dependencies.copilotRepository.getPendingAction(binding.resourceId);
    return action?.status === "pending" ? pendingResource(action) : undefined;
  }

  private async executeCardDecision(binding: FeishuCardAction): Promise<Record<string, unknown>> {
    const action = this.dependencies.copilotRepository.getPendingAction(binding.resourceId);
    if (!action) throw new Error("COPILOT_PENDING_ACTION_NOT_FOUND");
    const decision = binding.actionType === "approve_pending_action" ? "approved" : "rejected";
    return await this.decide(action, decision);
  }

  private async decide(
    action: CopilotPendingAction,
    decision: "approved" | "rejected"
  ): Promise<FeishuPendingDecisionResult> {
    const repo = this.dependencies.copilotRepository;
    const run = repo.getRun(action.runId);
    if (!run || run.status !== "waiting_for_approval") throw new Error("COPILOT_RUN_NOT_APPROVABLE");
    if (decision === "rejected") return this.reject(action);
    const claimed = repo.updatePendingActionIfStatus(action.id, "pending", { status: "processing" });
    if (!claimed) throw new Error("COPILOT_PENDING_ACTION_NOT_PENDING");
    const result = await this.dependencies.executePendingAction(claimed);
    if (isApprovalError(result)) {
      repo.updatePendingActionIfStatus(claimed.id, "processing", { status: "pending", result: null });
      throw new Error(result.error.code);
    }
    const approved = repo.updatePendingActionIfStatusAndRunStatus(claimed.id, "processing", "waiting_for_approval", {
      status: "approved",
      result,
      approvedBy: this.dependencies.userId,
      approvedAt: Date.now()
    });
    if (!approved) throw new Error("COPILOT_PENDING_ACTION_NOT_PENDING");
    repo.addEvent(run.id, {
      type: "pending_action_approved",
      message: "Pending action approved from Feishu",
      payload: { actionId: action.id, actionType: action.type }
    });
    const continuation = await this.dependencies.continueRun?.({ action: approved, result });
    if (!continuation) repo.updateRunIfStatus(run.id, "waiting_for_approval", { status: "completed", completedAt: Date.now() });
    const messages = continuation?.assistantMessages.length
      ? continuation.assistantMessages
      : [approvalReceipt(action, result)];
    return {
      handled: true,
      decision: "approved",
      runId: run.id,
      actionId: action.id,
      parts: messages.map((content, index) => ({
        type: "text",
        content: index === 0 ? `${approvalExecutionReceipt(result)}\n\n${content}` : content
      }))
    };
  }

  private reject(action: CopilotPendingAction): FeishuPendingDecisionResult {
    const repo = this.dependencies.copilotRepository;
    const rejected = repo.updatePendingActionIfStatus(action.id, "pending", {
      status: "rejected",
      result: { reason: "rejected_from_feishu" }
    });
    if (!rejected) throw new Error("COPILOT_PENDING_ACTION_NOT_PENDING");
    repo.addEvent(action.runId, {
      type: "pending_action_rejected",
      message: "Pending action rejected from Feishu",
      payload: { actionId: action.id, actionType: action.type }
    });
    repo.updateRunIfStatus(action.runId, "waiting_for_approval", { status: "completed", completedAt: Date.now() });
    return {
      handled: true,
      decision: "rejected",
      runId: action.runId,
      actionId: action.id,
      parts: [{ type: "text", content: "已拒绝该操作，未向目标会话发送任何输入。" }]
    };
  }
}

function pendingResource(action: CopilotPendingAction): { payloadDigest: string; revision: number } {
  // The digest makes payload drift visible without putting authoritative input in the card.
  return {
    payloadDigest: createHash("sha256")
      .update(JSON.stringify({ id: action.id, type: action.type, input: action.input }))
      .digest("hex"),
    revision: action.updatedAt ?? action.createdAt ?? 0
  };
}

function parseTextDecision(text: string): "approved" | "rejected" | undefined {
  const normalized = text.trim().replace(/[。！!]+$/u, "");
  if (approvalWords.has(normalized)) return "approved";
  if (rejectionWords.has(normalized)) return "rejected";
  return undefined;
}

function waitingResult(action: CopilotPendingAction, count: number): FeishuPendingDecisionResult {
  return {
    handled: true,
    decision: "waiting",
    runId: action.runId,
    actionId: action.id,
    parts: [{
      type: "text",
      content: count === 1
        ? "操作尚未发送，正在等待审批。请点击审批卡片，或明确回复“可以”/“拒绝”。"
        : `当前有 ${count} 个操作等待审批，请使用对应审批卡片，避免确认错操作。`
    }]
  };
}

function pendingActionSummary(action: CopilotPendingAction): string {
  if (action.type === "openforge.propose_session_input") {
    return "Copilot 请求向一个已核验的开发会话发送输入。请确认是否执行。";
  }
  return "Copilot 请求执行一个受控平台操作。请确认是否执行。";
}

function approvalReceipt(action: CopilotPendingAction, result: Record<string, unknown>): string {
  const sessionId = typeof result.sessionId === "string" ? result.sessionId : undefined;
  if (action.type === "openforge.propose_session_input" && sessionId) {
    return `已批准并发送到会话 ${sessionId}。`;
  }
  return "操作已批准并执行。";
}

function approvalExecutionReceipt(result: Record<string, unknown>): string {
  const terminal = isRecord(result.terminal) ? result.terminal : undefined;
  const tracking = terminal && isRecord(terminal.tracking) ? terminal.tracking : undefined;
  const status = tracking && typeof tracking.status === "string" ? tracking.status : undefined;
  if (status?.startsWith("unchanged")) {
    return "本次审批输入已发送，但目标终端在观察窗口内没有变化；系统不会自动重复发送。";
  }
  return "本次审批已执行。若目标 CLI 随后提出新的权限请求，那是另一项操作，需要单独审批。";
}

function isApprovalError(result: Record<string, unknown>): result is { error: { code: string } } {
  const error = result.error;
  return Boolean(error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function continuationMessages(repository: CopilotRepository, action: CopilotPendingAction): string[] {
  // Only the post-decision assistant response belongs in the approval delivery receipt.
  const events = repository.listEvents(action.runId);
  const decisionSequence = events.find((event) =>
    event.type === "pending_action_approved" && event.payload.actionId === action.id
  )?.sequence ?? Number.MAX_SAFE_INTEGER;
  const messages = events
    .filter((event) => event.sequence > decisionSequence && event.type === "assistant_message" && event.message)
    .map((event) => event.message as string);
  return messages.length ? [messages.at(-1) as string] : [];
}
