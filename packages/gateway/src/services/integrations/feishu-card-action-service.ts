import type {
  FeishuCardAction,
  FeishuChannelRepository
} from "../../db/repositories/feishu-channel-repository.js";

export interface FeishuCardCallback {
  actionId: string;
  operatorOpenId: string;
  chatId: string;
  threadId?: string;
  messageId?: string;
}

export class FeishuCardActionService {
  constructor(
    private readonly repository: FeishuChannelRepository,
    private readonly dependencies: {
      resolveResource(action: FeishuCardAction): {
        payloadDigest: string;
        revision: number;
      } | undefined;
      executePendingAction(action: FeishuCardAction): Promise<Record<string, unknown>>;
    }
  ) {}

  createBinding(input: {
    accountId: string;
    chatId: string;
    threadId?: string;
    operatorOpenId: string;
    actionType: string;
    resourceId: string;
    payloadDigest: string;
    resourceRevision: number;
    permissionSnapshot: Record<string, unknown>;
    expiresAt: Date;
  }): string {
    return this.repository.createCardAction(input).id;
  }

  async handle(
    callback: FeishuCardCallback,
    now = new Date()
  ): Promise<{ ok: true; actionId: string; result: Record<string, unknown> }> {
    const action = this.repository.getCardAction(callback.actionId);
    if (!action) throw new Error("CARD_ACTION_NOT_FOUND");
    const current = this.dependencies.resolveResource(action);
    if (!current || current.payloadDigest !== action.payloadDigest
      || current.revision !== action.resourceRevision) {
      throw new Error("CARD_ACTION_RESOURCE_DRIFT");
    }
    if (action.permissionSnapshot.canApprove !== true) {
      throw new Error("CARD_ACTION_PERMISSION_DENIED");
    }
    // Repository CAS is the single replay barrier; execution happens only after it succeeds.
    const claimed = this.repository.claimCardAction(action.id, {
      operatorOpenId: callback.operatorOpenId,
      chatId: callback.chatId,
      ...(callback.threadId ? { threadId: callback.threadId } : {}),
      payloadDigest: current.payloadDigest,
      resourceRevision: current.revision,
      ...(callback.messageId ? { cardMessageId: callback.messageId } : {}),
      now
    });
    const result = await this.dependencies.executePendingAction(claimed);
    return { ok: true, actionId: action.id, result };
  }
}
