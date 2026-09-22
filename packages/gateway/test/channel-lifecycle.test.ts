import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ChannelWorkerScheduler } from "../src/services/channels/channel-worker-scheduler.js";
import { FeishuChannelRuntime } from "../src/services/integrations/feishu-channel-runtime.js";
import { FeishuConnectionSupervisor, type FeishuSupervisorAccount, type FeishuConnectionHealth } from "../src/services/integrations/feishu-connection-supervisor.js";
import type { FeishuSdkCallbacks, FeishuSdkEventHandlers } from "../src/services/integrations/feishu-sdk.js";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function account(userId = "user-1"): FeishuSupervisorAccount {
  return { userId, accountId: userId, appId: "test", appSecret: "fixture", enabled: true, configRevision: 1 };
}
function fixture(options: {
  list?: () => Promise<FeishuSupervisorAccount[]>;
  get?: (id: string) => Promise<FeishuSupervisorAccount | undefined>;
  persist?: (id: string, health: FeishuConnectionHealth) => Promise<void>;
} = {}) {
  const accounts = [account(), account("user-2")];
  const handles: Array<{ callbacks: FeishuSdkCallbacks; handlers: FeishuSdkEventHandlers; closed: boolean; throwClose: boolean }> = [];
  const supervisor = new FeishuConnectionSupervisor({
    accounts: {
      listEnabled: options.list ?? (() => accounts),
      get: options.get ?? ((id) => accounts.find((value) => value.userId === id)),
      updateHealth: options.persist ?? (() => undefined)
    },
    sdkFactory: { createWebSocketClient: (_config, callbacks, handlers) => {
      const handle = { callbacks, handlers, closed: false, throwClose: false };
      handles.push(handle);
      return {
        start: async () => undefined,
        close: () => { handle.closed = true; if (handle.throwClose) throw new Error("fixture-close"); },
        getConnectionStatus: () => ({ state: "idle", reconnectAttempts: 0 })
      };
    } }
  });
  return { supervisor, handles, accounts };
}

describe("channel lifecycle composition", () => {
  it("fences ingress synchronously when runtime stop is called", async () => {
    const f = fixture();
    let admitted = 0;
    f.supervisor.registerHandlers("user-1", { onMessage: () => { admitted += 1; }, onCardAction: () => { admitted += 1; } });
    const runtime = new FeishuChannelRuntime({ supervisor: f.supervisor });
    await runtime.start(); await flush();
    const stopping = runtime.stop();
    f.handles[0]!.handlers.onMessage?.({}, { botOpenId: "fixture" });
    f.handles[0]!.handlers.onCardAction?.({});
    await stopping;
    assert.equal(admitted, 0);
  });

  it("replaces a client that fails while an unchanged config lookup is pending", async () => {
    const read = deferred<FeishuSupervisorAccount>();
    let pending = false;
    const f = fixture({ list: async () => [account()], get: async () => pending ? read.promise : account() });
    await f.supervisor.start();
    pending = true;
    const updating = f.supervisor.reconcileAccount("user-1");
    f.handles[0]!.callbacks.onError?.(new Error("terminal fixture"));
    read.resolve(account()); await updating;
    assert.equal(f.handles.length, 2);
    assert.equal(f.handles[0]!.closed, true);
    await f.supervisor.stop();
  });

  it("keeps the newer reconciliation when account reads complete out of order", async () => {
    const reads: Array<ReturnType<typeof deferred<FeishuSupervisorAccount>>> = [];
    const f = fixture({ list: async () => [], get: async () => {
      const read = deferred<FeishuSupervisorAccount>(); reads.push(read); return read.promise;
    } });
    await f.supervisor.start();
    const first = f.supervisor.reconcileAccount("user-1");
    const second = f.supervisor.reconcileAccount("user-1");
    reads[1]!.resolve({ ...account(), configRevision: 2 });
    await second;
    reads[0]!.resolve(account());
    await first;
    assert.equal(f.handles.length, 1);
    assert.equal(f.supervisor.getHealth("user-1").configRevision, 2);
    await f.supervisor.stop();
  });

  it("does not replace explicit reconciliation with a late startup snapshot", async () => {
    const listing = deferred<FeishuSupervisorAccount[]>();
    const f = fixture({ list: () => listing.promise });
    const starting = f.supervisor.start();
    f.accounts[0]!.configRevision = 2;
    await f.supervisor.reconcileAccount("user-1");
    listing.resolve([account()]);
    await starting;
    assert.equal(f.handles.length, 1);
    assert.equal(f.supervisor.getHealth("user-1").configRevision, 2);
    await f.supervisor.stop();
  });

  it("isolates account read and health persistence failures from other accounts", async () => {
    const f = fixture({
      get: async (id) => { if (id === "user-1") throw new Error("private fixture"); return account(id); },
      persist: async () => { throw new Error("private fixture"); }
    });
    await f.supervisor.start();
    await flush();
    assert.equal(f.handles.length, 1);
    assert.equal(f.supervisor.getHealth("user-1").lastErrorMessage, "FEISHU_ACCOUNT_READ_FAILED");
    assert.equal(f.supervisor.getHealth("user-2").state, "connecting");
    await f.supervisor.stop();
    assert.equal(f.handles[0]!.closed, true);
  });

  it("does not connect after stop during startup listing or account lookup", async () => {
    const listing = deferred<FeishuSupervisorAccount[]>();
    const f = fixture({ list: () => listing.promise });
    const starting = f.supervisor.start();
    await f.supervisor.stop();
    listing.resolve([account()]);
    await starting;
    assert.equal(f.handles.length, 0);

    const read = deferred<FeishuSupervisorAccount>();
    const g = fixture({ list: async () => [], get: () => read.promise });
    await g.supervisor.start();
    const reconciling = g.supervisor.reconcileAccount("user-1");
    await g.supervisor.stop();
    read.resolve(account());
    await reconciling;
    assert.equal(g.handles.length, 0);
  });

  it("retains callbacks after unchanged reconciliation and fences both event kinds after stop", async () => {
    const f = fixture();
    let admitted = 0;
    f.supervisor.registerHandlers("user-1", {
      onMessage: () => { admitted += 1; }, onCardAction: () => { admitted += 1; }
    });
    await f.supervisor.start();
    await f.supervisor.reconcileAccount("user-1");
    const h = f.handles[0]!;
    h.callbacks.onReady?.();
    await h.handlers.onMessage?.({}, { botOpenId: "fixture" });
    await h.handlers.onCardAction?.({});
    assert.equal(admitted, 2);
    assert.equal(f.supervisor.getHealth("user-1").state, "connected");
    await f.supervisor.stop();
    h.callbacks.onReady?.();
    await h.handlers.onMessage?.({}, { botOpenId: "fixture" });
    await h.handlers.onCardAction?.({});
    assert.equal(admitted, 2);
    assert.equal(f.supervisor.getHealth("user-1").state, "stopped");
  });

  it("serializes delayed health persistence and closes every client despite close failure", async () => {
    const write = deferred<void>();
    const persisted: string[] = [];
    const f = fixture({ persist: async (id, health) => {
      if (id !== "user-1") return;
      if (health.state === "connecting") await write.promise;
      persisted.push(health.state);
    } });
    await f.supervisor.start();
    await flush();
    f.handles[0]!.throwClose = true;
    const stopping = f.supervisor.stop();
    assert.ok(f.handles.every((h) => h.closed));
    assert.equal(f.supervisor.getHealth("user-1").state, "stopped");
    write.resolve();
    await stopping;
    assert.deepEqual(persisted, ["connecting", "stopped"]);
  });

  it("bounds runtime shutdown when health persistence hangs, with all sockets closed", async () => {
    const f = fixture({ persist: () => new Promise<void>(() => undefined) });
    const runtime = new FeishuChannelRuntime({ supervisor: f.supervisor, drainTimeoutMs: 100 });
    await runtime.start();
    await flush();
    assert.equal(f.handles.length, 2);
    const one = runtime.stop();
    const two = runtime.stop();
    await Promise.all([
      assert.rejects(one, /CHANNEL_SHUTDOWN_TIMEOUT/),
      assert.rejects(two, /CHANNEL_SHUTDOWN_TIMEOUT/)
    ]);
    assert.ok(f.handles.every((h) => h.closed));
    assert.equal(f.supervisor.getHealth("user-2").state, "stopped");
  });

  it("does not reconcile after account preparation completes after shutdown", async () => {
    const preparation = deferred<void>();
    const f = fixture();
    let reconciled = 0;
    const runtime = new FeishuChannelRuntime({
      supervisor: {
        start: () => f.supervisor.start(), stop: () => f.supervisor.stop(),
        getHealth: (id) => f.supervisor.getHealth(id),
        reconcileAccount: async () => { reconciled += 1; }
      }, prepareAccount: () => preparation.promise
    });
    await runtime.start();
    const preparing = runtime.reconcileAccount("user-1");
    const rejected = assert.rejects(preparing, /FEISHU_RUNTIME_NOT_RUNNING/);
    await runtime.stop();
    preparation.resolve();
    await rejected;
    assert.equal(reconciled, 0);
  });
});

describe("ChannelWorkerScheduler", () => {
  it("shares shutdown even when an abort listener reenters stop", async () => {
    let tick!: () => void;
    let nested: Promise<void> | undefined;
    let cleaned = 0;
    const cleanup = async () => { cleaned += 1; };
    const scheduler = new ChannelWorkerScheduler({
      workers: [async (signal) => new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => { nested = scheduler.stop(cleanup); resolve(); }, { once: true });
      })],
      setInterval: (callback) => { tick = callback; return 1; }, clearInterval: () => undefined
    });
    scheduler.start(); tick(); await flush();
    const outer = scheduler.stop(cleanup);
    await outer;
    assert.equal(nested, outer);
    assert.equal(cleaned, 1);
  });

  it("signals active work, shares drain completion, and isolates worker/reporting failures", async () => {
    let tick!: () => void;
    const release = deferred<void>();
    let signal: AbortSignal | undefined;
    let fast = 0;
    let errors = 0;
    let cleanup = 0;
    const scheduler = new ChannelWorkerScheduler({
      workers: [async (input) => { signal = input; await release.promise; },
        async () => { fast += 1; throw new Error("fixture"); }],
      onWorkerError: () => { errors += 1; throw new Error("reporter fixture"); },
      setInterval: (callback) => { tick = callback; return 1; }, clearInterval: () => undefined
    });
    scheduler.start();
    tick(); await flush(); tick(); await flush();
    assert.equal(fast, 2);
    assert.equal(errors, 2);
    const one = scheduler.stop(async () => { cleanup += 1; });
    const two = scheduler.stop();
    assert.equal(one, two);
    assert.equal(signal?.aborted, true);
    let stopped = false;
    void two.then(() => { stopped = true; });
    await flush();
    assert.equal(stopped, false);
    release.resolve(); await one;
    tick(); await flush();
    assert.equal(fast, 2);
    assert.equal(cleanup, 1);
  });

  it("times out an uncooperative worker and never reschedules it", async () => {
    let tick!: () => void;
    let calls = 0;
    const scheduler = new ChannelWorkerScheduler({
      workers: [async () => { calls += 1; await new Promise<void>(() => undefined); }],
      drainTimeoutMs: 100,
      setInterval: (callback) => { tick = callback; return 1; }, clearInterval: () => undefined
    });
    scheduler.start(); tick(); await flush();
    await assert.rejects(scheduler.stop(), /CHANNEL_SHUTDOWN_TIMEOUT/);
    scheduler.start(); tick(); await flush();
    assert.equal(calls, 1);
  });

  it("still cleans up after timer disposal failure and uses finite interval defaults", async () => {
    let tick!: () => void;
    let interval = 0;
    let cleaned = false;
    let calls = 0;
    const scheduler = new ChannelWorkerScheduler({
      workerIntervalMs: Number.NaN,
      workers: [async () => { calls += 1; }],
      setInterval: (callback, milliseconds) => { tick = callback; interval = milliseconds; return 1; },
      clearInterval: () => { throw new Error("private fixture"); }
    });
    scheduler.start();
    assert.equal(interval, 250);
    await assert.rejects(scheduler.stop(async () => { cleaned = true; }), /CHANNEL_TIMER_CLEANUP_FAILED/);
    tick(); await flush();
    assert.equal(cleaned, true);
    assert.equal(calls, 0);
  });

  it("drains workers even if supervisor cleanup rejects", async () => {
    let tick!: () => void;
    const released = deferred<void>();
    const scheduler = new ChannelWorkerScheduler({
      workers: [async () => released.promise],
      setInterval: (callback) => { tick = callback; return 1; }, clearInterval: () => undefined
    });
    scheduler.start(); tick(); await flush();
    let settled = false;
    const stopped = scheduler.stop(async () => { throw new Error("fixture secret"); });
    const rejected = assert.rejects(stopped, /CHANNEL_SHUTDOWN_FAILED/).then(() => { settled = true; });
    await flush(); assert.equal(settled, false);
    released.resolve(); await rejected;
  });
});
