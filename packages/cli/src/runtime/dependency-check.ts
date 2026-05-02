import { spawn } from "node:child_process";

export interface CliCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
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

function runCommand(command: string, args: string[]): Promise<CliCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolve({
        exitCode: 127,
        stdout,
        stderr: error.message
      });
    });
    child.on("close", (exitCode) => {
      resolve({
        exitCode: exitCode ?? 1,
        stdout,
        stderr
      });
    });
  });
}
