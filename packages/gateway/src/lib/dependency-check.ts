import { spawn } from "node:child_process";

import {
  isWindowsShimCommand,
  resolveWindowsShimCommand
} from "../services/session-server/platform-adapter.js";

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
  args: string[],
  options?: CommandRunnerOptions
) => Promise<CommandResult>;

export interface DependencyStatus {
  name: string;
  available: boolean;
  required?: boolean;
  version?: string;
  checkFailed?: boolean;
  error?: string;
}

/** The Session Server daemon is the single terminal backend. */
export type TerminalRuntimeMode = "ready" | "unavailable";

export interface TerminalRuntimeStatus {
  persistence: "session-server";
  mode: TerminalRuntimeMode;
  supported: boolean;
  message: string;
}

export interface ForgeBadgerDependencyReport {
  dependencies: DependencyStatus[];
  terminalRuntime: TerminalRuntimeStatus;
}

/**
 * Health signal for the Session Server backend, provided by the caller that
 * owns the daemon connection (session manager → SessionServerClient). When
 * omitted, the embedded backend is assumed available.
 */
export interface TerminalBackendHealth {
  available: boolean;
  message?: string;
}

interface DependencyCheck {
  command: string;
  args: string[];
  required: boolean;
  timeoutMs?: number;
}

const ADAPTER_DEPENDENCY_CHECKS: DependencyCheck[] = [
  { command: "claude", args: ["--version"], required: false },
  { command: "opencode", args: ["--version"], required: false },
  { command: "codex", args: ["--version"], required: false },
  {
    // kimi's native launcher needs ~2-4s on a cold cache (measured on
    // Windows); the 3s default intermittently reported it as missing.
    command: "kimi",
    args: ["--version"],
    required: false,
    timeoutMs: 10_000
  }
];

const DEFAULT_COMMAND_TIMEOUT_MS = 3000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_KILL_GRACE_MS = 250;

interface BoundedOutput {
  chunks: Buffer[];
  byteLength: number;
}

const MISSING_EXIT_CODES = new Set([
  // spawn failure (ENOENT/EPERM) or POSIX shell "command not found"
  127,
  // cmd.exe "not recognized" when the Windows shell fallback runs a bare name
  9009
]);

export async function checkCommand(
  command: string,
  args: string[],
  runner: CommandRunner = runCommand,
  options?: CommandRunnerOptions
): Promise<DependencyStatus> {
  try {
    const result = await runner(command, args, options);
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
      // Not-found codes mean the CLI is absent; any other failure (timeout,
      // non-zero --version exit) means it exists but the probe misbehaved.
      ...(MISSING_EXIT_CODES.has(result.exitCode) ? {} : { checkFailed: true }),
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

/** Probe a single CLI command, applying the per-adapter timeout when set. */
export async function checkAdapterCommand(
  command: string,
  args: string[],
  runner: CommandRunner = runCommand
): Promise<DependencyStatus> {
  const timeoutMs = ADAPTER_DEPENDENCY_CHECKS.find((check) => check.command === command)?.timeoutMs;
  return checkCommand(command, args, runner, timeoutMs === undefined ? undefined : { timeoutMs });
}

export async function checkForgeBadgerDependencies(
  runner: CommandRunner = runCommand
): Promise<DependencyStatus[]> {
  return Promise.all(
    ADAPTER_DEPENDENCY_CHECKS.map(async (check) => {
      const status = await checkAdapterCommand(check.command, check.args, runner);
      return {
        ...status,
        required: check.required
      };
    })
  );
}

export async function checkForgeBadgerRuntimeDependencies(
  runner: CommandRunner = runCommand,
  backendHealth?: TerminalBackendHealth
): Promise<ForgeBadgerDependencyReport> {
  const dependencies = await checkForgeBadgerDependencies(runner);
  return {
    dependencies,
    terminalRuntime: describeTerminalRuntime(backendHealth)
  };
}

export function describeTerminalRuntime(
  backendHealth?: TerminalBackendHealth
): TerminalRuntimeStatus {
  if (!backendHealth || backendHealth.available) {
    return {
      persistence: "session-server",
      mode: "ready",
      supported: true,
      message: backendHealth?.message ?? "Session Server terminal backend is ready."
    };
  }
  return {
    persistence: "session-server",
    mode: "unavailable",
    supported: false,
    message: backendHealth.message ?? "Session Server terminal backend is unavailable."
  };
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
