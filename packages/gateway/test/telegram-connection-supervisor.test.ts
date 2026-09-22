import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TelegramConnectionSupervisor,
  type TelegramSupervisorAccount
} from "../src/services/integrations/telegram-connection-supervisor.js";
import type {
  TelegramPollingCallbacks,
  TelegramPollingHandlers
} from "../src/services/integrations/telegram-polling-client.js";

describe("TelegramConnectionSupervisor", () => {
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

  it("recreates a terminal client with bounded exponential backoff and redacted errors", async () => {
    const fixture = createFixture();
    const supervisor = fixture.createSupervisor();
    await supervisor.start();

    fixture.handles[0]!.callbacks.onError?.(new Error("terminal failure 999999:ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"));
    await flushAsyncCallbacks();
    assert.equal(supervisor.getHealth("user-1").state, "unhealthy");
    assert.doesNotMatch(supervisor.getHealth("user-1").lastErrorMessage ?? "", /999999:/);
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

  it("ignores callbacks and inbound events from a replaced client", async () => {
    const fixture = createFixture();
    const supervisor = fixture.createSupervisor();
    let admitted = 0;
    supervisor.registerHandlers("user-1", { onMessage: () => { admitted += 1; } });
    await supervisor.start();
    const old = fixture.handles[0]!;
    fixture.account.configRevision = 2;
    await supervisor.reconcileAccount("user-1");
    old.callbacks.onReady?.();
    old.callbacks.onError?.(new Error("late error"));
    await old.handlers.onMessage?.(undefined as never);
    await flushAsyncCallbacks();
    assert.equal(supervisor.getHealth("user-1").configRevision, 2);
    assert.equal(supervisor.getHealth("user-1").state, "connecting");
    assert.equal(fixture.handles[1]!.closed, false);
    assert.equal(admitted, 0);
    assert.equal(fixture.delays.length, 0);
    await supervisor.stop();
  });

  it("does not resurrect a disabled account through a stale error or retry", async () => {
    const fixture = createFixture();
    const supervisor = fixture.createSupervisor();
    await supervisor.start();
    fixture.handles[0]!.callbacks.onError?.(new Error("failure"));
    await flushAsyncCallbacks();
    fixture.account.enabled = false;
    await supervisor.reconcileAccount("user-1");
    fixture.handles[0]!.callbacks.onError?.(new Error("late failure"));
    await flushAsyncCallbacks();
    await fixture.runNextTimer();
    await fixture.runNextTimer();
    assert.equal(fixture.handles.length, 1);
    assert.equal(supervisor.getHealth("user-1").state, "disabled");
    await supervisor.stop();
  });

  it("rechecks enabled configuration at retry time and coalesces repeated failures", async () => {
    const fixture = createFixture();
    const supervisor = fixture.createSupervisor();
    await supervisor.start();
    fixture.handles[0]!.callbacks.onError?.(new Error("first"));
    fixture.handles[0]!.callbacks.onError?.(new Error("duplicate"));
    await flushAsyncCallbacks();
    assert.equal(fixture.delays.length, 1);
    fixture.account.enabled = false;
    await fixture.runNextTimer();
    assert.equal(fixture.handles.length, 1);
    assert.equal(supervisor.getHealth("user-1").state, "disabled");
    await supervisor.stop();
  });

  it("records safe health when construction fails without rejecting start", async () => {
    const fixture = createFixture();
    fixture.constructError = new Error("botToken=999999:PLAINSECRETABCDEFGHIJKLMNOPQRSTUVWXYZ failed");
    const supervisor = fixture.createSupervisor();

    await assert.doesNotReject(() => supervisor.start());
    assert.equal(supervisor.getHealth("user-1").state, "unhealthy");
    assert.doesNotMatch(supervisor.getHealth("user-1").lastErrorMessage ?? "", /999999:/);
  });

  it("passes learned bot identities through to the account source", async () => {
    const fixture = createFixture();
    const supervisor = fixture.createSupervisor();
    await supervisor.start();

    fixture.handles[0]!.callbacks.onIdentity?.({ id: 111, username: "forgebadger_bot", firstName: "FB" });
    await flushAsyncCallbacks();
    assert.deepEqual(fixture.usernameWrites, [["user-1", "forgebadger_bot"]]);

    fixture.handles[0]!.callbacks.onIdentity?.({ id: 111, username: null, firstName: "FB" });
    await flushAsyncCallbacks();
    assert.deepEqual(fixture.usernameWrites, [["user-1", "forgebadger_bot"], ["user-1", null]]);
    await supervisor.stop();
  });
});

function createFixture() {
  const account: TelegramSupervisorAccount = {
    userId: "user-1",
    accountId: "account-1",
    botToken: "999999:ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890",
    botUsername: null,
    enabled: true,
    configRevision: 1
  };
  const handles: Array<{
    callbacks: TelegramPollingCallbacks;
    handlers: TelegramPollingHandlers;
    closed: boolean;
  }> = [];
  const timers: Array<() => void> = [];
  const delays: number[] = [];
  const usernameWrites: Array<[string, string | null]> = [];
  let cancelledTimers = 0;
  let constructError: Error | undefined;

  return {
    account,
    handles,
    delays,
    usernameWrites,
    get cancelledTimers() { return cancelledTimers; },
    get constructError() { return constructError; },
    set constructError(value: Error | undefined) { constructError = value; },
    createSupervisor() {
      return new TelegramConnectionSupervisor({
        accounts: {
          listEnabled: () => [account],
          get: (userId) => userId === account.userId ? account : undefined,
          updateHealth: () => undefined,
          updateBotUsername: (userId, botUsername) => { usernameWrites.push([userId, botUsername]); }
        },
        createPollingClient: (_config, callbacks, handlers) => {
          if (constructError) throw constructError;
          const handle = {
            callbacks,
            handlers,
            closed: false,
            start: async () => new Promise<void>(() => undefined),
            close(_force?: boolean) { handle.closed = true; }
          };
          handles.push(handle);
          return handle;
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
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  };
}

async function flushAsyncCallbacks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
