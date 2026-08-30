import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { FeishuChannelRepository } from "../src/db/repositories/feishu-channel-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { createGatewayApp } from "../src/server.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import { OpenForgeEventBus } from "../src/services/event-bus.js";
import { FeishuChannelRuntime } from "../src/services/integrations/feishu-channel-runtime.js";
import { createFeishuSdkHandlers } from "../src/services/integrations/feishu-runtime-factory.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";

const masterKey = "0123456789abcdef0123456789abcdef";

describe("FeishuChannelRuntime", () => {
  it("keeps startup non-blocking and delegates rolling account reconciliation", async () => {
    const reconciled: string[] = [];
    const runtime = new FeishuChannelRuntime({
      supervisor: {
        start: async () => new Promise<void>(() => undefined),
        stop: async () => undefined,
        reconcileAccount: async (userId) => { reconciled.push(userId); },
        getHealth: () => health("connected")
      },
      setInterval: () => 1,
      clearInterval: () => undefined
    });

    await runtime.start();
    await runtime.reconcileAccount("user-1");

    assert.deepEqual(reconciled, ["user-1"]);
    assert.equal(runtime.getHealth("user-1").state, "connected");
  });

  it("applies emergency stop and exposes only redacted health", async () => {
    let supervisorStops = 0;
    const runtime = new FeishuChannelRuntime({
      supervisor: {
        start: async () => undefined,
        stop: async () => { supervisorStops += 1; },
        reconcileAccount: async () => undefined,
        getHealth: () => ({ ...health("unhealthy"), lastErrorMessage: "app_secret=plain-secret token=abc failure" })
      },
      setInterval: () => 1,
      clearInterval: () => undefined
    });
    await runtime.start();

    await runtime.emergencyStop();

    assert.equal(supervisorStops, 1);
    assert.doesNotMatch(runtime.getHealth("user-1").lastErrorMessage ?? "", /plain-secret|token=abc/u);
  });

  it("does not start supervisor side effects after a same-tick stop", async () => {
    let supervisorStarts = 0;
    let supervisorStops = 0;
    const runtime = new FeishuChannelRuntime({
      supervisor: {
        start: async () => { supervisorStarts += 1; },
        stop: async () => { supervisorStops += 1; },
        reconcileAccount: async () => undefined,
        getHealth: () => health("connected")
      },
      setInterval: () => 1,
      clearInterval: () => undefined
    });

    void runtime.start();
    await runtime.stop();
    await new Promise((resolve) => setImmediate(resolve));
    await runtime.stop();

    assert.equal(supervisorStarts, 0, "queued start must not create SDK side effects after close");
    assert.equal(supervisorStops, 1, "stop remains idempotent");
  });

  it("drains active worker cycles before shutdown", async () => {
    let tick: (() => void) | undefined;
    let release: (() => void) | undefined;
    let completed = false;
    const runtime = new FeishuChannelRuntime({
      supervisor: {
        start: async () => undefined, stop: async () => undefined,
        reconcileAccount: async () => undefined, getHealth: () => health("connected")
      },
      workers: [async () => {
        await new Promise<void>((resolve) => { release = resolve; });
        completed = true;
      }],
      setInterval: (callback) => { tick = callback; return 1; },
      clearInterval: () => undefined,
      drainTimeoutMs: 1_000
    });
    await runtime.start();
    tick?.();
    await new Promise((resolve) => setImmediate(resolve));

    const stopping = runtime.stop();
    release?.();
    await stopping;

    assert.equal(completed, true);
  });

  it("acknowledges a card click inline and records a durable rejection when no binding exists", () => {
    const db = createTestDb();
    const userId = new UserRepository(db).create("card-ack@example.com", "hash").id;
    const repository = new FeishuChannelRepository(db, userId, masterKey);
    repository.upsertAccount({
      appId: "cli_card_ack",
      appSecret: "secret",
      enabled: true
    });
    const actionId = "action-card-ack";
    const handlers = createFeishuSdkHandlers({ db, masterKey, userId });

    const response = handlers.onCardAction({
      token: "callback-token",
      context: { open_message_id: "om_card", open_chat_id: "oc_chat" },
      operator: { open_id: "ou_owner" },
      action: { value: { action_id: actionId } }
    });

    // The inline card acknowledgement prevents provider retries from becoming a
    // second delivery channel, and the selector persists a durable rejection.
    assert.equal(response?.card.type, "raw");
    assert.match(response?.card.data.header.title.content ?? "", /已收到/);
    const ingress = db.prepare(
      "SELECT handler_kind, state, rejection_code FROM portfolio_feishu_ingress_events"
    ).all() as Array<{ handler_kind: string; state: string; rejection_code: string }>;
    assert.deepEqual(ingress, [{ handler_kind: "portfolio", state: "denied", rejection_code: "PORTFOLIO_FEISHU_HANDLER_AMBIGUOUS" }]);
  });

  it("attaches complete agent deps before starting the production runtime window", async () => {
    const db = createTestDb();
    const eventBus = new OpenForgeEventBus();
    const sessionManager = new InMemorySessionManager({
      async createSession() {}, async killSession() {}, async capturePane() { return ""; },
      async listSessions() { return [] as string[]; }, async sendInput() {}
    } as never);
    let runtime: FeishuChannelRuntime;
    let depsObservedAtStart: ReturnType<FeishuChannelRuntime["getAgentDeps"]>;
    let ambiguousWindowMessage = false;
    runtime = new FeishuChannelRuntime({
      supervisor: {
        start: async () => {
          depsObservedAtStart = runtime.getAgentDeps();
          ambiguousWindowMessage = depsObservedAtStart === undefined;
        },
        stop: async () => undefined,
        reconcileAccount: async () => undefined,
        getHealth: () => health("connected")
      },
      setInterval: () => 1,
      clearInterval: () => undefined
    });

    const app = createGatewayApp({
      jwtSecret: "0123456789abcdef0123456789abcdef",
      masterKey,
      db,
      sessionManager,
      apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
      eventBus,
      feishuChannelRuntime: runtime
    });

    try {
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(ambiguousWindowMessage, false);
      assert.ok(depsObservedAtStart);
      assert.equal(depsObservedAtStart, runtime.getAgentDeps());
      assert.equal(depsObservedAtStart.eventBus, eventBus);
      assert.equal(depsObservedAtStart.sessionManager, sessionManager);
      assert.ok(depsObservedAtStart.portfolioApi);
    } finally {
      await app.close();
    }
  });
});

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
  return db;
}

function health(state: "connected" | "unhealthy") {
  return {
    state, accountId: "account-1", configRevision: 1, reconnectAttempt: 0,
    lastConnectedAt: new Date(), lastErrorMessage: null
  } as const;
}
