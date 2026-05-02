import type { Server } from "node:http";

import type { GatewayEnv } from "../config/env.js";
import { loadEnv } from "../config/env.js";
import { createGatewayApp, type GatewayApp } from "../server.js";
import { startupGateway } from "../services/startup.js";
import type { TmuxClient } from "../services/tmux.js";

export interface StartedGateway extends GatewayApp {
  host: string;
  port: number;
}

export interface GatewayRuntimeOverrides {
  tmuxClient?: TmuxClient;
}

export async function createGatewayRuntime(
  input: NodeJS.ProcessEnv | GatewayEnv = process.env,
  overrides: GatewayRuntimeOverrides = {}
): Promise<GatewayApp> {
  const env = resolveGatewayEnv(input);
  const startupOptions =
    overrides.tmuxClient === undefined ? { env } : { env, tmuxClient: overrides.tmuxClient };
  const { db, sessionManager, apiKeyStore, eventBus } = await startupGateway(startupOptions);
  const runtime = createGatewayApp({
    jwtSecret: env.OPENFORGE_JWT_SECRET,
    masterKey: env.OPENFORGE_MASTER_KEY,
    db,
    sessionManager,
    apiKeyStore,
    eventBus
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

  await listen(runtime.server, env.OPENFORGE_PORT, env.OPENFORGE_HOST);

  return {
    ...runtime,
    host: env.OPENFORGE_HOST,
    port: env.OPENFORGE_PORT
  };
}

function resolveGatewayEnv(input: NodeJS.ProcessEnv | GatewayEnv): GatewayEnv {
  return isGatewayEnv(input) ? input : loadEnv(input);
}

function isGatewayEnv(input: NodeJS.ProcessEnv | GatewayEnv): input is GatewayEnv {
  return (
    typeof input.OPENFORGE_PORT === "number" &&
    typeof input.OPENFORGE_HOST === "string" &&
    typeof input.OPENFORGE_STATE_DIR === "string" &&
    typeof input.OPENFORGE_DB_PATH === "string" &&
    typeof input.OPENFORGE_JWT_SECRET === "string" &&
    typeof input.OPENFORGE_MASTER_KEY === "string"
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
