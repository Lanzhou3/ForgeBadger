import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionWriterLeases } from "../src/services/session-writer-leases.js";
import { assertAdapterAutonomy, getAdapterAutonomy } from "../src/services/adapter-autonomy.js";
import { TerminalInputBuffer } from "../src/websocket/terminal.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";

for (const phase of ["inspect", "settle", "stop"] as const) {
  test(`takeover during ${phase} prevents subsequent programmatic writes`, async () => {
    const calls: string[] = [];
    let pane = "› Ask Codex to do anything\n\nmodel · cwd";
    const manager = new InMemorySessionManager({
      async createSession() {}, async killSession() {}, async listSessions() { return []; },
      async hasSession() { return true; },
      async capturePane() { return pane; },
      async inspectPane() {
        if (phase === "inspect") manager.takeoverSession("u", "s");
        return { content: pane, dead: false, inMode: false };
      },
      async stageProgrammaticInput(_name, data) { calls.push("stage"); pane = `› ${data}\n\nmodel · cwd`; },
      async pressEnter() { calls.push("enter"); }
    }, undefined, undefined, { sleep: async () => {
      assert.throws(() => manager.assertManualInputAllowed("u", "s"), /WRITER_BUSY/);
      if (phase === "stop") { await manager.stopSession("s"); return; }
      manager.takeoverSession("u", "s");
      manager.assertManualInputAllowed("u", "s");
    } });
    await manager.createSession({ userId: "u", sessionId: "s", launchPlan: {
      command: "codex", args: [], cwd: "/tmp", env: {}, secretEnvNames: [], credentialMode: "host_environment"
    } });
    await assert.rejects(manager.submitProgrammaticTask("s", { adapter: "codex", message: "hello" }),
      phase === "inspect" ? /WRITER_FENCE_STALE/ : /PROGRAMMATIC_SUBMIT_INDETERMINATE/);
    assert.deepEqual(calls, phase === "inspect" ? [] : ["stage"]);
    assert.throws(() => manager.takeoverSession("other", "s"), phase === "stop" ? /Unknown session/ : /SESSION_NOT_FOUND/);
  });
}

test("writer lease excludes sessions sharing a workspace and fences takeover", () => {
  const leases = new SessionWriterLeases();
  const scope = { userId: "u", sessionId: "a", workspace: "/tmp" };
  const first = leases.acquire(scope);
  assert.throws(() => leases.acquire({ ...scope, sessionId: "b" }), /WRITER_BUSY/);
  assert.throws(() => leases.assertManualInputAllowed(scope), /WRITER_BUSY/);
  leases.takeover(scope);
  assert.throws(() => leases.assertCurrent(first), /WRITER_FENCE_STALE/);
  const next = leases.acquire(scope);
  assert.ok(next.fence > first.fence);
  leases.release(first);
  leases.assertCurrent(next);
  leases.release(next);
  leases.assertManualInputAllowed(scope);
});

test("another tenant cannot revoke the workspace writer", () => {
  const leases = new SessionWriterLeases();
  const scope = { userId: "a", sessionId: "s", workspace: "/tmp" };
  const lease = leases.acquire(scope);
  assert.throws(() => leases.takeover({ ...scope, userId: "b" }), /WRITER_BUSY/);
  leases.assertCurrent(lease);
});

test("buffer rechecks writer authorization at flush and drops blocked bytes", () => {
  let allowed = true;
  const buffer = new TerminalInputBuffer(() => { if (!allowed) throw new Error("WRITER_BUSY"); });
  const writes: string[] = [];
  buffer.writeOrStore(undefined, "stale input");
  allowed = false;
  assert.throws(() => buffer.flush({ write: (value) => writes.push(value) }), /WRITER_BUSY/);
  allowed = true;
  buffer.flush({ write: (value) => writes.push(value) });
  assert.deepEqual(writes, []);
});

test("every production adapter requires manual execution", () => {
  for (const adapter of ["claude", "opencode", "codex", "kimi"] as const) {
    assert.equal(getAdapterAutonomy(adapter).mode, "manual_only");
    assert.throws(() => assertAdapterAutonomy(adapter), /ADAPTER_AUTONOMY_UNVERIFIED/);
  }
});
