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
import { readSessionServerTokenFile } from "./session-server/auth-token.js";
import { createPlatformAdapter } from "./session-server/platform-adapter.js";

function defaultStateDir(): string {
  return process.env.FORGEBADGER_STATE_DIR ?? join(homedir(), ".forgebadger");
}

function parseArgs(args: string[]): { ipcPath?: string | undefined; tokenFile?: string | undefined } {
  let ipcPath: string | undefined;
  let tokenFile: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--ipc" && args[i + 1]) {
      ipcPath = args[i + 1];
      i++;
    } else if (args[i] === "--token-file" && args[i + 1]) {
      tokenFile = args[i + 1];
      i++;
    }
  }
  return { ipcPath, tokenFile };
}

async function main(): Promise<void> {
  const { ipcPath: ipcArg, tokenFile } = parseArgs(process.argv.slice(2));

  // The handshake token arrives via a 0600 file — never via argv value or
  // environment variable, so it cannot leak through `ps` or /proc.
  if (!tokenFile) {
    throw new Error("missing required --token-file <path> argument");
  }
  const token = readSessionServerTokenFile(tokenFile);

  const ipcPath = ipcArg ?? createPlatformAdapter().getIpcPath(defaultStateDir());

  console.info(`starting, ipc=${ipcPath}`);

  const { stop } = await startSessionServer({
    ipcPath,
    stateDir: defaultStateDir(),
    token
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
