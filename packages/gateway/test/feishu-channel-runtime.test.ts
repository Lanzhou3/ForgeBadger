import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FeishuChannelRuntime } from "../src/services/integrations/feishu-channel-runtime.js";


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

});

function health(state: "connected" | "unhealthy") {
  return {
    state, accountId: "account-1", configRevision: 1, reconnectAttempt: 0,
    lastConnectedAt: new Date(), lastErrorMessage: null
  } as const;
}
