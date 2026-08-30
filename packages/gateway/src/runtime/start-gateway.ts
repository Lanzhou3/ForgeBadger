import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import { statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
  const dshEnabled = env.FORGEBADGER_DSH_COPILOT_ENABLED;
  const dshLauncherPath = dshEnabled
    ? resolveDshLauncherPath(env.FORGEBADGER_DSH_BRIDGE_LAUNCHER)
    : undefined;
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
  let bridgeToken = env.FORGEBADGER_COPILOT_BRIDGE_TOKEN;
  if (dshEnabled && !bridgeToken) {
    bridgeToken = randomBytes(32).toString("hex");
    console.info("[gateway] dsh copilot enabled: generated an ephemeral copilot-bridge token for this boot");
  }

  const runtime = createGatewayApp({
    jwtSecret: env.FORGEBADGER_JWT_SECRET,
    masterKey: env.FORGEBADGER_MASTER_KEY,
    db,
    sessionManager,
    apiKeyStore,
    eventBus,
    claudePortfolioWorker,
    portfolioExecution,
    operationsRuntime,
    feishuChannelRuntime,
    copilotBridgeToken: bridgeToken,
    copilotReactiveEnabled: env.FORGEBADGER_COPILOT_REACTIVE_ENABLED,
    registrationMode: env.FORGEBADGER_REGISTRATION,
    dispatchConfirm: {
      timeoutMs: env.FORGEBADGER_DISPATCH_CONFIRM_TIMEOUT_MS,
      intervalMs: env.FORGEBADGER_DISPATCH_CONFIRM_INTERVAL_MS
    },
    ...(dshEnabled
      ? {
        dshCopilot: {
          launcherPath: dshLauncherPath!,
          gatewayUrl: `http://${env.FORGEBADGER_HOST}:${env.FORGEBADGER_PORT}`,
          bridgeToken: bridgeToken ?? "",
          stateDir: env.FORGEBADGER_STATE_DIR,
          idleMs: env.FORGEBADGER_DSH_IDLE_MS
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

/** Resolves the optional DSH bridge without assuming the source monorepo exists in npm installs. */
export function resolveDshLauncherPath(
  configuredPath: string | undefined,
  moduleUrl = import.meta.url
): string {
  const candidate = configuredPath?.trim()
    ? resolve(configuredPath)
    : join(dirname(fileURLToPath(moduleUrl)), "..", "..", "..", "dsh-bridge", "dist", "launcher.js");

  try {
    if (statSync(candidate).isFile()) {
      return candidate;
    }
  } catch {
    // Report one actionable configuration error below.
  }

  if (configuredPath?.trim()) {
    throw new Error(
      `FORGEBADGER_DSH_BRIDGE_LAUNCHER must point to an existing file when DSH Copilot is enabled: ${candidate}`
    );
  }
  throw new Error(
    "FORGEBADGER_DSH_BRIDGE_LAUNCHER is required when DSH Copilot is enabled outside a source checkout with packages/dsh-bridge/dist/launcher.js"
  );
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
