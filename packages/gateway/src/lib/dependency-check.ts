import { spawn } from "node:child_process";

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

interface DependencyCheck {
  command: string;
  args: string[];
  required: boolean;
}

const OPENFORGE_DEPENDENCY_CHECKS: DependencyCheck[] = [
  { command: "tmux", args: ["-V"], required: true },
  { command: "claude", args: ["--version"], required: false },
  { command: "opencode", args: ["--version"], required: false },
  { command: "codex", args: ["--version"], required: false }
];

const DEFAULT_COMMAND_TIMEOUT_MS = 3000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_KILL_GRACE_MS = 250;

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

export async function checkOpenForgeDependencies(
  runner: CommandRunner = runCommand
): Promise<DependencyStatus[]> {
  return Promise.all(
    OPENFORGE_DEPENDENCY_CHECKS.map(async (check) => ({
      ...(await checkCommand(check.command, check.args, runner)),
      required: check.required
    }))
  );
}

export function runCommand(
  command: string,
  args: string[],
  options: CommandRunnerOptions = {}
): Promise<CommandResult> {
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
      if (stderr.byteLength === 0) {
        appendBoundedOutput(stderr, error.message, maxOutputBytes);
      }
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
