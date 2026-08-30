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

export type CliTerminalRuntimeMode = "native_tmux" | "wsl_required" | "tmux_missing";

export interface CliTerminalRuntimeStatus {
  persistence: "tmux";
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

const CLI_DEPENDENCY_CHECKS: CliDependencyCheck[] = [
  TMUX_DEPENDENCY_CHECK,
  { name: "claude", args: ["--version"], required: false },
  { name: "opencode", args: ["--version"], required: false },
  { name: "codex", args: ["--version"], required: false },
  { name: "kimi", args: ["--version"], required: false }
];

const DEFAULT_COMMAND_TIMEOUT_MS = 3000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_KILL_GRACE_MS = 250;

interface BoundedOutput {
  chunks: Buffer[];
  byteLength: number;
}

export async function checkCliDependencies(
  runner: CliCommandRunner = runCommand
): Promise<CliDependencyStatus[]> {
  return Promise.all(CLI_DEPENDENCY_CHECKS.map((check) => checkDependency(check, runner)));
}

export interface CliTerminalRuntimeCheckOptions {
  runner?: CliCommandRunner | undefined;
  platform?: NodeJS.Platform | undefined;
}

export async function checkCliTerminalRuntime(
  options: CliTerminalRuntimeCheckOptions = {}
): Promise<CliTerminalRuntimeStatus> {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    return describeCliTerminalRuntime([], platform);
  }

  const tmux = await checkDependency(TMUX_DEPENDENCY_CHECK, options.runner ?? runCommand);
  return describeCliTerminalRuntime([tmux], platform);
}

export function describeCliTerminalRuntime(
  dependencies: CliDependencyStatus[],
  platform: NodeJS.Platform = process.platform
): CliTerminalRuntimeStatus {
  if (platform === "win32") {
    return {
      persistence: "tmux",
      mode: "wsl_required",
      supported: false,
      message: "Native Windows terminals require WSL because ForgeBadger persists sessions with tmux."
    };
  }

  const tmux = dependencies.find((dependency) => dependency.name === "tmux");
  if (tmux?.available) {
    return {
      persistence: "tmux",
      mode: "native_tmux",
      supported: true,
      message: "tmux is available for persistent browser terminals."
    };
  }

  return {
    persistence: "tmux",
    mode: "tmux_missing",
    supported: false,
    message: "Install tmux to enable persistent browser terminals."
  };
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
