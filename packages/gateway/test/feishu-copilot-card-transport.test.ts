import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { UserRepository } from "../src/db/repositories/user-repository.js";
import { FeishuChannelRepository } from "../src/db/repositories/feishu-channel-repository.js";
import {
  sendFeishuChatCard,
  sendFeishuChatText,
  updateFeishuChatCard
} from "../src/services/integrations/feishu-runtime-factory.js";
import type { FeishuSdkFactory } from "../src/services/integrations/feishu-sdk.js";

const masterKey = "0123456789abcdef0123456789abcdef";
const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/db/migrations"
);

function createHarness(message: Record<string, unknown>) {
  const db = new Database(":memory:");
  migrate(drizzle(db), { migrationsFolder });
  const userId = new UserRepository(db).create("feishu-card-transport@example.com", "hash").id;
  new FeishuChannelRepository(db, userId, masterKey).upsertAccount({
    appId: "cli_card_transport",
    appSecret: "secret",
    enabled: true
  });
  const sdkFactory = {
    createRestClient: () => ({ im: { message } })
  } as unknown as FeishuSdkFactory;
  return {
    db,
    invokeUpdate: (card: unknown = { schema: "2.0", body: { elements: [] } }) => updateFeishuChatCard({
      db,
      masterKey,
      sdkFactory,
      userId,
      messageId: "om_card_1",
      card
    }),
    invokeSend: (card: unknown = { schema: "2.0", body: { elements: [] } }) => sendFeishuChatCard({
      db,
      masterKey,
      sdkFactory,
      userId,
      chatId: "oc_chat_1",
      card
    }),
    invokeText: (text = "reply") => sendFeishuChatText({
      db,
      masterKey,
      sdkFactory,
      userId,
      chatId: "oc_chat_1",
      text
    })
  };
}

describe("Feishu Copilot card transport", () => {
  it("patches an interactive card with the provider path payload and never calls message.update", async () => {
    const patchCalls: unknown[] = [];
    const updateCalls: unknown[] = [];
    const h = createHarness({
      patch: async (input: unknown) => {
        patchCalls.push(input);
        return { code: 0 };
      },
      update: async (input: unknown) => {
        updateCalls.push(input);
        return { code: 0 };
      }
    });

    try {
      await h.invokeUpdate();
      assert.deepEqual(patchCalls, [{
        path: { message_id: "om_card_1" },
        data: { content: JSON.stringify({ schema: "2.0", body: { elements: [] } }) }
      }]);
      assert.equal(updateCalls.length, 0);
    } finally {
      h.db.close();
    }
  });

  it("fails closed with one redacted error when patch is missing or the provider response is invalid", async () => {
    const cases: Array<{ name: string; message: Record<string, unknown> }> = [
      { name: "missing patch", message: {} },
      { name: "undefined response", message: { patch: async () => undefined } },
      { name: "non-object response", message: { patch: async () => "ok" } },
      { name: "provider error code", message: { patch: async () => ({ code: 230001, msg: "sensitive provider detail" }) } },
      { name: "provider rejection", message: { patch: async () => { throw new Error("sensitive provider detail"); } } }
    ];

    for (const testCase of cases) {
      const h = createHarness(testCase.message);
      try {
        await assert.rejects(h.invokeUpdate(), {
          message: "FEISHU_CARD_UPDATE_FAILED"
        }, testCase.name);
      } finally {
        h.db.close();
      }
    }
  });

  it("requires a successful create response with a non-empty message id", async () => {
    const createCalls: unknown[] = [];
    const h = createHarness({
      create: async (input: unknown) => {
        createCalls.push(input);
        return { code: 0, data: { message_id: "om_created" } };
      }
    });

    try {
      assert.equal(await h.invokeSend(), "om_created");
      assert.deepEqual(createCalls, [{
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: "oc_chat_1",
          msg_type: "interactive",
          content: JSON.stringify({ schema: "2.0", body: { elements: [] } })
        }
      }]);
    } finally {
      h.db.close();
    }
  });

  it("rejects a text response with a nonzero provider code", async () => {
    const h = createHarness({
      create: async () => ({ code: 230001, data: { message_id: "om_rejected" } })
    });

    try {
      await assert.rejects(h.invokeText(), { message: "FEISHU_PROVIDER_NOT_ACCEPTED" });
    } finally {
      h.db.close();
    }
  });

  it("accepts a text response only when the provider returns numeric code zero", async () => {
    const createCalls: unknown[] = [];
    const h = createHarness({
      create: async (input: unknown) => {
        createCalls.push(input);
        return { code: 0, data: { message_id: "om_text_accepted" } };
      }
    });

    try {
      await h.invokeText("visible reply");
      assert.deepEqual(createCalls, [{
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: "oc_chat_1",
          msg_type: "text",
          content: JSON.stringify({ text: "visible reply" })
        }
      }]);
    } finally {
      h.db.close();
    }
  });

  it("rejects missing and malformed text provider responses", async () => {
    const cases: Array<{ name: string; message: Record<string, unknown> }> = [
      { name: "missing create", message: {} },
      { name: "undefined response", message: { create: async () => undefined } },
      { name: "null response", message: { create: async () => null } },
      { name: "non-object response", message: { create: async () => "ok" } },
      { name: "missing code", message: { create: async () => ({ data: { message_id: "om_missing_code" } }) } },
      { name: "string zero code", message: { create: async () => ({ code: "0", data: { message_id: "om_string_code" } }) } }
    ];

    for (const testCase of cases) {
      const h = createHarness(testCase.message);
      try {
        await assert.rejects(
          h.invokeText(),
          { message: "FEISHU_PROVIDER_NOT_ACCEPTED" },
          testCase.name
        );
      } finally {
        h.db.close();
      }
    }
  });

  it("fails closed with one redacted error when card creation is unavailable or rejected", async () => {
    const cases: Array<{ name: string; message: Record<string, unknown> }> = [
      { name: "missing create", message: {} },
      { name: "undefined response", message: { create: async () => undefined } },
      { name: "non-object response", message: { create: async () => "ok" } },
      { name: "provider error code", message: { create: async () => ({ code: 230001, msg: "sensitive" }) } },
      { name: "missing message id", message: { create: async () => ({ code: 0, data: {} }) } },
      { name: "blank message id", message: { create: async () => ({ code: 0, data: { message_id: " " } }) } },
      { name: "provider rejection", message: { create: async () => { throw new Error("sensitive"); } } }
    ];

    for (const testCase of cases) {
      const h = createHarness(testCase.message);
      try {
        await assert.rejects(h.invokeSend(), {
          message: "FEISHU_CARD_SEND_FAILED"
        }, testCase.name);
      } finally {
        h.db.close();
      }
    }
  });

  it("rejects card create and patch payloads above the Feishu 30KB limit before the SDK call", async () => {
    let createCalls = 0;
    let patchCalls = 0;
    const h = createHarness({
      create: async () => { createCalls += 1; return { code: 0, data: { message_id: "om_created" } }; },
      patch: async () => { patchCalls += 1; return { code: 0 }; }
    });
    const oversizedCard = { schema: "2.0", text: "密".repeat(11_000) };

    try {
      await assert.rejects(h.invokeSend(oversizedCard), { message: "FEISHU_CARD_SEND_FAILED" });
      await assert.rejects(h.invokeUpdate(oversizedCard), { message: "FEISHU_CARD_UPDATE_FAILED" });
      assert.equal(createCalls, 0);
      assert.equal(patchCalls, 0);
    } finally {
      h.db.close();
    }
  });
});
