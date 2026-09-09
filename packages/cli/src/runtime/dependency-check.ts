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

export type NodePtyLoader = () => Promise<unknown>;

interface CliDependencyCheck {
  name: string;
  args: string[];
  required: boolean;
}

const OPTIONAL_CLI_DEPENDENCY_CHECKS: CliDependencyCheck[] = [
  { name: "claude", args: ["--version"], required: false },
  { name: "opencode", args: ["--version"], required: false },
  { name: "codex", args: ["--version"], required: false },
  { name: "kimi", args: ["--version"], required: false }
];

const NODE_PTY_REINSTALL_GUIDANCE =
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
  loadNodePty: NodePtyLoader = loadNodePtyModule
): Promise<CliDependencyStatus[]> {
  const [nodePty, ...cliStatuses] = await Promise.all([
    checkNodePtyLoadable(loadNodePty),
    ...OPTIONAL_CLI_DEPENDENCY_CHECKS.map((check) => checkDependency(check, runner))
  ]);
  return [nodePty, ...cliStatuses];
}

export async function checkNodePtyLoadable(
  load: NodePtyLoader = loadNodePtyModule
): Promise<CliDependencyStatus> {
  try {
    await load();
    return { name: "node-pty", available: true, required: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      name: "node-pty",
      available: false,
      required: true,
      error: `node-pty failed to load (${detail}); ${NODE_PTY_REINSTALL_GUIDANCE}`
    };
  }
}

async function loadNodePtyModule(): Promise<unknown> {
  return import("node-pty");
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
