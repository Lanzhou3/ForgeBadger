import { spawn } from "node:child_process";

export interface CliCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CliCommandRunnerOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
  killGraceMs?: number;
}

export type CliCommandRunner = (
  command: string,
  args: string[]
) => Promise<CliCommandResult>;

export type CliDependencyGroup = "runtime" | "ai-cli" | "tooling";

export interface CliDependencyStatus {
  name: string;
  available: boolean;
  required: boolean;
  group: CliDependencyGroup;
  version?: string;
  error?: string;
  installHint?: string;
}

export type NodePtyLoader = () => Promise<unknown>;

export type NativeModuleLoader = () => Promise<unknown>;

interface CliDependencyCheck {
  name: string;
  args: string[];
  required: boolean;
  group: CliDependencyGroup;
  installHint?: string;
}

const OPTIONAL_CLI_DEPENDENCY_CHECKS: CliDependencyCheck[] = [
  {
    name: "claude",
    args: ["--version"],
    required: false,
    group: "ai-cli",
    installHint: "npm install -g @anthropic-ai/claude-code"
  },
  {
    name: "opencode",
    args: ["--version"],
    required: false,
    group: "ai-cli",
    installHint: "npm install -g opencode-ai"
  },
  {
    name: "codex",
    args: ["--version"],
    required: false,
    group: "ai-cli",
    installHint: "npm install -g @openai/codex"
  },
  {
    name: "kimi",
    args: ["--version"],
    required: false,
    group: "ai-cli",
    installHint: "npm install -g @moonshot-ai/kimi-code"
  },
  {
    name: "codegraph",
    args: ["--version"],
    required: false,
    group: "tooling",
    installHint: "npm install -g @colbymchenry/codegraph"
  },
  {
    name: "git",
    args: ["--version"],
    required: false,
    group: "tooling",
    installHint: "https://git-scm.com/downloads"
  }
];

export const SUPPORTED_NODE_RANGE = ">=20.12 <25";

export interface CliEnvironmentInfo {
  platform: NodeJS.Platform;
  arch: string;
  nodeVersion: string;
  supportedNode: boolean;
  notes: string[];
}

export function collectEnvironmentInfo(
  options: { platform?: NodeJS.Platform; arch?: string; nodeVersion?: string } = {}
): CliEnvironmentInfo {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const nodeVersion = options.nodeVersion ?? process.version;
  const supportedNode = isSupportedNodeVersion(nodeVersion);
  const notes: string[] = [];
  if (!supportedNode) {
    notes.push(
      `Node ${nodeVersion} is outside the supported range (${SUPPORTED_NODE_RANGE}); upgrade Node.js before running ForgeBadger.`
    );
  }
  if (platform === "win32") {
    notes.push("Windows terminal sessions use ConPTY; WSL sessions are not managed by ForgeBadger.");
  }
  return { platform, arch, nodeVersion, supportedNode, notes };
}

export function isSupportedNodeVersion(nodeVersion: string): boolean {
  const match = /^v?(\d+)\.(\d+)/.exec(nodeVersion);
  if (!match) {
    return false;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major === 20) {
    return minor >= 12;
  }
  return major >= 21 && major < 25;
}

const NATIVE_MODULE_REINSTALL_GUIDANCE =
  "reinstall ForgeBadger to rebuild native modules (npm install -g forgebadger)";

const DEFAULT_COMMAND_TIMEOUT_MS = 3000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_KILL_GRACE_MS = 250;

interface BoundedOutput {
  chunks: Buffer[];
  byteLength: number;
}

export async function checkCliDependencies(
  runner: CliCommandRunner = runCommand,
  loadNodePty: NodePtyLoader = loadNodePtyModule,
  loadBetterSqlite3: NativeModuleLoader = loadBetterSqlite3Module
): Promise<CliDependencyStatus[]> {
  const [nodePty, betterSqlite3, ...cliStatuses] = await Promise.all([
    checkNodePtyLoadable(loadNodePty),
    checkBetterSqlite3Loadable(loadBetterSqlite3),
    ...OPTIONAL_CLI_DEPENDENCY_CHECKS.map((check) => checkDependency(check, runner))
  ]);
  return [nodePty, betterSqlite3, ...cliStatuses];
}

export async function checkNodePtyLoadable(
  load: NodePtyLoader = loadNodePtyModule
): Promise<CliDependencyStatus> {
  try {
    await load();
    return { name: "node-pty", available: true, required: true, group: "runtime" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      name: "node-pty",
      available: false,
      required: true,
      group: "runtime",
      error: `node-pty failed to load (${detail}); ${NATIVE_MODULE_REINSTALL_GUIDANCE}`
    };
  }
}

export async function checkBetterSqlite3Loadable(
  load: NativeModuleLoader = loadBetterSqlite3Module
): Promise<CliDependencyStatus> {
  try {
    await load();
    return { name: "better-sqlite3", available: true, required: true, group: "runtime" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      name: "better-sqlite3",
      available: false,
      required: true,
      group: "runtime",
      error: `better-sqlite3 failed to load (${detail}); ${NATIVE_MODULE_REINSTALL_GUIDANCE}`
    };
  }
}

async function loadNodePtyModule(): Promise<unknown> {
  return import("node-pty");
}

interface BetterSqlite3Module {
  default: new (filename: string) => { close(): void };
}

// The specifier is indirect on purpose: the CLI package does not ship
// @types/better-sqlite3, and a static specifier would fail typecheck.
async function loadBetterSqlite3Module(): Promise<unknown> {
  const specifier = "better-sqlite3";
  const module: BetterSqlite3Module = await import(specifier);
  const db = new module.default(":memory:");
  db.close();
  return module;
}

async function checkDependency(
  check: CliDependencyCheck,
  runner: CliCommandRunner
): Promise<CliDependencyStatus> {
  try {
    const result = await runner(check.name, check.args);
    return formatDependencyStatus(check, result);
  } catch (error) {
    return formatDependencyStatus(check, {
      exitCode: 127,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error)
    });
  }
}

function formatDependencyStatus(
  check: CliDependencyCheck,
  result: CliCommandResult
): CliDependencyStatus {
  if (result.exitCode === 0) {
    const version = result.stdout.trim();
    return {
      name: check.name,
      available: true,
      required: check.required,
      group: check.group,
      ...(version ? { version } : {})
    };
  }

  return {
    name: check.name,
    available: false,
    required: check.required,
    group: check.group,
    error: result.stderr.trim() || `Command exited with ${result.exitCode}`,
    ...(check.installHint ? { installHint: check.installHint } : {})
  };
}

export function runCommand(
  command: string,
  args: string[],
  options: CliCommandRunnerOptions = {}
): Promise<CliCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...commandSpawnOptions()
    });

    const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
    const stdout = createBoundedOutput();
    const stderr = createBoundedOutput();
    let settled = false;
    let timeoutResult: CliCommandResult | undefined;
    let killGraceTimeout: ReturnType<typeof setTimeout> | undefined;

    const timeout = setTimeout(() => {
      timeoutResult = {
        exitCode: 124,
        stdout: boundedOutputToString(stdout),
        stderr: `Command timed out after ${timeoutMs}ms`
      };
      child.kill("SIGTERM");
      killGraceTimeout = setTimeout(() => {
        child.kill("SIGKILL");
        finish(timeoutResult!);
      }, killGraceMs);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      appendBoundedOutput(stdout, chunk, maxOutputBytes);
    });
    child.stderr.on("data", (chunk) => {
      appendBoundedOutput(stderr, chunk, maxOutputBytes);
    });
    child.on("error", (error) => {
      appendBoundedOutput(stderr, stderr.byteLength === 0 ? error.message : `\n${error.message}`, maxOutputBytes);
      finish({
        exitCode: 127,
        stdout: boundedOutputToString(stdout),
        stderr: boundedOutputToString(stderr)
      });
    });
    child.on("close", (exitCode) => {
      finish(timeoutResult ?? {
        exitCode: exitCode ?? 1,
        stdout: boundedOutputToString(stdout),
        stderr: boundedOutputToString(stderr)
      });
    });

    function finish(result: CliCommandResult): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (killGraceTimeout) {
        clearTimeout(killGraceTimeout);
      }
      resolve(result);
    }
  });
}

export function commandSpawnOptions(
  platform: NodeJS.Platform = process.platform
): { shell?: true } {
  return platform === "win32" ? { shell: true } : {};
}

function createBoundedOutput(): BoundedOutput {
  return {
    chunks: [],
    byteLength: 0
  };
}

function appendBoundedOutput(output: BoundedOutput, chunk: Buffer | string, maxBytes: number): void {
  if (output.byteLength >= maxBytes) {
    return;
  }

  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  const remainingBytes = maxBytes - output.byteLength;
  const accepted = buffer.byteLength <= remainingBytes ? buffer : buffer.subarray(0, remainingBytes);
  output.chunks.push(accepted);
  output.byteLength += accepted.byteLength;
}

function boundedOutputToString(output: BoundedOutput): string {
  return Buffer.concat(output.chunks, output.byteLength).toString("utf8");
}
