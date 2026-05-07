import { checkCommand, type CommandRunner } from "../lib/dependency-check.js";

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
  runner?: CommandRunner
): Promise<AdapterDiscoveryResult> {
  const definition = getAdapterDefinition(adapterId);
  const status = await checkCommand(definition.command, definition.versionArgs, runner);
  return {
    ...definition,
    launchEnabled: definition.launchEnabled && status.available,
    available: status.available,
    status: status.available ? "available" : "missing",
    ...(status.version ? { version: status.version } : {}),
    ...(status.error ? { error: status.error } : {})
  };
}

export async function discoverAdapters(
  runner?: CommandRunner
): Promise<AdapterDiscoveryResult[]> {
  return Promise.all(
    adapterDefinitions.map((definition) => getAdapterLaunchStatus(definition.id, runner))
  );
}
