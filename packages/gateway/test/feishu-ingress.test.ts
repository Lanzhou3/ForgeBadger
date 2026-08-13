import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { FeishuChannelRepository } from "../src/db/repositories/feishu-channel-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { CopilotLiveRunConflictError } from "../src/db/repositories/copilot-repository.js";
import { normalizeFeishuEvent } from "../src/services/integrations/feishu-event-normalizer.js";
import { FeishuIngressService } from "../src/services/integrations/feishu-ingress-service.js";
import { FeishuIngressWorker } from "../src/services/integrations/feishu-ingress-worker.js";

const masterKey = "0123456789abcdef0123456789abcdef";

describe("Feishu durable ingress", () => {
  let db: Database.Database;
  let repo: FeishuChannelRepository;
  let accountId: string;

  beforeEach(() => {
    db = createTestDb();
    const user = new UserRepository(db).create("ingress@example.com", "hash");
    repo = new FeishuChannelRepository(db, user.id, masterKey);
    accountId = repo.upsertAccount({
      appId: "cli_ingress",
      appSecret: "app-secret",
      enabled: false
    }).id;
  });

  it("normalizes only required message and card fields", () => {
    const message = normalizeFeishuEvent(messageEnvelope(), {
      accountId,
      botOpenId: "ou_bot"
    });
    const card = normalizeFeishuEvent(cardEnvelope(), { accountId });

    assert.deepEqual(message, {
      kind: "message",
      accountId,
      eventId: "evt-1",
      messageId: "msg-1",
      chatId: "oc_chat",
      chatType: "group",
      threadId: "thread-1",
      senderOpenId: "ou_user",
      text: "summarize this project",
      mentionedBot: true,
      laneKey: "oc_chat:thread-1"
    });
    assert.deepEqual(card, {
      kind: "card_action",
      accountId,
      eventId: "evt-card",
      chatId: "oc_chat",
      messageId: "thread-1",
      senderOpenId: "ou_user",
      actionId: "opaque-action-id",
      laneKey: "oc_chat:card"
    });
    assert.equal(JSON.stringify(message).includes("raw-token"), false);
  });

  it("normalizes payload-only events emitted by the official SDK dispatcher", () => {
    const message = normalizeFeishuEvent(messageEnvelope().event, {
      accountId,
      botOpenId: "ou_bot",
      eventType: "im.message.receive_v1"
    });

    assert.equal(message?.kind, "message");
    assert.equal(message?.eventId, "message:msg-1");
    assert.equal(message?.messageId, "msg-1");
    assert.equal(message?.mentionedBot, true);
  });

  it("encrypts retained content and terminates the socket cycle on admission failure", () => {
    let terminated = 0;
    const service = new FeishuIngressService(repo, { terminateSocket: () => { terminated += 1; } });
    const event = normalizeFeishuEvent(messageEnvelope(), { accountId, botOpenId: "ou_bot" })!;

    const result = service.admit(event);
    const row = db.prepare("SELECT content_encrypted FROM feishu_channel_inbox WHERE id = ?")
      .get(result.id) as { content_encrypted: string };
    assert.doesNotMatch(row.content_encrypted, /summarize this project/);
    assert.match(repo.decryptInboxContent(result.id), /summarize this project/);

    const failing = new FeishuIngressService({
      admitInbox: () => { throw new Error("disk unavailable"); }
    }, { terminateSocket: () => { terminated += 1; } });
    assert.throws(() => failing.admit(event), /disk unavailable/);
    assert.equal(terminated, 1);
  });

  it("processes a logical message once across event redelivery", async () => {
    const service = new FeishuIngressService(repo);
    service.admit(normalizeFeishuEvent(messageEnvelope(), { accountId })!);
    service.admit(normalizeFeishuEvent(messageEnvelope({ eventId: "evt-2" }), { accountId })!);
    const processed: string[] = [];
    const worker = new FeishuIngressWorker(repo, {
      process: async (item) => {
        processed.push(item.eventId);
        return { conversationId: "conversation-1" };
      }
    });

    assert.equal(await worker.runOnce(new Date(Date.now() + 1)), "completed");
    assert.equal(await worker.runOnce(new Date(Date.now() + 1)), "duplicate");
    assert.deepEqual(processed, ["evt-1"]);
  });

  it("retries bounded failures then dead-letters without blocking the next lane", async () => {
    const service = new FeishuIngressService(repo);
    service.admit(normalizeFeishuEvent(messageEnvelope(), { accountId })!);
    service.admit(normalizeFeishuEvent(messageEnvelope({
      eventId: "evt-other",
      messageId: "msg-other",
      chatId: "oc_other"
    }), { accountId })!);
    const worker = new FeishuIngressWorker(repo, {
      maxAttempts: 2,
      retryDelayMs: 0,
      process: async (item) => {
        if (item.chatId === "oc_chat") throw new Error("temporary model failure");
        return { conversationId: "conversation-other" };
      }
    });

    assert.equal(await worker.runOnce(new Date(Date.now() + 1)), "retrying");
    assert.equal(await worker.runOnce(new Date(Date.now() + 2)), "completed");
    assert.equal(await worker.runOnce(new Date(Date.now() + 3)), "dead_letter");
  });

  it("classifies a concurrent Copilot run as busy instead of a generic ingress failure", async () => {
    const service = new FeishuIngressService(repo);
    const admitted = service.admit(normalizeFeishuEvent(messageEnvelope(), { accountId })!);
    const worker = new FeishuIngressWorker(repo, {
      maxAttempts: 1,
      process: async () => { throw new CopilotLiveRunConflictError(undefined); }
    });

    assert.equal(await worker.runOnce(new Date(Date.now() + 1)), "dead_letter");
    const failed = db.prepare("SELECT last_error_code FROM feishu_channel_inbox WHERE id = ?")
      .get(admitted.id) as { last_error_code: string };
    assert.equal(failed.last_error_code, "COPILOT_BUSY");
  });
});

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
  return db;
}

function messageEnvelope(overrides: {
  eventId?: string;
  messageId?: string;
  chatId?: string;
} = {}) {
  return {
    schema: "2.0",
    header: {
      event_id: overrides.eventId ?? "evt-1",
      event_type: "im.message.receive_v1",
      token: "raw-token"
    },
    event: {
      sender: { sender_id: { open_id: "ou_user" } },
      message: {
        message_id: overrides.messageId ?? "msg-1",
        chat_id: overrides.chatId ?? "oc_chat",
        chat_type: "group",
        message_type: "text",
        thread_id: "thread-1",
        content: JSON.stringify({ text: "summarize this project" }),
        mentions: [{ id: { open_id: "ou_bot" } }]
      }
    }
  };
}

function cardEnvelope() {
  return {
    schema: "2.0",
    header: { event_id: "evt-card", event_type: "card.action.trigger" },
    event: {
      operator: { open_id: "ou_user" },
      context: { open_chat_id: "oc_chat", open_message_id: "thread-1" },
      action: { value: { action_id: "opaque-action-id", ignored: "not-retained" } }
    }
  };
}
