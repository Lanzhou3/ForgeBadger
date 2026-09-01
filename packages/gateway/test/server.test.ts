import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import { ForgeBadgerEventBus } from "../src/services/event-bus.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { createServer, createGatewayApp, type GatewayApp } from "../src/server.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { FeishuChannelRuntime } from "../src/services/integrations/feishu-channel-runtime.js";
import { RuntimeAuthorizationInvalidator } from "../src/services/runtime-authorization-invalidation.js";

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
      eventBus: new ForgeBadgerEventBus(),
      runtimeAuthorizationInvalidator: new RuntimeAuthorizationInvalidator()
    });

    const stack = (app as { _router?: { stack?: { handle?: unknown }[] } })._router?.stack ?? [];
    const lastLayer = stack.at(-1);
    assert.equal(lastLayer?.handle, errorHandler);

    db.close();
  });
});


describe("Gateway Feishu shutdown ordering", () => {
  it("stops Feishu ingress before later runtimes and the database", async () => {
    const db = new Database(":memory:");
    migrate(drizzle(db), {
      migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
    });
    const order: string[] = [];
    let releaseStop: (() => void) | undefined;
    const heldStop = new Promise<void>((resolve) => { releaseStop = resolve; });
    const runtime = new FeishuChannelRuntime({
      supervisor: {
        start: async () => undefined,
        stop: async () => {
          order.push("feishu-stop");
          await heldStop;
          order.push("feishu-stopped");
        },
        reconcileAccount: async () => undefined,
        getHealth: () => ({
          state: "connected", accountId: "account-close", configRevision: 1,
          reconnectAttempt: 0, lastConnectedAt: new Date(), lastErrorMessage: null
        })
      },
      setInterval: () => 1,
      clearInterval: () => undefined
    });
    const app = createGatewayApp({
      jwtSecret,
      masterKey,
      db,
      sessionManager: new InMemorySessionManager({} as never),
      apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
      feishuChannelRuntime: runtime
    });

    let closeSettled = false;
    const closing = app.close().then(() => { closeSettled = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(order, ["feishu-stop"]);
    assert.equal(closeSettled, false);
    assert.equal(db.open, true);

    releaseStop?.();
    await closing;

    assert.deepEqual(order, ["feishu-stop", "feishu-stopped"]);
    assert.equal(db.open, false);
  });

  it("runs every shutdown stage and aggregates failures instead of skipping cleanup", async () => {
    const db = new Database(":memory:");
    migrate(drizzle(db), {
      migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
    });
    const order: string[] = [];
    const runtime = new FeishuChannelRuntime({
      supervisor: {
        start: async () => undefined,
        stop: async () => {
          order.push("feishu-stop");
          throw new Error("feishu stop failed");
        },
        reconcileAccount: async () => undefined,
        getHealth: () => ({
          state: "connected", accountId: "account-close-errors", configRevision: 1,
          reconnectAttempt: 0, lastConnectedAt: new Date(), lastErrorMessage: null
        })
      },
      setInterval: () => 1,
      clearInterval: () => undefined
    });
    const app = createGatewayApp({
      jwtSecret,
      masterKey,
      db,
      sessionManager: new InMemorySessionManager({} as never),
      apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
      feishuChannelRuntime: runtime
    });

    await assert.rejects(
      app.close(),
      (error: unknown) => {
        assert.equal(error instanceof AggregateError, true);
        assert.equal((error as AggregateError).message, "GATEWAY_SHUTDOWN_FAILED");
        assert.equal((error as AggregateError).errors.length, 1);
        return true;
      }
    );

    assert.deepEqual(order, ["feishu-stop"]);
    assert.equal(db.open, false, "database close remains the final cleanup stage");
  });
});
