import {
  checkForgeBadgerRuntimeDependencies,
  type CommandRunner,
  type DependencyStatus,
  type TerminalRuntimeStatus
} from "../lib/dependency-check.js";

export type AdapterId = "claude" | "opencode" | "codex" | "kimi";
export type AdapterRuntimeMode = "terminal";
export type PortfolioWorkerReadiness = "claude_session_start" | "unsupported";

/** Phase 4 keeps every adapter input-disabled pending Task 8.2 evidence. */
export interface PortfolioWorkerCapability {
  readiness: PortfolioWorkerReadiness;
  inputRuntime: "unverified_no_input";
}

export interface AdapterDefinition {
  id: AdapterId;
  label: string;
  command: string;
  versionArgs: string[];
  supportLevel: "supported" | "prototype";
  launchEnabled: boolean;
  configDir: string;
  runtimeModes: AdapterRuntimeMode[];
  portfolioWorker: PortfolioWorkerCapability;
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
    runtimeModes: ["terminal"],
    portfolioWorker: { readiness: "claude_session_start", inputRuntime: "unverified_no_input" }
  },
  {
    id: "opencode",
    label: "OpenCode",
    command: "opencode",
    versionArgs: ["--version"],
    supportLevel: "supported",
    launchEnabled: true,
    configDir: ".opencode",
    runtimeModes: ["terminal"],
    portfolioWorker: { readiness: "unsupported", inputRuntime: "unverified_no_input" }
  },
  {
    id: "codex",
    label: "Codex CLI",
    command: "codex",
    versionArgs: ["--version"],
    supportLevel: "supported",
    launchEnabled: true,
    configDir: ".codex",
    runtimeModes: ["terminal"],
    portfolioWorker: { readiness: "unsupported", inputRuntime: "unverified_no_input" }
  },
  {
    id: "kimi",
    label: "Kimi Code",
    command: "kimi",
    versionArgs: ["--version"],
    supportLevel: "supported",
    launchEnabled: true,
    configDir: ".kimi-code",
    runtimeModes: ["terminal"],
    portfolioWorker: { readiness: "unsupported", inputRuntime: "unverified_no_input" }
  }
];

export function listAdapterDefinitions(): AdapterDefinition[] {
  return adapterDefinitions.map((definition) => ({
    ...definition,
    runtimeModes: [...definition.runtimeModes],
    portfolioWorker: { ...definition.portfolioWorker }
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
  return {
    ...definition,
    runtimeModes: [...definition.runtimeModes],
    portfolioWorker: { ...definition.portfolioWorker }
  };
}

export async function getAdapterLaunchStatus(
  adapterId: AdapterId,
  runner?: CommandRunner,
  platform: NodeJS.Platform = process.platform
): Promise<AdapterDiscoveryResult> {
  const definition = getAdapterDefinition(adapterId);
  const report = await checkForgeBadgerRuntimeDependencies(runner, platform);
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
  const report = await checkForgeBadgerRuntimeDependencies(runner, platform);
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
    portfolioWorker: { ...definition.portfolioWorker },
    launchEnabled: definition.launchEnabled && status.available && terminalLaunchSupported,
    available: status.available,
    status: status.available ? "available" : "missing",
    ...(status.version ? { version: status.version } : {}),
    ...(error ? { error } : {})
  };
}
