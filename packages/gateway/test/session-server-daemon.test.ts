/**
 * P2 daemon-behavior tests, driven in-process (IpcServer + SessionServer in
 * the test process):
 *   - hello_ok carries the daemon identity (pid + startedAt)
 *   - shutdown_server destroys sessions and requests host exit
 *   - show_environment returns real ownership markers and
 *     session-manager.attachExistingSession enforces them
 *   - reconnect after a daemon instance change sets the restart signal
 *   - in-flight requests reject immediately when the transport closes
 *   - a dropped I/O transport emits transportClose, never exit 0
 */
import { describe, it, after } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server as NetServer, type Socket } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { SessionServer } from "../src/services/session-server/session-server.js";
import { IpcServer } from "../src/services/session-server/ipc-server.js";
import { createPlatformAdapter } from "../src/services/session-server/platform-adapter.js";
import { SessionServerClient } from "../src/services/session-server-client.js";
import { SessionServerPty } from "../src/services/session-server-pty.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import type { LaunchPlan } from "../src/adapters/claude.js";

const isWin = process.platform === "win32";
const TOKEN = "0123456789abcdef".repeat(4);

let counter = 0;
const tempDirs: string[] = [];

function uniqueIpcPath(): string {
  counter++;
  if (isWin) {
    return `\\\\.\\pipe\\fb-ss-daemon-${process.pid}-${counter}`;
  }
  const dir = mkdtempSync(join(tmpdir(), "fb-ss-daemon-"));
  tempDirs.push(dir);
  return join(dir, "server.sock");
}

after(() => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

interface PairOptions {
  startedAt?: string;
  onShutdownRequested?: () => void;
}

async function startPair(ipcPath: string, options: PairOptions = {}) {
  const sessionServer = new SessionServer();
  const ipcServer = new IpcServer({
    ipcPath,
    sessionServer,
    token: TOKEN,
    ...(options.startedAt !== undefined ? { startedAt: options.startedAt } : {}),
    ...(options.onShutdownRequested ? { onShutdownRequested: options.onShutdownRequested } : {})
  });
  await ipcServer.start();
  // Give the pipe time to be fully ready on Windows
  await new Promise((r) => setTimeout(r, 150));
  const client = new SessionServerClient({ ipcPath, token: TOKEN });
  await client.connect();
  return { sessionServer, ipcServer, client };
}

const longSession = isWin
  ? { command: "cmd.exe", args: ["/c", "ping -n 60 127.0.0.1"] }
  : { command: "bash", args: ["-c", "sleep 60"] };

function launchPlan(cwd: string): LaunchPlan {
  return {
    ...longSession,
    cwd,
    env: {},
    secretEnvNames: [],
    credentialMode: "host_environment"
  };
}

describe("daemon identity in hello_ok", () => {
  it("reports pid and startedAt to the client", async () => {
    const ipcPath = uniqueIpcPath();
    const { ipcServer, client } = await startPair(ipcPath, { startedAt: "2026-09-09T00:00:00.000Z" });
    try {
      const identity = client.getServerIdentity();
      assert.ok(identity);
      assert.strictEqual(identity.pid, process.pid);
      assert.strictEqual(identity.startedAt, "2026-09-09T00:00:00.000Z");
    } finally {
      await client.disconnect();
      await ipcServer.stop();
    }
  });

  it("flags a daemon restart when the identity changes across reconnects", async () => {
    const ipcPath = uniqueIpcPath();
    const first = await startPair(ipcPath, { startedAt: "2026-09-09T00:00:00.000Z" });
    const client = first.client;
    assert.strictEqual(client.consumeServerRestarted(), false);

    // Simulate a daemon restart: stop the server, start a new instance on
    // the same path with a different start time, reconnect the same client.
    await first.ipcServer.stop();
    const sessionServer = new SessionServer();
    const ipcServer = new IpcServer({
      ipcPath,
      sessionServer,
      token: TOKEN,
      startedAt: "2026-09-09T01:00:00.000Z"
    });
    await ipcServer.start();
    await new Promise((r) => setTimeout(r, 150));
    try {
      await client.connect();
      assert.strictEqual(client.consumeServerRestarted(), true, "restart signal should be set");
      assert.strictEqual(client.consumeServerRestarted(), false, "restart signal is one-shot");
    } finally {
      await client.disconnect();
      await ipcServer.stop();
    }
  });
});

describe("shutdown_server", () => {
  it("destroys all sessions and requests host exit", async () => {
    const ipcPath = uniqueIpcPath();
    const cwd = tempDirs[0] ?? mkdtempSync(join(tmpdir(), "fb-ss-shutdown-"));
    if (!tempDirs.includes(cwd)) tempDirs.push(cwd);

    let shutdownRequested = false;
    const { sessionServer, ipcServer, client } = await startPair(ipcPath, {
      onShutdownRequested: () => { shutdownRequested = true; }
    });
    try {
      await client.createSession({ name: "fb-u1-shutdown", cwd, ...longSession, env: {} });
      assert.strictEqual(await client.hasSession("fb-u1-shutdown"), true);

      await client.shutdownServer();

      // Sessions are destroyed before the host exit callback fires.
      const start = Date.now();
      while (!shutdownRequested && Date.now() - start < 5000) {
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.strictEqual(shutdownRequested, true);
      assert.deepStrictEqual(sessionServer.listSessions(), []);
    } finally {
      await client.disconnect().catch(() => {});
      await ipcServer.stop();
      await sessionServer.destroy();
    }
  });
});

describe("session ownership metadata", () => {
  it("show_environment returns real markers and attachExistingSession enforces them", async () => {
    const ipcPath = uniqueIpcPath();
    const cwd = mkdtempSync(join(tmpdir(), "fb-ss-owner-"));
    tempDirs.push(cwd);
    const { sessionServer, ipcServer, client } = await startPair(ipcPath);
    try {
      await client.createSession({
        name: "fb-u1-owned",
        cwd,
        ...longSession,
        env: {
          FORGEBADGER_SESSION_ID: "db-session-1",
          FORGEBADGER_ATTACH_TOKEN: "attach-token-1",
          FORGEBADGER_USER_ID: "user-1"
        }
      });

      const env = await client.showEnvironment("fb-u1-owned");
      assert.strictEqual(env.FORGEBADGER_SESSION_ID, "db-session-1");
      assert.strictEqual(env.FORGEBADGER_ATTACH_TOKEN, "attach-token-1");

      const manager = new InMemorySessionManager(client);
      const input = {
        userId: "user-1",
        sessionId: "db-session-1",
        tmuxName: "fb-u1-owned",
        launchPlan: launchPlan(cwd)
      };

      // Wrong session id → the session belongs to another ForgeBadger session
      await assert.rejects(
        () => manager.attachExistingSession({ ...input, sessionId: "db-session-other" }),
        /belongs to another ForgeBadger session/
      );

      // Wrong attach token → hook-auth break attempt rejected
      await assert.rejects(
        () => manager.attachExistingSession({ ...input, attachToken: "wrong-token" }),
        /attach token mismatch/
      );

      // Correct ownership markers → adopted
      const session = await manager.attachExistingSession({ ...input, attachToken: "attach-token-1" });
      assert.strictEqual(session.id, "db-session-1");
      assert.strictEqual(session.status, "running");
    } finally {
      await client.disconnect();
      await ipcServer.stop();
      await sessionServer.destroy();
    }
  });
});

describe("pending request rejection", () => {
  it("rejects in-flight requests immediately when the transport closes", async () => {
    const ipcPath = uniqueIpcPath();
    // Fake daemon: completes the hello handshake but never answers requests.
    const sockets = new Set<Socket>();
    const fake: NetServer = createServer((socket) => {
      sockets.add(socket);
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => {
        if (chunk.includes("\"hello\"")) {
          socket.write(`${JSON.stringify({ type: "hello_ok", protocolVersion: 1, pid: 1, startedAt: "x" })}\n`);
        }
      });
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => {});
    });
    await new Promise<void>((resolve) => fake.listen(ipcPath, resolve));
    await new Promise((r) => setTimeout(r, 150));

    const client = new SessionServerClient({ ipcPath, token: TOKEN, requestTimeoutMs: 30_000 });
    await client.connect();

    const startedAt = Date.now();
    let rejected: Error | undefined;
    const pending = client.hasSession("anything").catch((error: Error) => {
      rejected = error;
    });

    // Kill the transport without answering.
    for (const socket of sockets) socket.destroy();
    await pending;

    assert.ok(rejected, "in-flight request must reject on transport close");
    assert.match(rejected.message, /connection closed/);
    assert.ok(Date.now() - startedAt < 5000, "rejection must not wait for the request timeout");

    await new Promise<void>((resolve) => fake.close(() => resolve()));
  });
});

describe("I/O transport close semantics", () => {
  it("emits transportClose, never exit 0, when the server drops the stream", async () => {
    const ipcPath = uniqueIpcPath();
    const cwd = mkdtempSync(join(tmpdir(), "fb-ss-transport-"));
    tempDirs.push(cwd);
    const { sessionServer, ipcServer, client } = await startPair(ipcPath);

    await client.createSession({ name: "fb-u1-stream", cwd, ...longSession, env: {} });

    const pty = new SessionServerPty({ ipcPath, sessionId: "fb-u1-stream", token: TOKEN });
    await pty.connect();

    let exitEvent: { exitCode: number } | undefined;
    let transportClosed = false;
    pty.onExit((event) => { exitEvent = event; });
    pty.onTransportClose(() => { transportClosed = true; });

    // Simulate a daemon crash: drop every connection without session_exit.
    await ipcServer.stop();

    const start = Date.now();
    while (!transportClosed && Date.now() - start < 5000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.strictEqual(transportClosed, true, "transport close must be signalled");
    assert.strictEqual(exitEvent, undefined, "transport loss must never be reported as an exit");

    await client.disconnect().catch(() => {});
    await sessionServer.destroy();
  });

  it("does not emit transportClose after an intentional detach", async () => {
    const ipcPath = uniqueIpcPath();
    const cwd = mkdtempSync(join(tmpdir(), "fb-ss-detach-"));
    tempDirs.push(cwd);
    const { sessionServer, ipcServer, client } = await startPair(ipcPath);
    try {
      await client.createSession({ name: "fb-u1-detach", cwd, ...longSession, env: {} });
      const pty = new SessionServerPty({ ipcPath, sessionId: "fb-u1-detach", token: TOKEN });
      await pty.connect();

      let transportClosed = false;
      pty.onTransportClose(() => { transportClosed = true; });
      pty.kill();
      await new Promise((r) => setTimeout(r, 300));
      assert.strictEqual(transportClosed, false);
    } finally {
      await client.disconnect();
      await ipcServer.stop();
      await sessionServer.destroy();
    }
  });
});
