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
import { createFeishuCopilotChannel, type FeishuCopilotChannelIngress } from "../src/services/integrations/feishu-copilot-channel.js";
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

  const factory = (_deps: AgentStackDeps, userId: string) => {
    const log = new CopilotConversationLog(db, userId);
    return {
      log,
      memory: {},
      toolRegistry: { tools: new Map() },
      orchestrator: {
        async runTurn(input: { userId: string; conversationId: string; userText: string }): Promise<string> {
          turnCalls.push(input);
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
    conversation(id: string | undefined) {
      return id ? new CopilotConversationLog(db, userId).getConversation(id) : undefined;
    }
  };
}

/**
 * dsh-path harness (M3): same stub stack, plus a stub dshBff on the deps. The
 * BFF stub mirrors the orchestrator stub's projection writes so the channel's
 * reply logic (pending card, tool result lookup) observes the same rows.
 */
function createDshHarness(behavior: "completed" | "awaiting_approval" = "completed") {
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
        if (input.approved) {
          log.appendMessage(run.conversationId, { role: "tool", kind: "tool_result", content: "{\"ok\":true}", toolName: action.tool });
        }
        log.updateRun(run.id, { status: "completed", completedAt: new Date() });
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
    transport: "long_connection"
  });
  const deliver = async (ingress: Omit<FeishuCopilotChannelIngress, "senderIdentity">) => {
    const full: FeishuCopilotChannelIngress = { senderIdentity: "ou_owner", ...ingress };
    if (!channel.admitMessage(full)) return "duplicate";
    await channel.processMessage(full);
    return "admitted";
  };
  return { db, userId, sent, stub, deliver, dsh: { sendCalls, decideCalls } };
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
    assert.match(harness.sent.at(-1)?.text ?? "", /已批准并执行 stub_operate_tool/u);
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
    assert.match(harness.sent.at(-1)?.text ?? "", /已批准并执行 stub_operate_tool/u);
  });
});

describe("Feishu ingress routing", () => {
  const messagePayload = (eventId: string, chatId: string, text: string, openId = "ou_owner") => ({
    header: { event_id: eventId, event_type: "im.message.receive_v1" },
    event: {
      message: { message_id: `om_${eventId}`, chat_id: chatId, message_type: "text", content: JSON.stringify({ text }) },
      sender: { sender_id: { open_id: openId } }
    }
  });

  it("routes unbound long-connection messages into the Copilot channel", async () => {
    // Arrange
    const harness = createHarness();
    const fakeSdk = {
      createRestClient: () => ({
        im: { message: { create: async () => ({ data: { message_id: "om_stub" } }) } }
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
});

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor timeout");
    await new Promise((resolve) => setImmediate(resolve));
  }
}
