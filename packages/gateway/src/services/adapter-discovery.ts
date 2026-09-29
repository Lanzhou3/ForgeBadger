import { adapterIds, isCanonicalAdapterId, type CanonicalAdapterId } from "../lib/adapter-ids.js";
import {
  checkAdapterCommand,
  checkForgeBadgerRuntimeDependencies,
  describeTerminalRuntime,
  type CommandRunner,
  type DependencyStatus,
  type TerminalBackendHealth
} from "../lib/dependency-check.js";

export type AdapterId = CanonicalAdapterId;
export type AdapterRuntimeMode = "terminal";
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
  status: "available" | "missing" | "check_failed";
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
    runtimeModes: ["terminal"]
  },
  {
    id: "kimi",
    label: "Kimi Code",
    command: "kimi",
    versionArgs: ["--version"],
    supportLevel: "supported",
    launchEnabled: true,
    configDir: ".kimi-code",
    runtimeModes: ["terminal"]
  },
  {
    id: "pi",
    label: "PI",
    command: "pi",
    versionArgs: ["--version"],
    supportLevel: "supported",
    launchEnabled: true,
    configDir: ".pi",
    runtimeModes: ["terminal"]
  },
  {
    // MiniMax Code. Note the install directory (~/.minimax-code, which owns
    // the PATH launcher) is deliberately NOT this configDir: user data lives in
    // ~/.minimax. See docs/minimax-cli-integration-plan.md.
    id: "mcode",
    label: "MiniMax Code",
    command: "mcode",
    versionArgs: ["--version"],
    supportLevel: "supported",
    launchEnabled: true,
    configDir: ".minimax",
    runtimeModes: ["terminal"]
  }
];

export function listAdapterDefinitions(): AdapterDefinition[] {
  return adapterDefinitions.map((definition) => ({
    ...definition,
    runtimeModes: [...definition.runtimeModes]
  }));
}

export function isAdapterId(value: string): value is AdapterId {
  return isCanonicalAdapterId(value);
}

export function getAdapterDefinition(adapterId: AdapterId): AdapterDefinition {
  const definition = adapterDefinitions.find((adapter) => adapter.id === adapterId);
  if (!definition) {
    throw new Error(`Unknown adapter: ${adapterId}`);
  }
  return {
    ...definition,
    runtimeModes: [...definition.runtimeModes]
  };
}

export async function getAdapterLaunchStatus(
  adapterId: AdapterId,
  runner?: CommandRunner,
  backendHealth?: TerminalBackendHealth
): Promise<AdapterDiscoveryResult> {
  const definition = getAdapterDefinition(adapterId);
  const status = await checkAdapterCommand(definition.command, definition.versionArgs, runner);
  return toAdapterDiscoveryResult(
    definition,
    status,
    describeTerminalRuntime(backendHealth)
  );
}

export async function discoverAdapters(
  runner?: CommandRunner,
  backendHealth?: TerminalBackendHealth
): Promise<AdapterDiscoveryResult[]> {
  const report = await checkForgeBadgerRuntimeDependencies(runner, backendHealth);
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
  terminalRuntime: { supported: boolean; message: string }
): AdapterDiscoveryResult {
  const terminalLaunchSupported = !definition.runtimeModes.includes("terminal") || terminalRuntime.supported;
  const terminalError = terminalLaunchSupported ? undefined : terminalRuntime.message;
  const error = status.error ?? terminalError;

  return {
    ...definition,
    runtimeModes: [...definition.runtimeModes],
    launchEnabled: definition.launchEnabled && status.available && terminalLaunchSupported,
    available: status.available,
    status: status.available ? "available" : status.checkFailed ? "check_failed" : "missing",
    ...(status.version ? { version: status.version } : {}),
    ...(error ? { error } : {})
  };
}
