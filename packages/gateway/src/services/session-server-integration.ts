/**
 * Gateway integration for the Session Server daemon.
 *
 * Daemon lifecycle contract (D1):
 *   - Startup probes the IPC endpoint first: a live daemon with a valid
 *     token is reused (its sessions survive Gateway restarts); only when no
 *     daemon answers is a new one spawned (detached + unref'd on POSIX).
 *   - Gateway shutdown disconnects only — it must never kill the daemon.
 *     stop() is the explicit maintenance path (shutdown_server + SIGKILL
 *     fallback) for tests and future CLI commands.
 *   - While the Gateway runs, a lost connection triggers lazy restart with
 *     exponential backoff (1s ×2, cap 30s) and a circuit breaker (5 failures
 *     in a 300s window stops restarting until the next explicit operation).
 *     There is no post-exit supervision: the daemon outlives the Gateway.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { connect as netConnect } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { SessionServerClient } from "./session-server-client.js";
import { buildSanitizedEnv } from "./session-server/env-policy.js";
import {
  generateSessionServerToken,
  resolveSessionServerTokenPath,
  writeSessionServerTokenFile
} from "./session-server/auth-token.js";
import { createPlatformAdapter } from "./session-server/platform-adapter.js";

export interface SessionServerIntegration {
  client: SessionServerClient;
  /** The IPC path the server is listening on (explicit override or platform default). */
  ipcPath: string;
  /** True when we connected to an already-running daemon instead of spawning one. */
  reused: boolean;
  /** PID of the connected daemon, from the hello handshake. */
  serverPid: number | undefined;
  /** Gateway shutdown path: disconnect only — the daemon must outlive the Gateway. */
  disconnect: () => Promise<void>;
  /**
   * Explicit maintenance path: ask the daemon to shut down (destroys all
   * sessions), with a SIGTERM/SIGKILL fallback for a daemon we spawned.
   * Never called from the Gateway's normal shutdown.
   */
  stop: () => Promise<void>;
  /** Supervision state snapshot (tests / diagnostics). */
  getSupervisionState: () => SessionServerSupervisionState;
}

export interface SessionServerSupervisionState {
  available: boolean;
  circuitOpen: boolean;
  failuresInWindow: number;
}

export interface SessionServerIntegrationOptions {
  stateDir: string;
  ipcPath?: string;
  env?: NodeJS.ProcessEnv;
  /** Test hooks for restart backoff / circuit-breaker timing. */
  restart?: {
    initialBackoffMs?: number;
    maxBackoffMs?: number;
    breakerWindowMs?: number;
    breakerMaxFailures?: number;
  };
  /** Test hook: observe supervision state transitions. */
  onSupervisionEvent?: (event: "down" | "restarted" | "circuit-open", detail?: string) => void;
  /** Test hook: override process spawning (e.g. to force restart failures). */
  spawnImpl?: typeof spawn;
}

const PROBE_TIMEOUT_MS = 1500;
const PROBE_ATTEMPTS = 2;
const SPAWN_READY_TIMEOUT_MS = 15_000;

export async function startAndConnectSessionServer(
  options: SessionServerIntegrationOptions
): Promise<SessionServerIntegration> {
  const platformAdapter = createPlatformAdapter();
  const ipcPath = options.ipcPath ?? platformAdapter.getIpcPath(options.stateDir);
  const tokenPath = resolveSessionServerTokenPath(options.stateDir);

  const client = new SessionServerClient({ ipcPath, tokenPath, connectTimeoutMs: 5000 });
  const supervision = createSupervision(options, ipcPath, tokenPath, client);

  // Probe before spawning: a live daemon (hello succeeds with the token file)
  // is reused, keeping its sessions alive across Gateway restarts.
  const reused = await probeExistingDaemon(client);
  let child: ChildProcess | undefined;
  if (!reused) {
    child = supervision.spawnDaemon();
    await waitForIpcReady(ipcPath, SPAWN_READY_TIMEOUT_MS);
    await client.connect();
  }
  supervision.attach(child);

  const identity = client.getServerIdentity();
  console.info("[gateway] session server connected", {
    ipcPath,
    reused,
    pid: identity?.pid,
    startedAt: identity?.startedAt
  });

  const disconnect = async () => {
    supervision.teardown();
    await client.disconnect();
  };

  const stop = async () => {
    supervision.teardown();
    try {
      await client.shutdownServer();
    } catch {
      // The daemon may already be gone; fall through to the kill fallback.
    }
    await client.disconnect();
    await killSpawnedChild(supervision.currentChild());
  };

  return {
    client,
    ipcPath,
    reused,
    serverPid: identity?.pid,
    disconnect,
    stop,
    getSupervisionState: supervision.getState
  };
}

/**
 * Connect to an already-running Session Server (e.g., started by a watchdog).
 */
export async function connectToSessionServer(ipcPath: string): Promise<SessionServerClient> {
  const client = new SessionServerClient({ ipcPath, connectTimeoutMs: 5000 });
  await client.connect();
  return client;
}

// ---------------------------------------------------------------------------
// Reuse probe
// ---------------------------------------------------------------------------

/** hello timeouts do not prove the daemon is dead (it may be in GC), so the
 *  probe retries before the caller falls back to unlink + spawn. */
async function probeExistingDaemon(client: SessionServerClient): Promise<boolean> {
  for (let attempt = 0; attempt < PROBE_ATTEMPTS; attempt++) {
    try {
      await client.connect(PROBE_TIMEOUT_MS);
      return true;
    } catch {
      // Missing token file, refused connection, or hello timeout — retry,
      // then let the caller spawn a fresh daemon.
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Lazy-restart supervision (backoff + circuit breaker)
// ---------------------------------------------------------------------------

interface Supervision {
  attach(child: ChildProcess | undefined): void;
  spawnDaemon(): ChildProcess;
  currentChild(): ChildProcess | undefined;
  teardown(): void;
  getState(): SessionServerSupervisionState;
}

function createSupervision(
  options: SessionServerIntegrationOptions,
  ipcPath: string,
  tokenPath: string,
  client: SessionServerClient
): Supervision {
  const restartCfg = {
    initialBackoffMs: options.restart?.initialBackoffMs ?? 1000,
    maxBackoffMs: options.restart?.maxBackoffMs ?? 30_000,
    breakerWindowMs: options.restart?.breakerWindowMs ?? 300_000,
    breakerMaxFailures: options.restart?.breakerMaxFailures ?? 5
  };
  const spawnImpl = options.spawnImpl ?? spawn;

  let child: ChildProcess | undefined;
  let stopped = false;
  let available = true;
  let circuitOpen = false;
  let backoffMs = restartCfg.initialBackoffMs;
  let failures: number[] = [];
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  let restarting: Promise<void> | undefined;

  const spawnDaemon = (): ChildProcess => {
    // Each daemon start rotates the handshake token; the client re-reads the
    // token file on every connect.
    writeSessionServerTokenFile(tokenPath, generateSessionServerToken());
    const { entry, loaderArgs } = resolveSessionServerEntry();
    // stdio fully ignored: a piped stdout/stderr would EPIPE the orphaned
    // daemon once the spawning Gateway exits. The daemon logs to a file
    // under the state directory instead.
    const spawned = spawnImpl(
      process.execPath,
      [...loaderArgs, entry, "--ipc", ipcPath, "--token-file", tokenPath],
      {
        detached: process.platform !== "win32",
        env: {
          ...buildSanitizedEnv(process.env),
          FORGEBADGER_STATE_DIR: options.stateDir,
          ...options.env
        },
        stdio: ["ignore", "ignore", "ignore"]
      }
    );
    if (process.platform !== "win32") {
      spawned.unref();
    }
    spawned.on("exit", (code, signal) => {
      if (spawned === child) {
        onBackendDown(`daemon exited (code=${String(code)} signal=${String(signal)})`);
      }
    });
    return spawned;
  };

  const onBackendDown = (reason: string) => {
    if (stopped || circuitOpen || !available) return;
    available = false;
    options.onSupervisionEvent?.("down", reason);
    console.error("[gateway] session server unavailable", { reason });
    scheduleRestart(backoffMs);
  };

  const scheduleRestart = (delayMs: number) => {
    if (stopped) return;
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      restartTimer = undefined;
      void attemptRestart();
    }, delayMs);
    restartTimer.unref?.();
  };

  const attemptRestart = async (): Promise<void> => {
    if (stopped || circuitOpen) return;
    restarting ??= doRestart();
    try {
      await restarting;
    } finally {
      restarting = undefined;
    }
  };

  const doRestart = async (): Promise<void> => {
    try {
      // A reconnect alone may suffice (an external supervisor may have
      // restarted the daemon); otherwise spawn a fresh daemon ourselves.
      try {
        await client.connect(PROBE_TIMEOUT_MS);
      } catch {
        child = spawnDaemon();
        await waitForIpcReady(ipcPath, SPAWN_READY_TIMEOUT_MS);
        await client.connect();
      }
      failures = [];
      backoffMs = restartCfg.initialBackoffMs;
      available = true;
      options.onSupervisionEvent?.("restarted");
      console.info("[gateway] session server restarted", {
        pid: client.getServerIdentity()?.pid
      });
    } catch (error) {
      registerRestartFailure(error);
    }
  };

  const registerRestartFailure = (error: unknown) => {
    const now = Date.now();
    failures = failures.filter((at) => now - at < restartCfg.breakerWindowMs);
    failures.push(now);
    console.error("[gateway] session server restart failed", {
      failuresInWindow: failures.length,
      message: error instanceof Error ? error.message : String(error)
    });
    if (failures.length >= restartCfg.breakerMaxFailures) {
      circuitOpen = true;
      options.onSupervisionEvent?.("circuit-open");
      console.error("[gateway] session server restart circuit open; staying unavailable until the next explicit operation");
      return;
    }
    backoffMs = Math.min(backoffMs * 2, restartCfg.maxBackoffMs);
    scheduleRestart(backoffMs);
  };

  // An explicit operation that fails to connect re-arms an open circuit.
  client.onConnectError = () => {
    if (!circuitOpen || stopped) return;
    circuitOpen = false;
    failures = [];
    backoffMs = restartCfg.initialBackoffMs;
    scheduleRestart(0);
  };
  client.onDisconnect = () => onBackendDown("management connection closed");

  return {
    attach(spawned) {
      child = spawned;
    },
    spawnDaemon,
    currentChild: () => child,
    teardown() {
      stopped = true;
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = undefined;
      }
      client.onDisconnect = undefined;
      client.onConnectError = undefined;
    },
    getState: () => ({
      available,
      circuitOpen,
      failuresInWindow: failures.length
    })
  };
}

async function killSpawnedChild(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.killed) return;
  child.kill("SIGTERM");
  // Give it 2 seconds to shut down gracefully
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
      resolve();
    }, 2000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function resolveSessionServerEntry(): { entry: string; loaderArgs: string[] } {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const distPath = join(here, "session-server-entry.js");
  // Check the disk directly instead of require.resolve(): under tsx the
  // CJS resolver remaps a missing .js to the existing .ts source, which
  // would falsely report that the compiled entry is available.
  if (existsSync(distPath)) {
    return { entry: distPath, loaderArgs: [] };
  }
  return { entry: join(here, "session-server-entry.ts"), loaderArgs: ["--import", "tsx"] };
}

// Probe with a real connection rather than existsSync: on Windows,
// fs.existsSync() reports false for live named pipes, so a connect probe
// is the only portable way to detect readiness (works for both named
// pipes and unix domain sockets).
function waitForIpcReady(path: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  return new Promise<void>((resolve, reject) => {
    const check = () => {
      const socket = netConnect({ path });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for IPC endpoint: ${path}`));
          return;
        }
        setTimeout(check, 100);
      });
    };
    check();
  });
}
