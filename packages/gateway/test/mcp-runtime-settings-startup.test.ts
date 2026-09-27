import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { signJwt } from "../src/auth/jwt.js";
import { loadEnv } from "../src/config/env.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import { createGatewayApp } from "../src/server.js";
import { ForgeBadgerEventBus } from "../src/services/event-bus.js";
import { createRuntimeSettingsStore } from "../src/services/runtime-settings.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";

process.env.FORGEBADGER_JWT_SECRET = jwtSecret;
process.env.FORGEBADGER_MASTER_KEY = masterKey;

function createTestDb(): Database {
  const db = new Database(":memory:");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
  return db;
}

describe("MCP runtime setting at Gateway startup", () => {
  for (const { envEnabled, savedEnabled } of [
    { envEnabled: false, savedEnabled: true },
    { envEnabled: true, savedEnabled: false }
  ]) {
    it(`mounts routes from saved setting ${savedEnabled} over env ${envEnabled}`, async () => {
      // Arrange: save an admin setting before constructing a new Gateway.
      const db = createTestDb();
      const env = loadEnv({
        FORGEBADGER_JWT_SECRET: jwtSecret,
        FORGEBADGER_MASTER_KEY: masterKey,
        FORGEBADGER_MCP_ENABLED: String(envEnabled)
      });
      const user = new UserRepository(db).create("owner@example.com", "hash", { role: "admin" });
      createRuntimeSettingsStore(db, { env }).update(user.id, { mcp_enabled: savedEnabled });
      const gateway = createGatewayApp({
        db,
        env,
        jwtSecret,
        masterKey,
        sessionManager: new InMemorySessionManager({} as never),
        apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
        eventBus: new ForgeBadgerEventBus(),
        sessionServerIpcPath: "/tmp/forgebadger-test-session-server.sock",
        mcpEnabled: envEnabled
      });
      await new Promise<void>((resolve) => gateway.server.listen(0, "127.0.0.1", resolve));
      const port = (gateway.server.address() as { port: number }).port;
      const authorization = `Bearer ${signJwt({ userId: user.id, email: user.email }, jwtSecret)}`;

      try {
        // Act: inspect both the console status and the actual route mount.
        const status = await fetch(`http://127.0.0.1:${port}/api/v1/mcp`, {
          headers: { authorization }
        });
        const tokens = await fetch(`http://127.0.0.1:${port}/api/v1/mcp/tokens`, {
          headers: { authorization }
        });
        const endpoint = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST" });

        // Assert: a mounted endpoint requires authentication; an unmounted one is 404.
        assert.equal(status.status, 200);
        assert.equal((await status.json()).data.enabled, savedEnabled);
        assert.equal(tokens.status, savedEnabled ? 200 : 404);
        assert.equal(endpoint.status, savedEnabled ? 401 : 404);
      } finally {
        await gateway.close();
      }
    });
  }
});
