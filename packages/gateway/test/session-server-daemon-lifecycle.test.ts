/**
 * P2 daemon lifecycle tests against a real spawned Session Server process:
 *   - startup reuse: a second "Gateway" connects to the live daemon (same pid)
 *     instead of spawning a new one
 *   - Gateway exit does not kill the daemon: sessions survive a disconnect
 *   - shutdown_server: the daemon destroys its sessions and exits
 *   - lazy restart: a dead daemon is respawned and the client reconnects
 *   - circuit breaker: 5 failed restarts inside the window stop supervision
 *   - stolen-socket self-check: the daemon exits when its socket is unlinked
 *   - recovery on reuse: recoverForgeBadgerSessions reconciles a reused
 *     daemon against the DB recovery store (survivors detached, orphans killed)
 */
import { describe, it, after } from "node:test";
import assert from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { connect as netConnect } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  startAndConnectSessionServer,
  type SessionServerIntegration
} from "../src/services/session-server-integration.js";
import { SessionServerClient } from "../src/services/session-server-client.js";
import {
  generateSessionServerToken,
  resolveSessionServerTokenPath,
  writeSessionServerTokenFile
} from "../src/services/session-server/auth-token.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import type {
  SessionRecoveryStore,
  StoredSession
} from "../src/services/session-manager.js";
import type { TerminalBackendClient } from "../src/services/terminal-backend.js";
import type { LaunchPlan } from "../src/adapters/claude.js";

const isWin = process.platform === "win32";

const stateDir = mkdtempSync(join(tmpdir(), "fb-ss-life-"));

let counter = 0;
function uniqueIpcPath(): string {
  counter++;
  return isWin
    ? `\\\\.\\pipe\\fb-ss-life-${process.pid}-${counter}`
    : join(stateDir, `server-${counter}.sock`);
}

const longSession = isWin
  ? { command: "cmd.exe", args: ["/c", "ping -n 60 127.0.0.1"] }
  : { command: "bash", args: ["-c", "sleep 60"] };

const runningIntegrations: SessionServerIntegration[] = [];

async function track(promise: Promise<SessionServerIntegration>): Promise<SessionServerIntegration> {
  const integration = await promise;
  runningIntegrations.push(integration);
  return integration;
}

after(async () => {
  for (const integration of runningIntegrations) {
    await integration.stop().catch(() => {});
  }
  await new Promise((r) => setTimeout(r, 300));
  try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* Windows EBUSY ignore */ }
});

async function pollUntil(predicate: () => Promise<boolean> | boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`poll timeout after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

function ipcAcceptsConnections(ipcPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = netConnect({ path: ipcPath });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

describe("startup reuse", () => {
  it("reuses a live daemon instead of spawning a second process", async () => {
    const ipcPath = uniqueIpcPath();
    const first = await track(startAndConnectSessionServer({ stateDir, ipcPath }));
    assert.strictEqual(first.reused, false);
    assert.ok(first.serverPid, "spawned daemon must report its pid");

    const second = await track(startAndConnectSessionServer({ stateDir, ipcPath }));
    assert.strictEqual(second.reused, true, "second startup must reuse the live daemon");
    assert.strictEqual(second.serverPid, first.serverPid, "reuse means the same daemon pid");

    // Sessions are shared through the reused daemon.
    await second.client.createSession({ name: "fb-u1-reuse", cwd: stateDir, ...longSession, env: {} });
    assert.strictEqual(await first.client.hasSession("fb-u1-reuse"), true);
    await first.client.killSession("fb-u1-reuse");
  });
});

describe("exit does not kill", () => {
  it("sessions survive a Gateway disconnect", async () => {
    const ipcPath = uniqueIpcPath();
    const integration = await track(startAndConnectSessionServer({ stateDir, ipcPath }));
    await integration.client.createSession({ name: "fb-u1-survive", cwd: stateDir, ...longSession, env: {} });

    // Normal Gateway shutdown: disconnect only.
    await integration.disconnect();

    // A fresh client (no supervision) still finds the daemon and the session.
    const client = new SessionServerClient({
      ipcPath,
      tokenPath: resolveSessionServerTokenPath(stateDir)
    });
    await client.connect();
    try {
      assert.strictEqual(await client.hasSession("fb-u1-survive"), true);
      const listed = await client.listSessions();
      assert.ok(listed.includes("fb-u1-survive"));
    } finally {
      await client.shutdownServer();
      await client.disconnect().catch(() => {});
    }

    // shutdown_server terminated the daemon.
    await pollUntil(async () => !(await ipcAcceptsConnections(ipcPath)), 10_000);
  });
});

describe("recovery after Gateway restart (daemon reuse)", () => {
  function launchPlan(): LaunchPlan {
    return {
      ...longSession,
      cwd: stateDir,
      env: {},
      secretEnvNames: [],
      credentialMode: "host_environment"
    };
  }

  function singleRecordStore(record: StoredSession): SessionRecoveryStore {
    return {
      async listSessions() { return [record]; },
      async upsertSession() {},
      async removeSession() {}
    };
  }

  it("reconciles a reused daemon: DB record recovered as detached, unknown session killed", async () => {
    const ipcPath = uniqueIpcPath();
    const integration = await track(startAndConnectSessionServer({ stateDir, ipcPath }));

    // Known session: indexed in the recovery store with real ownership env.
    await integration.client.createSession({
      name: "fb-user1-known",
      cwd: stateDir,
      ...longSession,
      env: {
        FORGEBADGER_SESSION_ID: "db-s1",
        FORGEBADGER_USER_ID: "user1",
        FORGEBADGER_ATTACH_TOKEN: "tok-1"
      }
    });
    // Orphan: live in the daemon but missing from the recovery index.
    await integration.client.createSession({
      name: "fb-user1-orphan",
      cwd: stateDir,
      ...longSession,
      env: {}
    });

    // Simulate a Gateway restart: disconnect, then reconnect like startup does.
    await integration.disconnect();
    const client = new SessionServerClient({
      ipcPath,
      tokenPath: resolveSessionServerTokenPath(stateDir)
    });
    await client.connect();

    try {
      // list_sessions rebuilt the name mapping on reconnect.
      assert.ok((await client.listSessions()).includes("fb-user1-known"));

      const manager = new InMemorySessionManager(client as unknown as TerminalBackendClient, singleRecordStore({
        id: "db-s1",
        userId: "user1",
        attachToken: "tok-1",
        runtimeSessionName: "fb-user1-known",
        launchPlan: launchPlan(),
        createdAt: new Date().toISOString()
      }));

      const result = await manager.recoverForgeBadgerSessions({ userId: "user1", cwd: stateDir });

      assert.deepStrictEqual(result.killedOrphans, ["fb-user1-orphan"]);
      assert.strictEqual(result.recovered.length, 1);
      assert.strictEqual(result.recovered[0]?.id, "db-s1");
      assert.strictEqual(result.recovered[0]?.status, "detached");
      assert.strictEqual(await client.hasSession("fb-user1-orphan"), false);
      assert.strictEqual(await client.hasSession("fb-user1-known"), true);

      // Ownership markers survived the Gateway restart.
      const env = await client.showEnvironment("fb-user1-known");
      assert.strictEqual(env.FORGEBADGER_SESSION_ID, "db-s1");
      assert.strictEqual(env.FORGEBADGER_ATTACH_TOKEN, "tok-1");
    } finally {
      await client.shutdownServer().catch(() => {});
      await client.disconnect().catch(() => {});
      await pollUntil(async () => !(await ipcAcceptsConnections(ipcPath)), 10_000);
    }
  });
});

describe("lazy restart supervision", () => {
  it("respawns a dead daemon and reconnects", async () => {
    const ipcPath = uniqueIpcPath();
    const events: string[] = [];
    const integration = await track(startAndConnectSessionServer({
      stateDir,
      ipcPath,
      restart: { initialBackoffMs: 50, maxBackoffMs: 200 },
      onSupervisionEvent: (event) => { events.push(event); }
    }));
    const firstPid = integration.serverPid;

    // Kill the daemon out of band; the supervisor must respawn it.
    const killer = new SessionServerClient({
      ipcPath,
      tokenPath: resolveSessionServerTokenPath(stateDir)
    });
    await killer.connect();
    await killer.shutdownServer();

    await pollUntil(() => integration.getSupervisionState().available
      && integration.client.getServerIdentity()?.pid !== firstPid, 20_000);

    assert.ok(events.includes("down"));
    assert.ok(events.includes("restarted"));
    // The new daemon has an empty registry but answers commands.
    assert.deepStrictEqual(await integration.client.listSessions(), []);
    await killer.disconnect().catch(() => {});
  });

  it("opens the circuit after repeated restart failures", async () => {
    const ipcPath = uniqueIpcPath();
    let failSpawn = false;
    let spawnAttempts = 0;
    const spawnImpl: typeof spawn = ((...args: Parameters<typeof spawn>) => {
      if (failSpawn) {
        spawnAttempts++;
        throw new Error("spawn disabled by test");
      }
      return spawn(...args);
    }) as typeof spawn;

    const integration = await track(startAndConnectSessionServer({
      stateDir,
      ipcPath,
      spawnImpl,
      restart: { initialBackoffMs: 20, maxBackoffMs: 40, breakerWindowMs: 60_000, breakerMaxFailures: 5 }
    }));

    failSpawn = true;
    await integration.client.shutdownServer();

    await pollUntil(() => integration.getSupervisionState().circuitOpen, 30_000);
    const state = integration.getSupervisionState();
    assert.strictEqual(state.available, false);
    assert.strictEqual(state.failuresInWindow, 5);
    // The breaker stopped further spawns — give a would-be retry window.
    await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(spawnAttempts, 5);
  });
});

describe("stolen-socket self-check", () => {
  it("exits when its socket file is unlinked (POSIX)", { skip: isWin }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "fb-ss-stolen-"));
    const ipcPath = join(dir, "server.sock");
    const tokenPath = resolveSessionServerTokenPath(dir);
    writeSessionServerTokenFile(tokenPath, generateSessionServerToken());

    const entry = fileURLToPath(new URL("../src/services/session-server-entry.ts", import.meta.url));
    const child: ChildProcess = spawn(
      process.execPath,
      ["--import", "tsx", entry, "--ipc", ipcPath, "--token-file", tokenPath, "--socket-check-ms", "150"],
      { stdio: ["ignore", "ignore", "ignore"] }
    );
    const exitPromise = new Promise<number | null>((resolve) => {
      child.once("exit", (code) => resolve(code));
    });

    try {
      await pollUntil(() => existsSync(ipcPath), 15_000);
      unlinkSync(ipcPath);
      // The daemon notices the theft within a few check intervals and exits.
      const code = await Promise.race([
        exitPromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000))
      ]);
      assert.strictEqual(code, 1, "daemon must exit(1) after its socket was stolen");
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
