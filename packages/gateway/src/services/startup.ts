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

export interface StartupResult {
  db: Database;
  sessionManager: InMemorySessionManager;
  apiKeyStore: InMemoryApiKeyStore;
  eventBus: ForgeBadgerEventBus;
  terminalRuntime: TerminalMultiplexerRuntime;
}

export async function startupGateway(options: {
  env: GatewayEnv;
  tmuxClient?: TmuxClient;
  terminalRuntime?: TerminalMultiplexerRuntime;
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
  const sessionManager = new InMemorySessionManager(
    options.tmuxClient ?? createTmuxClient(terminalRuntime),
    createDbSessionRecoveryStore(db, options.env.FORGEBADGER_MASTER_KEY),
    eventBus,
    {
      tmuxPrefix: options.env.FORGEBADGER_TMUX_PREFIX,
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

  return { db, sessionManager, apiKeyStore, eventBus, terminalRuntime };
}
