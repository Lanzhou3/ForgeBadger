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

export interface CliDependencyStatus {
  name: string;
  available: boolean;
  required: boolean;
  version?: string;
  error?: string;
}

export type CliTerminalRuntimeMode =
  | "native_tmux"
  | "native_psmux"
  | "tmux_missing"
  | "psmux_missing"
  | "psmux_outdated";

export interface CliTerminalRuntimeStatus {
  persistence: "tmux" | "psmux";
  mode: CliTerminalRuntimeMode;
  supported: boolean;
  message: string;
}

interface CliDependencyCheck {
  name: string;
  args: string[];
  required: boolean;
}

const TMUX_DEPENDENCY_CHECK: CliDependencyCheck = { name: "tmux", args: ["-V"], required: true };
const PSMUX_DEPENDENCY_CHECK: CliDependencyCheck = { name: "psmux", args: ["-V"], required: true };

const OPTIONAL_CLI_DEPENDENCY_CHECKS: CliDependencyCheck[] = [
  { name: "claude", args: ["--version"], required: false },
  { name: "opencode", args: ["--version"], required: false },
  { name: "codex", args: ["--version"], required: false },
  { name: "kimi", args: ["--version"], required: false }
];

const DEFAULT_COMMAND_TIMEOUT_MS = 3000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_KILL_GRACE_MS = 250;
const MINIMUM_PSMUX_VERSION = [3, 3, 8] as const;

interface BoundedOutput {
  chunks: Buffer[];
  byteLength: number;
}

export async function checkCliDependencies(
  runner: CliCommandRunner = runCommand,
  platform: NodeJS.Platform = process.platform
): Promise<CliDependencyStatus[]> {
  const checks = [terminalDependencyCheck(platform), ...OPTIONAL_CLI_DEPENDENCY_CHECKS];
  return Promise.all(checks.map((check) => checkDependency(check, runner)));
}

export interface CliTerminalRuntimeCheckOptions {
  runner?: CliCommandRunner | undefined;
  platform?: NodeJS.Platform | undefined;
}

export async function checkCliTerminalRuntime(
  options: CliTerminalRuntimeCheckOptions = {}
): Promise<CliTerminalRuntimeStatus> {
  const platform = options.platform ?? process.platform;
  const dependency = await checkDependency(
    terminalDependencyCheck(platform),
    options.runner ?? runCommand
  );
  return describeCliTerminalRuntime([dependency], platform);
}

export function describeCliTerminalRuntime(
  dependencies: CliDependencyStatus[],
  platform: NodeJS.Platform = process.platform
): CliTerminalRuntimeStatus {
  const check = terminalDependencyCheck(platform);
  const persistence: "tmux" | "psmux" = platform === "win32" ? "psmux" : "tmux";
  const dependency = dependencies.find((item) => item.name === check.name);
  if (dependency?.available) {
    return {
      persistence,
      mode: persistence === "psmux" ? "native_psmux" : "native_tmux",
      supported: true,
      message: `${persistence} is available for persistent browser terminals.`
    };
  }

  if (persistence === "psmux" && isOutdatedPsmuxVersion(dependency?.version)) {
    return {
      persistence: "psmux",
      mode: "psmux_outdated",
      supported: false,
      message: "Upgrade psmux to version 3.3.8 or newer for persistent browser terminals."
    };
  }

  return {
    persistence,
    mode: persistence === "psmux" ? "psmux_missing" : "tmux_missing",
    supported: false,
    message: `Install ${persistence} to enable persistent browser terminals.`
  };
}

function terminalDependencyCheck(platform: NodeJS.Platform): CliDependencyCheck {
  return platform === "win32" ? PSMUX_DEPENDENCY_CHECK : TMUX_DEPENDENCY_CHECK;
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
    if (check.name === "psmux" && !isSupportedPsmuxVersion(version)) {
      return {
        name: check.name,
        available: false,
        required: check.required,
        ...(version ? { version } : {}),
        error: parsePsmuxVersion(version)
          ? "psmux 3.3.8 or newer is required"
          : "Unable to determine psmux version; version 3.3.8 or newer is required"
      };
    }
    return {
      name: check.name,
      available: true,
      required: check.required,
      ...(version ? { version } : {})
    };
  }

  return {
    name: check.name,
    available: false,
    required: check.required,
    error: result.stderr.trim() || `Command exited with ${result.exitCode}`
  };
}

function isSupportedPsmuxVersion(version: string): boolean {
  const parsed = parsePsmuxVersion(version);
  return parsed !== undefined && compareVersions(parsed, MINIMUM_PSMUX_VERSION) >= 0;
}

function isOutdatedPsmuxVersion(version: string | undefined): boolean {
  const parsed = parsePsmuxVersion(version);
  return parsed !== undefined && compareVersions(parsed, MINIMUM_PSMUX_VERSION) < 0;
}

function parsePsmuxVersion(version: string | undefined): readonly [number, number, number] | undefined {
  const match = /(?:psmux|tmux)\s+(\d+)\.(\d+)\.(\d+)/i.exec(version ?? "");
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(
  left: readonly [number, number, number],
  right: readonly [number, number, number]
): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) return difference;
  }
  return 0;
}

export function runCommand(
  command: string,
  args: string[],
  options: CliCommandRunnerOptions = {}
): Promise<CliCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"]
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
