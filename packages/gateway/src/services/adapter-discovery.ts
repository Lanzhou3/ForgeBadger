import {
  checkOpenForgeRuntimeDependencies,
  type CommandRunner,
  type DependencyStatus,
  type TerminalRuntimeStatus
} from "../lib/dependency-check.js";

export type AdapterId = "claude" | "opencode" | "codex";
export type AdapterRuntimeMode = "terminal" | "app-server-stdio" | "app-server-websocket";

export interface AdapterDefinition {
  id: AdapterId;
  label: string;
  command: string;
  versionArgs: string[];
  supportLevel: "supported" | "prototype";
  launchEnabled: boolean;
  configDir: string;
  runtimeModes: AdapterRuntimeMode[];
}

export interface AdapterDiscoveryResult extends AdapterDefinition {
  available: boolean;
  status: "available" | "missing";
  version?: string;
  error?: string;
}

const adapterDefinitions: AdapterDefinition[] = [
  {
    id: "claude",
    label: "Claude Code",
    command: "claude",
    versionArgs: ["--version"],
    supportLevel: "supported",
    launchEnabled: true,
    configDir: ".claude",
    runtimeModes: ["terminal"]
  },
  {
    id: "opencode",
    label: "OpenCode",
    command: "opencode",
    versionArgs: ["--version"],
    supportLevel: "supported",
    launchEnabled: true,
    configDir: ".opencode",
    runtimeModes: ["terminal"]
  },
  {
    id: "codex",
    label: "Codex CLI",
    command: "codex",
    versionArgs: ["--version"],
    supportLevel: "supported",
    launchEnabled: true,
    configDir: ".codex",
    runtimeModes: ["terminal", "app-server-stdio", "app-server-websocket"]
  }
];

export function listAdapterDefinitions(): AdapterDefinition[] {
  return adapterDefinitions.map((definition) => ({
    ...definition,
    runtimeModes: [...definition.runtimeModes]
  }));
}

export function isAdapterId(value: string): value is AdapterId {
  return adapterDefinitions.some((definition) => definition.id === value);
}

export function getAdapterDefinition(adapterId: AdapterId): AdapterDefinition {
  const definition = adapterDefinitions.find((adapter) => adapter.id === adapterId);
  if (!definition) {
    throw new Error(`Unknown adapter: ${adapterId}`);
  }
  return { ...definition, runtimeModes: [...definition.runtimeModes] };
}

export async function getAdapterLaunchStatus(
  adapterId: AdapterId,
  runner?: CommandRunner,
  platform: NodeJS.Platform = process.platform
): Promise<AdapterDiscoveryResult> {
  const definition = getAdapterDefinition(adapterId);
  const report = await checkOpenForgeRuntimeDependencies(runner, platform);
  return toAdapterDiscoveryResult(
    definition,
    getDependencyStatus(report.dependencies, definition.command),
    report.terminalRuntime
  );
}

export async function discoverAdapters(
  runner?: CommandRunner,
  platform: NodeJS.Platform = process.platform
): Promise<AdapterDiscoveryResult[]> {
  const report = await checkOpenForgeRuntimeDependencies(runner, platform);
  return adapterDefinitions.map((definition) =>
    toAdapterDiscoveryResult(
      definition,
      getDependencyStatus(report.dependencies, definition.command),
      report.terminalRuntime
    )
  );
}

function getDependencyStatus(dependencies: DependencyStatus[], command: string): DependencyStatus {
  return dependencies.find((dependency) => dependency.name === command) ?? {
    name: command,
    available: false,
    error: `${command} was not checked`
  };
}

function toAdapterDiscoveryResult(
  definition: AdapterDefinition,
  status: DependencyStatus,
  terminalRuntime: TerminalRuntimeStatus
): AdapterDiscoveryResult {
  const terminalLaunchSupported = !definition.runtimeModes.includes("terminal") || terminalRuntime.supported;
  const terminalError = terminalLaunchSupported ? undefined : terminalRuntime.message;
  const error = status.error ?? terminalError;

  return {
    ...definition,
    runtimeModes: [...definition.runtimeModes],
    launchEnabled: definition.launchEnabled && status.available && terminalLaunchSupported,
    available: status.available,
    status: status.available ? "available" : "missing",
    ...(status.version ? { version: status.version } : {}),
    ...(error ? { error } : {})
  };
}
