import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { GatewayEnv } from "../config/env.js";
import { loadEnv } from "../config/env.js";
import { createGatewayApp, type GatewayApp } from "../server.js";
import { startupGateway } from "../services/startup.js";
import type { TmuxClient } from "../services/tmux.js";
import type { OperationsRuntimeFactory } from "../services/portfolio/operations-runtime.js";

export interface StartedGateway extends GatewayApp {
  host: string;
  port: number;
}

/** @internal Test/runtime wiring hook; production callers should use the defaults. */
export interface GatewayRuntimeOverrides {
  tmuxClient?: TmuxClient;
  operationsRuntimeFactory?: OperationsRuntimeFactory;
}

export async function createGatewayRuntime(
  input: NodeJS.ProcessEnv | GatewayEnv = process.env,
  overrides: GatewayRuntimeOverrides = {}
): Promise<GatewayApp> {
  const env = resolveGatewayEnv(input);
  const startupOptions = {
    env,
    ...(overrides.tmuxClient === undefined ? {} : { tmuxClient: overrides.tmuxClient }),
    ...(overrides.operationsRuntimeFactory === undefined ? {} : { operationsRuntimeFactory: overrides.operationsRuntimeFactory })
  };
  const {
    db,
    sessionManager,
    apiKeyStore,
    eventBus,
    feishuChannelRuntime,
    claudePortfolioWorker,
    portfolioExecution,
    operationsRuntime
  } = await startupGateway(startupOptions);

  // M2 dsh copilot: when enabled without a configured bridge token, generate
  // an ephemeral per-boot token that serves both the internal route mount and
  // the child-process env injection. The value is never logged.
  const dshEnabled = env.OPENFORGE_DSH_COPILOT_ENABLED;
  let bridgeToken = env.OPENFORGE_COPILOT_BRIDGE_TOKEN;
  if (dshEnabled && !bridgeToken) {
    bridgeToken = randomBytes(32).toString("hex");
    console.info("[gateway] dsh copilot enabled: generated an ephemeral copilot-bridge token for this boot");
  }

  const runtime = createGatewayApp({
    jwtSecret: env.OPENFORGE_JWT_SECRET,
    masterKey: env.OPENFORGE_MASTER_KEY,
    db,
    sessionManager,
    apiKeyStore,
    eventBus,
    claudePortfolioWorker,
    portfolioExecution,
    operationsRuntime,
    feishuChannelRuntime,
    copilotBridgeToken: bridgeToken,
    copilotReactiveEnabled: env.OPENFORGE_COPILOT_REACTIVE_ENABLED,
    dispatchConfirm: {
      timeoutMs: env.OPENFORGE_DISPATCH_CONFIRM_TIMEOUT_MS,
      intervalMs: env.OPENFORGE_DISPATCH_CONFIRM_INTERVAL_MS
    },
    ...(dshEnabled
      ? {
        dshCopilot: {
          launcherPath: env.OPENFORGE_DSH_BRIDGE_LAUNCHER ?? defaultDshLauncherPath(),
          gatewayUrl: `http://${env.OPENFORGE_HOST}:${env.OPENFORGE_PORT}`,
          bridgeToken: bridgeToken ?? "",
          stateDir: env.OPENFORGE_STATE_DIR,
          idleMs: env.OPENFORGE_DSH_IDLE_MS
        }
      }
      : {})
  });

  await runtime.recoveryReady;
  return runtime;
}

export async function startGateway(
  input: NodeJS.ProcessEnv | GatewayEnv = process.env,
  overrides: GatewayRuntimeOverrides = {}
): Promise<StartedGateway> {
  const env = resolveGatewayEnv(input);
  const runtime = await createGatewayRuntime(env, overrides);

  try {
    await listen(runtime.server, env.OPENFORGE_PORT, env.OPENFORGE_HOST);
  } catch (error) {
    await runtime.close();
    throw error;
  }

  return {
    ...runtime,
    host: env.OPENFORGE_HOST,
    port: env.OPENFORGE_PORT
  };
}

function resolveGatewayEnv(input: NodeJS.ProcessEnv | GatewayEnv): GatewayEnv {
  return loadEnv(input as NodeJS.ProcessEnv);
}

/** Default dsh launcher: the monorepo dsh-bridge build output. */
function defaultDshLauncherPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "dsh-bridge", "dist", "launcher.js");
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
