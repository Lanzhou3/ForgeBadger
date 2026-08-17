/**
 * Feishu -> Copilot conversation bridge.
 *
 * Feishu chats without an active Portfolio channel binding route their text
 * messages into the same Copilot harness the web chat uses (buildAgentStack:
 * conversation log + memory + tools + orchestrator). Each chat keeps its own
 * conversation with isolated context; /new swaps the chat's pointer to a fresh
 * conversation. Provider retries are deduplicated through the same durable
 * ingress ledger as the Portfolio channel.
 */
import type { Database } from "../../db/types.js";
import { PortfolioFeishuChannelRepository } from "../../db/repositories/portfolio-feishu-channel-repository.js";
import type { PortfolioFeishuTransport } from "../portfolio/feishu/contracts.js";
import { sha256 } from "../portfolio/feishu/codec.js";
import type { AgentStack, AgentStackDeps } from "../agent/agent-stack.js";
import type { AgentPendingAction } from "../agent/types.js";

const REPLY_MAX_CHARS = 4_000;

const HELP_TEXT = [
  "可用命令：",
  "/new - 开始全新会话（重置该聊天的上下文）",
  "/approve - 批准最近一条等待审批的操作",
  "/reject - 拒绝最近一条等待审批的操作",
  "/help - 显示本帮助",
  "其他消息会直接发给 Copilot，与网页聊天共享同一记忆与工具。"
].join("\n");

type BuildAgentStack = (deps: AgentStackDeps, userId: string) => AgentStack;

export interface FeishuCopilotChannel {
  routeMessage(input: { chatId: string; text: string; providerEventId: string }): Promise<void>;
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

  async function routeMessage(message: { chatId: string; text: string; providerEventId: string }): Promise<void> {
    // Dedup provider retries through the same durable ingress ledger.
    const ledger = new PortfolioFeishuChannelRepository(deps.db, userId);
    const admission = ledger.admitIngress({
      providerAccountId,
      providerEventId: message.providerEventId,
      transport,
      handlerKind: "copilot",
      safeEnvelope: {
        handler: "copilot",
        eventType: "message",
        conversationDigest: sha256(message.chatId),
        textLength: message.text.length
      }
    });
    if (!admission.admitted) return;

    const text = message.text.trim();
    if (!text) return;
    const stack = buildAgentStack(deps, userId);

    const command = parseCommand(text);
    if (command === "new") return handleNewConversation(stack, message.chatId);
    if (command === "approve" || command === "reject") return handleDecision(stack, message.chatId, command === "approve");
    if (command === "help") return reply(message.chatId, HELP_TEXT);
    return runTurn(stack, message.chatId, text);
  }

  async function handleNewConversation(stack: AgentStack, chatId: string): Promise<void> {
    const conversation = stack.log.createConversation(feishuConversationTitle(chatId));
    pointChatAt(deps.db, userId, chatId, conversation.id);
    await reply(chatId, "已开始新的会话，上下文已重置。");
  }

  async function handleDecision(stack: AgentStack, chatId: string, approved: boolean): Promise<void> {
    const conversationId = chatConversation(deps.db, userId, chatId);
    if (!conversationId) {
      return reply(chatId, "当前聊天还没有 Copilot 会话，直接发送消息即可开始。");
    }
    const pending = latestPendingAction(stack, conversationId);
    if (!pending) return reply(chatId, "没有等待审批的操作。");
    const result = await stack.orchestrator.resumeAfterApproval({ userId, runId: pending.runId, actionId: pending.id, approved });
    if (!result.resumed) return reply(chatId, "该操作已被处理过。");
    if (!approved) return reply(chatId, "已拒绝该操作。");
    const outcome = latestToolResult(stack, conversationId);
    return reply(chatId, `已批准并执行 ${pending.tool}：\n${truncate(outcome ?? "（无输出）")}`);
  }

  async function runTurn(stack: AgentStack, chatId: string, text: string): Promise<void> {
    const conversationId = resolveConversation(stack, deps.db, userId, chatId);
    try {
      const runId = await stack.orchestrator.runTurn({ userId, conversationId, userText: text, source: "user" });
      const run = stack.log.getRun(runId);
      if (run?.status === "awaiting_approval") {
        const pending = stack.log.listPendingActions(runId).find((action) => action.status === "pending");
        if (pending) {
          return reply(chatId, [
            "Copilot 请求执行以下操作，需要你的审批：",
            `工具：${pending.tool}`,
            `输入：${truncate(pending.inputJson)}`,
            "",
            "回复 /approve 批准，/reject 拒绝。"
          ].join("\n"));
        }
      }
      const finalText = latestAssistantText(stack, conversationId);
      if (finalText) await reply(chatId, truncate(finalText));
    } catch (error) {
      // runTurn rethrows after persisting the failed run; surface the reason.
      const reason = error instanceof Error ? error.message : "Copilot run failed";
      await reply(chatId, `Copilot 运行失败：${reason}`);
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

  return { routeMessage };
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
}

function chatConversation(db: Database, userId: string, chatId: string): string | undefined {
  const row = db.prepare("SELECT conversation_id FROM feishu_copilot_channels WHERE user_id = ? AND chat_id = ?")
    .get(userId, chatId) as ChatChannelRow | undefined;
  return row?.conversation_id;
}

function pointChatAt(db: Database, userId: string, chatId: string, conversationId: string): void {
  const now = Date.now();
  db.prepare(`INSERT INTO feishu_copilot_channels (user_id, chat_id, conversation_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, chat_id) DO UPDATE SET conversation_id = excluded.conversation_id, updated_at = excluded.updated_at`)
    .run(userId, chatId, conversationId, now, now);
}

function resolveConversation(stack: AgentStack, db: Database, userId: string, chatId: string): string {
  const existing = chatConversation(db, userId, chatId);
  if (existing && stack.log.getConversation(existing)) return existing;
  const conversation = stack.log.createConversation(feishuConversationTitle(chatId));
  pointChatAt(db, userId, chatId, conversation.id);
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
