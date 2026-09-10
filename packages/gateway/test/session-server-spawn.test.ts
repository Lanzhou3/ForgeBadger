/**
 * End-to-end test for the Session Server.
 *
 * Spawns the standalone session-server-entry as a child process (the same
 * way the Gateway integration does) and drives it through the
 * SessionServerClient — exercising the full IPC path, including Windows
 * named pipes / POSIX socket files and the tsx/entry resolution.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  startAndConnectSessionServer,
  type SessionServerIntegration
} from "../src/services/session-server-integration.js";
import { SESSION_SERVER_TOKEN_FILE_NAME } from "../src/services/session-server/auth-token.js";

const stateDir = mkdtempSync(join(tmpdir(), "fb-ss-e2e-"));
const ipcPath = process.platform === "win32"
  ? `\\\\.\\pipe\\forgebadger-ss-e2e-${process.pid}-${Date.now()}`
  : join(stateDir, "session-server.sock");

const isWin = process.platform === "win32";
const shortSession = isWin
  ? { command: "cmd.exe", args: ["/c", "echo e2e-ready && exit 0"] }
  : { command: "bash", args: ["-c", "echo e2e-ready; exit 0"] };
const longSession = isWin
  ? { command: "cmd.exe", args: ["/c", "ping -n 60 127.0.0.1"] }
  : { command: "bash", args: ["-c", "sleep 60"] };

async function pollUntilTrue(predicate: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`poll timeout after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe("Session Server spawn (e2e)", () => {
  let integration: SessionServerIntegration;

  before(async () => {
    integration = await startAndConnectSessionServer({ stateDir, ipcPath });
  });

  after(async () => {
    try {
      await integration.stop();
    } catch {
      // Best-effort shutdown
    }
    // Let the child process fully exit so stateDir is not locked (Windows)
    await new Promise((r) => setTimeout(r, 300));
    try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* Windows EBUSY ignore */ }
  });

  it("writes the handshake token file with owner-only permissions", () => {
    const tokenPath = join(stateDir, SESSION_SERVER_TOKEN_FILE_NAME);
    const stat = statSync(tokenPath);
    assert.ok(stat.isFile());
    if (process.platform !== "win32") {
      assert.strictEqual(stat.mode & 0o777, 0o600);
    }
  });

  it("creates, lists, captures, and exits a short-lived session", async () => {
    const { client } = integration;

    await client.createSession({ name: "e2e-1", cwd: stateDir, ...shortSession, env: {} });

    const listed = await client.listSessions();
    assert.ok(listed.includes("e2e-1"), `expected e2e-1 in list: ${listed.join(",")}`);
    assert.strictEqual(await client.hasSession("e2e-1"), true);
    assert.strictEqual(typeof (await client.capturePane("e2e-1")), "string");

    // The process exits on its own; once the exit is relayed the session
    // must disappear (backend has-session semantics).
    await pollUntilTrue(async () => !(await client.hasSession("e2e-1")), 15_000);
  });

  it("kills a long-lived session", async () => {
    const { client } = integration;

    await client.createSession({ name: "e2e-2", cwd: stateDir, ...longSession, env: {} });

    await pollUntilTrue(async () => (await client.hasSession("e2e-2")), 15_000);

    await client.killSession("e2e-2");
    assert.strictEqual(await client.hasSession("e2e-2"), false);
  });
});
