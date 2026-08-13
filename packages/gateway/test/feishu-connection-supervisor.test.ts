import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FeishuConnectionSupervisor,
  type FeishuSupervisorAccount
} from "../src/services/integrations/feishu-connection-supervisor.js";

describe("FeishuConnectionSupervisor", () => {
  it("publishes connection lifecycle and keeps startup non-blocking", async () => {
    const fixture = createFixture();
    const supervisor = fixture.createSupervisor();

    await supervisor.start();
    assert.equal(supervisor.getHealth("user-1").state, "connecting");

    fixture.handles[0]!.callbacks.onReady?.();
    assert.equal(supervisor.getHealth("user-1").state, "connected");
    fixture.handles[0]!.callbacks.onReconnecting?.();
    assert.equal(supervisor.getHealth("user-1").state, "reconnecting");
    fixture.handles[0]!.callbacks.onReconnected?.();
    assert.equal(supervisor.getHealth("user-1").state, "connected");
  });

  it("recreates a terminal client with bounded exponential backoff", async () => {
    const fixture = createFixture();
    const supervisor = fixture.createSupervisor();
    await supervisor.start();

    fixture.handles[0]!.callbacks.onError?.(new Error("token=secret-value terminal failure"));
    await flushAsyncCallbacks();
    assert.equal(supervisor.getHealth("user-1").state, "unhealthy");
    assert.doesNotMatch(supervisor.getHealth("user-1").lastErrorMessage ?? "", /secret-value/);
    assert.deepEqual(fixture.delays, [1_000]);

    await fixture.runNextTimer();
    fixture.handles[1]!.callbacks.onError?.(new Error("second failure"));
    await flushAsyncCallbacks();
    assert.deepEqual(fixture.delays, [1_000, 2_000]);
  });

  it("rolls only the changed account revision and closes the old client", async () => {
    const fixture = createFixture();
    const supervisor = fixture.createSupervisor();
    await supervisor.start();
    await supervisor.reconcileAccount("user-1");
    assert.equal(fixture.handles.length, 1);

    fixture.account.configRevision = 2;
    await supervisor.reconcileAccount("user-1");
    assert.equal(fixture.handles[0]?.closed, true);
    assert.equal(fixture.handles.length, 2);
  });

  it("aborts timers and closes clients on stop", async () => {
    const fixture = createFixture();
    const supervisor = fixture.createSupervisor();
    await supervisor.start();
    fixture.handles[0]!.callbacks.onError?.(new Error("terminal"));
    await flushAsyncCallbacks();

    await supervisor.stop();

    assert.equal(fixture.handles[0]?.closed, true);
    assert.equal(fixture.cancelledTimers, 1);
    await fixture.runNextTimer();
    assert.equal(fixture.handles.length, 1);
  });

  it("records safe health when construction fails without rejecting start", async () => {
    const fixture = createFixture();
    fixture.constructError = new Error("app_secret=plain-secret failed");
    const supervisor = fixture.createSupervisor();

    await assert.doesNotReject(() => supervisor.start());
    assert.equal(supervisor.getHealth("user-1").state, "unhealthy");
    assert.doesNotMatch(supervisor.getHealth("user-1").lastErrorMessage ?? "", /plain-secret/);
  });
});

function createFixture() {
  const account: FeishuSupervisorAccount = {
    userId: "user-1",
    accountId: "account-1",
    appId: "cli_test",
    appSecret: "app-secret",
    enabled: true,
    configRevision: 1
  };
  const handles: Array<{
    callbacks: Record<string, ((error?: Error) => void) | undefined>;
    closed: boolean;
  }> = [];
  const timers: Array<() => void> = [];
  const delays: number[] = [];
  let cancelledTimers = 0;
  let constructError: Error | undefined;

  return {
    account,
    handles,
    delays,
    get cancelledTimers() { return cancelledTimers; },
    get constructError() { return constructError; },
    set constructError(value: Error | undefined) { constructError = value; },
    createSupervisor() {
      return new FeishuConnectionSupervisor({
        accounts: {
          listEnabled: () => [account],
          get: (userId) => userId === account.userId ? account : undefined,
          updateHealth: () => undefined
        },
        sdkFactory: {
          createWebSocketClient: (_config, callbacks) => {
            if (constructError) throw constructError;
            const handle = {
              callbacks,
              closed: false,
              start: async () => new Promise<void>(() => undefined),
              close() { handle.closed = true; },
              getConnectionStatus: () => ({ state: "idle" as const, reconnectAttempts: 0 })
            };
            handles.push(handle);
            return handle;
          }
        },
        timers: {
          set: (callback, delayMs) => {
            delays.push(delayMs);
            timers.push(callback);
            return callback;
          },
          clear: () => { cancelledTimers += 1; }
        },
        jitter: () => 0
      });
    },
    async runNextTimer() {
      const callback = timers.shift();
      callback?.();
      await Promise.resolve();
      await Promise.resolve();
    }
  };
}

async function flushAsyncCallbacks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
