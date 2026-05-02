import { once } from "node:events";
import type { ChildProcess } from "node:child_process";

import {
  loadOrCreateRuntimeConfig,
  type LoadRuntimeConfigOptions,
  type RuntimeConfig
} from "../runtime/config.js";
import { resolveInstalledPaths, type InstalledPaths } from "../runtime/paths.js";
import { assertPortAvailable } from "../runtime/ports.js";
import { installShutdownHandlers, spawnNode } from "../runtime/processes.js";
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
  installShutdown?: (children: ChildProcess[]) => void;
  stdout?: OutputWriter;
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
  await writeRuntimeConfig({ webPublicDir: paths.webPublicDir, gatewayBaseUrl: gatewayUrl });

  const gateway = spawnProcess(paths.gatewayEntry, buildGatewayEnv(config, gatewayUrl));
  const web = spawnProcess(paths.webServerEntry, buildWebEnv(config, gatewayUrl));

  installShutdown([gateway, web]);
  stdout.write(`OpenForge Web Console: ${webUrl}\n`);
  stdout.write(`OpenForge Gateway: ${gatewayUrl}\n`);

  const [code] = (await Promise.race([once(gateway, "exit"), once(web, "exit")])) as [number | null];
  return code ?? 0;
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
  return {
    ...process.env,
    HOSTNAME: config.web.host,
    PORT: String(config.web.port),
    OPENFORGE_GATEWAY_URL: gatewayUrl
  };
}

function buildUrl(host: string, port: number): string {
  return `http://${host}:${port}`;
}
