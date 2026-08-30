/**
 * Feishu -> Copilot conversation bridge.
 *
 * Feishu chats without an active Portfolio channel binding route their text
 * messages into the same Copilot harness the web chat uses (buildAgentStack:
 * conversation log + memory + tools + orchestrator). Each chat keeps its own
 * conversation with isolated context; /new swaps the chat's pointer to a fresh
 * conversation. Provider retries are deduplicated through the same durable
 * ingress ledger as the Portfolio channel.
 *
 * Sender ownership: the channel belongs to the first Feishu sender who opened
 * it (mirroring the Portfolio binding's external-identity key). Messages,
 * commands, and approval decisions from any other sender in the chat are
 * refused, so a group member cannot run turns or approve pending actions as
 * the ForgeBadger account owner.
 */
import { FeishuCopilotChannelRepository } from "../../db/repositories/feishu-copilot-channel-repository.js";
import type { Database } from "../../db/types.js";
import { PortfolioFeishuChannelRepository } from "../../db/repositories/portfolio-feishu-channel-repository.js";
import type { PortfolioFeishuTransport } from "../portfolio/feishu/contracts.js";
import { sha256 } from "../portfolio/feishu/codec.js";
import { redactAgentErrorMessage } from "../agent/redaction.js";
import type { AgentStack, AgentStackDeps } from "../agent/agent-stack.js";
import type { AgentPendingAction, AgentRun } from "../agent/types.js";
import {
  buildCopilotApprovalCard,
  buildCopilotApprovalResolvedCard,
  buildCopilotRunCard,
  createFeishuOutboundTextScrubber,
  prepareFeishuCopilotText,
  type CopilotApprovalResolutionState,
  type CopilotRunCardState
} from "./feishu-copilot-cards.js";

const EMPTY_DONE_REPLY = "已完成，但没有可展示的回复。";
/** Bounded wait for an approved dsh kernel turn to land its tool result. */
const DECIDE_SETTLE_TIMEOUT_MS = 20_000;

const SENDER_MISMATCH_TEXT = "该会话已由其他飞书用户开启，无法在此对话中操作。请让发起人继续，或由发起人发送 /new 重置。";

const HELP_TEXT = [
  "可用命令：",
  "/new - 开始全新会话（重置该聊天的上下文）",
  "/approve - 批准最近一条等待审批的操作",
  "/reject - 拒绝最近一条等待审批的操作",
  "/help - 显示本帮助",
  "其他消息会直接发给 Copilot，与网页聊天共享同一记忆与工具。"
].join("\n");

type BuildAgentStack = (deps: AgentStackDeps, userId: string) => AgentStack;

export interface FeishuCopilotChannelIngress {
  chatId: string;
  text: string;
  providerEventId: string;
  senderIdentity: string;
  /** Present on live transports; enables the Typing reaction. */
  messageId?: string;
  /** "p2p" | "group" when known; group messages require a bot mention. */
  chatType?: string;
  /** True when the bot was @mentioned (group gate). */
  mentionedBot?: boolean;
}

export interface FeishuCopilotChannel {
  /**
   * Synchronously record the event in the durable ingress ledger. Must run on
   * the ingress acknowledgement path so ledger failures reject the delivery
   * (and the provider retries) instead of silently dropping the message.
   * Returns false for provider-retry duplicates.
   */
  admitMessage(ingress: FeishuCopilotChannelIngress): boolean;
  /** Run the admitted message. Fire-and-forget; never blocks the ack. Serialized per chat. */
  processMessage(ingress: FeishuCopilotChannelIngress): Promise<void>;
  /** Ledger admission for copilot approval-card clicks (dedups provider retries). */
  admitCardAction(ingress: {
    chatId: string;
    senderIdentity: string;
    providerEventId: string;
    value: Record<string, unknown>;
  }): boolean;
  /** Handle an approval-card button click. Fire-and-forget; serialized per chat. */
  handleCardAction(ingress: {
    chatId: string;
    senderIdentity: string;
    value: Record<string, unknown>;
    messageId?: string;
  }): Promise<void>;
}

export interface FeishuCopilotCardTransport {
  sendCard(chatId: string, card: unknown): Promise<string | undefined>;
  updateCard(messageId: string, card: unknown): Promise<void>;
}

/** Streaming update cadence: at most one in-place card refresh per interval. */
const STREAM_FLUSH_INTERVAL_MS = 900;
const SHARED_CHAT_QUEUE_STATES = new WeakMap<Database, SharedChatQueueState>();

interface SharedChatQueueState {
  accepting: boolean;
  queues: Map<string, Promise<void>>;
}

export function createFeishuCopilotChannel(input: {
  deps: AgentStackDeps;
  buildAgentStack: BuildAgentStack;
  sendMessage: (message: { chatId: string; text: string }) => Promise<void>;
  userId: string;
  providerAccountId: string;
  transport: PortfolioFeishuTransport;
  /** Optional interactive-card transport enabling streaming + approval buttons. */
  cardTransport?: FeishuCopilotCardTransport;
  /** Optional Typing-reaction surface shown while a turn processes. */
  reactions?: {
    start(messageId: string): Promise<{ reactionId: string | null }>;
    stop(state: { reactionId: string | null }): Promise<void>;
  };
  /** Internal bounded wait override used by focused integration tests. */
  approvalSettleTimeoutMs?: number;
}): FeishuCopilotChannel {
  const { deps, buildAgentStack, sendMessage, userId, providerAccountId, transport, cardTransport, reactions } = input;
  const approvalSettleTimeoutMs = Math.max(0, input.approvalSettleTimeoutMs ?? DECIDE_SETTLE_TIMEOUT_MS);
  const channelRepository = new FeishuCopilotChannelRepository(deps.db, userId);

  // Per-chat serialization: a chat's turns and decisions execute strictly in
  // arrival order, so concurrent messages can never interleave runs.
  const chatQueueState = sharedChatQueueState(deps.db);
  const chatQueues = chatQueueState.queues;
  function enqueue(chatId: string, task: () => Promise<void>): Promise<void> {
    if (!chatQueueState.accepting) return Promise.resolve();
    const queueKey = JSON.stringify([userId, providerAccountId, chatId]);
    const previous = chatQueues.get(queueKey) ?? Promise.resolve();
    const next = previous.then(task, task);
    chatQueues.set(queueKey, next);
    void next.catch(() => undefined).finally(() => {
      if (chatQueues.get(queueKey) === next) chatQueues.delete(queueKey);
    });
    return next;
  }

  function admitMessage(ingress: FeishuCopilotChannelIngress): boolean {
    if (!chatQueueState.accepting) return false;
    // Dedup provider retries through the same durable ingress ledger.
    const ledger = new PortfolioFeishuChannelRepository(deps.db, userId);
    const admission = ledger.admitIngress({
      providerAccountId,
      providerEventId: ingress.providerEventId,
      transport,
      handlerKind: "copilot",
      safeEnvelope: {
        handler: "copilot",
        eventType: "message",
        conversationDigest: sha256(ingress.chatId),
        senderDigest: sha256(ingress.senderIdentity),
        textLength: ingress.text.length
      }
    });
    return admission.admitted;
  }

  function admitCardAction(ingress: {
    chatId: string;
    senderIdentity: string;
    providerEventId: string;
    value: Record<string, unknown>;
  }): boolean {
    if (!chatQueueState.accepting) return false;
    const ledger = new PortfolioFeishuChannelRepository(deps.db, userId);
    const admission = ledger.admitIngress({
      providerAccountId,
      providerEventId: ingress.providerEventId,
      transport,
      handlerKind: "copilot",
      safeEnvelope: {
        handler: "copilot",
        eventType: "card_action",
        conversationDigest: sha256(ingress.chatId),
        senderDigest: sha256(ingress.senderIdentity),
        textLength: JSON.stringify(ingress.value ?? {}).length
      }
    });
    return admission.admitted;
  }

  function processMessage(ingress: FeishuCopilotChannelIngress): Promise<void> {
    return enqueue(ingress.chatId, async () => {
      await runMessage(ingress);
    });
  }

  function handleCardAction(ingress: {
    chatId: string;
    senderIdentity: string;
    value: Record<string, unknown>;
    messageId?: string;
  }): Promise<void> {
    return enqueue(ingress.chatId, () => runCardAction(ingress));
  }

  async function runMessage(ingress: FeishuCopilotChannelIngress): Promise<void> {
    const text = ingress.text.trim();
    if (!text) return;

    const isGroup = ingress.chatType === "group";
    if (isGroup && ingress.mentionedBot !== true) return; // fail closed unless the exact bot was mentioned

    const command = parseCommand(text);
    const stack = buildAgentStack(deps, userId);
    if (command === "approve" || command === "reject") {
      const channel = channelRepository.get(ingress.chatId);
      if (!channel?.senderIdentity || channel.senderIdentity !== ingress.senderIdentity) {
        return reply(ingress.chatId, SENDER_MISMATCH_TEXT);
      }
      return handleDecision(stack, ingress.chatId, channel.conversationId, command === "approve");
    }

    // Claim or validate ownership synchronously before the first reaction,
    // card, reply, or model await. This is the cross-instance ownership gate.
    const ownership = claimMessageOwner(stack, ingress);
    if (!ownership.owned) {
      return reply(ingress.chatId, SENDER_MISMATCH_TEXT);
    }
    if (command === "new") {
      if (ownership.created) return reply(ingress.chatId, "已开始新的会话，上下文已重置。");
      return handleNewConversation(stack, ingress);
    }
    if (command === "help") return reply(ingress.chatId, HELP_TEXT);
    const reaction = ingress.messageId && reactions
      ? await reactions.start(ingress.messageId).catch(() => ({ reactionId: null }))
      : null;
    try {
      return await runTurn(stack, ingress, text, ownership.conversationId);
    } finally {
      if (reaction && reactions) await reactions.stop(reaction).catch(() => undefined);
    }
  }

  function claimMessageOwner(stack: AgentStack, ingress: FeishuCopilotChannelIngress) {
    const existing = channelRepository.get(ingress.chatId);
    if (existing?.senderIdentity) {
      return {
        ...existing,
        owned: existing.senderIdentity === ingress.senderIdentity,
        created: false
      };
    }

    const candidate = existing
      ? undefined
      : stack.log.createConversation(feishuConversationTitle(ingress.chatId));
    const claimed = channelRepository.claimOwner({
      chatId: ingress.chatId,
      conversationId: existing?.conversationId ?? candidate!.id,
      senderIdentity: ingress.senderIdentity
    });
    if (candidate && claimed.conversationId !== candidate.id) {
      stack.log.deleteConversation(candidate.id);
    }
    return claimed;
  }

  async function runCardAction(ingress: {
    chatId: string;
    senderIdentity: string;
    value: Record<string, unknown>;
    messageId?: string;
  }): Promise<void> {
    const decisionValue = ingress.value.copilot_decision;
    const decision = typeof decisionValue === "string" ? decisionValue : undefined;
    if (decision !== "approve" && decision !== "reject") return;
    const channel = channelRepository.get(ingress.chatId);
    if (!channel?.senderIdentity || channel.senderIdentity !== ingress.senderIdentity) {
      return reply(ingress.chatId, SENDER_MISMATCH_TEXT);
    }
    const actionId = typeof ingress.value.action_id === "string" ? ingress.value.action_id : "";
    const runId = typeof ingress.value.run_id === "string" ? ingress.value.run_id : "";
    const suppliedConversationId = ingress.value.conversation_id;
    const stack = buildAgentStack(deps, userId);
    const run = runId ? stack.log.getRun(runId) : undefined;
    const pending = runId && actionId
      ? stack.log.listPendingActions(runId).find((candidate) => candidate.id === actionId && candidate.status === "pending")
      : undefined;
    if (
      !actionId ||
      !runId ||
      (suppliedConversationId !== undefined && suppliedConversationId !== channel.conversationId) ||
      run?.conversationId !== channel.conversationId ||
      !pending
    ) {
      return reply(ingress.chatId, "该审批请求无效或已失效，无法处理。");
    }
    const decisionInput: Parameters<typeof applyDecision>[0] = {
      chatId: ingress.chatId,
      approved: decision === "approve",
      pending
    };
    if (ingress.messageId !== undefined) decisionInput.originMessageId = ingress.messageId;
    await applyDecision(decisionInput);
  }

  async function handleNewConversation(stack: AgentStack, ingress: FeishuCopilotChannelIngress): Promise<void> {
    const conversation = stack.log.createConversation(feishuConversationTitle(ingress.chatId));
    const updated = channelRepository.pointAtConversation({
      chatId: ingress.chatId,
      conversationId: conversation.id,
      senderIdentity: ingress.senderIdentity
    });
    if (!updated) {
      stack.log.deleteConversation(conversation.id);
      return reply(ingress.chatId, SENDER_MISMATCH_TEXT);
    }
    await reply(ingress.chatId, "已开始新的会话，上下文已重置。");
  }

  async function handleDecision(
    stack: AgentStack,
    chatId: string,
    conversationId: string,
    approved: boolean
  ): Promise<void> {
    const pending = latestPendingAction(stack, conversationId);
    if (!pending) return reply(chatId, "没有等待审批的操作。");
    await applyDecision({ chatId, approved, pending });
  }

  async function applyDecision(input: {
    chatId: string;
    approved: boolean;
    pending: AgentPendingAction;
    originMessageId?: string;
  }): Promise<void> {
    const { chatId, approved, pending } = input;
    const stack = buildAgentStack(deps, userId);
    const conversationId = channelRepository.get(chatId)?.conversationId;
    const beforeSequence = conversationId
      ? (stack.log.listMessages(conversationId).at(-1)?.sequence ?? 0)
      : 0;
    const result = deps.dshBff
      ? await deps.dshBff.decidePendingAction({ userId, runId: pending.runId, actionId: pending.id, approved })
      : await stack.orchestrator.resumeAfterApproval({ userId, runId: pending.runId, actionId: pending.id, approved });
    if (!result.resumed) return reply(chatId, "该操作已被处理过。");

    if (!approved) {
      return deliverApprovalState({ ...input, state: "rejected" });
    }

    if (input.originMessageId && cardTransport) {
      await deliverApprovalState({ ...input, state: "approved_running" });
    }

    const settled = await waitForRunSettled(stack, pending.runId, approvalSettleTimeoutMs);
    if (settled?.status === "completed") {
      const outcome = conversationId
        ? latestToolResult(stack, conversationId, pending.tool, beforeSequence)
        : undefined;
      return deliverApprovalState({ ...input, state: "completed", ...(outcome ? { detail: outcome } : {}) });
    }
    if (settled?.status === "failed") {
      return deliverApprovalState({ ...input, state: "failed", ...(settled.error ? { detail: settled.error } : {}) });
    }
    if (settled?.status === "cancelled") {
      return deliverApprovalState({ ...input, state: "cancelled" });
    }
    return deliverApprovalState({ ...input, state: "still_running" });
  }

  async function deliverApprovalState(input: {
    chatId: string;
    pending: AgentPendingAction;
    state: CopilotApprovalResolutionState;
    originMessageId?: string;
    detail?: string;
  }): Promise<void> {
    const cardInput = {
      tool: input.pending.tool,
      state: input.state,
      ...(input.detail ? { detail: input.detail } : {})
    };
    if (input.originMessageId && cardTransport) {
      try {
        await cardTransport.updateCard(input.originMessageId, buildCopilotApprovalResolvedCard(cardInput));
        return;
      } catch {
        // The truthful text status below is the delivery fallback.
      }
    }
    await reply(input.chatId, approvalStateText(input.state, input.pending.tool, input.detail), undefined, true);
  }

  async function runTurn(
    stack: AgentStack,
    ingress: FeishuCopilotChannelIngress,
    text: string,
    conversationId: string
  ): Promise<void> {
    const stream = await beginStream(ingress.chatId, conversationId);
    try {
      const runId = deps.dshBff
        ? await deps.dshBff.sendMessage({ userId, conversationId, content: text })
        : await stack.orchestrator.runTurn({ userId, conversationId, userText: text, source: "user" });
      const run = stack.log.getRun(runId);
      if (run?.status === "awaiting_approval") {
        const pending = stack.log.listPendingActions(runId).find((action) => action.status === "pending");
        if (pending) {
          await stream?.finishAwaitingApproval(pending.id, pending.tool);
          if (stream) return sendApprovalCard(ingress.chatId, pending, conversationId);
          return reply(ingress.chatId, [
            "Copilot 请求执行以下操作，需要你的审批：",
            `工具：${pending.tool}`,
            `输入：${pending.inputJson}`,
            "",
            "回复 /approve 批准，/reject 拒绝。"
          ].join("\n"));
        }
      }
      const finalText = latestAssistantText(stack, conversationId) ?? "";
      if (stream) {
        await stream.finish(finalText, "done");
        return;
      }
      await reply(
        ingress.chatId,
        finalText,
        EMPTY_DONE_REPLY,
        Boolean(cardTransport && deps.eventBus)
      );
    } catch (error) {
      // runTurn rethrows after persisting the failed run. The Feishu reply only
      // carries a redacted reason; the full run log stays on the web side.
      const reason = redactAgentErrorMessage(error instanceof Error ? error.message : "Copilot run failed");
      if (stream) {
        await stream.finish(`运行失败：${reason}`, "failed");
        return;
      }
      await reply(ingress.chatId, `Copilot 运行失败：${reason}`);
    }
  }

  /**
   * Streaming card session for one turn. Returns null when cards are
   * unavailable (no transport or the initial send failed) — every failure
   * degrades to the legacy single-text-reply behavior.
   */
  async function beginStream(
    chatId: string,
    conversationId: string
  ): Promise<
    | {
        finish(finalText: string, state: "done" | "failed"): Promise<void>;
        finishAwaitingApproval(actionId: string, tool: string): Promise<void>;
      }
    | null
  > {
    if (!cardTransport || !deps.eventBus) return null;
    // The initial card must exist before any delta can arrive, otherwise the
    // first tokens would be dropped while message_id is still unresolved.
    let messageId: string | undefined;
    try {
      messageId = await cardTransport.sendCard(chatId, buildCopilotRunCard({ state: "running", text: "" }));
      if (!messageId) throw new Error("FEISHU_CARD_NO_MESSAGE_ID");
    } catch {
      return null;
    }
    let buffer = "";
    const scrubber = createFeishuOutboundTextScrubber();
    let closed = false;
    let lastFlushAt = 0;
    let chain: Promise<void> = Promise.resolve();

    const flush = (state: CopilotRunCardState, force: boolean): void => {
      if (closed || !messageId) return;
      const now = Date.now();
      if (!force && now - lastFlushAt < STREAM_FLUSH_INTERVAL_MS) return;
      lastFlushAt = now;
      chain = chain.then(async () => {
        if (closed || !messageId) return;
        try {
          await cardTransport.updateCard(messageId, buildCopilotRunCard({ state, text: scrubber.visible() }));
        } catch {
          // A failed mid-stream refresh never aborts the turn; the finalize
          // attempt below still runs and plain-text fallback remains possible.
        }
      });
    };

    const onEvent = (event: unknown): void => {
      const candidate = event as {
        type?: string;
        userId?: string;
        conversationId?: string;
        status?: string;
        textDelta?: string;
      };
      if (
        candidate?.type !== "copilot_run_updated" ||
        candidate.userId !== userId ||
        candidate.conversationId !== conversationId ||
        candidate.status !== "running" ||
        typeof candidate.textDelta !== "string"
      ) {
        return;
      }
      buffer += candidate.textDelta;
      scrubber.append(candidate.textDelta);
      flush("running", false);
    };
    deps.eventBus.on("event", onEvent);

    const close = (): void => {
      closed = true;
      deps.eventBus?.off("event", onEvent);
    };

    const finish = async (finalText: string, state: "done" | "failed"): Promise<void> => {
      buffer = finalText || buffer;
      scrubber.replace(buffer);
      close();
      await chain.catch(() => undefined);
      try {
        if (messageId) {
          await cardTransport.updateCard(messageId, buildCopilotRunCard({ state, text: scrubber.visible() }));
        }
      } catch {
        await sendFinalPatchFallback(
          chatId,
          buffer,
          state === "done" ? EMPTY_DONE_REPLY : undefined
        );
      }
    };

    return {
      finish: (finalText, state) => finish(finalText, state),
      finishAwaitingApproval: async (_actionId, tool) => {
        close();
        await chain.catch(() => undefined);
        try {
          if (messageId) {
            await cardTransport.updateCard(messageId, buildCopilotRunCard({
              state: "awaiting_approval",
              text: scrubber.visible(),
              note: `等待审批：工具 **${tool}** 需要你的确认。`
            }));
          }
        } catch {
          // The independent approval card is still sent by the caller.
        }
      }
    };
  }

  async function sendApprovalCard(
    chatId: string,
    pending: { id: string; runId: string; tool: string; inputJson: string },
    conversationId: string
  ): Promise<void> {
    if (!cardTransport) {
      return reply(chatId, [
        "Copilot 请求执行以下操作，需要你的审批：",
        `工具：${pending.tool}`,
        `输入：${pending.inputJson}`,
        "",
        "回复 /approve 批准，/reject 拒绝。"
      ].join("\n"));
    }
    try {
      const messageId = await cardTransport.sendCard(
        chatId,
        buildCopilotApprovalCard({
          tool: pending.tool,
          inputJson: pending.inputJson,
          conversationId,
          runId: pending.runId,
          actionId: pending.id
        })
      );
      if (!messageId) throw new Error("FEISHU_CARD_NO_MESSAGE_ID");
    } catch {
      await reply(chatId, [
        "Copilot 请求执行以下操作，需要你的审批：",
        `工具：${pending.tool}`,
        "",
        "回复 /approve 批准，/reject 拒绝。"
      ].join("\n"));
    }
  }

  async function reply(chatId: string, text: string, emptyFallback?: string, forceText = false): Promise<void> {
    try {
      const visibleText = prepareFeishuCopilotText(text).trim()
        || (emptyFallback ? prepareFeishuCopilotText(emptyFallback).trim() : "");
      if (!visibleText) return;
      // Rich content renders as a markdown card when the surface allows it.
      if (!forceText && cardTransport && looksRich(visibleText)) {
        try {
          await cardTransport.sendCard(chatId, buildCopilotRunCard({ state: "done", text: visibleText }));
          return;
        } catch {
          // fall through to chunked plain text
        }
      }
      for (const chunk of splitForText(visibleText)) {
        await sendMessage({ chatId, text: chunk });
      }
    } catch {
      // Delivery failures never propagate into the ingress path; the provider
      // will not retry an event already recorded by the ingress ledger.
    }
  }

  async function sendFinalPatchFallback(
    chatId: string,
    text: string,
    emptyFallback?: string
  ): Promise<void> {
    try {
      const visibleText = prepareFeishuCopilotText(text).trim()
        || (emptyFallback ? prepareFeishuCopilotText(emptyFallback).trim() : "");
      if (!visibleText) return;
      await sendMessage({ chatId, text: truncateSingleText(visibleText) });
    } catch {
      // The final PATCH fallback is one best-effort provider message only.
    }
  }

  return { admitMessage, processMessage, admitCardAction, handleCardAction };
}

function sharedChatQueueState(db: Database): SharedChatQueueState {
  const existing = SHARED_CHAT_QUEUE_STATES.get(db);
  if (existing) return existing;
  const created: SharedChatQueueState = { accepting: true, queues: new Map() };
  SHARED_CHAT_QUEUE_STATES.set(db, created);
  return created;
}

/** @internal Gateway shutdown barrier; not exposed through HTTP or channel APIs. */
export async function drainFeishuCopilotChatQueues(
  db: Database,
  warningIntervalMs = 5_000
): Promise<boolean> {
  const state = sharedChatQueueState(db);
  state.accepting = false;
  const intervalMs = Math.max(1, warningIntervalMs);
  while (state.queues.size > 0) {
    const settled = await settleWithin([...state.queues.values()], intervalMs);
    if (!settled) {
      console.warn("[feishu-copilot] queue drain still waiting", {
        code: "FEISHU_COPILOT_QUEUE_DRAIN_WAITING"
      });
      continue;
    }
    await Promise.resolve();
  }
  return true;
}

async function settleWithin(pending: Promise<void>[], timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.allSettled(pending).then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type FeishuCommand = "new" | "approve" | "reject" | "help";

function parseCommand(text: string): FeishuCommand | undefined {
  const match = /^\/(new|approve|reject|help)(?:\s|$)/iu.exec(text);
  const command = match?.[1]?.toLowerCase();
  return command === "new" || command === "approve" || command === "reject" || command === "help" ? command : undefined;
}

/** Heuristic: does this reply benefit from markdown rendering? */
function looksRich(text: string): boolean {
  return /```\w|\n\|[^\n]*\||^#{1,3} \S|\*\*\S[^\n]*\*\*/mu.test(text);
}

const TEXT_CHUNK_LIMIT = 3_800;
const TEXT_TRUNCATION_SUFFIX = "\n…（已截断）";

function truncateSingleText(text: string): string {
  if (text.length <= TEXT_CHUNK_LIMIT) return text;
  return `${text.slice(0, TEXT_CHUNK_LIMIT - TEXT_TRUNCATION_SUFFIX.length)}${TEXT_TRUNCATION_SUFFIX}`;
}

/** Paragraph-boundary chunking; hard-split only when a single block exceeds the limit. */
function splitForText(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= TEXT_CHUNK_LIMIT) return [trimmed];
  const chunks: string[] = [];
  let current = "";
  for (const block of trimmed.split(/\n{2,}/u)) {
    let piece = block;
    while (piece.length > TEXT_CHUNK_LIMIT) {
      if (current) { chunks.push(current); current = ""; }
      chunks.push(piece.slice(0, TEXT_CHUNK_LIMIT));
      piece = piece.slice(TEXT_CHUNK_LIMIT);
    }
    if (!piece) continue;
    const candidate = current ? `${current}\n\n${piece}` : piece;
    if (candidate.length > TEXT_CHUNK_LIMIT) { chunks.push(current); current = piece; }
    else current = candidate;
  }
  if (current) chunks.push(current);
  return chunks;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function feishuConversationTitle(chatId: string): string {
  return `飞书 · ${chatId.slice(0, 32)}`;
}

function latestPendingAction(stack: AgentStack, conversationId: string): AgentPendingAction | undefined {
  const runs = stack.log.listRuns(conversationId);
  for (const run of runs) {
    const pending = stack.log.listPendingActions(run.id).find((action) => action.status === "pending");
    if (pending) return pending;
  }
  return undefined;
}

function latestToolResult(
  stack: AgentStack,
  conversationId: string,
  tool: string,
  afterSequence: number
): string | undefined {
  const messages = stack.log.listMessages(conversationId);
  for (const message of [...messages].reverse()) {
    if (
      message.sequence > afterSequence &&
      message.role === "tool" &&
      message.kind === "tool_result" &&
      message.toolName === tool
    ) {
      return message.content;
    }
  }
  return undefined;
}

function latestAssistantText(stack: AgentStack, conversationId: string): string | undefined {
  const messages = stack.log.listMessages(conversationId);
  for (const message of [...messages].reverse()) {
    if (message.role === "assistant" && message.kind === "text" && message.content.trim().length > 0) return message.content;
  }
  return undefined;
}

function approvalStateText(
  state: CopilotApprovalResolutionState,
  tool: string,
  detail?: string
): string {
  if (state === "rejected") return "已拒绝该操作。";
  if (state === "approved_running") return `已批准 ${tool}，正在执行。`;
  if (state === "completed") {
    return `执行完成 ${tool}：\n${detail ?? "操作已完成，但没有返回可展示的工具输出。"}`;
  }
  if (state === "failed") return `执行失败 ${tool}：\n${detail ?? "未返回错误详情。"}`;
  if (state === "cancelled") return `执行已取消 ${tool}。`;
  return `${tool} 已批准但仍在执行，请稍后查看。`;
}

/** Poll until the run leaves non-terminal states (awaiting_approval/running). */
async function waitForRunSettled(stack: AgentStack, runId: string, timeoutMs: number): Promise<AgentRun | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = stack.log.getRun(runId);
    if (!run || run.status === "completed" || run.status === "cancelled" || run.status === "failed") return run;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return run;
    await new Promise((resolve) => setTimeout(resolve, Math.min(200, remaining)));
  }
}
