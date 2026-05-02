import { spawn } from "node:child_process";

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  command: string,
  args: string[]
) => Promise<CommandResult>;

export interface DependencyStatus {
  name: string;
  available: boolean;
  version?: string;
  error?: string;
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

export function runCommand(command: string, args: string[]): Promise<CommandResult> {
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
