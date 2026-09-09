/**
 * Session Server entry point — standalone process that manages pty sessions.
 *
 * Usage: node session-server-entry.js --ipc <socket-path>
 *
 * This process is spawned by the Gateway and communicates via IPC.
 * It manages all pty sessions and provides terminal I/O via the IPC protocol.
 */
import { join } from "node:path";
import { homedir } from "node:os";

import { startSessionServer } from "./session-server/ipc-server.js";
import { createPlatformAdapter } from "./session-server/platform-adapter.js";

function defaultStateDir(): string {
  return process.env.FORGEBADGER_STATE_DIR ?? join(homedir(), ".forgebadger");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let ipcPath: string | undefined;

  // Parse --ipc <path>
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--ipc" && args[i + 1]) {
      ipcPath = args[i + 1];
      break;
    }
  }

  if (!ipcPath) {
    const platformAdapter = createPlatformAdapter();
    ipcPath = platformAdapter.getIpcPath(defaultStateDir());
  }

  console.info(`starting, ipc=${ipcPath}`);

  const { stop } = await startSessionServer({
    ipcPath,
    stateDir: defaultStateDir()
  });

  console.info("ready");

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    console.info(`received ${signal}, shutting down...`);
    await stop();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGHUP", () => void shutdown("SIGHUP"));

  // Keep the process alive
  await new Promise<void>(() => {});
}

main().catch((error) => {
  console.error("fatal:", error);
  process.exit(1);
});
