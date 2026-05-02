import type { Database } from "../db/types.js";
import type { GatewayEnv } from "../config/env.js";
import { initializeDatabase } from "../db/client.js";
import { InMemoryApiKeyStore } from "../secrets/api-key-store.js";
import { InMemorySessionManager } from "./session-manager.js";
import { createDbSessionRecoveryStore } from "./db-session-recovery-store.js";
import { createTmuxClient, type TmuxClient } from "./tmux.js";
import { OpenForgeEventBus } from "./event-bus.js";

export interface StartupResult {
  db: Database;
  sessionManager: InMemorySessionManager;
  apiKeyStore: InMemoryApiKeyStore;
  eventBus: OpenForgeEventBus;
}

export async function startupGateway(options: {
  env: GatewayEnv;
  tmuxClient?: TmuxClient;
}): Promise<StartupResult> {
  // 1. Validate env (already done by loadEnv)
  // 2. Initialize database
  const db = initializeDatabase(options.env.OPENFORGE_DB_PATH);

  // 3. Create API key store
  const apiKeyStore = new InMemoryApiKeyStore({
    masterKey: options.env.OPENFORGE_MASTER_KEY
  });

  // 4. Create event bus
  const eventBus = new OpenForgeEventBus();

  // 5. Create session manager
  const sessionManager = new InMemorySessionManager(
    options.tmuxClient ?? createTmuxClient(),
    createDbSessionRecoveryStore(db),
    eventBus
  );

  // 6. Recover sessions + kill orphans
  await sessionManager
    .recoverOpenForgeSessions({
      userId: "system",
      cwd: process.cwd()
    })
    .catch((err) => {
      console.error(
        JSON.stringify({
          level: "error",
          action: "gateway.recover_sessions_failed",
          message: err.message
        })
      );
    });

  return { db, sessionManager, apiKeyStore, eventBus };
}
