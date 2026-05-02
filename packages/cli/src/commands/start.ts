import type { ChildProcess } from "node:child_process";

import {
  loadOrCreateRuntimeConfig,
  type LoadRuntimeConfigOptions,
  type RuntimeConfig
} from "../runtime/config.js";
import { resolveInstalledPaths, type InstalledPaths } from "../runtime/paths.js";
import { assertPortAvailable } from "../runtime/ports.js";
import { installShutdownHandlers, spawnNode, type ShutdownCleanup } from "../runtime/processes.js";
import { writeWebRuntimeConfig, type WriteWebRuntimeConfigOptions } from "../runtime/web-runtime.js";

interface OutputWriter {
  write(chunk: string): unknown;
}

export interface RunStartOptions extends LoadRuntimeConfigOptions {
  openBrowser?: boolean;
  loadConfig?: (options: LoadRuntimeConfigOptions) => Promise<RuntimeConfig>;
  resolvePaths?: () => InstalledPaths;
  checkPort?: (host: string, port: number) => Promise<void>;
  writeRuntimeConfig?: (options: WriteWebRuntimeConfigOptions) => Promise<string>;
  spawn?: (entry: string, env: NodeJS.ProcessEnv) => ChildProcess;
  installShutdown?: (children: ChildProcess[]) => ShutdownCleanup | void;
  stdout?: OutputWriter;
}

interface ChildResult {
  child: ChildProcess;
  type: "error" | "exit" | "close";
  code: number | null;
  error?: Error;
}

export async function runStart(options: RunStartOptions = {}): Promise<number> {
  const loadConfig = options.loadConfig ?? loadOrCreateRuntimeConfig;
  const resolvePaths = options.resolvePaths ?? resolveInstalledPaths;
  const checkPort = options.checkPort ?? assertPortAvailable;
  const writeRuntimeConfig = options.writeRuntimeConfig ?? writeWebRuntimeConfig;
  const spawnProcess = options.spawn ?? spawnNode;
  const installShutdown = options.installShutdown ?? installShutdownHandlers;
  const stdout = options.stdout ?? process.stdout;

  const config = await loadConfig(toRuntimeConfigOptions(options));
  const paths = resolvePaths();
  const gatewayUrl = buildUrl(config.gateway.host, config.gateway.port);
  const webUrl = buildUrl(config.web.host, config.web.port);

  await checkPort(config.gateway.host, config.gateway.port);
  await checkPort(config.web.host, config.web.port);
  try {
    await writeRuntimeConfig({ webPublicDir: paths.webPublicDir, gatewayBaseUrl: gatewayUrl });
  } catch (error) {
    throw new Error(`Unable to write Web runtime config to ${paths.webPublicDir}: ${formatError(error)}`, {
      cause: error
    });
  }

  const gateway = spawnProcess(paths.gatewayEntry, buildGatewayEnv(config, gatewayUrl));
  const web = spawnProcess(paths.webServerEntry, buildWebEnv(config, gatewayUrl));
  const children = [gateway, web];
  const childResult = waitForFirstChildResult(children);
  const cleanupShutdown = installShutdown(children) ?? noop;

  try {
    stdout.write(`OpenForge Web Console: ${webUrl}\n`);
    stdout.write(`OpenForge Gateway: ${gatewayUrl}\n`);

    const result = await childResult;
    terminateSiblings(children, result.child);

    if (result.type === "error") {
      throw result.error ?? new Error("OpenForge child process failed to spawn");
    }

    return result.code ?? 1;
  } finally {
    cleanupShutdown();
  }
}

function toRuntimeConfigOptions(options: RunStartOptions): LoadRuntimeConfigOptions {
  const runtimeOptions: LoadRuntimeConfigOptions = {};
  if (options.stateDir !== undefined) {
    runtimeOptions.stateDir = options.stateDir;
  }
  if (options.gatewayPort !== undefined) {
    runtimeOptions.gatewayPort = options.gatewayPort;
  }
  if (options.webPort !== undefined) {
    runtimeOptions.webPort = options.webPort;
  }
  if (options.host !== undefined) {
    runtimeOptions.host = options.host;
  }
  return runtimeOptions;
}

function buildGatewayEnv(config: RuntimeConfig, gatewayUrl: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    OPENFORGE_HOST: config.gateway.host,
    OPENFORGE_PORT: String(config.gateway.port),
    OPENFORGE_STATE_DIR: config.stateDir,
    OPENFORGE_DB_PATH: config.dbPath,
    OPENFORGE_MASTER_KEY: config.secrets.masterKey,
    OPENFORGE_JWT_SECRET: config.secrets.jwtSecret,
    OPENFORGE_GATEWAY_URL: gatewayUrl
  };
}

function buildWebEnv(config: RuntimeConfig, gatewayUrl: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.OPENFORGE_MASTER_KEY;
  delete env.OPENFORGE_JWT_SECRET;

  return {
    ...env,
    HOSTNAME: config.web.host,
    PORT: String(config.web.port),
    OPENFORGE_GATEWAY_URL: gatewayUrl
  };
}

function buildUrl(host: string, port: number): string {
  return `http://${host}:${port}`;
}

function waitForFirstChildResult(children: ChildProcess[]): Promise<ChildResult> {
  return new Promise((resolve) => {
    const cleanupCallbacks: Array<() => void> = [];
    let settled = false;

    const settle = (result: ChildResult) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanupChildListeners(cleanupCallbacks);
      resolve(result);
    };

    for (const child of children) {
      const onError = (error: Error) => {
        settle({ child, type: "error", code: null, error });
      };
      const onExit = (code: number | null) => {
        settle({ child, type: "exit", code });
      };
      const onClose = (code: number | null) => {
        settle({ child, type: "close", code });
      };

      child.once("error", onError);
      child.once("exit", onExit);
      child.once("close", onClose);
      cleanupCallbacks.push(() => {
        child.off("error", onError);
        child.off("exit", onExit);
        child.off("close", onClose);
      });
    }
  });
}

function cleanupChildListeners(cleanupCallbacks: Array<() => void>): void {
  for (const cleanup of cleanupCallbacks) {
    cleanup();
  }
}

function terminateSiblings(children: ChildProcess[], finishedChild: ChildProcess): void {
  for (const child of children) {
    if (child !== finishedChild && !child.killed) {
      child.kill("SIGTERM");
    }
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function noop(): void {}
