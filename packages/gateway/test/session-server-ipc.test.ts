/**
 * Integration test for Session Server IPC.
 *
 * Each test uses a unique IPC path. A short delay after server.start()
 * ensures the pipe is ready for client connections on Windows.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { SessionServer } from "../src/services/session-server/session-server.js";
import { IpcServer } from "../src/services/session-server/ipc-server.js";
import { createPlatformAdapter } from "../src/services/session-server/platform-adapter.js";
import { SessionServerClient } from "../src/services/session-server-client.js";
import type { LaunchPlanPayload } from "../src/services/session-server/ipc-protocol.js";

let testCounter = 0;
function uniqueIpcPath(): string {
  testCounter++;
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\forgebadger-ss-it-${testCounter}-${Date.now()}`;
  }
  const adapter = createPlatformAdapter();
  const dir = mkdtempSync(join(tmpdir(), "ss-it-"));
  return `${adapter.getIpcPath(dir)}-${testCounter}`;
}

const shell = process.platform === "win32" ? "cmd.exe" : "bash";
const shellArg = process.platform === "win32" ? "/c" : "-c";

function shellPlan(cwd: string, cmd: string): LaunchPlanPayload {
  return { command: shell, args: [shellArg, cmd], cwd, env: {}, secretEnvNames: [], credentialMode: "host_environment" };
}

/** Start IPC server + client, wait briefly for Windows pipe readiness. */
async function startPair(ipcPath: string, cwd: string) {
  const sessionServer = new SessionServer();
  const ipcServer = new IpcServer({ ipcPath, sessionServer });
  await ipcServer.start();
  // Give the pipe time to be fully ready on Windows
  await new Promise((r) => setTimeout(r, 150));
  const client = new SessionServerClient({ ipcPath });
  await client.connect();
  return { sessionServer, ipcServer, client };
}

describe("Session Server IPC", () => {
  const cwd = mkdtempSync(join(tmpdir(), "ss-ipc-"));

  after(async () => {
    // Wait for child processes to exit so files are not locked on Windows
    await new Promise((r) => setTimeout(r, 200));
    try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("create session via IPC and verify management", async () => {
    const ipcPath = uniqueIpcPath();
    const { ipcServer, client } = await startPair(ipcPath, cwd);
    try {
      const plan = shellPlan(cwd, "echo ipc && exit 0");

      await client.createSession({
        name: "ipc-s1", cwd: plan.cwd, command: plan.command, args: plan.args, env: plan.env
      });

      const sessions = await client.listSessions();
      assert.ok(sessions.length >= 1);

      const has = await client.hasSession("ipc-s1");
      assert.strictEqual(has, true);

      const scrollback = await client.capturePane("ipc-s1");
      assert.strictEqual(typeof scrollback, "string");
    } finally {
      await client.disconnect();
      await ipcServer.stop();
    }
  });

  it("kills session via IPC", async () => {
    const ipcPath = uniqueIpcPath();
    const { ipcServer, client } = await startPair(ipcPath, cwd);
    try {
      await client.createSession({
        name: "ipc-k1", cwd, command: shell, args: [shellArg, "exit 0"], env: {}
      });

      await client.killSession("ipc-k1");

      const has = await client.hasSession("ipc-k1");
      assert.strictEqual(has, false);
    } finally {
      await client.disconnect();
      await ipcServer.stop();
    }
  });

  it("naturally exited sessions become invisible via IPC", async () => {
    const ipcPath = uniqueIpcPath();
    const { ipcServer, client } = await startPair(ipcPath, cwd);
    try {
      await client.createSession({
        name: "ipc-x1", cwd, command: shell, args: [shellArg, "exit 0"], env: {}
      });
      assert.strictEqual(await client.hasSession("ipc-x1"), true);

      // The process exits on its own; after the exit relay the server must
      // drop the session so has_session reports false (tmux semantics, which
      // session-manager.reconcileSessionStatus relies on).
      const start = Date.now();
      let has = true;
      while (has && Date.now() - start < 10_000) {
        await new Promise((r) => setTimeout(r, 100));
        has = await client.hasSession("ipc-x1");
      }
      assert.strictEqual(has, false, "session should be removed after natural exit");
    } finally {
      await client.disconnect();
      await ipcServer.stop();
    }
  });
});
