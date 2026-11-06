/**
 * PTY idle detection: SessionHandle edge-triggered quiet tracking and the
 * SessionServer sweep that reports it via onSessionIdle. Covers CLI sessions
 * whose completion hook never fires (their work state would otherwise be
 * stuck at "working" forever).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { IPty } from "node-pty";

import { SessionHandle } from "../src/services/session-server/session-handle.js";
import { SessionServer } from "../src/services/session-server/session-server.js";
import { IpcServer } from "../src/services/session-server/ipc-server.js";
import { createPlatformAdapter } from "../src/services/session-server/platform-adapter.js";
import { SessionServerClient } from "../src/services/session-server-client.js";

/** Minimal IPty stub, mirroring session-server-headless.test.ts. */
function fakePty(): { pty: IPty; emitter: EventEmitter } {
  const emitter = new EventEmitter();
  const pty = {
    pid: 4242,
    cols: 80,
    rows: 24,
    process: "fake-shell",
    onData: (listener: (data: string) => void) => {
      emitter.on("data", listener);
      return { dispose: () => emitter.off("data", listener) };
    },
    onExit: (listener: (event: { exitCode: number }) => void) => {
      emitter.on("exit", listener);
      return { dispose: () => emitter.off("exit", listener) };
    },
    write: () => undefined,
    resize: () => undefined,
    kill: () => undefined,
    pause: () => undefined,
    resume: () => undefined,
    clear: () => undefined
  } as unknown as IPty;
  return { pty, emitter };
}

async function pollUntil(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("pollUntil timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("SessionHandle idle detection", () => {
  it("never signals for a session that produced no output", () => {
    const { pty } = fakePty();
    const handle = new SessionHandle({ sessionId: "s", userId: "u", attachToken: "t", pty });
    try {
      assert.equal(handle.shouldSignalIdle(Date.now() + 600_000, 60_000), false);
    } finally {
      handle.disposeResources();
    }
  });

  it("signals once per active→silent transition and re-arms on new output", () => {
    const { pty } = fakePty();
    const handle = new SessionHandle({ sessionId: "s", userId: "u", attachToken: "t", pty });
    try {
      const t0 = Date.now();
      handle.fanOut("hello", () => undefined);
      assert.equal(handle.shouldSignalIdle(t0 + 500, 1_000), false, "still within the silence window");
      assert.equal(handle.shouldSignalIdle(t0 + 1_500, 1_000), true);

      handle.markIdleSignaled();
      assert.equal(handle.shouldSignalIdle(t0 + 5_000, 1_000), false, "already reported for this transition");

      handle.fanOut("more output", () => undefined);
      assert.equal(handle.shouldSignalIdle(Date.now() + 1_500, 1_000), true, "re-armed by new output");
    } finally {
      handle.disposeResources();
    }
  });

  it("does not signal after the session exited", () => {
    const { pty } = fakePty();
    const handle = new SessionHandle({ sessionId: "s", userId: "u", attachToken: "t", pty });
    try {
      handle.fanOut("hello", () => undefined);
      handle.markExited(0);
      assert.equal(handle.shouldSignalIdle(Date.now() + 600_000, 1_000), false);
    } finally {
      handle.disposeResources();
    }
  });
});

describe("SessionServer idle sweep", () => {
  it("reports a quiet session once, then again after renewed output", async () => {
    const server = new SessionServer({ idleMs: 150, idleSweepMs: 30 });
    const idleCalls: string[] = [];
    server.onSessionIdle = (sessionId) => idleCalls.push(sessionId);

    // Prints once at startup, echoes each stdin line, then stays alive:
    // output → silence → idle; input → output → silence → idle again.
    const handle = await server.createSession({
      sessionId: "idle-sweep-1",
      userId: "u",
      attachToken: "t",
      launchPlan: {
        command: process.execPath,
        args: [
          "-e",
          "console.log('ready'); process.stdin.on('data', () => console.log('echo'));"
        ],
        cwd: process.cwd(),
        env: {},
        secretEnvNames: [],
        credentialMode: "host_environment"
      }
    });
    try {
      await pollUntil(() => idleCalls.length >= 1);
      assert.deepEqual(idleCalls, ["idle-sweep-1"]);

      // Edge-triggered: no repeat while the session stays quiet.
      await new Promise((r) => setTimeout(r, 400));
      assert.equal(idleCalls.length, 1);

      handle.write("x\n");
      await pollUntil(() => idleCalls.length >= 2);
      assert.deepEqual(idleCalls, ["idle-sweep-1", "idle-sweep-1"]);
    } finally {
      handle.kill();
      handle.disposeResources();
      await server.destroy();
    }
  });
});

describe("session_idle IPC round trip", () => {
  it("relays the idle push over the management socket to the client", async () => {
    const token = "idle-ipc-token";
    const ipcPath = process.platform === "win32"
      ? `\\\\.\\pipe\\forgebadger-ss-idle-it-${Date.now()}`
      : `${createPlatformAdapter().getIpcPath(mkdtempSync(join(tmpdir(), "ss-idle-it-")))}-1`;
    const cwd = mkdtempSync(join(tmpdir(), "ss-idle-cwd-"));

    const sessionServer = new SessionServer({ idleMs: 150, idleSweepMs: 30 });
    const ipcServer = new IpcServer({ ipcPath, sessionServer, token });
    await ipcServer.start();
    // Give the pipe time to be fully ready on Windows (same as the IPC suite).
    await new Promise((r) => setTimeout(r, 150));
    const client = new SessionServerClient({ ipcPath, token });
    await client.connect();

    try {
      const idleReceived: string[] = [];
      client.onSessionIdle = (sessionId) => idleReceived.push(sessionId);

      await client.createSession({
        name: "idle-ipc-1",
        cwd,
        command: process.execPath,
        args: ["-e", "console.log('ready'); setInterval(() => {}, 1000);"],
        env: {}
      });

      await pollUntil(() => idleReceived.length >= 1);
      assert.deepEqual(idleReceived, ["idle-ipc-1"]);
    } finally {
      await client.disconnect();
      await ipcServer.stop();
      await sessionServer.destroy();
      // Wait for the child to exit so the temp dir is not locked on Windows.
      await new Promise((r) => setTimeout(r, 200));
      try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
