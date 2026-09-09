import type { Database } from "../db/types.js";
import type { GatewayEnv } from "../config/env.js";
import { initializeDatabase } from "../db/client.js";
import { SessionRepository } from "../db/repositories/session-repository.js";
import { InMemoryApiKeyStore } from "../secrets/api-key-store.js";
import { InMemorySessionManager } from "./session-manager.js";
import { createDbSessionRecoveryStore } from "./db-session-recovery-store.js";
import { createTmuxClient, type TmuxClient } from "./tmux.js";
import {
  resolveTerminalMultiplexerRuntime,
  type TerminalMultiplexerRuntime
} from "./terminal-multiplexer-runtime.js";
import { ForgeBadgerEventBus } from "./event-bus.js";
import { cleanupExpiredCliConfigBackups } from "./cli-config-apply.js";
import type { SessionServerClient } from "./session-server-client.js";

export interface StartupResult {
  db: Database;
  sessionManager: InMemorySessionManager;
  apiKeyStore: InMemoryApiKeyStore;
  eventBus: ForgeBadgerEventBus;
  terminalRuntime: TerminalMultiplexerRuntime;
  /** Present when using the custom Session Server (non-tmux) architecture. */
  sessionServerClient?: SessionServerClient | undefined;
  /** Stops the periodic session status correction scan. */
  stopStatusCorrection: () => void;
}

export async function startupGateway(options: {
  env: GatewayEnv;
  tmuxClient?: TmuxClient;
  terminalRuntime?: TerminalMultiplexerRuntime;
  /** Session Server client for the custom (non-tmux) architecture. */
  sessionServerClient?: SessionServerClient;
}): Promise<StartupResult> {
  const db = initializeDatabase(options.env.FORGEBADGER_DB_PATH);
  cleanupExpiredCliConfigBackups();
  const backupCleanupTimer = setInterval(() => cleanupExpiredCliConfigBackups(), 60 * 60 * 1000);
  backupCleanupTimer.unref?.();

  const apiKeyStore = new InMemoryApiKeyStore({
    masterKey: options.env.FORGEBADGER_MASTER_KEY
  });
  const eventBus = new ForgeBadgerEventBus();
  const terminalRuntime = options.terminalRuntime ?? resolveTerminalMultiplexerRuntime();

  // Determine which terminal backend to use:
  //   1. Explicit tmuxClient (test override) → use it
  //   2. sessionServerClient (custom architecture) → use it
  //   3. Default → create tmux client
  const terminalBackend: TmuxClient = options.tmuxClient
    ?? options.sessionServerClient
    ?? createTmuxClient(terminalRuntime);

  const sessionServerClient = options.sessionServerClient;
  const sessionManager = new InMemorySessionManager(
    terminalBackend,
    createDbSessionRecoveryStore(db, options.env.FORGEBADGER_MASTER_KEY),
    eventBus,
    {
      tmuxPrefix: options.env.FORGEBADGER_TMUX_PREFIX,
      db,
      // The session-server client detects daemon restarts via the hello
      // pid/startedAt identity; the correction scan consumes this to mark
      // orphaned sessions `lost` instead of `exited`.
      ...(sessionServerClient
        ? { detectBackendRestart: () => sessionServerClient.consumeServerRestarted() }
        : {}),
      runtimeInputAuthorizer(runtimeSession) {
        // Tenant check: the session must exist for the runtime user.
        const session = new SessionRepository(db, runtimeSession.userId).getById(runtimeSession.id);
        if (!session) throw new Error("Session authorization is unavailable");
      }
    }
  );

  await sessionManager.recoverForgeBadgerSessions({
    userId: "system",
    cwd: process.cwd()
  }).catch((error: unknown) => {
    console.error(JSON.stringify({
      level: "error",
      action: "gateway.recover_sessions_failed",
      message: error instanceof Error ? error.message : String(error)
    }));
  });

  // Periodic drift correction: marks sessions whose backing terminal
  // disappeared (daemon restart → lost; otherwise exited). Unref'd, so it
  // never keeps the process alive.
  const stopStatusCorrection = sessionManager.startStatusCorrectionScan();

  return {
    db,
    sessionManager,
    apiKeyStore,
    eventBus,
    terminalRuntime,
    sessionServerClient: options.sessionServerClient,
    stopStatusCorrection
  };
}
