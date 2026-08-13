import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { FeishuChannelRepository } from "../src/db/repositories/feishu-channel-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { FeishuCardActionService } from "../src/services/integrations/feishu-card-action-service.js";

const masterKey = "0123456789abcdef0123456789abcdef";
let testActionId = "";

describe("FeishuCardActionService", () => {
  let db: Database.Database;
  let repo: FeishuChannelRepository;
  let service: FeishuCardActionService;
  let actionId: string;
  let executions: number;

  beforeEach(() => {
    db = createTestDb();
    const userId = new UserRepository(db).create("card@example.com", "hash").id;
    repo = new FeishuChannelRepository(db, userId, masterKey);
    repo.upsertAccount({ appId: "cli_card", appSecret: "secret", enabled: false });
    executions = 0;
    service = new FeishuCardActionService(repo, {
      resolveResource: () => ({ payloadDigest: "digest-1", revision: 3 }),
      executePendingAction: async () => {
        executions += 1;
        return { ok: true };
      }
    });
    actionId = service.createBinding({
      accountId: "default",
      chatId: "oc_chat",
      threadId: "thread-1",
      operatorOpenId: "ou_owner",
      actionType: "approve_pending_action",
      resourceId: "pending-1",
      payloadDigest: "digest-1",
      resourceRevision: 3,
      permissionSnapshot: { canApprove: true },
      expiresAt: new Date(5_000)
    });
    testActionId = actionId;
  });

  it("executes one valid mapped card action", async () => {
    const result = await service.handle(callback(), new Date(4_000));

    assert.deepEqual(result, { ok: true, actionId, result: { ok: true } });
    assert.equal(executions, 1);
  });

  it("rejects wrong user, chat, thread, expiry, and replay", async () => {
    await assert.rejects(() => service.handle(callback({ operatorOpenId: "ou_other" }), new Date(4_000)), /CARD_ACTION_CONTEXT_MISMATCH/);
    await assert.rejects(() => service.handle(callback({ chatId: "oc_other" }), new Date(4_000)), /CARD_ACTION_CONTEXT_MISMATCH/);
    await assert.rejects(() => service.handle(callback({ threadId: "thread-2" }), new Date(4_000)), /CARD_ACTION_CONTEXT_MISMATCH/);
    await assert.rejects(() => service.handle(callback(), new Date(5_001)), /CARD_ACTION_EXPIRED/);

    await service.handle(callback(), new Date(4_000));
    await assert.rejects(() => service.handle(callback(), new Date(4_001)), /CARD_ACTION_ALREADY_CLAIMED/);
  });

  it("rejects payload or resource revision drift before execution", async () => {
    const payloadDrift = new FeishuCardActionService(repo, {
      resolveResource: () => ({ payloadDigest: "digest-2", revision: 3 }),
      executePendingAction: async () => ({ ok: true })
    });
    await assert.rejects(() => payloadDrift.handle(callback(), new Date(4_000)), /CARD_ACTION_RESOURCE_DRIFT/);

    const revisionDrift = new FeishuCardActionService(repo, {
      resolveResource: () => ({ payloadDigest: "digest-1", revision: 4 }),
      executePendingAction: async () => ({ ok: true })
    });
    await assert.rejects(() => revisionDrift.handle(callback(), new Date(4_000)), /CARD_ACTION_RESOURCE_DRIFT/);
    assert.equal(executions, 0);
  });

  it("allows only one concurrent callback to win the CAS", async () => {
    const results = await Promise.allSettled([
      service.handle(callback(), new Date(4_000)),
      service.handle(callback(), new Date(4_000))
    ]);

    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.equal(executions, 1);
  });

  it("keeps actions tenant scoped", async () => {
    const otherUserId = new UserRepository(db).create("other-card@example.com", "hash").id;
    const otherRepo = new FeishuChannelRepository(db, otherUserId, masterKey);
    const otherService = new FeishuCardActionService(otherRepo, {
      resolveResource: () => ({ payloadDigest: "digest-1", revision: 3 }),
      executePendingAction: async () => ({ ok: true })
    });

    await assert.rejects(() => otherService.handle(callback(), new Date(4_000)), /CARD_ACTION_NOT_FOUND/);
  });

  it("rejects a callback from a different delivered card message", async () => {
    repo.bindCardActionMessageIds([actionId], "om_expected");

    await assert.rejects(
      () => service.handle({ ...callback(), messageId: "om_forwarded" }, new Date(4_000)),
      /CARD_ACTION_CONTEXT_MISMATCH/
    );
    const accepted = await service.handle({ ...callback(), messageId: "om_expected" }, new Date(4_000));
    assert.equal(accepted.ok, true);
  });
});

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
  return db;
}

function callback(overrides: Record<string, unknown> = {}) {
  return {
    actionId: testActionId,
    operatorOpenId: "ou_owner",
    chatId: "oc_chat",
    threadId: "thread-1",
    ...overrides
  };
}
