import { spawn } from "node:child_process";

import {
  isWindowsShimCommand,
  resolveTerminalMultiplexerRuntime,
  resolveWindowsShimCommand
} from "../services/terminal-multiplexer-runtime.js";

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunnerOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
  killGraceMs?: number;
}

export type CommandRunner = (
  command: string,
  args: string[]
) => Promise<CommandResult>;

export interface DependencyStatus {
  name: string;
  available: boolean;
  required?: boolean;
  version?: string;
  error?: string;
}

export type TerminalRuntimeMode =
  | "native_tmux"
  | "native_psmux"
  | "tmux_missing"
  | "psmux_missing"
  | "psmux_outdated";

export interface TerminalRuntimeStatus {
  persistence: "tmux" | "psmux";
  mode: TerminalRuntimeMode;
  supported: boolean;
  message: string;
}

export interface ForgeBadgerDependencyReport {
  dependencies: DependencyStatus[];
  terminalRuntime: TerminalRuntimeStatus;
}

interface DependencyCheck {
  command: string;
  args: string[];
  required: boolean;
}

const OPTIONAL_ADAPTER_DEPENDENCY_CHECKS: DependencyCheck[] = [
  { command: "claude", args: ["--version"], required: false },
  { command: "opencode", args: ["--version"], required: false },
  { command: "codex", args: ["--version"], required: false },
  { command: "kimi", args: ["--version"], required: false }
];

const DEFAULT_COMMAND_TIMEOUT_MS = 3000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_KILL_GRACE_MS = 250;
const MINIMUM_PSMUX_VERSION = [3, 3, 8] as const;

interface BoundedOutput {
  chunks: Buffer[];
  byteLength: number;
}

export async function checkCommand(
  command: string,
  args: string[],
  runner: CommandRunner = runCommand
): Promise<DependencyStatus> {
  try {
    const result = await runner(command, args);
    if (result.exitCode === 0) {
      const version = result.stdout.trim();
      return {
        name: command,
        available: true,
        ...(version ? { version } : {})
      };
    }

    return {
      name: command,
      available: false,
      error: result.stderr.trim() || `Command exited with ${result.exitCode}`
    };
  } catch (error) {
    return {
      name: command,
      available: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function checkGateADependencies(
  runner: CommandRunner = runCommand
): Promise<DependencyStatus[]> {
  return Promise.all([
    checkCommand("tmux", ["-V"], runner),
    checkCommand("claude", ["--version"], runner)
  ]);
}

export async function checkForgeBadgerDependencies(
  runner: CommandRunner = runCommand,
  platform: NodeJS.Platform = process.platform
): Promise<DependencyStatus[]> {
  const runtime = resolveTerminalMultiplexerRuntime(platform);
  const checks: DependencyCheck[] = [
    { command: runtime.command, args: runtime.versionArgs, required: true },
    ...OPTIONAL_ADAPTER_DEPENDENCY_CHECKS
  ];
  return Promise.all(
    checks.map(async (check) => {
      const status = await checkCommand(check.command, check.args, runner);
      return {
        ...validateTerminalRuntimeVersion(status, platform),
        required: check.required
      };
    })
  );
}

export async function checkForgeBadgerRuntimeDependencies(
  runner: CommandRunner = runCommand,
  platform: NodeJS.Platform = process.platform
): Promise<ForgeBadgerDependencyReport> {
  const dependencies = await checkForgeBadgerDependencies(runner, platform);
  return {
    dependencies,
    terminalRuntime: describeTerminalRuntime(dependencies, platform)
  };
}

export async function checkTerminalRuntimeReadiness(
  runner: CommandRunner = runCommand,
  platform: NodeJS.Platform = process.platform
): Promise<TerminalRuntimeStatus> {
  const runtime = resolveTerminalMultiplexerRuntime(platform);
  const dependency = validateTerminalRuntimeVersion(
    await checkCommand(runtime.command, runtime.versionArgs, runner),
    platform
  );
  return describeTerminalRuntime([dependency], platform);
}

export function runCommand(
  command: string,
  args: string[],
  options: CommandRunnerOptions = {}
): Promise<CommandResult> {
  return new Promise((resolve) => {
    // Windows npm/cargo shims are .cmd files (e.g. opencode.cmd) that bare
    // spawn refuses to execute (EINVAL since Node 20.12/CVE-2024-27980).
    // Resolve those shims to the real executable (or node + script) and spawn
    // it directly; this avoids cmd.exe re-tokenizing args and is fast enough to
    // stay inside the timeout even when several adapters are probed in
    // parallel. When resolution fails, fall back to running through cmd.exe.
    const resolved = resolveWindowsShimCommand(command, process.env);
    const needsShell = resolved === undefined && isWindowsShimCommand(command);
    const child = spawn(
      resolved?.command ?? command,
      [...(resolved?.args ?? []), ...args],
      {
        stdio: ["ignore", "pipe", "pipe"],
        ...(needsShell ? { shell: true } : {})
      }
    );

    const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
    const stdout = createBoundedOutput();
    const stderr = createBoundedOutput();
    let settled = false;
    let timeoutResult: CommandResult | undefined;
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

    function finish(result: CommandResult): void {
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

function describeTerminalRuntime(
  dependencies: DependencyStatus[],
  platform: NodeJS.Platform
): TerminalRuntimeStatus {
  const runtime = resolveTerminalMultiplexerRuntime(platform);
  const dependency = dependencies.find((item) => item.name === runtime.command);
  if (dependency?.available) {
    return {
      persistence: runtime.kind,
      mode: runtime.kind === "psmux" ? "native_psmux" : "native_tmux",
      supported: true,
      message: `${runtime.command} is available for persistent browser terminals.`
    };
  }

  if (runtime.kind === "psmux" && isOutdatedPsmuxVersion(dependency?.version)) {
    return {
      persistence: "psmux",
      mode: "psmux_outdated",
      supported: false,
      message: "Upgrade psmux to version 3.3.8 or newer for persistent browser terminals."
    };
  }

  return {
    persistence: runtime.kind,
    mode: runtime.kind === "psmux" ? "psmux_missing" : "tmux_missing",
    supported: false,
    message: `Install ${runtime.command} to enable persistent browser terminals.`
  };
}

function validateTerminalRuntimeVersion(
  status: DependencyStatus,
  platform: NodeJS.Platform
): DependencyStatus {
  if (platform !== "win32" || status.name !== "psmux" || !status.available) {
    return status;
  }
  const parsed = parsePsmuxVersion(status.version);
  if (parsed && compareVersions(parsed, MINIMUM_PSMUX_VERSION) >= 0) {
    return status;
  }
  return {
    ...status,
    available: false,
    error: parsed
      ? "psmux 3.3.8 or newer is required"
      : "Unable to determine psmux version; version 3.3.8 or newer is required"
  };
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
