import type { Server } from "node:http";

import type { GatewayEnv } from "../config/env.js";
import { loadEnv } from "../config/env.js";
import { createGatewayApp, type GatewayApp } from "../server.js";
import { startupGateway } from "../services/startup.js";
import type { TerminalBackendClient } from "../services/terminal-backend.js";
import { createLocalAccountRecovery } from "../services/local-account-recovery.js";
import { createPlatformAdapter } from "../services/session-server/platform-adapter.js";
import { resolveSessionServerTokenPath } from "../services/session-server/auth-token.js";
import {
  startAndConnectSessionServer,
  type SessionServerIntegration
} from "../services/session-server-integration.js";

export interface StartedGateway extends GatewayApp {
  host: string;
  port: number;
}

/** @internal Test/runtime wiring hook; production callers should use the defaults. */
export interface GatewayRuntimeOverrides {
  /** Test seam: inject a terminal backend directly (skips Session Server startup). */
  backendClient?: TerminalBackendClient;
  /** Explicit Session Server IPC endpoint override. */
  sessionServerIpcPath?: string;
  /** Pre-connected Session Server client (test override). */
  sessionServerClient?: import("../services/session-server-client.js").SessionServerClient;
}

export async function createGatewayRuntime(
  input: NodeJS.ProcessEnv | GatewayEnv = process.env,
  overrides: GatewayRuntimeOverrides = {}
): Promise<GatewayApp> {
  const env = resolveGatewayEnv(input);
  const accountRecovery = createLocalAccountRecovery(env.FORGEBADGER_STATE_DIR);

  // The Session Server is the single terminal backend:
  //   1. overrides.sessionServerClient → pre-connected client (test injection)
  //   2. overrides.backendClient       → direct backend injection (test seam)
  //   3. otherwise                     → probe/spawn the daemon and connect
  let sessionServerIntegration: SessionServerIntegration | undefined;
  let sessionServerIpcPath: string;

  const ipcPathOverride =
    overrides.sessionServerIpcPath ?? env.FORGEBADGER_SESSION_SERVER_IPC_PATH;

  if (overrides.sessionServerClient || overrides.backendClient) {
    // Injected backend (tests): no daemon is spawned; the WS handler still
    // needs a syntactically valid IPC path even though nothing listens there.
    sessionServerIpcPath = ipcPathOverride ?? defaultSessionServerIpcPath(env);
  } else {
    // Probe-and-reuse or spawn the daemon; the IPC endpoint falls back to the
    // platform default (Windows named pipe / POSIX state-dir socket).
    sessionServerIntegration = await startAndConnectSessionServer({
      stateDir: env.FORGEBADGER_STATE_DIR,
      ...(ipcPathOverride ? { ipcPath: ipcPathOverride } : {})
    });
    sessionServerIpcPath = sessionServerIntegration.ipcPath;
  }

  try {
    const startupOptions = {
      env,
      ...(overrides.backendClient === undefined ? {} : { backendClient: overrides.backendClient }),
      ...(sessionServerIntegration ? { sessionServerClient: sessionServerIntegration.client } : {}),
      ...(overrides.sessionServerClient ? { sessionServerClient: overrides.sessionServerClient } : {})
    };
    console.info("[gateway] local account recovery key ready", {
      path: accountRecovery.keyPath
    });
    const {
      db,
      sessionManager,
      apiKeyStore,
      eventBus,
      stopStatusCorrection
    } = await startupGateway(startupOptions);

    const runtime = createGatewayApp({
      jwtSecret: env.FORGEBADGER_JWT_SECRET,
      masterKey: env.FORGEBADGER_MASTER_KEY,
      db,
      sessionManager,
      apiKeyStore,
      eventBus,
      accountRecovery,
      registrationMode: env.FORGEBADGER_REGISTRATION,
      sessionServerIpcPath,
      sessionServerTokenPath: resolveSessionServerTokenPath(env.FORGEBADGER_STATE_DIR)
    });

    // Attach shutdown hook: the Gateway only disconnects from the Session
    // Server daemon — the daemon (and its CLI sessions) must outlive the
    // Gateway. Killing it is an explicit maintenance action
    // (SessionServerIntegration.stop), never part of normal shutdown.
    const originalClose = runtime.close.bind(runtime);
    (runtime as { close: () => Promise<void> }).close = async () => {
      try {
        stopStatusCorrection();
        await originalClose();
      } finally {
        await sessionServerIntegration?.disconnect();
      }
    };

    await runtime.recoveryReady;
    return runtime;
  } catch (error) {
    // We own only the Gateway connection; startup failures must not kill
    // the independent daemon or the CLI sessions it continues hosting.
    await sessionServerIntegration?.disconnect();
    throw error;
  }
}

function defaultSessionServerIpcPath(env: GatewayEnv): string {
  return createPlatformAdapter().getIpcPath(env.FORGEBADGER_STATE_DIR);
}

export async function startGateway(
  input: NodeJS.ProcessEnv | GatewayEnv = process.env,
  overrides: GatewayRuntimeOverrides = {}
): Promise<StartedGateway> {
  const env = resolveGatewayEnv(input);
  const runtime = await createGatewayRuntime(env, overrides);

  try {
    await listen(runtime.server, env.FORGEBADGER_PORT, env.FORGEBADGER_HOST);
  } catch (error) {
    await runtime.close();
    throw error;
  }

  return {
    ...runtime,
    host: env.FORGEBADGER_HOST,
    port: env.FORGEBADGER_PORT
  };
}

function resolveGatewayEnv(input: NodeJS.ProcessEnv | GatewayEnv): GatewayEnv {
  return loadEnv(input as NodeJS.ProcessEnv);
}

async function listen(server: Server, port: number, host: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.listen(port, host, onListening);
  });
}
