import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { CopilotRepository } from "../src/db/repositories/copilot-repository.js";
import { FeishuChannelRepository } from "../src/db/repositories/feishu-channel-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { FeishuPendingActionBridge } from "../src/services/integrations/feishu-pending-action-bridge.js";
import type { FeishuInboundCardAction, FeishuInboundMessage } from "../src/services/integrations/feishu-event-normalizer.js";

const masterKey = "0123456789abcdef0123456789abcdef";

describe("FeishuPendingActionBridge", () => {
  let db: Database.Database;
  let userId: string;
  let channelRepo: FeishuChannelRepository;
  let copilotRepo: CopilotRepository;
  let accountId: string;
  let conversationId: string;
  let runId: string;
  let actionId: string;
  let executeCount: number;
  let bridge: FeishuPendingActionBridge;

  beforeEach(() => {
    db = createTestDb();
    userId = new UserRepository(db).create("feishu-approval@example.com", "hash").id;
    channelRepo = new FeishuChannelRepository(db, userId, masterKey);
    accountId = channelRepo.upsertAccount({ appId: "cli_approval", appSecret: "secret", enabled: false }).id;
    copilotRepo = new CopilotRepository(db, userId);
    const conversation = copilotRepo.createConversation({ title: "Feishu", source: "feishu" });
    conversationId = conversation.id;
    const run = copilotRepo.createRun({ status: "waiting_for_approval", source: "feishu", goal: "continue work" });
    runId = run.id;
    copilotRepo.persistConversationTurn(conversation.id, {
      runId,
      userContent: "continue",
      assistantMessages: ["Waiting for approval"]
    });
    actionId = copilotRepo.createPendingAction(runId, {
      type: "openforge.propose_session_input",
      input: { sessionId: "session-1", input: "继续", submit: true }
    }).id;
    executeCount = 0;
    bridge = new FeishuPendingActionBridge({
      userId,
      channelRepository: channelRepo,
      copilotRepository: copilotRepo,
      executePendingAction: async () => {
        executeCount += 1;
        return { sessionId: "session-1", submitted: true };
      },
      continueRun: async () => ({
        runId,
        status: "completed",
        assistantMessages: ["已发送到 session-1，会话已继续工作。"]
      }),
      describePendingAction: () => [
        "**项目** OpenForge",
        "**会话** OpenCode · opencode · session-1",
        "**本次操作** 确认当前高亮选项（Enter）",
        "",
        "此审批仅作用于当前这一项权限请求；后续新权限请求会再次单独审批。"
      ].join("\n")
    });
  });

  it("creates an opaque approval card and executes one valid callback", async () => {
    const parts = bridge.createApprovalParts(message(), runId);
    const recoveredParts = bridge.createApprovalParts(message(), runId);
    assert.equal(parts.length, 1);
    assert.equal(parts[0]?.type, "card");
    const actionIds = readCardActionIds(parts[0]);
    assert.equal(actionIds.length, 2);
    assert.deepEqual(readCardActionIds(recoveredParts[0]), actionIds);
    const cardCount = db.prepare("SELECT count(*) AS total FROM feishu_card_actions").get() as { total: number };
    assert.equal(cardCount.total, 2);
    assert.match(JSON.stringify(parts), /OpenForge|OpenCode|session-1|仅作用于当前/);
    assert.doesNotMatch(JSON.stringify(parts), /继续/);

    const result = await bridge.handleCardAction(cardAction(actionIds[0]!));

    assert.equal(result.handled, true);
    assert.equal(result.decision, "approved");
    assert.equal(executeCount, 1);
    assert.equal(copilotRepo.getPendingAction(actionId)?.status, "approved");
    assert.equal(result.parts[0]?.type, "text");
    assert.match(result.parts[0]?.type === "text" ? result.parts[0].content : "", /本次审批已执行/);
    assert.match(result.parts[0]?.type === "text" ? result.parts[0].content : "", /已发送到 session-1/);
    await assert.rejects(
      () => bridge.handleCardAction(cardAction(actionIds[0]!)),
      /CARD_ACTION_ALREADY_CLAIMED|CARD_ACTION_RESOURCE_DRIFT/
    );
  });

  it("approves an exact phrase only when one action is pending in the same binding", async () => {
    const event = message({ text: "可以" });
    const result = await bridge.handleMessageDecision({ conversationId }, event);
    const recovered = await bridge.handleMessageDecision({ conversationId }, event);

    assert.equal(result?.handled, true);
    assert.equal(result?.decision, "approved");
    assert.equal(recovered?.decision, "approved");
    assert.equal(executeCount, 1);
    assert.equal(copilotRepo.getPendingAction(actionId)?.status, "approved");
  });

  it("does not approve ambiguous follow-up text and returns a waiting receipt", async () => {
    const result = await bridge.handleMessageDecision({ conversationId }, message({ text: "发了吗" }));

    assert.equal(result?.handled, true);
    assert.equal(result?.decision, "waiting");
    assert.equal(executeCount, 0);
    assert.equal(copilotRepo.getPendingAction(actionId)?.status, "pending");
    assert.match(result?.parts[0]?.type === "text" ? result.parts[0].content : "", /尚未发送|等待审批/);
  });

  it("does not reuse a pending action from another conversation", async () => {
    const other = copilotRepo.createConversation({ title: "Other", source: "feishu" });
    const result = await bridge.handleMessageDecision(
      { conversationId: other.id },
      message({ text: "可以", chatId: "oc_other" })
    );

    assert.equal(result, undefined);
    assert.equal(executeCount, 0);
    assert.equal(copilotRepo.getPendingAction(actionId)?.status, "pending");
  });

  function message(overrides: Partial<FeishuInboundMessage> = {}): FeishuInboundMessage {
    return {
      kind: "message",
      accountId,
      eventId: "event-1",
      messageId: "message-1",
      chatId: "oc_chat",
      chatType: "p2p",
      senderOpenId: "ou_owner",
      text: "continue",
      mentionedBot: false,
      laneKey: "oc_chat:root",
      ...overrides
    };
  }

  function cardAction(opaqueActionId: string): FeishuInboundCardAction {
    return {
      kind: "card_action",
      accountId,
      eventId: `card-${opaqueActionId}`,
      chatId: "oc_chat",
      senderOpenId: "ou_owner",
      actionId: opaqueActionId,
      laneKey: "oc_chat:root"
    };
  }
});

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
  return db;
}

function readCardActionIds(part: unknown): string[] {
  if (!part || typeof part !== "object") return [];
  const content = (part as { content?: { elements?: unknown[] } }).content;
  const elements = content?.elements ?? [];
  const row = elements.find((element) => Boolean(element) && typeof element === "object" && (element as { tag?: string }).tag === "action");
  if (!row || typeof row !== "object") return [];
  const actions = (row as { actions?: Array<{ value?: { action_id?: string } }> }).actions ?? [];
  return actions.map((action) => action.value?.action_id).filter((id): id is string => Boolean(id));
}
