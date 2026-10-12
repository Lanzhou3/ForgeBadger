import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionWriterLeases } from "../src/services/session-writer-leases.js";
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
        return { content: pane, dead: false };
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

test('terminal wheel input preserves the writer fence, tenant checks and dispatch evidence', async () => {
  const manager = new InMemorySessionManager({
    async createSession() {}, async killSession() {}, async listSessions() { return []; },
    async hasSession() { return true; }, async capturePane() { return ''; },
  });
  await manager.createSession({ userId: 'u', sessionId: 's', launchPlan: {
    command: 'pi', args: [], cwd: '/tmp', env: {}, secretEnvNames: [], credentialMode: 'host_environment',
  } });
  const lease = manager.acquireWriterLease({ userId: 'u', sessionId: 's', workspace: '/tmp' });
  const writes: string[] = [];
  let interventions = 0;
  manager.noteManualInput = () => { interventions++; };
  const buffer = new TerminalInputBuffer(data => manager.assertTerminalInputAllowed('u', 's', data));
  const wheel = '\x1b[<65;10;10M';
  buffer.writeOrStore(undefined, wheel);
  buffer.flush({ write: value => writes.push(value) });
  for (const data of ['x', '\r', '\x1b[A', '\x1b[<0;10;10M', '\x1b[<35;10;10M', wheel + 'x', wheel + '\r', '\x1b[<65;10;10M\n', '\x1b[<65;10M'])
    assert.throws(() => buffer.writeOrStore({ write: value => writes.push(value) }, data), /WRITER_BUSY/, JSON.stringify(data));
  assert.deepEqual(writes, [wheel]);
  assert.equal(interventions, 0);
  assert.throws(() => manager.assertTerminalInputAllowed('other', 's', wheel), /SESSION_NOT_FOUND/);
  manager.assertWriterLeaseCurrent(lease);
  manager.releaseWriterLease(lease);
  buffer.writeOrStore({ write: value => writes.push(value) }, 'x');
  assert.equal(interventions, 1);
  assert.deepEqual(writes, [wheel, 'x']);
});
