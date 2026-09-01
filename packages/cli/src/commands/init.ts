import { pathToFileURL } from "node:url";
import path from "node:path";

import { resolveInstalledPaths, type InstalledPaths } from "../runtime/paths.js";
import {
  ensureCliTerminalRuntime,
  type CliTerminalRuntimeInstallResult,
  type EnsureCliTerminalRuntimeOptions
} from "../runtime/terminal-runtime-install.js";
import {
  writeEnvironmentCheckStart,
  writeForgeBadgerInstallBanner
} from "../ui/install-banner.js";

interface OutputWriter {
  write(chunk: string): unknown;
}

interface GatewayInitModule {
  runForgeBadgerCli(args: string[]): Promise<number>;
}

export interface RunInitOptions {
  resolvePaths?: () => InstalledPaths;
  importModule?: (specifier: string) => Promise<unknown>;
  ensureTerminalRuntime?: typeof ensureCliTerminalRuntime;
  dependencyRunner?: EnsureCliTerminalRuntimeOptions["dependencyRunner"];
  confirmInstall?: EnsureCliTerminalRuntimeOptions["confirmInstall"];
  installRunner?: EnsureCliTerminalRuntimeOptions["installRunner"];
  platform?: NodeJS.Platform;
  isTTY?: boolean;
  env?: NodeJS.ProcessEnv;
  stdout?: OutputWriter;
  stderr?: OutputWriter;
}

export async function runInit(args: string[], options: RunInitOptions = {}): Promise<number> {
  const ensureTerminalRuntime = options.ensureTerminalRuntime ?? ensureCliTerminalRuntime;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const env = options.env ?? process.env;
  const isTTY = options.isTTY ?? process.stdin.isTTY === true;

  writeForgeBadgerInstallBanner(stdout, { isTTY, env });
  writeEnvironmentCheckStart(stdout);

  const runtimeResult = await ensureTerminalRuntime({
    platform: options.platform ?? process.platform,
    isTTY,
    env,
    ...(options.dependencyRunner ? { dependencyRunner: options.dependencyRunner } : {}),
    ...(options.confirmInstall ? { confirmInstall: options.confirmInstall } : {}),
    ...(options.installRunner ? { installRunner: options.installRunner } : {})
  });
  if (runtimeResult.status !== "ready") {
    stderr.write(formatInitRuntimeFailure(runtimeResult));
    return 1;
  }
  stdout.write(`[2/2] Environment ready: ${runtimeResult.runtime.message}\n\n`);
  const resolvePaths = options.resolvePaths ?? resolveInstalledPaths;
  const importModule = options.importModule ?? importGatewayInitModule;
  const paths = resolvePaths();
  const gatewayInitEntry = resolveGatewayInitEntry(paths);
  const module = await importModule(pathToFileURL(gatewayInitEntry).href);

  return assertGatewayInitModule(module).runForgeBadgerCli(args);
}

function formatInitRuntimeFailure(result: CliTerminalRuntimeInstallResult): string {
  const reason = result.status === "non_tty"
    ? "The runtime was not installed in this non-interactive environment."
    : result.status === "declined"
      ? "Runtime installation was declined."
      : result.message ?? "Runtime installation did not complete.";
  const command = result.installCommand ? ` Install with: ${result.installCommand}.` : "";
  return `Terminal requirement failed: ${result.runtime.message} ${reason}${command} Project initialization aborted before project files were written.\n`;
}

function resolveGatewayInitEntry(paths: InstalledPaths): string {
  const packageRoot = path.resolve(paths.packageRoot);
  const gatewayInitEntry = path.resolve(paths.gatewayInitEntry);
  const relative = path.relative(packageRoot, gatewayInitEntry);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Gateway init entry is outside the installed package");
  }
  return gatewayInitEntry;
}

async function importGatewayInitModule(specifier: string): Promise<unknown> {
  return import(specifier);
}

function assertGatewayInitModule(module: unknown): GatewayInitModule {
  if (
    typeof module !== "object" ||
    module === null ||
    typeof (module as Partial<GatewayInitModule>).runForgeBadgerCli !== "function"
  ) {
    throw new Error("Gateway init entry must export runForgeBadgerCli(args)");
  }
  return module as GatewayInitModule;
}
