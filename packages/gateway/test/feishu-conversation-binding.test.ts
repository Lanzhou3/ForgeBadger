import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { CopilotRepository } from "../src/db/repositories/copilot-repository.js";
import { FeishuChannelRepository } from "../src/db/repositories/feishu-channel-repository.js";
import { FeishuIntegrationRepository } from "../src/db/repositories/feishu-integration-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import {
  FeishuConversationBindingService,
  FeishuCopilotInboundDispatcher
} from "../src/services/integrations/feishu-conversation-binding.js";

const masterKey = "0123456789abcdef0123456789abcdef";
let testAccountId = "";

describe("FeishuConversationBindingService", () => {
  let db: Database.Database;
  let userId: string;
  let accountId: string;
  let service: FeishuConversationBindingService;
  let channelRepo: FeishuChannelRepository;
  let copilotRepo: CopilotRepository;

  beforeEach(() => {
    db = createTestDb();
    userId = new UserRepository(db).create("binding@example.com", "hash").id;
    channelRepo = new FeishuChannelRepository(db, userId, masterKey);
    accountId = channelRepo.upsertAccount({
      appId: "cli_binding",
      appSecret: "app-secret",
      enabled: false
    }).id;
    testAccountId = accountId;
    const integrationRepo = new FeishuIntegrationRepository(db, userId);
    integrationRepo.upsertConfig({
      enabled: true,
      identityMode: "bot",
      allowedChatIds: ["oc_private", "oc_group"]
    });
    integrationRepo.replaceUserMappings([{
      feishuUserId: "ou_user",
      openforgeUserId: userId,
      displayName: "Owner"
    }]);
    copilotRepo = new CopilotRepository(db, userId);
    service = new FeishuConversationBindingService({
      userId,
      channelRepository: channelRepo,
      integrationRepository: integrationRepo,
      copilotRepository: copilotRepo
    });
  });

  it("reuses one private-chat conversation", () => {
    const first = service.resolve(message({ chatId: "oc_private", chatType: "p2p" }));
    const second = service.resolve(message({ chatId: "oc_private", chatType: "p2p" }));

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (first.ok && second.ok) assert.equal(first.binding.conversationId, second.binding.conversationId);
  });

  it("replaces a soft-deleted bound conversation while preserving its scope", () => {
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge-binding-recovery",
      aiTool: "claude"
    });
    const first = service.resolve(message({ chatId: "oc_private", chatType: "p2p" }));
    assert.equal(first.ok, true);
    if (!first.ok) return;
    service.bindScope(first.binding.id, { type: "project", id: project.id });
    copilotRepo.deleteConversation(first.binding.conversationId);

    const recovered = service.resolve(message({ chatId: "oc_private", chatType: "p2p" }));

    assert.equal(recovered.ok, true);
    if (!recovered.ok) return;
    assert.notEqual(recovered.binding.conversationId, first.binding.conversationId);
    assert.deepEqual(recovered.binding.scope, { type: "project", id: project.id });
    assert.equal(copilotRepo.getConversation(recovered.binding.conversationId)?.status, "active");
  });

  it("isolates group threads and enforces mention or existing-thread context", () => {
    const denied = service.resolve(message({ chatId: "oc_group", chatType: "group", mentionedBot: false }));
    const first = service.resolve(message({ chatId: "oc_group", chatType: "group", threadId: "thread-a" }));
    const continuation = service.resolve(message({
      chatId: "oc_group",
      chatType: "group",
      threadId: "thread-a",
      mentionedBot: false
    }));
    const second = service.resolve(message({ chatId: "oc_group", chatType: "group", threadId: "thread-b" }));

    assert.deepEqual(denied, { ok: false, reasonCode: "feishu_group_mention_required" });
    assert.equal(first.ok && continuation.ok
      ? first.binding.conversationId === continuation.binding.conversationId
      : false, true);
    assert.equal(first.ok && second.ok
      ? first.binding.conversationId !== second.binding.conversationId
      : false, true);
  });

  it("persists explicit project and workspace scopes without cross-tenant access", () => {
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });
    const resolved = service.resolve(message({ chatId: "oc_private", chatType: "p2p" }));
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;

    const projectBinding = service.bindScope(resolved.binding.id, {
      type: "project",
      id: project.id
    });
    const workspaceBinding = service.bindScope(resolved.binding.id, { type: "workspace" });
    assert.deepEqual(projectBinding.scope, { type: "project", id: project.id });
    assert.deepEqual(workspaceBinding.scope, { type: "workspace" });

    const otherUserId = new UserRepository(db).create("other-binding@example.com", "hash").id;
    const otherRepo = new FeishuChannelRepository(db, otherUserId, masterKey);
    assert.equal(otherRepo.getConversationBinding(resolved.binding.id), undefined);
  });

  it("dispatches subsequent messages into the existing Copilot conversation", async () => {
    let runNumber = 0;
    const conversationContexts: Array<string | undefined> = [];
    const dispatcher = new FeishuCopilotInboundDispatcher({
      userId,
      bindingService: service,
      copilotRepository: copilotRepo,
      runText: async (input) => {
        conversationContexts.push(input.conversationContext);
        runNumber += 1;
        const run = copilotRepo.createRun({
          source: "feishu",
          goal: `Feishu turn ${runNumber}`,
          status: "running"
        });
        copilotRepo.updateRun(run.id, { status: "completed", completedAt: Date.now() });
        return {
          runId: run.id,
          assistantMessages: [`reply ${runNumber}`]
        };
      }
    });

    const first = await dispatcher.dispatch(message({ chatId: "oc_private", chatType: "p2p", text: "remember alpha" }));
    const second = await dispatcher.dispatch(message({ chatId: "oc_private", chatType: "p2p", text: "what did I say" }));

    assert.equal(first.ok && second.ok ? first.conversationId === second.conversationId : false, true);
    assert.equal(copilotRepo.listConversations().length, 1);
    assert.equal(copilotRepo.listConversationMessages(first.ok ? first.conversationId : "").length, 4);
    assert.deepEqual(conversationContexts, [undefined, "user: remember alpha\nassistant: reply 1"]);
  });

  it("wraps an authorized Copilot turn with transient receipt feedback", async () => {
    const events: string[] = [];
    const dispatcher = new FeishuCopilotInboundDispatcher({
      userId,
      bindingService: service,
      copilotRepository: copilotRepo,
      reactionLifecycle: {
        start: async (messageId) => {
          events.push(`reaction:add:${messageId}`);
          return { messageId, reactionId: "reaction-1" };
        },
        stop: async () => { events.push("reaction:remove"); },
      },
      afterPersist: async () => { events.push("outbox:queued"); },
      runText: async () => {
        events.push("copilot");
        const run = copilotRepo.createRun({ source: "feishu", goal: "reply", status: "completed" });
        return { runId: run.id, assistantMessages: ["reply"] };
      },
    });

    const result = await dispatcher.dispatch(message({ chatId: "oc_private", chatType: "p2p" }));

    assert.equal(result.ok, true);
    assert.deepEqual(events, [
      "reaction:add:msg-oc_private-root",
      "copilot",
      "outbox:queued",
      "reaction:remove",
    ]);
  });

  it("recovers one adopted run after a post-run failure without rerunning or reacting again", async () => {
    const events: string[] = [];
    let runCount = 0;
    let adopted: { runId: string; assistantMessages: string[] } | undefined;
    let persistAttempts = 0;
    const dispatcher = new FeishuCopilotInboundDispatcher({
      userId,
      bindingService: service,
      copilotRepository: copilotRepo,
      recoverRun: () => adopted,
      reactionLifecycle: {
        start: async (messageId) => {
          events.push(`reaction:add:${messageId}`);
          return { messageId, reactionId: "reaction-1" };
        },
        stop: async () => { events.push("reaction:remove"); },
      },
      afterPersist: async () => {
        persistAttempts += 1;
        if (persistAttempts === 1) throw new Error("outbox temporarily unavailable");
        events.push("outbox:queued");
      },
      runText: async () => {
        runCount += 1;
        const run = copilotRepo.createRun({
          source: "feishu",
          sourceIdempotencyKey: "account:msg-oc_private-root",
          goal: "reply",
          status: "completed"
        });
        copilotRepo.addEvent(run.id, { type: "assistant_message", message: "reply" });
        adopted = { runId: run.id, assistantMessages: ["reply"] };
        return adopted;
      },
    });
    const event = message({ chatId: "oc_private", chatType: "p2p" });

    await assert.rejects(() => dispatcher.dispatch(event), /outbox temporarily unavailable/);
    const recovered = await dispatcher.dispatch(event);

    assert.equal(recovered.ok, true);
    assert.equal(runCount, 1);
    assert.equal(persistAttempts, 2);
    assert.equal(events.filter((entry) => entry.startsWith("reaction:add:")).length, 1);
    assert.equal(events.filter((entry) => entry === "reaction:remove").length, 1);
    const conversationId = recovered.ok ? recovered.conversationId : "";
    assert.deepEqual(
      copilotRepo.listConversationMessages(conversationId).map((entry) => entry.role),
      ["user", "assistant"]
    );
  });

  it("does not acknowledge a message rejected by the conversation policy", async () => {
    let reactionCount = 0;
    const dispatcher = new FeishuCopilotInboundDispatcher({
      userId,
      bindingService: service,
      copilotRepository: copilotRepo,
      reactionLifecycle: {
        start: async (messageId) => {
          reactionCount += 1;
          return { messageId, reactionId: "reaction-1" };
        },
        stop: async () => undefined,
      },
      runText: async () => { throw new Error("must not run"); },
    });

    const result = await dispatcher.dispatch(message({
      chatId: "oc_group",
      chatType: "group",
      mentionedBot: false,
    }));

    assert.deepEqual(result, { ok: false, reasonCode: "feishu_group_mention_required" });
    assert.equal(reactionCount, 0);
  });

  it("handles a pending Feishu decision before reaction or a second model run", async () => {
    let reactions = 0;
    let modelRuns = 0;
    const dispatcher = new FeishuCopilotInboundDispatcher({
      userId,
      bindingService: service,
      copilotRepository: copilotRepo,
      reactionLifecycle: {
        start: async () => {
          reactions += 1;
          return { messageId: "message-1", reactionId: "reaction-1" };
        },
        stop: async () => undefined
      },
      handlePendingDecision: async () => ({ runId: "adopted-run" }),
      runText: async () => {
        modelRuns += 1;
        return { runId: "new-run", assistantMessages: [] };
      }
    });

    const result = await dispatcher.dispatch(message({ chatId: "oc_private", chatType: "p2p", text: "可以" }));

    assert.equal(result.ok, true);
    assert.equal(result.ok ? result.runId : "", "adopted-run");
    assert.equal(reactions, 0);
    assert.equal(modelRuns, 0);
  });
});

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
  return db;
}

function message(overrides: Record<string, unknown> = {}) {
  const chatId = String(overrides.chatId ?? "oc_private");
  const threadId = typeof overrides.threadId === "string" ? overrides.threadId : undefined;
  return {
    kind: "message" as const,
    accountId: testAccountId,
    eventId: `evt-${chatId}-${threadId ?? "root"}`,
    messageId: `msg-${chatId}-${threadId ?? "root"}`,
    chatId,
    chatType: String(overrides.chatType ?? "p2p"),
    ...(threadId ? { threadId } : {}),
    senderOpenId: "ou_user",
    text: String(overrides.text ?? "continue managing the project"),
    mentionedBot: overrides.mentionedBot !== false,
    laneKey: `${chatId}:${threadId ?? "root"}`
  };
}
