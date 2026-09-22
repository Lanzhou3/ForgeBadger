import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { UserRepository } from "../src/db/repositories/user-repository.js";
import { TelegramChannelRepository } from "../src/db/repositories/telegram-channel-repository.js";
import { createTelegramNativeSender } from "../src/services/integrations/telegram-native-sender.js";
import type { TrustedChannelPeer } from "../src/services/channels/channel-identity-service.js";

const masterKey = "abcdef0123456789abcdef0123456789";
const botToken = "123456:test-token";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
  return db;
}

interface FakeCall {
  url: string;
  body: Record<string, unknown>;
}

function okResponse(messageId: number): unknown {
  return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: messageId } }) };
}

function apiErrorResponse(status: number, payload: Record<string, unknown>): unknown {
  return { ok: false, status, json: async () => payload };
}

function createSender(text: string, responses: Array<() => unknown>, events: string[] = []) {
  const db = createTestDb();
  const user = new UserRepository(db).create("telegram-sender@example.com", "hash");
  const account = new TelegramChannelRepository(db, user.id, masterKey).upsertAccount({ botToken, enabled: true });
  const calls: FakeCall[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    events.push(`fetch-${calls.length - 1}`);
    const next = responses.shift();
    if (!next) throw new Error("NO_FAKE_RESPONSE");
    return next() as Response;
  };
  const peer: TrustedChannelPeer = {
    channel: "telegram",
    accountId: account.id,
    accountRevision: 1,
    externalUserId: "ext-1",
    chatId: "chat-1",
    chatType: "p2p"
  };
  const send = createTelegramNativeSender(db, user.id, masterKey, {
    fetch: fetchImpl as unknown as typeof fetch,
    validate: async () => undefined
  });
  return {
    db,
    calls,
    events,
    send: async (authorize?: () => void) => send({
      peer,
      text,
      deliveryId: "delivery-1",
      signal: new AbortController().signal,
      authorize: () => { events.push("authorize"); authorize?.(); }
    })
  };
}

describe("createTelegramNativeSender", () => {
  it("sends a short message in a single request to the pinned endpoint", async () => {
    const fixture = createSender("hello bot", [() => okResponse(101)]);
    const result = await fixture.send();

    assert.deepEqual(result, { status: "delivered", messageId: "101" });
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.calls[0]?.url, `https://api.telegram.org/bot${botToken}/sendMessage`);
    assert.deepEqual(fixture.calls[0]?.body, { chat_id: "chat-1", text: "hello bot" });
  });

  it("splits text over the 4096 limit into two plain-text sends", async () => {
    const text = "a".repeat(4096) + "b".repeat(100);
    const fixture = createSender(text, [() => okResponse(201), () => okResponse(202)]);
    const result = await fixture.send();

    assert.deepEqual(result, { status: "delivered", messageId: "202" });
    assert.equal(fixture.calls.length, 2);
    assert.equal(String(fixture.calls[0]?.body.text), "a".repeat(4096));
    assert.equal(String(fixture.calls[1]?.body.text), "b".repeat(100));
  });

  it("splits exactly 4096 characters into a single send", async () => {
    const fixture = createSender("a".repeat(4096), [() => okResponse(301)]);
    const result = await fixture.send();

    assert.deepEqual(result, { status: "delivered", messageId: "301" });
    assert.equal(fixture.calls.length, 1);
  });

  it("prefers a newline cut point and drops the consumed newline", async () => {
    const text = "x".repeat(4090) + "\n" + "y".repeat(100);
    const fixture = createSender(text, [() => okResponse(401), () => okResponse(402)]);
    const result = await fixture.send();

    assert.equal(result.status, "delivered");
    assert.equal(fixture.calls.length, 2);
    assert.equal(String(fixture.calls[0]?.body.text), "x".repeat(4090));
    assert.equal(String(fixture.calls[1]?.body.text), "y".repeat(100));
  });

  it("authorizes before every chunk send", async () => {
    const text = "a".repeat(4096) + "b".repeat(100);
    const fixture = createSender(text, [() => okResponse(501), () => okResponse(502)]);
    await fixture.send();

    assert.deepEqual(fixture.events, ["authorize", "fetch-0", "authorize", "fetch-1"]);
  });

  it("reports a 429 throttle as unknown", async () => {
    const fixture = createSender("hello", [() => apiErrorResponse(429, {
      ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 5 }
    })]);
    const result = await fixture.send();

    assert.deepEqual(result, { status: "unknown" });
  });

  it("reports a 400 client error as failed", async () => {
    const fixture = createSender("hello", [() => apiErrorResponse(400, {
      ok: false, error_code: 400, description: "Bad Request: chat not found"
    })]);
    const result = await fixture.send();

    assert.deepEqual(result, { status: "failed" });
  });

  it("reports a network failure as unknown", async () => {
    const fixture = createSender("hello", [() => { throw new TypeError("fetch failed"); }]);
    const result = await fixture.send();

    assert.deepEqual(result, { status: "unknown" });
  });

  it("reports failed when a later chunk of a multi-part send fails", async () => {
    const text = "a".repeat(4096) + "b".repeat(100);
    const fixture = createSender(text, [
      () => okResponse(601),
      () => apiErrorResponse(400, { ok: false, error_code: 400, description: "Bad Request" })
    ]);
    const result = await fixture.send();

    assert.deepEqual(result, { status: "failed" });
    assert.equal(fixture.calls.length, 2);
  });
});
