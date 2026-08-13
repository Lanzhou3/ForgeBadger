import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { FeishuChannelRepository } from "../src/db/repositories/feishu-channel-repository.js";
import { UserRepository, type User } from "../src/db/repositories/user-repository.js";

const masterKey = "0123456789abcdef0123456789abcdef";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
  return db;
}

describe("FeishuChannelRepository", () => {
  let db: Database.Database;
  let owner: User;
  let other: User;
  let repo: FeishuChannelRepository;
  let otherRepo: FeishuChannelRepository;

  beforeEach(() => {
    db = createTestDb();
    const users = new UserRepository(db);
    owner = users.create("feishu-owner@example.com", "hash");
    other = users.create("feishu-other@example.com", "hash");
    repo = new FeishuChannelRepository(db, owner.id, masterKey);
    otherRepo = new FeishuChannelRepository(db, other.id, masterKey);
    repo.upsertAccount({ appId: "cli_baseline", appSecret: "baseline-secret", enabled: false });
  });

  it("stores write-only account credentials encrypted and tenant scoped", () => {
    const account = repo.upsertAccount({
      appId: "cli_owner",
      appSecret: "owner-app-secret",
      enabled: false
    });

    assert.equal(account.secretConfigured, true);
    assert.equal("appSecret" in account, false);
    assert.equal(otherRepo.getAccount(account.id), undefined);
    assert.deepEqual(repo.decryptAccountCredentials(account.id), {
      appId: "cli_owner",
      appSecret: "owner-app-secret"
    });

    const stored = db.prepare(
      "SELECT app_secret_encrypted FROM feishu_channel_accounts WHERE id = ?"
    ).get(account.id) as { app_secret_encrypted: string };
    assert.doesNotMatch(stored.app_secret_encrypted, /owner-app-secret/);
  });

  it("deduplicates transport events and logical messages without crossing accounts", () => {
    const first = admitMessage(repo, "event-1", "message-1");
    const transportDuplicate = admitMessage(repo, "event-1", "message-1");
    const logicalDuplicate = admitMessage(repo, "event-2", "message-1");

    assert.equal(first.admitted, true);
    assert.deepEqual(transportDuplicate, { admitted: false, reason: "duplicate_event" });
    assert.equal(logicalDuplicate.admitted, true);

    const firstClaim = repo.claimNextInbox(new Date(Date.now() + 1), 100);
    assert.equal(firstClaim?.eventId, "event-1");
    repo.completeInbox(firstClaim!.id, firstClaim!.claimToken!, "conversation-1");

    const duplicateClaim = repo.claimNextInbox(new Date(Date.now() + 1), 100);
    assert.equal(duplicateClaim?.eventId, "event-2");
    assert.equal(repo.adoptLogicalMessage(duplicateClaim!.id, duplicateClaim!.claimToken!), false);
  });

  it("recovers expired leases and releases retryable failures", () => {
    admitMessage(repo, "event-retry", "message-retry");
    const startedAt = Date.now() + 1;
    const first = repo.claimNextInbox(new Date(startedAt), 50);
    assert.ok(first?.claimToken);

    assert.equal(repo.claimNextInbox(new Date(startedAt + 25), 50), undefined);
    const recovered = repo.claimNextInbox(new Date(startedAt + 51), 50);
    assert.equal(recovered?.id, first?.id);
    assert.notEqual(recovered?.claimToken, first?.claimToken);

    repo.failInbox(recovered!.id, recovered!.claimToken!, {
      retryable: true,
      errorCode: "COPILOT_BUSY",
      retryAt: new Date(startedAt + 100)
    });
    assert.equal(repo.claimNextInbox(new Date(startedAt + 99), 50), undefined);
    assert.equal(repo.claimNextInbox(new Date(startedAt + 100), 50)?.id, first?.id);
  });

  it("serializes inbox claims within one chat lane", () => {
    admitMessage(repo, "event-a", "message-a", "chat-1");
    admitMessage(repo, "event-b", "message-b", "chat-1");
    admitMessage(repo, "event-c", "message-c", "chat-2");

    const claimAt = new Date(Date.now() + 1);
    const first = repo.claimNextInbox(claimAt, 100);
    const parallel = repo.claimNextInbox(claimAt, 100);
    assert.equal(first?.eventId, "event-a");
    assert.equal(parallel?.eventId, "event-c");
  });

  it("uses compare-and-swap to prevent card replay and cross-context claims", () => {
    const action = repo.createCardAction({
      accountId: "default",
      chatId: "chat-1",
      threadId: "thread-1",
      operatorOpenId: "ou_owner",
      actionType: "approve_pending_action",
      resourceId: "pending-1",
      payloadDigest: "sha256:payload",
      resourceRevision: 4,
      permissionSnapshot: { canApprove: true },
      expiresAt: new Date(5_000)
    });

    assert.throws(
      () => repo.claimCardAction(action.id, {
        operatorOpenId: "ou_attacker",
        chatId: "chat-1",
        threadId: "thread-1",
        payloadDigest: "sha256:payload",
        resourceRevision: 4,
        now: new Date(4_000)
      }),
      /CARD_ACTION_CONTEXT_MISMATCH/
    );
    assert.equal(repo.claimCardAction(action.id, {
      operatorOpenId: "ou_owner",
      chatId: "chat-1",
      threadId: "thread-1",
      payloadDigest: "sha256:payload",
      resourceRevision: 4,
      now: new Date(4_000)
    }).status, "claimed");
    assert.throws(
      () => repo.claimCardAction(action.id, {
        operatorOpenId: "ou_owner",
        chatId: "chat-1",
        threadId: "thread-1",
        payloadDigest: "sha256:payload",
        resourceRevision: 4,
        now: new Date(4_001)
      }),
      /CARD_ACTION_ALREADY_CLAIMED/
    );
  });
});

function admitMessage(
  repository: FeishuChannelRepository,
  eventId: string,
  messageId: string,
  chatId = "chat-1"
) {
  return repository.admitInbox({
    accountId: "default",
    eventId,
    messageId,
    eventType: "im.message.receive_v1",
    laneKey: `${chatId}:root`,
    chatId,
    senderOpenId: "ou_owner",
    content: "please summarize the project",
    retentionUntil: new Date(86_400_000)
  });
}
