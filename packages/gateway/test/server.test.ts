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
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { createServer, createGatewayApp, type GatewayApp } from "../src/server.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { PortfolioFeishuRegistryRepository } from "../src/db/repositories/portfolio-feishu-registry-repository.js";
import { FeishuChannelRuntime } from "../src/services/integrations/feishu-channel-runtime.js";
import { createFeishuCopilotChannel } from "../src/services/integrations/feishu-copilot-channel.js";

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
      eventBus: new ForgeBadgerEventBus()
    });

    const stack = (app as { _router?: { stack?: { handle?: unknown }[] } })._router?.stack ?? [];
    const lastLayer = stack.at(-1);
    assert.equal(lastLayer?.handle, errorHandler);

    db.close();
  });
});

describe("copilot reactive loop gateway gate", () => {
  function createTestDb(): Database.Database {
    const db = new Database(":memory:");
    migrate(drizzle(db), {
      migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
    });
    return db;
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function startApp(overrides: { copilotReactiveEnabled?: boolean }): Promise<{
    app: GatewayApp;
    log: CopilotConversationLog;
  }> {
    const db = createTestDb();
    const user = new UserRepository(db).create("reactive-gate@example.com", "hash");
    const app = createGatewayApp({
      jwtSecret,
      masterKey,
      db,
      sessionManager: new InMemorySessionManager({} as never),
      apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
      ...(overrides.copilotReactiveEnabled ? { copilotReactiveEnabled: true } : {})
    });
    return { app, log: new CopilotConversationLog(db, user.id) };
  }

  function emitTriggerEvent(app: GatewayApp): void {
    // A user row must exist for the event to be meaningful, but the loop does
    // not validate it — the id is all the debounce/cooldown state needs.
    app.eventBus.emitEvent({
      type: "session_status_changed",
      userId: "user-reactive-gate",
      sessionId: "s1",
      oldStatus: "running",
      newStatus: "completed",
      occurredAt: new Date()
    });
  }

  it("does not attach the reactive loop by default: events never self-start conversations", async () => {
    const { app, log } = await startApp({});
    try {
      // Default off: no listener is attached at all.
      assert.equal(app.reactiveLoop, undefined);
      emitTriggerEvent(app);
      await sleep(60);
      assert.equal(log.listConversations().length, 0);
    } finally {
      await app.close();
    }
  });

  it("attaches the reactive loop when opted in via copilotReactiveEnabled", async () => {
    const { app } = await startApp({ copilotReactiveEnabled: true });
    try {
      // Opted in: the loop handle exists and close() stops it (behavior of the
      // loop itself is covered by agent-reactive-loop.test.ts).
      assert.ok(app.reactiveLoop);
    } finally {
      await app.close();
    }
  });
});

describe("Gateway Feishu shutdown ordering", () => {
  it("stops ingress and drains a held Feishu turn before later runtimes and the database", async () => {
    const db = new Database(":memory:");
    migrate(drizzle(db), {
      migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
    });
    const userId = new UserRepository(db).create("feishu-close-order@example.com", "hash").id;
    const providerAccount = new PortfolioFeishuRegistryRepository(db).register({
      userId,
      provider: "feishu",
      providerAccountId: "cli-feishu-close-order"
    });
    const eventBus = new ForgeBadgerEventBus();
    const sessionManager = new InMemorySessionManager({} as never);
    const order: string[] = [];
    let app: GatewayApp;
    let releaseTurn: (() => void) | undefined;
    let markTurnStarted: (() => void) | undefined;
    const turnStarted = new Promise<void>((resolve) => { markTurnStarted = resolve; });
    const held = new Promise<void>((resolve) => { releaseTurn = resolve; });
    const runtime = new FeishuChannelRuntime({
      supervisor: {
        start: async () => undefined,
        stop: async () => {
          order.push(app.server.listening ? "feishu-stop-before-http-close" : "http-close-then-feishu-stop");
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
    app = createGatewayApp({
      jwtSecret,
      masterKey,
      db,
      sessionManager,
      apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
      eventBus,
      feishuChannelRuntime: runtime,
      operationsRuntime: {
        stop: async () => {
          assert.equal(db.open, true, "operations stop must precede database close");
          order.push("operations-stop");
        }
      }
    });
    await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const stackFactory = (_deps: unknown, actingUserId: string) => {
      const log = new CopilotConversationLog(db, actingUserId);
      return {
        log,
        memory: {},
        toolRegistry: { tools: new Map() },
        orchestrator: {
          async runTurn(input: { conversationId: string; userText: string }) {
            order.push("turn-start");
            markTurnStarted?.();
            await held;
            log.appendMessage(input.conversationId, {
              role: "user", kind: "text", content: input.userText
            });
            const run = log.createRun(input.conversationId, {});
            log.appendMessage(input.conversationId, {
              role: "assistant", kind: "text", content: "done"
            });
            log.updateRun(run.id, { status: "completed", completedAt: new Date() });
            order.push("turn-end");
            return run.id;
          },
          async resumeAfterApproval() { return { resumed: false, runId: "none" }; },
          async cancelRun() { return { cancelled: false, runId: "none" }; }
        }
      };
    };
    const channel = createFeishuCopilotChannel({
      deps: { db, masterKey, eventBus },
      buildAgentStack: stackFactory as never,
      sendMessage: async () => undefined,
      userId,
      providerAccountId: providerAccount.id,
      transport: "long_connection"
    });
    const ingress = {
      chatId: "oc-close-order",
      text: "held turn",
      providerEventId: "ev-close-order",
      senderIdentity: "ou-owner"
    };
    assert.equal(channel.admitMessage(ingress), true);
    const processing = channel.processMessage(ingress);
    await turnStarted;

    let closeSettled = false;
    const closing = app.close().then(() => { closeSettled = true; });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(order.includes("http-close-then-feishu-stop"), true);
    assert.equal(order.includes("operations-stop"), false);
    assert.equal(closeSettled, false, "close must wait for the active Feishu queue");
    assert.equal(db.open, true);

    releaseTurn?.();
    await processing;
    await closing;

    assert.deepEqual(order, [
      "turn-start",
      "http-close-then-feishu-stop",
      "turn-end",
      "operations-stop"
    ]);
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
      feishuChannelRuntime: runtime,
      operationsRuntime: {
        stop: async () => {
          assert.equal(db.open, true, "later runtime cleanup must precede database close");
          order.push("operations-stop");
          throw new Error("operations stop failed");
        }
      }
    });

    await assert.rejects(
      app.close(),
      (error: unknown) => {
        assert.equal(error instanceof AggregateError, true);
        assert.equal((error as AggregateError).message, "GATEWAY_SHUTDOWN_FAILED");
        assert.equal((error as AggregateError).errors.length, 2);
        return true;
      }
    );

    assert.deepEqual(order, ["feishu-stop", "operations-stop"]);
    assert.equal(db.open, false, "database close remains the final cleanup stage");
  });
});
