import type {
  FeishuConversationBinding,
  FeishuConversationScope
} from "../../db/repositories/feishu-channel-repository.js";
import type { CopilotRepository } from "../../db/repositories/copilot-repository.js";
import type { FeishuChannelRepository } from "../../db/repositories/feishu-channel-repository.js";
import type { FeishuIntegrationRepository } from "../../db/repositories/feishu-integration-repository.js";
import type { FeishuInboundMessage } from "./feishu-event-normalizer.js";
import { buildCopilotConversationContext } from "../copilot/conversation-context.js";
import type {
  FeishuTypingReactionLifecycle,
  FeishuTypingReactionState
} from "./feishu-typing-reaction.js";

export type FeishuBindingResolution =
  | { ok: true; binding: FeishuConversationBinding; mappedUserId: string }
  | { ok: false; reasonCode: string };

export class FeishuConversationBindingService {
  constructor(private readonly dependencies: {
    userId: string;
    channelRepository: FeishuChannelRepository;
    integrationRepository: FeishuIntegrationRepository;
    copilotRepository: CopilotRepository;
  }) {}

  resolve(event: FeishuInboundMessage): FeishuBindingResolution {
    const config = this.dependencies.integrationRepository.getConfig();
    if (!config.enabled || config.emergencyDisabled) {
      return { ok: false, reasonCode: "feishu_integration_disabled" };
    }
    if (!config.allowedChatIds.includes(event.chatId)) {
      return { ok: false, reasonCode: "feishu_chat_not_allowed" };
    }
    const mapping = this.dependencies.integrationRepository.listUserMappings()
      .find((item) => item.feishuUserId === event.senderOpenId);
    if (!mapping || mapping.openforgeUserId !== this.dependencies.userId) {
      return { ok: false, reasonCode: "feishu_user_not_mapped" };
    }
    const threadKey = event.threadId ?? "root";
    const existing = this.dependencies.channelRepository.findConversationBinding({
      accountId: event.accountId,
      chatId: event.chatId,
      threadKey
    });
    const commandInvoked = event.text.trim().startsWith(config.commandPrefix);
    if (event.chatType !== "p2p" && !event.mentionedBot && !commandInvoked && !existing) {
      return { ok: false, reasonCode: "feishu_group_mention_required" };
    }
    if (existing) {
      const binding = this.ensureActiveConversation(existing, event);
      return { ok: true, binding, mappedUserId: mapping.openforgeUserId };
    }

    const conversation = this.dependencies.copilotRepository.createConversation({
      title: conversationTitle(event.text),
      source: "feishu",
      sourceRefId: event.chatId
    });
    const binding = this.dependencies.channelRepository.createConversationBinding({
      accountId: event.accountId,
      chatId: event.chatId,
      threadKey,
      conversationId: conversation.id
    });
    return { ok: true, binding, mappedUserId: mapping.openforgeUserId };
  }

  bindScope(bindingId: string, scope: Exclude<FeishuConversationScope, { type: "unbound" }>): FeishuConversationBinding {
    return this.dependencies.channelRepository.updateConversationBindingScope(bindingId, scope);
  }

  private ensureActiveConversation(
    binding: FeishuConversationBinding,
    event: FeishuInboundMessage
  ): FeishuConversationBinding {
    if (this.dependencies.copilotRepository.getConversation(binding.conversationId)) return binding;
    const replacement = this.dependencies.copilotRepository.createConversation({
      title: conversationTitle(event.text),
      source: "feishu",
      sourceRefId: event.chatId
    });
    const updated = this.dependencies.channelRepository.replaceConversationBindingConversation(
      binding.id,
      binding.conversationId,
      replacement.id
    );
    if (updated) return updated;

    // Another worker won the replacement race; discard our unused history container.
    this.dependencies.copilotRepository.deleteConversation(replacement.id);
    const current = this.dependencies.channelRepository.getConversationBinding(binding.id);
    if (!current || !this.dependencies.copilotRepository.getConversation(current.conversationId)) {
      throw new Error("FEISHU_BINDING_CONVERSATION_UNAVAILABLE");
    }
    return current;
  }
}

export class FeishuCopilotInboundDispatcher {
  constructor(private readonly dependencies: {
    userId: string;
    bindingService: FeishuConversationBindingService;
    copilotRepository: CopilotRepository;
    reactionLifecycle?: Pick<FeishuTypingReactionLifecycle, "start" | "stop">;
    recoverRun?(event: FeishuInboundMessage): { runId: string; assistantMessages: string[] } | undefined;
    handlePendingDecision?(
      binding: FeishuConversationBinding,
      event: FeishuInboundMessage
    ): Promise<{ runId: string } | undefined>;
    afterPersist?(input: {
      event: FeishuInboundMessage;
      runId: string;
      assistantMessages: string[];
    }): Promise<void>;
    runText(input: {
      userId: string;
      prompt: string;
      conversationContext?: string;
      source: "feishu";
      sourceRefId?: string;
      sourceIdempotencyKey?: string;
    }): Promise<{ runId: string; assistantMessages: string[] }>;
  }) {}

  async dispatch(event: FeishuInboundMessage): Promise<
    | { ok: true; conversationId: string; runId: string }
    | { ok: false; reasonCode: string }
  > {
    const resolution = this.dependencies.bindingService.resolve(event);
    if (!resolution.ok) return resolution;
    const pendingDecision = await this.dependencies.handlePendingDecision?.(resolution.binding, event);
    if (pendingDecision) {
      return {
        ok: true,
        conversationId: resolution.binding.conversationId,
        runId: pendingDecision.runId
      };
    }
    const recovered = this.dependencies.recoverRun?.(event);
    if (recovered) {
      await this.persistAndQueue(resolution.binding.conversationId, event, recovered);
      return { ok: true, conversationId: resolution.binding.conversationId, runId: recovered.runId };
    }
    let reactionState: FeishuTypingReactionState | undefined;
    try {
      reactionState = await this.startReaction(event.messageId);
      const conversationContext = buildCopilotConversationContext(
        this.dependencies.copilotRepository.listConversationMessages(resolution.binding.conversationId)
      );
      const result = await this.dependencies.runText({
        userId: this.dependencies.userId,
        prompt: event.text,
        source: "feishu",
        ...(conversationContext ? { conversationContext } : {}),
        ...(resolution.binding.scope.type === "project"
          ? { sourceRefId: resolution.binding.scope.id }
          : {})
      });
      await this.persistAndQueue(resolution.binding.conversationId, event, result);
      return {
        ok: true,
        conversationId: resolution.binding.conversationId,
        runId: result.runId
      };
    } finally {
      await this.stopReaction(reactionState);
    }
  }

  private async persistAndQueue(
    conversationId: string,
    event: FeishuInboundMessage,
    result: { runId: string; assistantMessages: string[] }
  ): Promise<void> {
    // Deterministic turn message IDs make recovery safe after a post-model delivery failure.
    this.dependencies.copilotRepository.persistConversationTurn(conversationId, {
      runId: result.runId,
      userContent: event.text,
      userPayload: { source: "feishu", chatId: event.chatId, messageId: event.messageId },
      assistantMessages: result.assistantMessages
    });
    await this.dependencies.afterPersist?.({ event, ...result });
  }

  private async startReaction(messageId: string): Promise<FeishuTypingReactionState | undefined> {
    try {
      return await this.dependencies.reactionLifecycle?.start(messageId);
    } catch {
      // A custom lifecycle must remain auxiliary even if it violates the no-throw service contract.
      return undefined;
    }
  }

  private async stopReaction(state: FeishuTypingReactionState | undefined): Promise<void> {
    if (!state) return;
    try {
      await this.dependencies.reactionLifecycle?.stop(state);
    } catch {
      // Cleanup failures must not overwrite an adopted Copilot result.
    }
  }
}

function conversationTitle(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized || "Feishu conversation";
}
