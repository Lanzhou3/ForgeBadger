import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { UserRepository } from "../src/db/repositories/user-repository.js";
import { FeishuChannelRepository } from "../src/db/repositories/feishu-channel-repository.js";
import { PortfolioFeishuRegistryRepository } from "../src/db/repositories/portfolio-feishu-registry-repository.js";
import { PortfolioFeishuChannelRepository } from "../src/db/repositories/portfolio-feishu-channel-repository.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { buildAgentStack, type AgentStackDeps } from "../src/services/agent/agent-stack.js";
import { OpenForgeEventBus } from "../src/services/event-bus.js";
import {
  createFeishuCopilotChannel,
  drainFeishuCopilotChatQueues,
  type FeishuCopilotChannelIngress
} from "../src/services/integrations/feishu-copilot-channel.js";
import {
  createFeishuSdkHandlers,
  routeVerifiedFeishuIngress,
  createPortfolioIngressSelector
} from "../src/services/integrations/feishu-runtime-factory.js";
import type { FeishuSdkFactory } from "../src/services/integrations/feishu-sdk.js";

const masterKey = "0123456789abcdef0123456789abcdef";
const defaultReply = "来自 Copilot 的回复";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
  return db;
}

interface SentMessage {
  chatId: string;
  text: string;
}

interface TurnCall {
  userId: string;
  conversationId: string;
  userText: string;
}

/**
 * A stub agent stack keeps the routing tests on the bridge contract: the real
 * conversation log persists turns, while runTurn/resume are observable fakes.
 */
function createStubAgentStackFactory(db: Database) {
  const turnCalls: TurnCall[] = [];
  const resumeCalls: Array<{ runId: string; actionId: string; approved: boolean }> = [];
  let behavior: "completed" | "awaiting_approval" | "fails" = "completed";
  let finalText = defaultReply;
  let turnHold: Promise<void> | null = null;
  let releaseTurn: (() => void) | null = null;

  const factory = (_deps: AgentStackDeps, userId: string) => {
    const log = new CopilotConversationLog(db, userId);
    return {
      log,
      memory: {},
      toolRegistry: { tools: new Map() },
      orchestrator: {
        async runTurn(input: { userId: string; conversationId: string; userText: string }): Promise<string> {
          turnCalls.push(input);
          if (turnHold) {
            const held = turnHold;
            turnHold = null;
            await held;
          }
          log.appendMessage(input.conversationId, { role: "user", kind: "text", content: input.userText });
          const run = log.createRun(input.conversationId, {});
          if (behavior === "awaiting_approval") {
            log.createPendingAction({ runId: run.id, tool: "stub_operate_tool", inputJson: "{\"x\":1}", inputDigest: "digest" });
            log.updateRun(run.id, { status: "awaiting_approval" });
            return run.id;
          }
          if (behavior === "fails") {
            log.updateRun(run.id, { status: "failed" });
            throw new Error("sk-test-api-key token expired");
          }
          log.appendMessage(input.conversationId, { role: "assistant", kind: "text", content: finalText });
          log.updateRun(run.id, { status: "completed", completedAt: new Date() });
          return run.id;
        },
        async resumeAfterApproval(input: { runId: string; actionId: string; approved: boolean }) {
          resumeCalls.push(input);
          const run = log.getRun(input.runId);
          if (input.approved && run) {
            log.appendMessage(run.conversationId, { role: "tool", kind: "tool_result", content: "{\"ok\":true}", toolName: "stub_operate_tool" });
            log.updateRun(run.id, { status: "completed", completedAt: new Date() });
          }
          return { resumed: true, runId: input.runId };
        },
        async cancelRun(input: { runId: string }) {
          return { cancelled: true, runId: input.runId };
        }
      }
    };
  };

  return {
    factory: factory as unknown as typeof buildAgentStack,
    turnCalls,
    resumeCalls,
    setBehavior(next: "completed" | "awaiting_approval" | "fails") {
      behavior = next;
    },
    setFinalText(next: string) {
      finalText = next;
    },
    holdNextTurn() {
      turnHold = new Promise<void>((resolve) => { releaseTurn = resolve; });
    },
    releaseTurn() {
      releaseTurn?.();
      releaseTurn = null;
    }
  };
}

function createHarness() {
  const db = createTestDb();
  const userId = new UserRepository(db).create("feishu-copilot@example.com", "hash").id;
  new FeishuChannelRepository(db, userId, masterKey).upsertAccount({ appId: "cli_copilot_test", appSecret: "secret", enabled: true });
  const providerAccount = new PortfolioFeishuRegistryRepository(db)
    .register({ userId, provider: "feishu", providerAccountId: "cli_copilot_test" });
  const stub = createStubAgentStackFactory(db);
  const sent: SentMessage[] = [];
  const deps: AgentStackDeps = { db, masterKey, eventBus: new OpenForgeEventBus() };
  const channel = createFeishuCopilotChannel({
    deps,
    buildAgentStack: stub.factory,
    sendMessage: async ({ chatId, text }) => {
      sent.push({ chatId, text });
    },
    userId,
    providerAccountId: providerAccount.id,
    transport: "long_connection"
  });
  /** Mirrors the production ingress path: sync admission, then processing. */
  const deliver = async (ingress: Omit<FeishuCopilotChannelIngress, "senderIdentity"> & Partial<Pick<FeishuCopilotChannelIngress, "senderIdentity">>) => {
    const full: FeishuCopilotChannelIngress = { senderIdentity: "ou_owner", ...ingress };
    if (!channel.admitMessage(full)) return "duplicate";
    await channel.processMessage(full);
    return "admitted";
  };
  return {
    db,
    userId,
    providerAccount,
    deps,
    channel,
    deliver,
    sent,
    stub,
    pointer(chatId: string): string | undefined {
      const row = db.prepare("SELECT conversation_id FROM feishu_copilot_channels WHERE user_id = ? AND chat_id = ?")
        .get(userId, chatId) as { conversation_id: string } | undefined;
      return row?.conversation_id;
    },
    owner(chatId: string): string | undefined {
      const row = db.prepare("SELECT sender_identity FROM feishu_copilot_channels WHERE user_id = ? AND chat_id = ?")
        .get(userId, chatId) as { sender_identity: string | null } | undefined;
      return row?.sender_identity ?? undefined;
    },
    conversation(id: string | undefined) {
      return id ? new CopilotConversationLog(db, userId).getConversation(id) : undefined;
    }
  };
}

function seedNullableOwnerPending(
  harness: ReturnType<typeof createHarness>,
  chatId: string
): { runId: string; actionId: string } {
  const log = new CopilotConversationLog(harness.db, harness.userId);
  const conversation = log.createConversation(`legacy ${chatId}`);
  const run = log.createRun(conversation.id, {});
  const action = log.createPendingAction({
    runId: run.id,
    tool: "legacy_pending_tool",
    inputJson: "{}",
    inputDigest: "legacy-digest"
  });
  log.updateRun(run.id, { status: "awaiting_approval" });
  harness.db.prepare(`
    INSERT INTO feishu_copilot_channels (
      user_id, chat_id, conversation_id, sender_identity, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, 1, 1)
  `).run(harness.userId, chatId, conversation.id);
  return { runId: run.id, actionId: action.id };
}

/**
 * dsh-path harness (M3): same stub stack, plus a stub dshBff on the deps. The
 * BFF stub mirrors the orchestrator stub's projection writes so the channel's
 * reply logic (pending card, tool result lookup) observes the same rows.
 */
function createDshHarness(
  behavior: "completed" | "awaiting_approval" = "completed",
  decisionOutcome: "completed" | "failed" | "running" = "completed",
  approvalSettleTimeoutMs = 20_000
) {
  const db = createTestDb();
  const userId = new UserRepository(db).create("feishu-copilot-dsh@example.com", "hash").id;
  new FeishuChannelRepository(db, userId, masterKey).upsertAccount({ appId: "cli_copilot_test", appSecret: "secret", enabled: true });
  const providerAccount = new PortfolioFeishuRegistryRepository(db)
    .register({ userId, provider: "feishu", providerAccountId: "cli_copilot_test" });
  const stub = createStubAgentStackFactory(db);
  const sent: SentMessage[] = [];
  const sendCalls: Array<{ conversationId: string; content: string }> = [];
  const decideCalls: Array<{ runId: string; actionId: string; approved: boolean }> = [];
  const dshBff = {
    async sendMessage(input: { userId: string; conversationId: string; content: string }) {
      sendCalls.push(input);
      const log = new CopilotConversationLog(db, input.userId);
      log.appendMessage(input.conversationId, { role: "user", kind: "text", content: input.content });
      const run = log.createRun(input.conversationId, {});
      if (behavior === "awaiting_approval") {
        log.createPendingAction({ runId: run.id, tool: "stub_operate_tool", inputJson: "{\"x\":1}", inputDigest: "digest" });
        log.updateRun(run.id, { status: "awaiting_approval" });
        return run.id;
      }
      log.appendMessage(input.conversationId, { role: "assistant", kind: "text", content: defaultReply });
      log.updateRun(run.id, { status: "completed", completedAt: new Date() });
      return run.id;
    },
    async cancelRun() {
      return { cancelled: false, runId: "" };
    },
    async decidePendingAction(input: { userId: string; runId: string; actionId: string; approved: boolean }) {
      decideCalls.push(input);
      const log = new CopilotConversationLog(db, input.userId);
      const action = log.getPendingAction(input.actionId);
      if (!action || action.status !== "pending") return { resumed: false, runId: input.runId };
      log.decidePendingAction(action.id, input.approved ? "approved" : "rejected");
      const run = log.getRun(input.runId);
      if (run) {
        if (!input.approved) {
          log.updateRun(run.id, { status: "cancelled", completedAt: new Date() });
        } else if (decisionOutcome === "completed") {
          log.appendMessage(run.conversationId, { role: "tool", kind: "tool_result", content: "{\"ok\":true}", toolName: action.tool });
          log.updateRun(run.id, { status: "completed", completedAt: new Date() });
        } else if (decisionOutcome === "failed") {
          log.updateRun(run.id, { status: "failed", error: "dsh failed sk-secret123", completedAt: new Date() });
        } else {
          log.updateRun(run.id, { status: "running" });
        }
      }
      return { resumed: true, runId: input.runId };
    }
  };
  const deps: AgentStackDeps = { db, masterKey, eventBus: new OpenForgeEventBus(), dshBff };
  const channel = createFeishuCopilotChannel({
    deps,
    buildAgentStack: stub.factory,
    sendMessage: async ({ chatId, text }) => {
      sent.push({ chatId, text });
    },
    userId,
    providerAccountId: providerAccount.id,
    transport: "long_connection",
    approvalSettleTimeoutMs
  });
  const deliver = async (ingress: Omit<FeishuCopilotChannelIngress, "senderIdentity"> & Partial<Pick<FeishuCopilotChannelIngress, "senderIdentity">>) => {
    const full: FeishuCopilotChannelIngress = { senderIdentity: "ou_owner", ...ingress };
    if (!channel.admitMessage(full)) return "duplicate";
    await channel.processMessage(full);
    return "admitted";
  };
  return {
    db,
    userId,
    sent,
    stub,
    deliver,
    dsh: { sendCalls, decideCalls },
    owner(chatId: string): string | undefined {
      const row = db.prepare("SELECT sender_identity FROM feishu_copilot_channels WHERE user_id = ? AND chat_id = ?")
        .get(userId, chatId) as { sender_identity: string | null } | undefined;
      return row?.sender_identity ?? undefined;
    }
  };
}

describe("FeishuCopilotChannel", () => {
  it("runs a Copilot turn in a per-chat conversation and replies with the final text", async () => {
    // Arrange
    const harness = createHarness();

    // Act
    await harness.deliver({ chatId: "oc_alpha", text: "帮我看下项目状态", providerEventId: "ev-1" });

    // Assert
    assert.equal(harness.sent.length, 1);
    assert.equal(harness.sent[0]?.chatId, "oc_alpha");
    assert.equal(harness.sent[0]?.text, defaultReply);
    const conversationId = harness.pointer("oc_alpha");
    assert.ok(conversationId);
    assert.equal(harness.conversation(conversationId)?.title, "飞书 · oc_alpha");
    const messages = new CopilotConversationLog(harness.db, harness.userId).listMessages(conversationId);
    assert.equal(messages.filter((message) => message.role === "user" && message.content === "帮我看下项目状态").length, 1);
    assert.equal(messages.filter((message) => message.role === "assistant" && message.content === defaultReply).length, 1);
  });

  it("isolates two chats into two separate conversations", async () => {
    // Arrange
    const harness = createHarness();

    // Act
    await harness.deliver({ chatId: "oc_alpha", text: "第一个聊天", providerEventId: "ev-a" });
    await harness.deliver({ chatId: "oc_beta", text: "第二个聊天", providerEventId: "ev-b" });

    // Assert
    const alpha = harness.pointer("oc_alpha");
    const beta = harness.pointer("oc_beta");
    assert.ok(alpha && beta);
    assert.notEqual(alpha, beta);
    assert.deepEqual(harness.stub.turnCalls.map((call) => call.conversationId).sort(), [alpha, beta].sort());
  });

  it("starts a fresh conversation on /new and swaps the chat pointer", async () => {
    // Arrange
    const harness = createHarness();
    await harness.deliver({ chatId: "oc_alpha", text: "旧上下文", providerEventId: "ev-1" });
    const first = harness.pointer("oc_alpha");

    // Act
    await harness.deliver({ chatId: "oc_alpha", text: "/new", providerEventId: "ev-2" });

    // Assert
    const second = harness.pointer("oc_alpha");
    assert.ok(first && second);
    assert.notEqual(first, second);
    assert.match(harness.sent.at(-1)?.text ?? "", /重置/u);
    assert.equal(new CopilotConversationLog(harness.db, harness.userId).listMessages(second).length, 0);
  });

  it("deduplicates provider retries by provider event id", async () => {
    // Arrange
    const harness = createHarness();

    // Act
    await harness.deliver({ chatId: "oc_alpha", text: "只跑一次", providerEventId: "ev-dup" });
    await harness.deliver({ chatId: "oc_alpha", text: "只跑一次", providerEventId: "ev-dup" });

    // Assert
    assert.equal(harness.stub.turnCalls.length, 1);
    assert.equal(harness.sent.length, 1);
  });

  it("refuses messages from a sender who did not open the chat channel", async () => {
    // Arrange
    const harness = createHarness();
    await harness.deliver({ chatId: "oc_alpha", text: "开场消息", providerEventId: "ev-1" });

    // Act
    await harness.deliver({ chatId: "oc_alpha", text: "以别人身份跑一轮", providerEventId: "ev-2", senderIdentity: "ou_intruder" });

    // Assert
    assert.equal(harness.stub.turnCalls.length, 1);
    assert.match(harness.sent.at(-1)?.text ?? "", /其他飞书用户/u);
  });

  it("refuses /approve from a sender who did not open the chat channel", async () => {
    // Arrange
    const harness = createHarness();
    harness.stub.setBehavior("awaiting_approval");
    await harness.deliver({ chatId: "oc_alpha", text: "执行一个操作", providerEventId: "ev-1" });

    // Act
    await harness.deliver({ chatId: "oc_alpha", text: "/approve", providerEventId: "ev-2", senderIdentity: "ou_intruder" });

    // Assert
    assert.equal(harness.stub.resumeCalls.length, 0);
    assert.match(harness.sent.at(-1)?.text ?? "", /其他飞书用户/u);
  });

  it("keeps group turn and approval ownership with the first sender", async () => {
    // Arrange
    const harness = createHarness();
    harness.stub.setBehavior("awaiting_approval");
    await harness.deliver({
      chatId: "oc_group_owner",
      chatType: "group",
      mentionedBot: true,
      text: "执行一个操作",
      providerEventId: "ev-group-owner",
      senderIdentity: "ou_owner_a"
    });

    // Act
    await harness.deliver({
      chatId: "oc_group_owner",
      chatType: "group",
      mentionedBot: true,
      text: "接管普通消息",
      providerEventId: "ev-group-member-message",
      senderIdentity: "ou_member_b"
    });
    const ownerConversationId = harness.pointer("oc_group_owner");
    await harness.deliver({
      chatId: "oc_group_owner",
      chatType: "group",
      mentionedBot: true,
      text: "/new",
      providerEventId: "ev-group-member-new",
      senderIdentity: "ou_member_b"
    });
    await harness.deliver({
      chatId: "oc_group_owner",
      chatType: "group",
      mentionedBot: true,
      text: "/approve",
      providerEventId: "ev-group-member-approve",
      senderIdentity: "ou_member_b"
    });

    // Assert
    assert.equal(harness.stub.turnCalls.length, 1);
    assert.equal(harness.stub.resumeCalls.length, 0);
    assert.equal(harness.owner("oc_group_owner"), "ou_owner_a");
    assert.equal(harness.pointer("oc_group_owner"), ownerConversationId);
    assert.match(harness.sent.at(-1)?.text ?? "", /其他飞书用户/u);
  });

  it("atomically claims the first group owner across production-shaped channel instances", async () => {
    // Arrange: production creates a fresh channel per inbound message. The
    // first channel pauses at an external reaction await while the second runs.
    const harness = createHarness();
    const reactionMessageIds: string[] = [];
    const releases: Array<() => void> = [];
    const reactions = {
      start: (messageId: string) => new Promise<{ reactionId: string | null }>((resolve) => {
        reactionMessageIds.push(messageId);
        releases.push(() => resolve({ reactionId: null }));
      }),
      stop: async () => undefined
    };
    const makeChannel = (transport: "webhook" | "long_connection") => createFeishuCopilotChannel({
      deps: harness.deps,
      buildAgentStack: harness.stub.factory,
      sendMessage: async ({ chatId, text }) => { harness.sent.push({ chatId, text }); },
      userId: harness.userId,
      providerAccountId: harness.providerAccount.id,
      transport,
      reactions
    });
    const ownerChannel = makeChannel("long_connection");
    const memberChannel = makeChannel("webhook");
    const ownerIngress: FeishuCopilotChannelIngress = {
      chatId: "oc_concurrent_group",
      chatType: "group",
      mentionedBot: true,
      messageId: "om_owner_a",
      text: "owner A first turn",
      providerEventId: "ev-owner-a",
      senderIdentity: "ou_owner_a"
    };
    const memberIngress: FeishuCopilotChannelIngress = {
      ...ownerIngress,
      messageId: "om_member_b",
      text: "member B racing turn",
      providerEventId: "ev-member-b",
      senderIdentity: "ou_member_b"
    };
    assert.equal(ownerChannel.admitMessage(ownerIngress), true);
    assert.equal(memberChannel.admitMessage(memberIngress), true);

    // Act
    const ownerProcessing = ownerChannel.processMessage(ownerIngress);
    await waitFor(() => releases.length >= 1);
    const memberProcessing = memberChannel.processMessage(memberIngress);
    await flushAsyncWork();
    for (const release of releases.splice(0)) release();
    await Promise.all([ownerProcessing, memberProcessing]);

    // Assert
    assert.deepEqual(reactionMessageIds, ["om_owner_a"]);
    assert.equal(harness.stub.turnCalls.length, 1);
    assert.equal(harness.stub.turnCalls[0]?.userText, "owner A first turn");
    assert.equal(harness.owner("oc_concurrent_group"), "ou_owner_a");
  });

  it("serializes the same chat across independently-created webhook and long-connection channels", async () => {
    const harness = createHarness();
    harness.stub.holdNextTurn();
    const makeChannel = (transport: "webhook" | "long_connection") => createFeishuCopilotChannel({
      deps: harness.deps,
      buildAgentStack: harness.stub.factory,
      sendMessage: async ({ chatId, text }) => { harness.sent.push({ chatId, text }); },
      userId: harness.userId,
      providerAccountId: harness.providerAccount.id,
      transport
    });
    const first = makeChannel("long_connection");
    const second = makeChannel("webhook");
    const firstIngress: FeishuCopilotChannelIngress = {
      chatId: "oc_cross_transport_queue",
      text: "first",
      providerEventId: "ev-cross-first",
      senderIdentity: "ou_owner"
    };
    const secondIngress: FeishuCopilotChannelIngress = {
      ...firstIngress,
      text: "second",
      providerEventId: "ev-cross-second"
    };
    assert.equal(first.admitMessage(firstIngress), true);
    assert.equal(second.admitMessage(secondIngress), true);

    const firstProcessing = first.processMessage(firstIngress);
    await waitFor(() => harness.stub.turnCalls.length === 1);
    const secondProcessing = second.processMessage(secondIngress);
    await flushAsyncWork();

    assert.equal(harness.stub.turnCalls.length, 1, "second channel must share the first channel's queue");
    harness.stub.releaseTurn();
    await Promise.all([firstProcessing, secondProcessing]);
    assert.deepEqual(harness.stub.turnCalls.map((call) => call.userText), ["first", "second"]);
  });

  it("keeps shutdown drain pending past its warning interval until an active turn settles", async () => {
    const harness = createHarness();
    harness.stub.holdNextTurn();
    const ingress: FeishuCopilotChannelIngress = {
      chatId: "oc_slow_shutdown_drain",
      text: "slow turn",
      providerEventId: "ev-slow-shutdown-drain",
      senderIdentity: "ou_owner"
    };
    assert.equal(harness.channel.admitMessage(ingress), true);
    const processing = harness.channel.processMessage(ingress);
    await waitFor(() => harness.stub.turnCalls.length === 1);

    let drainSettled = false;
    const draining = drainFeishuCopilotChatQueues(harness.db, 10).then((result) => {
      drainSettled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const prematurelySettled = drainSettled;

    harness.stub.releaseTurn();
    await processing;
    const drained = await draining;

    assert.equal(prematurelySettled, false, "warning interval must not release the shutdown barrier");
    assert.equal(drained, true);
    harness.db.close();
  });

  it("rejects new message and card admission after drain starts without writing the ingress ledger", async () => {
    const harness = createHarness();
    const ledgerCount = (): number => {
      const row = harness.db.prepare(
        "SELECT COUNT(*) AS count FROM portfolio_feishu_ingress_events"
      ).get() as { count: number };
      return row.count;
    };

    await drainFeishuCopilotChatQueues(harness.db, 10);
    const messageAdmitted = harness.channel.admitMessage({
      chatId: "oc_after_drain",
      text: "must not enter",
      providerEventId: "ev-message-after-drain",
      senderIdentity: "ou_owner"
    });
    const actionAdmitted = harness.channel.admitCardAction({
      chatId: "oc_after_drain",
      senderIdentity: "ou_owner",
      providerEventId: "ev-card-after-drain",
      value: { copilot_decision: "approve" }
    });

    assert.equal(messageAdmitted, false);
    assert.equal(actionAdmitted, false);
    assert.equal(ledgerCount(), 0);
    harness.db.close();
  });

  it("fails closed for privileged commands on nullable legacy owner rows", async () => {
    for (const [index, command] of ["/approve", "/reject"].entries()) {
      // Arrange
      const harness = createHarness();
      const chatId = `oc_legacy_null_command_${index}`;
      seedNullableOwnerPending(harness, chatId);

      // Act
      await harness.deliver({
        chatId,
        chatType: "group",
        mentionedBot: true,
        text: command,
        providerEventId: `ev-legacy-null-command-${index}`,
        senderIdentity: "ou_arbitrary_member"
      });

      // Assert
      assert.equal(harness.stub.resumeCalls.length, 0);
      assert.equal(harness.owner(chatId), undefined);
      assert.match(harness.sent.at(-1)?.text ?? "", /其他飞书用户/u);
    }
  });

  it("lets an ordinary group message claim a nullable legacy owner row", async () => {
    // Arrange
    const harness = createHarness();
    const chatId = "oc_legacy_null_ordinary";
    seedNullableOwnerPending(harness, chatId);
    const legacyConversationId = harness.pointer(chatId);

    // Act
    await harness.deliver({
      chatId,
      chatType: "group",
      mentionedBot: true,
      text: "由首位普通消息发送者建立 owner",
      providerEventId: "ev-legacy-null-ordinary",
      senderIdentity: "ou_first_ordinary_sender"
    });

    // Assert
    assert.equal(harness.stub.turnCalls.length, 1);
    assert.equal(harness.owner(chatId), "ou_first_ordinary_sender");
    assert.equal(harness.pointer(chatId), legacyConversationId);
  });

  it("fails closed for card decisions on nullable legacy owner rows", async () => {
    // Arrange
    const harness = createHarness();
    const chatId = "oc_legacy_null_card";
    const pending = seedNullableOwnerPending(harness, chatId);
    const value = {
      copilot_decision: "approve",
      action_id: pending.actionId,
      run_id: pending.runId,
      tool: "legacy_pending_tool"
    };

    // Act
    assert.equal(harness.channel.admitCardAction({
      chatId,
      senderIdentity: "ou_arbitrary_member",
      providerEventId: "ev-legacy-null-card",
      value
    }), true);
    await harness.channel.handleCardAction({
      chatId,
      senderIdentity: "ou_arbitrary_member",
      value
    });

    // Assert
    assert.equal(harness.stub.resumeCalls.length, 0);
    assert.equal(harness.owner(chatId), undefined);
    assert.match(harness.sent.at(-1)?.text ?? "", /其他飞书用户/u);
  });

  it("surfaces pending approval and resumes the run on /approve", async () => {
    // Arrange
    const harness = createHarness();
    harness.stub.setBehavior("awaiting_approval");

    // Act
    await harness.deliver({ chatId: "oc_alpha", text: "执行一个操作", providerEventId: "ev-1" });
    const approvalPrompt = harness.sent.at(-1)?.text ?? "";
    await harness.deliver({ chatId: "oc_alpha", text: "/approve", providerEventId: "ev-2" });

    // Assert
    assert.match(approvalPrompt, /stub_operate_tool/u);
    assert.match(approvalPrompt, /\/approve/u);
    assert.equal(harness.stub.resumeCalls.length, 1);
    assert.equal(harness.stub.resumeCalls[0]?.approved, true);
    assert.match(harness.sent.at(-1)?.text ?? "", /执行完成 stub_operate_tool/u);
  });

  it("rejects the pending action on /reject", async () => {
    // Arrange
    const harness = createHarness();
    harness.stub.setBehavior("awaiting_approval");
    await harness.deliver({ chatId: "oc_alpha", text: "执行一个操作", providerEventId: "ev-1" });

    // Act
    await harness.deliver({ chatId: "oc_alpha", text: "/reject", providerEventId: "ev-2" });

    // Assert
    assert.equal(harness.stub.resumeCalls[0]?.approved, false);
    assert.match(harness.sent.at(-1)?.text ?? "", /已拒绝/u);
  });

  it("answers /help with the command list", async () => {
    // Arrange
    const harness = createHarness();

    // Act
    await harness.deliver({ chatId: "oc_alpha", text: "/help", providerEventId: "ev-1" });

    // Assert
    assert.match(harness.sent.at(-1)?.text ?? "", /\/new/u);
    assert.equal(harness.stub.turnCalls.length, 0);
  });

  it("replies with a redacted reason when the Copilot run fails", async () => {
    // Arrange
    const harness = createHarness();
    harness.stub.setBehavior("fails");

    // Act
    await harness.deliver({ chatId: "oc_alpha", text: "触发失败", providerEventId: "ev-1" });

    // Assert
    const failureReply = harness.sent.at(-1)?.text ?? "";
    assert.match(failureReply, /Copilot 运行失败/u);
    assert.doesNotMatch(failureReply, /sk-test-api-key/u);
  });

  it("routes turns through the dsh BFF when wired (M3)", async () => {
    // Arrange
    const harness = createDshHarness();

    // Act
    await harness.deliver({ chatId: "oc_dsh", text: "你好", providerEventId: "ev-1" });

    // Assert: the BFF drove the turn; the orchestrator was bypassed.
    assert.equal(harness.dsh.sendCalls.length, 1);
    assert.equal(harness.dsh.sendCalls[0]?.content, "你好");
    assert.equal(harness.stub.turnCalls.length, 0);
    assert.match(harness.sent.at(-1)?.text ?? "", new RegExp(defaultReply));
  });

  it("feishu /approve flows through the dsh decide path (M3)", async () => {
    // Arrange
    const harness = createDshHarness("awaiting_approval");

    // Act
    await harness.deliver({ chatId: "oc_dsh", text: "执行一个操作", providerEventId: "ev-1" });
    const approvalPrompt = harness.sent.at(-1)?.text ?? "";
    await harness.deliver({ chatId: "oc_dsh", text: "/approve", providerEventId: "ev-2" });

    // Assert
    assert.match(approvalPrompt, /stub_operate_tool/u);
    assert.equal(harness.dsh.decideCalls.length, 1);
    assert.equal(harness.dsh.decideCalls[0]?.approved, true);
    assert.equal(harness.stub.resumeCalls.length, 0, "orchestrator resume is bypassed");
    assert.match(harness.sent.at(-1)?.text ?? "", /执行完成 stub_operate_tool/u);
    assert.match(harness.sent.at(-1)?.text ?? "", /\{"ok":true\}/u);
  });

  it("reports a failed DSH approval outcome without claiming completion", async () => {
    const harness = createDshHarness("awaiting_approval", "failed", 1);
    await harness.deliver({ chatId: "oc_dsh_failed", text: "执行一个操作", providerEventId: "ev-failed-1" });

    await harness.deliver({ chatId: "oc_dsh_failed", text: "/approve", providerEventId: "ev-failed-2" });

    const reply = harness.sent.at(-1)?.text ?? "";
    assert.match(reply, /执行失败 stub_operate_tool/u);
    assert.doesNotMatch(reply, /执行完成|已批准并执行|sk-secret123/u);
  });

  it("reports a still-running DSH approval outcome after the bounded timeout", async () => {
    const harness = createDshHarness("awaiting_approval", "running", 1);
    await harness.deliver({ chatId: "oc_dsh_running", text: "执行一个操作", providerEventId: "ev-running-1" });

    await harness.deliver({ chatId: "oc_dsh_running", text: "/approve", providerEventId: "ev-running-2" });

    const reply = harness.sent.at(-1)?.text ?? "";
    assert.match(reply, /仍在执行/u);
    assert.doesNotMatch(reply, /执行完成|已批准并执行/u);
  });

  it("does not let another group member invoke the dsh turn or decision path", async () => {
    // Arrange
    const harness = createDshHarness("awaiting_approval");
    await harness.deliver({
      chatId: "oc_dsh_group_owner",
      chatType: "group",
      mentionedBot: true,
      text: "执行一个操作",
      providerEventId: "ev-dsh-group-owner",
      senderIdentity: "ou_owner_a"
    });

    // Act
    await harness.deliver({
      chatId: "oc_dsh_group_owner",
      chatType: "group",
      mentionedBot: true,
      text: "接管 dsh turn",
      providerEventId: "ev-dsh-group-member-message",
      senderIdentity: "ou_member_b"
    });
    await harness.deliver({
      chatId: "oc_dsh_group_owner",
      chatType: "group",
      mentionedBot: true,
      text: "/approve",
      providerEventId: "ev-dsh-group-member-approve",
      senderIdentity: "ou_member_b"
    });

    // Assert
    assert.equal(harness.dsh.sendCalls.length, 1);
    assert.equal(harness.dsh.decideCalls.length, 0);
    assert.equal(harness.owner("oc_dsh_group_owner"), "ou_owner_a");
    assert.match(harness.sent.at(-1)?.text ?? "", /其他飞书用户/u);
  });
});

describe("Feishu ingress routing", () => {
  const messagePayload = (
    eventId: string,
    chatId: string,
    text: string,
    openId = "ou_owner",
    options: { chatType?: "p2p" | "group"; mentions?: string[] } = {}
  ) => ({
    header: { event_id: eventId, event_type: "im.message.receive_v1" },
    event: {
      message: {
        message_id: `om_${eventId}`,
        chat_id: chatId,
        chat_type: options.chatType ?? "p2p",
        message_type: "text",
        content: JSON.stringify({ text }),
        mentions: (options.mentions ?? []).map((mentionedOpenId) => ({ id: { open_id: mentionedOpenId } }))
      },
      sender: { sender_id: { open_id: openId } }
    }
  });

  it("routes p2p messages without a mention into the Copilot channel", async () => {
    // Arrange
    const harness = createHarness();
    const fakeSdk = {
      createRestClient: () => ({
        im: { message: {
          create: async () => ({ code: 0, data: { message_id: "om_stub" } }),
          patch: async () => ({ code: 0 })
        } }
      })
    } as unknown as FeishuSdkFactory;
    const handlers = createFeishuSdkHandlers({
      db: harness.db,
      masterKey,
      userId: harness.userId,
      resolveAgentDeps: () => harness.deps,
      buildAgentStack: harness.stub.factory,
      sdkFactory: fakeSdk
    });

    // Act
    const response = handlers.onMessage(messagePayload("ev-h1", "oc_alpha", "你好 Copilot"));
    await waitFor(() => harness.stub.turnCalls.length === 1);

    // Assert
    assert.equal(response, undefined);
    assert.equal(harness.stub.turnCalls[0]?.userText, "你好 Copilot");
    assert.ok(harness.pointer("oc_alpha"));
  });

  it("requires an exact bot mention for group turns and deduplicates provider retries", async () => {
    // Arrange
    const harness = createHarness();
    const sdkCreates: unknown[] = [];
    const sdkPatches: unknown[] = [];
    const fakeSdk = {
      createRestClient: () => ({
        im: { message: {
          create: async (input: unknown) => {
            sdkCreates.push(input);
            return { code: 0, data: { message_id: "om_stub" } };
          },
          patch: async (input: unknown) => {
            sdkPatches.push(input);
            return { code: 0 };
          }
        } }
      })
    } as unknown as FeishuSdkFactory;
    const handlers = createFeishuSdkHandlers({
      db: harness.db,
      masterKey,
      userId: harness.userId,
      resolveAgentDeps: () => harness.deps,
      buildAgentStack: harness.stub.factory,
      sdkFactory: fakeSdk
    });
    const context = { botOpenId: "ou_exact_bot" };

    // Act: no mention and a mention of another user must stay silent.
    handlers.onMessage(messagePayload(
      "ev-group-none",
      "oc_group",
      "普通群消息",
      "ou_owner",
      { chatType: "group" }
    ), context);
    handlers.onMessage(messagePayload(
      "ev-group-other",
      "oc_group",
      "@其他人",
      "ou_owner",
      { chatType: "group", mentions: ["ou_someone_else"] }
    ), context);
    await flushAsyncWork();

    // Assert
    assert.equal(harness.stub.turnCalls.length, 0);
    assert.equal(sdkCreates.length, 0);
    assert.equal(sdkPatches.length, 0);

    // Act: exact bot open_id starts one turn; retrying the same event does not.
    const mentioned = messagePayload(
      "ev-group-bot",
      "oc_group",
      "@机器人 帮我检查项目",
      "ou_owner",
      { chatType: "group", mentions: ["ou_exact_bot"] }
    );
    handlers.onMessage(mentioned, context);
    await waitFor(() =>
      harness.stub.turnCalls.length === 1
      && sdkCreates.length === 1
      && sdkPatches.length === 1
    );
    handlers.onMessage(mentioned, context);
    await flushAsyncWork();

    // Assert
    assert.equal(harness.stub.turnCalls.length, 1);
    assert.equal(sdkCreates.length, 1);
    assert.equal(sdkPatches.length, 1);
  });

  it("fails closed for webhook group messages without bot mention metadata", async () => {
    // Arrange
    const harness = createHarness();
    const registry = new PortfolioFeishuRegistryRepository(harness.db);

    // Act: the public webhook path knows chat_type but cannot currently prove
    // the bot's exact open_id mention, so mentionedBot remains undefined.
    const routed = routeVerifiedFeishuIngress({
      db: harness.db,
      masterKey,
      userId: harness.userId,
      registry,
      selector: createPortfolioIngressSelector(harness.db, registry),
      event: {
        provider: "feishu",
        providerAccountId: "cli_copilot_test",
        providerEventId: "ev-webhook-group-unknown-mention",
        transport: "webhook",
        signatureVerified: true,
        externalIdentity: "ou_owner",
        conversationId: "oc_webhook_group",
        eventType: "message",
        safeEventMetadata: { source: "webhook", eventType: "message" }
      },
      kind: "message",
      text: "未证明精确 @bot 的群消息",
      copilotMeta: { messageId: "om_webhook_group", chatType: "group" },
      copilotChannel: harness.channel
    });
    await flushAsyncWork();

    // Assert
    assert.equal(routed, "copilot");
    assert.equal(harness.stub.turnCalls.length, 0);
    assert.equal(harness.pointer("oc_webhook_group"), undefined);
  });

  it("keeps Portfolio-bound chats off the Copilot channel", async () => {
    // Arrange
    const harness = createHarness();
    new PortfolioFeishuChannelRepository(harness.db, harness.userId).createBinding({
      provider: "feishu",
      providerAccountId: harness.providerAccount.id,
      externalIdentity: "ou_owner",
      conversationId: "oc_bound",
      isOwner: true
    });
    let copilotCalled = false;
    const copilotChannel = {
      admitMessage: () => {
        copilotCalled = true;
        return true;
      },
      processMessage: async () => {
        copilotCalled = true;
      }
    };
    const registry = new PortfolioFeishuRegistryRepository(harness.db);

    // Act: the bound chat stays on the Portfolio flow regardless of whether
    // requirement capture itself succeeds; the routing decision is what is asserted.
    let routed: string | undefined;
    try {
      routed = routeVerifiedFeishuIngress({
        db: harness.db,
        masterKey,
        userId: harness.userId,
        registry,
        selector: createPortfolioIngressSelector(harness.db, registry),
        event: {
          provider: "feishu",
          providerAccountId: "cli_copilot_test",
          providerEventId: "ev-bound-1",
          transport: "webhook",
          signatureVerified: true,
          externalIdentity: "ou_owner",
          conversationId: "oc_bound",
          eventType: "message",
          safeEventMetadata: { source: "webhook", eventType: "message" }
        },
        kind: "message",
        text: "需求描述",
        copilotChannel
      });
    } catch {
      // Portfolio capture may reject the payload; routing already happened.
    }

    // Assert
    assert.equal(copilotCalled, false);
    assert.equal(routed === "portfolio", true);
    assert.equal(harness.pointer("oc_bound"), undefined);
  });

  it("logs only a fixed safe code when background Copilot processing fails", async () => {
    const harness = createHarness();
    const registry = new PortfolioFeishuRegistryRepository(harness.db);
    const captured: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => { captured.push(args); };
    try {
      const routed = routeVerifiedFeishuIngress({
        db: harness.db,
        masterKey,
        userId: harness.userId,
        registry,
        selector: createPortfolioIngressSelector(harness.db, registry),
        event: {
          provider: "feishu",
          providerAccountId: "cli_copilot_test",
          providerEventId: "ev-background-failure",
          transport: "long_connection",
          signatureVerified: true,
          externalIdentity: "ou_owner",
          conversationId: "oc_sensitive_chat_id",
          eventType: "message",
          safeEventMetadata: { source: "test", eventType: "message" }
        },
        kind: "message",
        text: "hello",
        copilotChannel: {
          admitMessage: () => true,
          processMessage: async () => { throw new Error("super-secret-runtime-detail"); },
          admitCardAction: () => false,
          handleCardAction: async () => undefined
        }
      });
      assert.equal(routed, "copilot");
      await flushAsyncWork();
    } finally {
      console.error = originalError;
    }

    const logged = JSON.stringify(captured, (_key, value) =>
      value instanceof Error ? { message: value.message } : value
    );
    assert.match(logged, /FEISHU_COPILOT_PROCESS_FAILED/u);
    assert.match(logged, /long_connection/u);
    assert.doesNotMatch(logged, /super-secret-runtime-detail|oc_sensitive_chat_id/u);
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor timeout");
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}
