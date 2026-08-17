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
 * the OpenForge account owner.
 */
import type { Database } from "../../db/types.js";
import { PortfolioFeishuChannelRepository } from "../../db/repositories/portfolio-feishu-channel-repository.js";
import type { PortfolioFeishuTransport } from "../portfolio/feishu/contracts.js";
import { sha256 } from "../portfolio/feishu/codec.js";
import { redactAgentErrorMessage } from "../agent/redaction.js";
import type { AgentStack, AgentStackDeps } from "../agent/agent-stack.js";
import type { AgentPendingAction } from "../agent/types.js";

const REPLY_MAX_CHARS = 4_000;

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
}

export interface FeishuCopilotChannel {
  /**
   * Synchronously record the event in the durable ingress ledger. Must run on
   * the ingress acknowledgement path so ledger failures reject the delivery
   * (and the provider retries) instead of silently dropping the message.
   * Returns false for provider-retry duplicates.
   */
  admitMessage(ingress: FeishuCopilotChannelIngress): boolean;
  /** Run the admitted message. Fire-and-forget; never blocks the ack. */
  processMessage(ingress: FeishuCopilotChannelIngress): Promise<void>;
}

export function createFeishuCopilotChannel(input: {
  deps: AgentStackDeps;
  buildAgentStack: BuildAgentStack;
  sendMessage: (message: { chatId: string; text: string }) => Promise<void>;
  userId: string;
  providerAccountId: string;
  transport: PortfolioFeishuTransport;
}): FeishuCopilotChannel {
  const { deps, buildAgentStack, sendMessage, userId, providerAccountId, transport } = input;

  function admitMessage(ingress: FeishuCopilotChannelIngress): boolean {
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

  async function processMessage(ingress: FeishuCopilotChannelIngress): Promise<void> {
    const text = ingress.text.trim();
    if (!text) return;
    const stack = buildAgentStack(deps, userId);

    const channel = chatChannel(deps.db, userId, ingress.chatId);
    if (channel?.sender_identity && channel.sender_identity !== ingress.senderIdentity) {
      // Admission is already recorded, so this bounded refusal must not throw:
      // a throw would only feed the fire-and-forget catch, not the provider.
      return reply(ingress.chatId, SENDER_MISMATCH_TEXT);
    }

    const command = parseCommand(text);
    if (command === "new") return handleNewConversation(stack, ingress);
    if (command === "approve" || command === "reject") return handleDecision(stack, ingress, command === "approve");
    if (command === "help") return reply(ingress.chatId, HELP_TEXT);
    return runTurn(stack, ingress, text);
  }

  async function handleNewConversation(stack: AgentStack, ingress: FeishuCopilotChannelIngress): Promise<void> {
    const conversation = stack.log.createConversation(feishuConversationTitle(ingress.chatId));
    pointChatAt(deps.db, userId, ingress.chatId, conversation.id, ingress.senderIdentity);
    await reply(ingress.chatId, "已开始新的会话，上下文已重置。");
  }

  async function handleDecision(stack: AgentStack, ingress: FeishuCopilotChannelIngress, approved: boolean): Promise<void> {
    const conversationId = chatConversation(deps.db, userId, ingress.chatId);
    if (!conversationId) {
      return reply(ingress.chatId, "当前聊天还没有 Copilot 会话，直接发送消息即可开始。");
    }
    const pending = latestPendingAction(stack, conversationId);
    if (!pending) return reply(ingress.chatId, "没有等待审批的操作。");
    const result = await stack.orchestrator.resumeAfterApproval({ userId, runId: pending.runId, actionId: pending.id, approved });
    if (!result.resumed) return reply(ingress.chatId, "该操作已被处理过。");
    if (!approved) return reply(ingress.chatId, "已拒绝该操作。");
    const outcome = latestToolResult(stack, conversationId);
    return reply(ingress.chatId, `已批准并执行 ${pending.tool}：\n${truncate(outcome ?? "（无输出）")}`);
  }

  async function runTurn(stack: AgentStack, ingress: FeishuCopilotChannelIngress, text: string): Promise<void> {
    const conversationId = resolveConversation(stack, deps.db, userId, ingress);
    try {
      const runId = await stack.orchestrator.runTurn({ userId, conversationId, userText: text, source: "user" });
      const run = stack.log.getRun(runId);
      if (run?.status === "awaiting_approval") {
        const pending = stack.log.listPendingActions(runId).find((action) => action.status === "pending");
        if (pending) {
          return reply(ingress.chatId, [
            "Copilot 请求执行以下操作，需要你的审批：",
            `工具：${pending.tool}`,
            `输入：${truncate(pending.inputJson)}`,
            "",
            "回复 /approve 批准，/reject 拒绝。"
          ].join("\n"));
        }
      }
      const finalText = latestAssistantText(stack, conversationId);
      if (finalText) await reply(ingress.chatId, truncate(finalText));
    } catch (error) {
      // runTurn rethrows after persisting the failed run. The Feishu reply only
      // carries a redacted reason; the full run log stays on the web side.
      const reason = redactAgentErrorMessage(error instanceof Error ? error.message : "Copilot run failed");
      await reply(ingress.chatId, `Copilot 运行失败：${reason}`);
    }
  }

  async function reply(chatId: string, text: string): Promise<void> {
    try {
      await sendMessage({ chatId, text });
    } catch {
      // Delivery failures never propagate into the ingress path; the provider
      // will not retry an event already recorded by the ingress ledger.
    }
  }

  return { admitMessage, processMessage };
}

type FeishuCommand = "new" | "approve" | "reject" | "help";

function parseCommand(text: string): FeishuCommand | undefined {
  const match = /^\/(new|approve|reject|help)(?:\s|$)/iu.exec(text);
  const command = match?.[1]?.toLowerCase();
  return command === "new" || command === "approve" || command === "reject" || command === "help" ? command : undefined;
}

function feishuConversationTitle(chatId: string): string {
  return `飞书 · ${chatId.slice(0, 32)}`;
}

interface ChatChannelRow {
  conversation_id: string;
  sender_identity: string | null;
}

function chatChannel(db: Database, userId: string, chatId: string): ChatChannelRow | undefined {
  return db.prepare("SELECT conversation_id, sender_identity FROM feishu_copilot_channels WHERE user_id = ? AND chat_id = ?")
    .get(userId, chatId) as ChatChannelRow | undefined;
}

function chatConversation(db: Database, userId: string, chatId: string): string | undefined {
  return chatChannel(db, userId, chatId)?.conversation_id;
}

function pointChatAt(db: Database, userId: string, chatId: string, conversationId: string, senderIdentity: string): void {
  const now = Date.now();
  db.prepare(`INSERT INTO feishu_copilot_channels (user_id, chat_id, conversation_id, sender_identity, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, chat_id) DO UPDATE SET conversation_id = excluded.conversation_id, sender_identity = excluded.sender_identity, updated_at = excluded.updated_at`)
    .run(userId, chatId, conversationId, senderIdentity, now, now);
}

function resolveConversation(stack: AgentStack, db: Database, userId: string, ingress: FeishuCopilotChannelIngress): string {
  const existing = chatConversation(db, userId, ingress.chatId);
  if (existing && stack.log.getConversation(existing)) {
    // Claim sender ownership on first use of a pre-existing channel row.
    pointChatAt(db, userId, ingress.chatId, existing, ingress.senderIdentity);
    return existing;
  }
  const conversation = stack.log.createConversation(feishuConversationTitle(ingress.chatId));
  pointChatAt(db, userId, ingress.chatId, conversation.id, ingress.senderIdentity);
  return conversation.id;
}

function latestPendingAction(stack: AgentStack, conversationId: string): AgentPendingAction | undefined {
  const runs = stack.log.listRuns(conversationId);
  for (const run of [...runs].reverse()) {
    const pending = stack.log.listPendingActions(run.id).find((action) => action.status === "pending");
    if (pending) return pending;
  }
  return undefined;
}

function latestToolResult(stack: AgentStack, conversationId: string): string | undefined {
  const messages = stack.log.listMessages(conversationId);
  for (const message of [...messages].reverse()) {
    if (message.role === "tool" && message.kind === "tool_result") return message.content;
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

function truncate(text: string): string {
  return text.length > REPLY_MAX_CHARS ? `${text.slice(0, REPLY_MAX_CHARS)}\n…（已截断）` : text;
}
