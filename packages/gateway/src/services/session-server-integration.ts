/**
 * Gateway integration for the Session Server.
 *
 * Provides:
 *   - startAndConnectSessionServer(): spawn the Session Server as a child
 *     process and connect the Gateway client to it
 *   - connectToSessionServer(): connect to an already-running Session Server
 *   - Stop handle for graceful shutdown
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { connect as netConnect } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { SessionServerClient } from "./session-server-client.js";
import { createPlatformAdapter } from "./session-server/platform-adapter.js";

export interface SessionServerIntegration {
  client: SessionServerClient;
  /** The IPC path the server is listening on (explicit override or platform default). */
  ipcPath: string;
  stop: () => Promise<void>;
}

/**
 * Start the Session Server as a child process and connect to it.
 */
export async function startAndConnectSessionServer(options: {
  stateDir: string;
  ipcPath?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<SessionServerIntegration> {
  const platformAdapter = createPlatformAdapter();
  const ipcPath = options.ipcPath ?? platformAdapter.getIpcPath(options.stateDir);

  // Resolve the Session Server entry point: compiled dist in production,
  // tsx-loaded TypeScript source in development.
  const { entry: serverEntry, loaderArgs } = resolveSessionServerEntry();

  // Spawn the Session Server process
  const child = spawn(process.execPath, [...loaderArgs, serverEntry, "--ipc", ipcPath], {
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      ...options.env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  // Log output from the Session Server
  child.stdout?.on("data", (chunk) => {
    const lines = chunk.toString("utf8").trim().split("\n");
    for (const line of lines) {
      if (line) console.info(`[session-server] ${line}`);
    }
  });

  child.stderr?.on("data", (chunk) => {
    const lines = chunk.toString("utf8").trim().split("\n");
    for (const line of lines) {
      if (line) console.error(`[session-server:error] ${line}`);
    }
  });

  // Wait for the IPC endpoint to appear (dev mode pays a tsx cold-start cost)
  await waitForIpcReady(ipcPath, 15_000);

  // Connect the Gateway to the Session Server
  const client = new SessionServerClient({ ipcPath, connectTimeoutMs: 5000 });
  await client.connect();

  const stop = async () => {
    await client.disconnect();
    if (!child.killed) {
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
  };

  return { client, ipcPath, stop };
}

/**
 * Connect to an already-running Session Server (e.g., started by a watchdog).
 */
export async function connectToSessionServer(ipcPath: string): Promise<SessionServerClient> {
  const client = new SessionServerClient({ ipcPath, connectTimeoutMs: 5000 });
  await client.connect();
  return client;
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
