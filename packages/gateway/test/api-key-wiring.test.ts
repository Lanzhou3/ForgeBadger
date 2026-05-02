import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createGatewayApp } from "../src/server.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";

function createTestDb(): Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  const drizzleDb = drizzle(db);
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/db/migrations"
  );
  migrate(drizzleDb, { migrationsFolder });
  return db;
}

function createMockTmuxClient() {
  return {
    async createSession() {},
    async killSession() {},
    async capturePane() {
      return "";
    },
    async listSessions() {
      return [];
    }
  };
}

describe("Gateway API key wiring", () => {
  it("creates an encrypted API key store at application startup", async () => {
    const db = createTestDb();
    const apiKeyStore = new InMemoryApiKeyStore({ masterKey });
    const sessionManager = new InMemorySessionManager(createMockTmuxClient());

    const gatewayApp = createGatewayApp({
      jwtSecret,
      masterKey,
      db,
      sessionManager,
      apiKeyStore
    });

    const created = await gatewayApp.apiKeyStore.create({
      userId: "user_1",
      provider: "anthropic",
      name: "Claude",
      plaintextKey: "test-api-key-test"
    });
    const listed = await gatewayApp.apiKeyStore.listForUser("user_1");

    assert.equal(created.provider, "anthropic");
    assert.equal(listed.length, 1);
    assert.equal(JSON.stringify(listed).includes("test-api-key-test"), false);
  });
});
