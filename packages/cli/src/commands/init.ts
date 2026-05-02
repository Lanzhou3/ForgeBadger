import { pathToFileURL } from "node:url";

import { resolveInstalledPaths, type InstalledPaths } from "../runtime/paths.js";

interface GatewayInitModule {
  runOpenForgeCli(args: string[]): Promise<number>;
}

export interface RunInitOptions {
  resolvePaths?: () => InstalledPaths;
  importModule?: (specifier: string) => Promise<unknown>;
}

export async function runInit(args: string[], options: RunInitOptions = {}): Promise<number> {
  const resolvePaths = options.resolvePaths ?? resolveInstalledPaths;
  const importModule = options.importModule ?? importGatewayInitModule;
  const paths = resolvePaths();
  const module = await importModule(pathToFileURL(paths.gatewayInitEntry).href);

  return assertGatewayInitModule(module).runOpenForgeCli(args);
}

async function importGatewayInitModule(specifier: string): Promise<unknown> {
  return import(specifier);
}

function assertGatewayInitModule(module: unknown): GatewayInitModule {
  if (
    typeof module !== "object" ||
    module === null ||
    typeof (module as Partial<GatewayInitModule>).runOpenForgeCli !== "function"
  ) {
    throw new Error("Gateway init entry must export runOpenForgeCli(args)");
  }
  return module as GatewayInitModule;
}
