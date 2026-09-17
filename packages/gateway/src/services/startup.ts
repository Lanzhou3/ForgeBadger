import type { Database } from "../db/types.js";
import type { GatewayEnv } from "../config/env.js";
import { initializeDatabase } from "../db/client.js";
import { SessionRepository } from "../db/repositories/session-repository.js";
import { InMemoryApiKeyStore } from "../secrets/api-key-store.js";
import { InMemorySessionManager } from "./session-manager.js";
import { createDbSessionRecoveryStore } from "./db-session-recovery-store.js";
import type { TerminalBackendClient } from "./terminal-backend.js";
import { ForgeBadgerEventBus } from "./event-bus.js";
import { cleanupExpiredCliConfigBackups } from "./cli-config-apply.js";
import type { SessionServerClient } from "./session-server-client.js";

export interface StartupResult {
  db: Database;
  sessionManager: InMemorySessionManager;
  apiKeyStore: InMemoryApiKeyStore;
  eventBus: ForgeBadgerEventBus;
  /** The connected Session Server client (the single terminal backend). */
  sessionServerClient?: SessionServerClient | undefined;
  /** Stops the periodic session status correction scan. */
  stopStatusCorrection: () => void;
}

export async function startupGateway(options: {
  env: GatewayEnv;
  /** Test seam: inject a terminal backend directly instead of a Session Server client. */
  backendClient?: TerminalBackendClient;
  /** Session Server client for the single-backend architecture. */
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

  // The Session Server is the only terminal backend; `backendClient` exists
  // purely as a test seam.
  const terminalBackend: TerminalBackendClient = options.backendClient
    ?? options.sessionServerClient
    ?? requireTerminalBackend();

  const sessionServerClient = options.sessionServerClient;
  const sessionManager = new InMemorySessionManager(
    terminalBackend,
    createDbSessionRecoveryStore(db, options.env.FORGEBADGER_MASTER_KEY),
    eventBus,
    {
      sessionPrefix: options.env.FORGEBADGER_SESSION_PREFIX,
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
    sessionServerClient: options.sessionServerClient,
    stopStatusCorrection
  };
}

function requireTerminalBackend(): never {
  throw new Error("A terminal backend client is required (Session Server)");
}
