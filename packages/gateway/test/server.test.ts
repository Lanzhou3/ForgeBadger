import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import { OpenForgeEventBus } from "../src/services/event-bus.js";
import { createServer } from "../src/server.js";
import { errorHandler } from "../src/middleware/error-handler.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "0123456789abcdef0123456789abcdef";

describe("createServer", () => {
  it("mounts errorHandler after routes", () => {
    const db = new Database(":memory:");
    const app = createServer({
      db,
      jwtSecret,
      masterKey,
      sessionManager: {} as InMemorySessionManager,
      apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
      eventBus: new OpenForgeEventBus()
    });

    const stack = (app as { _router?: { stack?: { handle?: unknown }[] } })._router?.stack ?? [];
    const lastLayer = stack.at(-1);
    assert.equal(lastLayer?.handle, errorHandler);

    db.close();
  });
});
