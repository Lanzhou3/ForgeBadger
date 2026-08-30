import type { ChildProcess } from "node:child_process";
import path from "node:path";

import {
  loadOrCreateRuntimeConfig,
  type LoadRuntimeConfigOptions,
  type RuntimeConfig
} from "../runtime/config.js";
import { resolveInstalledPaths, type InstalledPaths } from "../runtime/paths.js";
import { assertPortAvailable } from "../runtime/ports.js";
import { installShutdownHandlers, spawnNode, type ShutdownCleanup } from "../runtime/processes.js";
import {
  prepareWebRuntime,
  type PreparedWebRuntime,
  type PrepareWebRuntimeOptions,
  writeWebRuntimeConfig,
  type WriteWebRuntimeConfigOptions
} from "../runtime/web-runtime.js";
import {
  checkCliTerminalRuntime,
  type CliCommandRunner
} from "../runtime/dependency-check.js";

interface OutputWriter {
  write(chunk: string): unknown;
}

export interface RunStartOptions extends LoadRuntimeConfigOptions {
  openBrowser?: boolean;
  loadConfig?: (options: LoadRuntimeConfigOptions) => Promise<RuntimeConfig>;
  resolvePaths?: () => InstalledPaths;
  checkPort?: (host: string, port: number) => Promise<void>;
  prepareWebRuntime?: (options: PrepareWebRuntimeOptions) => Promise<PreparedWebRuntime>;
  writeRuntimeConfig?: (options: WriteWebRuntimeConfigOptions) => Promise<string>;
  spawn?: (entry: string, env: NodeJS.ProcessEnv) => ChildProcess;
  installShutdown?: (children: ChildProcess[]) => ShutdownCleanup | void;
  dependencyRunner?: CliCommandRunner;
  platform?: NodeJS.Platform;
  stdout?: OutputWriter;
  stderr?: OutputWriter;
}

interface ChildResult {
  child: ChildProcess;
  type: "error" | "exit" | "close";
  code: number | null;
  error?: Error;
}

const WEB_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "USERNAME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "NODE_ENV",
  "NODE_OPTIONS",
  "SYSTEMROOT",
  "COMSPEC"
] as const;

export async function runStart(options: RunStartOptions = {}): Promise<number> {
  const loadConfig = options.loadConfig ?? loadOrCreateRuntimeConfig;
  const resolvePaths = options.resolvePaths ?? resolveInstalledPaths;
  const checkPort = options.checkPort ?? assertPortAvailable;
  const prepareRuntime = options.prepareWebRuntime ?? prepareWebRuntime;
  const writeRuntimeConfig = options.writeRuntimeConfig ?? writeWebRuntimeConfig;
  const spawnProcess = options.spawn ?? spawnNode;
  const installShutdown = options.installShutdown ?? installShutdownHandlers;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  const config = await loadConfig(toRuntimeConfigOptions(options));
  const paths = resolvePaths();
  assertDistinctBindEndpoints(config);
  if (options.dependencyRunner || options.spawn === undefined) {
    await warnIfTerminalRuntimeUnsupported({
      dependencyRunner: options.dependencyRunner,
      platform: options.platform ?? process.platform,
      stderr
    });
  }

  const gatewayUrl = buildBrowserUrl(config.gateway.host, config.gateway.port);
  const webUrl = buildBrowserUrl(config.web.host, config.web.port);

  await checkPort(config.gateway.host, config.gateway.port);
  await checkPort(config.web.host, config.web.port);

  const webRuntime = await prepareRuntime({
    installedWebServerEntry: paths.webServerEntry,
    runtimeWebDir: path.join(config.stateDir, "runtime", "web")
  });

  try {
    await writeRuntimeConfig({ webPublicDir: webRuntime.webPublicDir, gatewayBaseUrl: gatewayUrl });
  } catch (error) {
    throw new Error(`Unable to write Web runtime config to ${webRuntime.webPublicDir}: ${formatError(error)}`, {
      cause: error
    });
  }

  const gateway = spawnProcess(paths.gatewayEntry, buildGatewayEnv(config, gatewayUrl));
  const web = spawnProcess(webRuntime.webServerEntry, buildWebEnv(config, gatewayUrl));
  const children = [gateway, web];
  const childResult = waitForFirstChildResult(children);
  const cleanupShutdown = installShutdown(children) ?? noop;

  try {
    stdout.write(`ForgeBadger Web Console: ${webUrl}\n`);
    stdout.write(`ForgeBadger Gateway: ${gatewayUrl}\n`);
    if (options.openBrowser) {
      stdout.write("--open is not supported yet; open the URL manually.\n");
    }

    const result = await childResult;
    terminateSiblings(children, result.child);

    if (result.type === "error") {
      throw result.error ?? new Error("ForgeBadger child process failed to spawn");
    }

    return result.code ?? 1;
  } finally {
    cleanupShutdown();
  }
}

async function warnIfTerminalRuntimeUnsupported(options: {
  dependencyRunner?: CliCommandRunner | undefined;
  platform: NodeJS.Platform;
  stderr: OutputWriter;
}): Promise<void> {
  const terminalRuntime = await checkCliTerminalRuntime({
    ...(options.dependencyRunner ? { runner: options.dependencyRunner } : {}),
    platform: options.platform
  });
  if (terminalRuntime.supported) {
    return;
  }
  options.stderr.write(
    `Terminal warning: ${terminalRuntime.message} Run \`forgebadger doctor\` for dependency details.\n`
  );
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
  if (options.env !== undefined) {
    runtimeOptions.env = options.env;
  }
  if (options.homeDir !== undefined) {
    runtimeOptions.homeDir = options.homeDir;
  }
  return runtimeOptions;
}

function buildGatewayEnv(config: RuntimeConfig, gatewayUrl: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    FORGEBADGER_HOST: config.gateway.host,
    FORGEBADGER_PORT: String(config.gateway.port),
    FORGEBADGER_STATE_DIR: config.stateDir,
    FORGEBADGER_DB_PATH: config.dbPath,
    FORGEBADGER_MASTER_KEY: config.secrets.masterKey,
    FORGEBADGER_JWT_SECRET: config.secrets.jwtSecret,
    FORGEBADGER_GATEWAY_URL: gatewayUrl
  };
}

function buildWebEnv(config: RuntimeConfig, gatewayUrl: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of WEB_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }

  return {
    ...env,
    HOSTNAME: config.web.host,
    PORT: String(config.web.port),
    FORGEBADGER_GATEWAY_URL: gatewayUrl
  };
}

function assertDistinctBindEndpoints(config: RuntimeConfig): void {
  if (config.gateway.host === config.web.host && config.gateway.port === config.web.port) {
    throw new Error(`Gateway and Web cannot use the same bind endpoint: ${formatBindEndpoint(config.gateway.host, config.gateway.port)}`);
  }
  if (config.gateway.port === config.web.port && bindHostsOverlap(config.gateway.host, config.web.host)) {
    throw new Error(
      `Gateway and Web cannot use overlapping bind endpoints: ${formatBindEndpoint(config.gateway.host, config.gateway.port)} and ${formatBindEndpoint(config.web.host, config.web.port)}`
    );
  }
}

function buildBrowserUrl(bindHost: string, port: number): string {
  return `http://${formatBrowserHost(bindHost)}:${port}`;
}

function formatBrowserHost(bindHost: string): string {
  if (bindHost === "0.0.0.0" || bindHost === "::" || bindHost === "[::]") {
    return "127.0.0.1";
  }
  if (bindHost.startsWith("[") && bindHost.endsWith("]")) {
    return bindHost;
  }
  if (bindHost.includes(":")) {
    return `[${bindHost}]`;
  }
  return bindHost;
}

function formatBindEndpoint(host: string, port: number): string {
  if (host.startsWith("[") && host.endsWith("]")) {
    return `${host}:${port}`;
  }
  if (host.includes(":")) {
    return `[${host}]:${port}`;
  }
  return `${host}:${port}`;
}

function bindHostsOverlap(firstHost: string, secondHost: string): boolean {
  if (isWildcardBindHost(firstHost) || isWildcardBindHost(secondHost)) {
    return true;
  }

  const firstAliases = bindHostAliases(firstHost);
  const secondAliases = bindHostAliases(secondHost);
  return firstAliases.some((alias) => secondAliases.includes(alias));
}

function normalizeBindHost(host: string): string {
  return host.toLowerCase().replace(/^\[(.*)]$/, "$1");
}

function isWildcardBindHost(host: string): boolean {
  const normalized = normalizeBindHost(host);
  return normalized === "0.0.0.0" || normalized === "::";
}

function bindHostAliases(host: string): string[] {
  const normalized = normalizeBindHost(host);
  if (normalized === "localhost") {
    return ["localhost", "127.0.0.1", "::1"];
  }
  return [normalized];
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
