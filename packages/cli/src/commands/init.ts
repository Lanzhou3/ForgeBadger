import { pathToFileURL } from "node:url";
import path from "node:path";

import { resolveInstalledPaths, type InstalledPaths } from "../runtime/paths.js";
import { writeForgeBadgerInstallBanner } from "../ui/install-banner.js";

interface OutputWriter {
  write(chunk: string): unknown;
}

interface GatewayInitModule {
  runForgeBadgerCli(args: string[]): Promise<number>;
}

export interface RunInitOptions {
  resolvePaths?: () => InstalledPaths;
  importModule?: (specifier: string) => Promise<unknown>;
  isTTY?: boolean;
  env?: NodeJS.ProcessEnv;
  stdout?: OutputWriter;
}

export async function runInit(args: string[], options: RunInitOptions = {}): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const env = options.env ?? process.env;
  const isTTY = options.isTTY ?? process.stdin.isTTY === true;

  writeForgeBadgerInstallBanner(stdout, { isTTY, env });

  const resolvePaths = options.resolvePaths ?? resolveInstalledPaths;
  const importModule = options.importModule ?? importGatewayInitModule;
  const paths = resolvePaths();
  const gatewayInitEntry = resolveGatewayInitEntry(paths);
  const module = await importModule(pathToFileURL(gatewayInitEntry).href);

  return assertGatewayInitModule(module).runForgeBadgerCli(args);
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
