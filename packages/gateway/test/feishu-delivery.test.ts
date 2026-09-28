import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { FeishuChannelRepository } from "../src/db/repositories/feishu-channel-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import {
  FeishuDeliveryError,
  FeishuDeliveryService
} from "../src/services/integrations/feishu-delivery-service.js";
import { FeishuDeliveryWorker } from "../src/services/integrations/feishu-delivery-worker.js";
import { renderFeishuApprovalCard } from "../src/services/integrations/feishu-card-renderer.js";

const masterKey = "0123456789abcdef0123456789abcdef";
let testAccountId = "";

describe("Feishu durable delivery", () => {
  let db: Database.Database;
  let repo: FeishuChannelRepository;
  let accountId: string;

  beforeEach(() => {
    db = createTestDb();
    const user = new UserRepository(db).create("delivery@example.com", "hash");
    repo = new FeishuChannelRepository(db, user.id, masterKey);
    accountId = repo.upsertAccount({ appId: "cli_delivery", appSecret: "secret", enabled: false }).id;
    testAccountId = accountId;
  });

  it("enqueues one encrypted payload for a stable idempotency key", () => {
    const service = new FeishuDeliveryService(repo);
    const first = service.enqueue(plan());
    const duplicate = service.enqueue(plan());
    const row = db.prepare("SELECT payload_encrypted FROM feishu_channel_outbox WHERE id = ?")
      .get(first.id) as { payload_encrypted: string };

    assert.equal(first.id, duplicate.id);
    assert.doesNotMatch(row.payload_encrypted, /part one/);
    assert.match(repo.decryptOutboxPayload(first.id), /part one/);
  });

  it("retries before acceptance and resumes from the first undelivered part", async () => {
    new FeishuDeliveryService(repo).enqueue(plan());
    const sent: string[] = [];
    let failSecond = true;
    const worker = new FeishuDeliveryWorker(repo, {
      send: async (part) => {
        sent.push(part.content);
        if (part.content === "part two" && failSecond) {
          failSecond = false;
          throw new FeishuDeliveryError("temporary", { retryable: true, accepted: false });
        }
        return { messageId: `msg-${sent.length}`, accepted: true };
      },
      retryDelayMs: 0
    });

    assert.equal(await worker.runOnce(new Date(Date.now() + 1)), "retrying");
    assert.deepEqual(sent, ["part one", "part two"]);
    assert.equal(await worker.runOnce(new Date(Date.now() + 2)), "delivered");
    assert.deepEqual(sent, ["part one", "part two", "part two"]);
  });

  it("does not retry when acceptance may have happened without a message id", async () => {
    const outbox = new FeishuDeliveryService(repo).enqueue(plan(["uncertain"]));
    const worker = new FeishuDeliveryWorker(repo, {
      send: async () => ({ accepted: true })
    });

    assert.equal(await worker.runOnce(new Date(Date.now() + 1)), "accepted_receipt_missing");
    assert.equal(repo.getOutbox(outbox.id)?.status, "accepted_receipt_missing");
    assert.equal(await worker.runOnce(new Date(Date.now() + 2)), "idle");
  });

  it("marks permanent pre-acceptance failures terminal", async () => {
    const outbox = new FeishuDeliveryService(repo).enqueue(plan(["invalid"]));
    const worker = new FeishuDeliveryWorker(repo, {
      send: async () => {
        throw new FeishuDeliveryError("invalid receive id", { retryable: false, accepted: false });
      }
    });

    assert.equal(await worker.runOnce(new Date(Date.now() + 1)), "failed");
    assert.equal(repo.getOutbox(outbox.id)?.status, "failed");
  });

  it("binds a delivered card message id back to its opaque actions", async () => {
    const approve = repo.createCardAction(cardBinding("approve"));
    const reject = repo.createCardAction(cardBinding("reject"));
    const card = renderFeishuApprovalCard({
      title: "Approve",
      summary: "Confirm this action",
      approveActionId: approve.id,
      rejectActionId: reject.id
    });
    new FeishuDeliveryService(repo).enqueue({
      accountId,
      idempotencyKey: "approval:run-1",
      chatId: "oc_target",
      parts: [{ type: "card", content: card }]
    });
    const worker = new FeishuDeliveryWorker(repo, {
      send: async () => ({ accepted: true, messageId: "om_card_message" })
    });

    assert.equal(await worker.runOnce(new Date(Date.now() + 1)), "delivered");
    assert.equal(repo.getCardAction(approve.id)?.cardMessageId, "om_card_message");
    assert.equal(repo.getCardAction(reject.id)?.cardMessageId, "om_card_message");
  });

  function cardBinding(actionType: string) {
    return {
      accountId,
      chatId: "oc_target",
      operatorOpenId: "ou_owner",
      actionType,
      resourceId: "pending-1",
      payloadDigest: "digest",
      resourceRevision: 1,
      permissionSnapshot: { canApprove: true },
      expiresAt: new Date(Date.now() + 60_000)
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

function plan(parts = ["part one", "part two"]) {
  return {
    accountId: testAccountId,
    idempotencyKey: "automation:run-1:delivery",
    chatId: "oc_target",
    parts: parts.map((content) => ({ type: "text" as const, content }))
  };
}
