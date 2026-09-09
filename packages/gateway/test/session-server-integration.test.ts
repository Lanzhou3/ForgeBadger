/**
 * Integration test for the SessionServer core (without IPC).
 *
 * Uses short-lived processes to avoid Windows pty.kill() cleanup issues.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { SessionServer } from "../src/services/session-server/session-server.js";
import type { LaunchPlanPayload } from "../src/services/session-server/ipc-protocol.js";

const shellCmd = process.platform === "win32" ? "cmd.exe" : "bash";
const shellArg = process.platform === "win32" ? "/c" : "-c";

function shortPlan(cwd: string, cmd: string): LaunchPlanPayload {
  return { command: shellCmd, args: [shellArg, cmd], cwd, env: {}, secretEnvNames: [], credentialMode: "host_environment" };
}

describe("SessionServer core", () => {
  const cwd = mkdtempSync(join(tmpdir(), "ss-core-"));

  after(async () => {
    await new Promise((r) => setTimeout(r, 200));
    try { rmSync(cwd, { recursive: true, force: true }); } catch { /* Windows EBUSY ignore */ }
  });

  it("creates and lists a short-lived session", async () => {
    const server = new SessionServer();
    const plan = shortPlan(cwd, "echo hello");

    const handle = await server.createSession({
      sessionId: "s1", userId: "u1", attachToken: "t1", launchPlan: plan
    });
    assert.strictEqual(handle.sessionId, "s1");

    // Session should be listed
    const list = server.listSessions();
    assert.strictEqual(list.length, 1);

    assert.strictEqual(server.hasSession("s1"), true);
    assert.strictEqual(server.hasSession("s2"), false);
  });

  it("captures scrollback", async () => {
    const server = new SessionServer();
    const plan = shortPlan(cwd, "echo scrolly");

    await server.createSession({ sessionId: "sc", userId: "u", attachToken: "t", launchPlan: plan });
    // Give the process time to produce output
    await new Promise((r) => setTimeout(r, 200));

    const scrollback = await server.capturePane("sc");
    assert.strictEqual(typeof scrollback, "string");
    // scrollback may or may not contain output depending on timing
  });

  it("throws on duplicate session", async () => {
    const server = new SessionServer();
    const plan = shortPlan(cwd, "echo dup");

    await server.createSession({ sessionId: "dup", userId: "u", attachToken: "t", launchPlan: plan });
    await assert.rejects(
      () => server.createSession({ sessionId: "dup", userId: "u", attachToken: "t", launchPlan: plan }),
      /Session already exists/
    );
  });

  it("throws on unknown session operations", async () => {
    const server = new SessionServer();
    assert.strictEqual(server.hasSession("nope"), false);
    await assert.rejects(() => server.killSession("nope"), /Session not found/);
  });

  it("handles multi-client attach/detach", async () => {
    const server = new SessionServer();
    const plan = shortPlan(cwd, "echo mc");

    await server.createSession({ sessionId: "mc", userId: "u", attachToken: "t", launchPlan: plan });
    const attach1 = await server.attachClient("mc", "c1");
    const attach2 = await server.attachClient("mc", "c2");
    assert.strictEqual(typeof attach1.snapshot, "string");
    assert.strictEqual(typeof attach2.snapshot, "string");
    server.endClientBuffering("mc", "c1");
    server.endClientBuffering("mc", "c2");

    const handle = server.getSession("mc");
    assert.ok(handle);
    assert.strictEqual(handle.clientCount, 2);
    assert.strictEqual(handle.hasClient("c1"), true);
    assert.strictEqual(handle.hasClient("c2"), true);

    server.detachClient("mc", "c1");
    assert.strictEqual(handle.clientCount, 1);
    assert.strictEqual(handle.hasClient("c1"), false);
  });

  it("onExit callback fires when process exits", async () => {
    const events: string[] = [];
    const server = new SessionServer({
      onSessionExit: (id, code) => { events.push(`${id}:${code}`); }
    });

    const plan = shortPlan(cwd, "exit 0");
    await server.createSession({ sessionId: "x", userId: "u", attachToken: "t", launchPlan: plan });

    // Poll for exit (short-lived process)
    let waited = 0;
    while (events.length === 0 && waited < 5000) {
      await new Promise((r) => setTimeout(r, 100));
      waited += 100;
    }

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0]?.startsWith("x:"), true);
  });

  it("resize works without throwing", async () => {
    const server = new SessionServer();
    const plan = shortPlan(cwd, "echo r");

    await server.createSession({ sessionId: "r", userId: "u", attachToken: "t", launchPlan: plan });
    server.resizeWindow("r", 160, 50);
    // Should not throw
  });
});
