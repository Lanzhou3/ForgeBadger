import type { Server } from "node:http";

import type { GatewayEnv } from "../config/env.js";
import { loadEnv } from "../config/env.js";
import { createGatewayApp, type GatewayApp } from "../server.js";
import { startupGateway } from "../services/startup.js";
import type { TmuxClient } from "../services/tmux.js";
import { createLocalAccountRecovery } from "../services/local-account-recovery.js";
import type { TerminalMultiplexerRuntime } from "../services/terminal-multiplexer-runtime.js";
import { resolveTerminalMultiplexerRuntime } from "../services/terminal-multiplexer-runtime.js";
import {
  checkTerminalRuntimeReadiness,
  type TerminalRuntimeStatus
} from "../lib/dependency-check.js";
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
  tmuxClient?: TmuxClient;
  terminalRuntime?: TerminalMultiplexerRuntime;
  terminalRuntimeCheck?: () => Promise<TerminalRuntimeStatus>;
  /** Explicit Session Server IPC endpoint override (also forces the session-server backend). */
  sessionServerIpcPath?: string;
  /** Pre-connected Session Server client (test override). */
  sessionServerClient?: import("../services/session-server-client.js").SessionServerClient;
}

export async function createGatewayRuntime(
  input: NodeJS.ProcessEnv | GatewayEnv = process.env,
  overrides: GatewayRuntimeOverrides = {}
): Promise<GatewayApp> {
  const env = resolveGatewayEnv(input);
  const terminalRuntime = overrides.terminalRuntime ?? resolveTerminalMultiplexerRuntime();

  // Determine terminal backend mode:
  //   1. overrides.sessionServerClient → Session Server (pre-connected, test injection)
  //   2. overrides.tmuxClient          → legacy tmux/psmux (test injection / explicit opt-in)
  //   3. otherwise                     → FORGEBADGER_TERMINAL_BACKEND (default: session-server)
  const useSessionServer =
    overrides.sessionServerClient !== undefined
      ? true
      : overrides.tmuxClient !== undefined
        ? false
        : env.FORGEBADGER_TERMINAL_BACKEND === "session-server";

  let sessionServerIntegration: SessionServerIntegration | undefined;
  let sessionServerIpcPath: string | undefined;
  let terminalRuntimeStatus: TerminalRuntimeStatus;

  const ipcPathOverride =
    overrides.sessionServerIpcPath ?? env.FORGEBADGER_SESSION_SERVER_IPC_PATH;

  if (useSessionServer) {
    // Custom Session Server architecture — no tmux/psmux dependency check needed
    if (overrides.sessionServerClient) {
      // Pre-connected client (test override)
      sessionServerIpcPath = ipcPathOverride;
      terminalRuntimeStatus = {
        persistence: "tmux", // Historical field name
        mode: "native_tmux",
        supported: true,
        message: "Session Server client provided by test override."
      };
    } else {
      // Start and connect to the Session Server; the IPC endpoint falls back to
      // the platform default (Windows named pipe / POSIX state-dir socket).
      sessionServerIntegration = await startAndConnectSessionServer({
        stateDir: env.FORGEBADGER_STATE_DIR,
        ...(ipcPathOverride ? { ipcPath: ipcPathOverride } : {})
      });
      sessionServerIpcPath = sessionServerIntegration.ipcPath;
      terminalRuntimeStatus = {
        persistence: "tmux",
        mode: "native_tmux",
        supported: true,
        message: "Session Server is ready."
      };
    }
  } else {
    // Legacy tmux/psmux architecture
    terminalRuntimeStatus = await resolveTerminalRuntimeStatus(overrides, terminalRuntime);
    if (!terminalRuntimeStatus.supported) {
      throw new Error(`Terminal runtime is not ready: ${terminalRuntimeStatus.message}`);
    }
  }

  const startupOptions = {
    env,
    ...(overrides.tmuxClient === undefined ? {} : { tmuxClient: overrides.tmuxClient }),
    terminalRuntime,
    ...(sessionServerIntegration ? { sessionServerClient: sessionServerIntegration.client } : {}),
    ...(overrides.sessionServerClient ? { sessionServerClient: overrides.sessionServerClient } : {})
  };
  const accountRecovery = createLocalAccountRecovery(env.FORGEBADGER_STATE_DIR);
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
    terminalRuntime,
    registrationMode: env.FORGEBADGER_REGISTRATION,
    sessionServerIpcPath
  });

  // Attach shutdown hook: the Gateway only disconnects from the Session
  // Server daemon — the daemon (and its CLI sessions) must outlive the
  // Gateway. Killing it is an explicit maintenance action
  // (SessionServerIntegration.stop), never part of normal shutdown.
  const originalClose = runtime.close.bind(runtime);
  (runtime as { close: () => Promise<void> }).close = async () => {
    stopStatusCorrection();
    await originalClose();
    await sessionServerIntegration?.disconnect();
  };

  await runtime.recoveryReady;
  return runtime;
}

async function resolveTerminalRuntimeStatus(
  overrides: GatewayRuntimeOverrides,
  runtime: TerminalMultiplexerRuntime
): Promise<TerminalRuntimeStatus> {
  if (overrides.terminalRuntimeCheck) return overrides.terminalRuntimeCheck();
  // An injected client is a test/runtime boundary and cannot be probed through the host PATH.
  if (overrides.tmuxClient) {
    return {
      persistence: runtime.kind,
      mode: runtime.kind === "psmux" ? "native_psmux" : "native_tmux",
      supported: true,
      message: `${runtime.command} is provided by the injected terminal runtime.`
    };
  }
  return checkTerminalRuntimeReadiness();
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
