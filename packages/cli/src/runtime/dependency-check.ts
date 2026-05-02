import { spawn } from "node:child_process";

export interface CliCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CliCommandRunnerOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
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

interface CliDependencyCheck {
  name: string;
  args: string[];
  required: boolean;
}

const CLI_DEPENDENCY_CHECKS: CliDependencyCheck[] = [
  { name: "tmux", args: ["-V"], required: true },
  { name: "claude", args: ["--version"], required: false },
  { name: "opencode", args: ["--version"], required: false },
  { name: "codex", args: ["--version"], required: false }
];

const DEFAULT_COMMAND_TIMEOUT_MS = 3000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;

interface BoundedOutput {
  chunks: Buffer[];
  byteLength: number;
}

export async function checkCliDependencies(
  runner: CliCommandRunner = runCommand
): Promise<CliDependencyStatus[]> {
  return Promise.all(CLI_DEPENDENCY_CHECKS.map((check) => checkDependency(check, runner)));
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
    const stdout = createBoundedOutput();
    const stderr = createBoundedOutput();
    let settled = false;

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish({
        exitCode: 124,
        stdout: boundedOutputToString(stdout),
        stderr: `Command timed out after ${timeoutMs}ms`
      });
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
      finish({
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
