import type { Server } from "node:http";

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
    feishuChannelRuntime
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
