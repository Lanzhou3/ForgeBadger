import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";

const key = "0123456789abcdef0123456789abcdef";

describe("InMemoryApiKeyStore", () => {
  it("stores encrypted API keys and lists metadata without plaintext", async () => {
    const store = new InMemoryApiKeyStore({ masterKey: key });

    const created = await store.create({
      userId: "user_1",
      provider: "anthropic",
      name: "Claude",
      plaintextKey: "test-api-key-test"
    });
    const listed = await store.listForUser("user_1");

    assert.equal(created.provider, "anthropic");
    assert.equal("plaintextKey" in listed[0]!, false);
    assert.equal(JSON.stringify(listed).includes("test-api-key-test"), false);
  });

  it("decrypts a key only by id and owner", async () => {
    const store = new InMemoryApiKeyStore({ masterKey: key });
    const created = await store.create({
      userId: "user_1",
      provider: "anthropic",
      name: "Claude",
      plaintextKey: "test-api-key-test"
    });

    assert.equal(await store.decryptForLaunch({ userId: "user_1", id: created.id }), "test-api-key-test");
    await assert.rejects(
      () => store.decryptForLaunch({ userId: "user_2", id: created.id }),
      /not found/i
    );
  });

  it("enforces tenant isolation when listing keys", async () => {
    const store = new InMemoryApiKeyStore({ masterKey: key });
    await store.create({
      userId: "user_1",
      provider: "anthropic",
      name: "Claude",
      plaintextKey: "sk-user-1"
    });
    await store.create({
      userId: "user_2",
      provider: "anthropic",
      name: "Claude",
      plaintextKey: "sk-user-2"
    });

    const listed = await store.listForUser("user_1");

    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.userId, "user_1");
  });
});
