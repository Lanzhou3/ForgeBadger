import { lookup } from "node:dns/promises";
import { accessSync, constants, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import { checkAdapterCommand, runCommand, type CommandRunner } from "../lib/dependency-check.js";
import { getAdapterDefinition, type AdapterId } from "./adapter-discovery.js";
import { assertResolvedPublicHttpsEndpoint, type OutboundHostResolver } from "./network-policy.js";

export type AdapterUpdateState = "missing" | "check_failed" | "up_to_date" | "update_available";

export interface AdapterUpdateStatus {
  id: AdapterId;
  state: AdapterUpdateState;
  installedVersion?: string;
  latestVersion?: string;
  latestSource?: "npm" | "homebrew";
  command: string;
  installCommand: string;
  installRequiresNode?: string;
  error?: string;
}

export interface AdapterUpdateResult {
  id: AdapterId;
  previousVersion: string;
  installedVersion: string;
  latestVersion: string;
  command: string;
  versionStillBehind: boolean;
}

export interface AdapterInstallResult {
  id: AdapterId;
  command: string;
  installedVersion?: string;
  commandAvailable: boolean;
}

export interface AdapterUpdateDependencies {
  runner?: CommandRunner;
  fetcher?: typeof fetch;
  resolveHost?: OutboundHostResolver;
  resolveExecutable?: (command: string) => string | undefined;
  nodeVersion?: string;
}

export class AdapterUpdateError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

const updateConfig: Record<AdapterId, { npmPackage: string; args: string[]; installArgs: string[]; minNode?: string }> = {
  claude: { npmPackage: "@anthropic-ai/claude-code", args: ["update"], installArgs: ["install", "-g", "@anthropic-ai/claude-code"] },
  opencode: { npmPackage: "opencode-ai", args: ["upgrade"], installArgs: ["install", "-g", "opencode-ai"] },
  codex: { npmPackage: "@openai/codex", args: ["update"], installArgs: ["install", "-g", "@openai/codex"] },
  kimi: { npmPackage: "@moonshot-ai/kimi-code", args: ["upgrade", "--yes"], installArgs: ["install", "-g", "@moonshot-ai/kimi-code"], minNode: "22.19.0" },
  pi: { npmPackage: "@earendil-works/pi-coding-agent", args: ["update", "--self"], installArgs: ["install", "-g", "--ignore-scripts", "@earendil-works/pi-coding-agent"], minNode: "22.19.0" }
};

const ADAPTER_IDS: AdapterId[] = ["claude", "opencode", "codex", "kimi", "pi"];
const VERSION_PATTERN = /(?:^|[^\d])v?(\d+)\.(\d+)\.(\d+)(?:-([\da-z.-]+))?/i;
let cliOperationInProgress = false;

export async function checkAdapterUpdates(
  dependencies: AdapterUpdateDependencies = {}
): Promise<AdapterUpdateStatus[]> {
  return Promise.all(ADAPTER_IDS.map((id) => checkAdapterUpdate(id, dependencies)));
}

export async function checkAdapterUpdate(
  id: AdapterId,
  dependencies: AdapterUpdateDependencies = {}
): Promise<AdapterUpdateStatus> {
  const definition = getAdapterDefinition(id);
  const command = formatCommand(id);
  const installCommand = formatInstallCommand(id);
  const local = await checkAdapterCommand(definition.command, definition.versionArgs, dependencies.runner, safeCommandOptions());
  if (!local.available) {
    const installRequiresNode = await requiredNodeVersion(id, dependencies);
    return {
      id,
      state: local.checkFailed ? "check_failed" : "missing",
      command,
      installCommand,
      ...(installRequiresNode ? { installRequiresNode } : {}),
      error: local.checkFailed ? "Installed version check failed" : "CLI command not found"
    };
  }

  const installedVersion = parseVersion(local.version);
  if (!installedVersion) {
    return { id, state: "check_failed", command, installCommand, error: "Installed version could not be read" };
  }

  try {
    const latestSource = isHomebrewOpenCode(id, dependencies) ? "homebrew" : "npm";
    const latestVersion = latestSource === "homebrew"
      ? await fetchHomebrewOpenCodeVersion(dependencies)
      : await fetchLatestVersion(id, dependencies);
    return {
      id,
      state: compareVersions(installedVersion, latestVersion) < 0 ? "update_available" : "up_to_date",
      installedVersion,
      latestVersion,
      latestSource,
      command: formatUpdateCommand(id, latestSource, latestVersion),
      installCommand
    };
  } catch {
    return { id, state: "check_failed", installedVersion, command, installCommand, error: "Latest version check failed" };
  }
}

export async function updateAdapter(
  id: AdapterId,
  dependencies: AdapterUpdateDependencies = {}
): Promise<AdapterUpdateResult> {
  if (cliOperationInProgress) throw new AdapterUpdateError("Another CLI install or update is in progress", 409);
  cliOperationInProgress = true;
  let cleanupUncertain = false;
  try {
    const before = await checkAdapterUpdate(id, dependencies);
    if (before.state !== "update_available" || !before.installedVersion || !before.latestVersion) {
      throw new AdapterUpdateError(
        before.state === "up_to_date" ? "CLI is already up to date" : "CLI update availability could not be verified",
        before.state === "up_to_date" ? 409 : 503
      );
    }
    const definition = getAdapterDefinition(id);
    const result = await (dependencies.runner ?? runCommand)(definition.command, updateArgs(id, before.latestSource, before.latestVersion), {
      timeoutMs: 180_000,
      maxOutputBytes: 16 * 1024,
      killGraceMs: 5000,
      killProcessTree: true,
      ...safeCommandOptions()
    });
    if (result.processTreeCleanupUncertain) {
      cleanupUncertain = true;
      throw new AdapterUpdateError("CLI update timed out and cleanup could not be verified; restart Gateway before retrying", 503);
    }
    if (result.exitCode !== 0) {
      throw new AdapterUpdateError("Official CLI update command failed", 502);
    }
    const after = await checkAdapterCommand(definition.command, definition.versionArgs, dependencies.runner, safeCommandOptions());
    const installedVersion = parseVersion(after.version);
    if (!after.available || !installedVersion) {
      throw new AdapterUpdateError("CLI version could not be verified after update", 502);
    }
    if (id === "opencode" && before.latestSource === "homebrew" && compareVersions(installedVersion, before.latestVersion) < 0) {
      throw new AdapterUpdateError("OpenCode Homebrew upgrade did not reach the target version", 502);
    }
    return {
      id,
      previousVersion: before.installedVersion,
      installedVersion,
      latestVersion: before.latestVersion,
      command: before.command,
      versionStillBehind: compareVersions(installedVersion, before.latestVersion) < 0
    };
  } finally {
    if (!cleanupUncertain) cliOperationInProgress = false;
  }
}

export async function installAdapter(
  id: AdapterId,
  dependencies: AdapterUpdateDependencies = {}
): Promise<AdapterInstallResult> {
  if (cliOperationInProgress) throw new AdapterUpdateError("Another CLI install or update is in progress", 409);
  cliOperationInProgress = true;
  let cleanupUncertain = false;
  try {
    const definition = getAdapterDefinition(id);
    const before = await checkAdapterCommand(definition.command, definition.versionArgs, dependencies.runner, safeCommandOptions());
    if (before.available) throw new AdapterUpdateError("CLI is already installed", 409);
    if (before.checkFailed) throw new AdapterUpdateError("CLI installation state could not be verified", 503);
    if (await requiredNodeVersion(id, dependencies)) {
      throw new AdapterUpdateError(`CLI npm installation requires Node.js ${updateConfig[id].minNode} or later`, 409);
    }
    const npm = await checkAdapterCommand("npm", ["--version"], dependencies.runner, {
      timeoutMs: 10_000,
      ...safeCommandOptions()
    });
    if (!npm.available) throw new AdapterUpdateError("npm is not available on the Gateway host", 503);
    const result = await (dependencies.runner ?? runCommand)("npm", updateConfig[id].installArgs, {
      timeoutMs: 300_000,
      maxOutputBytes: 16 * 1024,
      killGraceMs: 5000,
      killProcessTree: true,
      ...safeCommandOptions()
    });
    if (result.processTreeCleanupUncertain) {
      cleanupUncertain = true;
      throw new AdapterUpdateError("CLI install timed out and cleanup could not be verified; restart Gateway before retrying", 503);
    }
    if (result.exitCode !== 0) throw new AdapterUpdateError("Official CLI install command failed", 502);
    const after = await checkAdapterCommand(definition.command, definition.versionArgs, dependencies.runner, safeCommandOptions());
    const installedVersion = parseVersion(after.version);
    return {
      id,
      command: formatInstallCommand(id),
      commandAvailable: after.available,
      ...(after.available && installedVersion ? { installedVersion } : {})
    };
  } finally {
    if (!cleanupUncertain) cliOperationInProgress = false;
  }
}

function formatCommand(id: AdapterId): string {
  return [getAdapterDefinition(id).command, ...updateConfig[id].args].join(" ");
}

function updateArgs(id: AdapterId, latestSource: AdapterUpdateStatus["latestSource"], latestVersion: string): string[] {
  return id === "opencode" && latestSource === "homebrew"
    ? ["upgrade", latestVersion, "--method", "brew"]
    : updateConfig[id].args;
}

function formatUpdateCommand(id: AdapterId, latestSource: AdapterUpdateStatus["latestSource"], latestVersion: string): string {
  return [getAdapterDefinition(id).command, ...updateArgs(id, latestSource, latestVersion)].join(" ");
}

function formatInstallCommand(id: AdapterId): string {
  return ["npm", ...updateConfig[id].installArgs].join(" ");
}

async function requiredNodeVersion(
  id: AdapterId,
  dependencies: AdapterUpdateDependencies
): Promise<string | undefined> {
  const required = updateConfig[id].minNode;
  if (!required) return undefined;
  const actual = dependencies.nodeVersion ?? (await checkAdapterCommand(
    "node", ["--version"], dependencies.runner, { timeoutMs: 10_000, ...safeCommandOptions() }
  )).version;
  const parsed = parseVersion(actual);
  return parsed && compareVersions(parsed, required) >= 0 ? undefined : required;
}

const UPDATE_ENV_KEYS = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
  "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP", "TMPDIR",
  "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "PNPM_HOME",
  "NPM_CONFIG_PREFIX", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
  "CODEX_HOME", "KIMI_CODE_HOME", "PI_CODING_AGENT_DIR", "DISABLE_UPDATES",
  "KIMI_CODE_NO_AUTO_UPDATE"
]);

function updateEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(source).filter(([key, value]) => value !== undefined && UPDATE_ENV_KEYS.has(key.toUpperCase()))
  );
}

function safeCommandOptions(): { cwd: string; env: NodeJS.ProcessEnv } {
  return { cwd: homedir(), env: updateEnvironment(process.env) };
}

function isHomebrewOpenCode(id: AdapterId, dependencies: AdapterUpdateDependencies): boolean {
  if (id !== "opencode" || process.platform === "win32") return false;
  const resolver = dependencies.resolveExecutable ?? (dependencies.runner ? () => undefined : resolveExecutableOnPath);
  const executable = resolver("opencode");
  return executable !== undefined && /(?:^|[\\/])Cellar[\\/]opencode[\\/]/.test(executable);
}

function resolveExecutableOnPath(command: string): string | undefined {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, command);
    try {
      accessSync(candidate, constants.X_OK);
      return realpathSync(candidate);
    } catch {
      // Continue through PATH until the same executable spawn would use is found.
    }
  }
  return undefined;
}

async function fetchHomebrewOpenCodeVersion(dependencies: AdapterUpdateDependencies): Promise<string> {
  const options = safeCommandOptions();
  const result = await (dependencies.runner ?? runCommand)("brew", ["info", "--json=v2", "opencode"], {
    timeoutMs: 10_000,
    maxOutputBytes: 64 * 1024,
    ...options,
    env: { ...options.env, HOMEBREW_NO_AUTO_UPDATE: "1" }
  });
  if (result.exitCode !== 0) throw new Error("Homebrew formula check failed");
  const data = JSON.parse(result.stdout) as { formulae?: Array<{ name?: unknown; full_name?: unknown }> };
  const formula = data.formulae?.find((item) => item.name === "opencode")?.full_name;
  let version: unknown;
  if (formula === "anomalyco/tap/opencode") {
    const body = await fetchPublicText(
      "https://raw.githubusercontent.com/anomalyco/homebrew-tap/master/opencode.rb", dependencies, 32 * 1024
    );
    version = /^\s*version\s+"([^"]+)"\s*$/m.exec(body)?.[1];
  } else if (formula === "homebrew/core/opencode" || formula === "opencode") {
    const body = await fetchPublicText("https://formulae.brew.sh/api/formula/opencode.json", dependencies);
    version = (JSON.parse(body) as { versions?: { stable?: unknown } }).versions?.stable;
  } else {
    throw new Error("Unsupported Homebrew OpenCode formula");
  }
  const parsed = parseVersion(version);
  if (!parsed || parsed !== version) throw new Error("Homebrew formula version is invalid");
  return parsed;
}

async function fetchLatestVersion(id: AdapterId, dependencies: AdapterUpdateDependencies): Promise<string> {
  const packageName = updateConfig[id].npmPackage.replace("/", "%2F");
  const url = `https://registry.npmjs.org/${packageName}/latest`;
  const body = await fetchPublicText(url, dependencies);
  const version = (JSON.parse(body) as { version?: unknown }).version;
  const parsed = parseVersion(version);
  if (!parsed || parsed !== version) throw new Error("Registry returned an invalid version");
  return parsed;
}

async function fetchPublicText(url: string, dependencies: AdapterUpdateDependencies, maxBytes = 128 * 1024): Promise<string> {
  await assertResolvedPublicHttpsEndpoint(url, dependencies.resolveHost ?? lookup);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await (dependencies.fetcher ?? fetch)(url, {
      signal: controller.signal,
      redirect: "error",
      headers: { accept: "application/json" }
    });
    if (!response.ok) throw new Error("Registry request failed");
    if (!response.body) return "";
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          controller.abort();
          void reader.cancel().catch(() => undefined);
          throw new Error("Version source response too large");
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks, totalBytes).toString("utf8");
  } finally {
    clearTimeout(timer);
  }
}

function parseVersion(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = VERSION_PATTERN.exec(value);
  if (!match) return undefined;
  return `${match[1]}.${match[2]}.${match[3]}${match[4] ? `-${match[4]}` : ""}`;
}

function compareVersions(left: string, right: string): number {
  const [leftCore = "", leftPre] = left.split("-");
  const [rightCore = "", rightPre] = right.split("-");
  const leftParts = leftCore.split(".").map(Number);
  const rightParts = rightCore.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  if (!leftPre && rightPre) return 1;
  if (leftPre && !rightPre) return -1;
  return leftPre === rightPre ? 0 : (leftPre ?? "").localeCompare(rightPre ?? "");
}
