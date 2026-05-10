import { spawn } from "node:child_process";

export interface TmuxCreateOptions {
  name: string;
  cwd: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface TmuxClient {
  createSession(options: TmuxCreateOptions): Promise<void>;
  killSession(name: string): Promise<void>;
  capturePane(name: string): Promise<string>;
  listSessions(): Promise<string[]>;
  resizeWindow?(name: string, cols: number, rows: number): Promise<void>;
}

export function createTmuxClient(): TmuxClient {
  return {
    async createSession(options) {
      const args = [
        "new-session",
        "-d",
        "-s",
        options.name,
        "-c",
        options.cwd
      ];

      for (const [name, value] of Object.entries(options.env)) {
        args.push("-e", `${name}=${value}`);
      }

      args.push("--", options.command, ...options.args);
      await runTmux(args);
    },

    async killSession(name) {
      await runTmux(["kill-session", "-t", name], { ignoreFailure: true });
    },

    async capturePane(name) {
      return runTmux(["capture-pane", "-e", "-S", "-500", "-t", name, "-p"]);
    },

    async listSessions() {
      const output = await runTmux(["list-sessions", "-F", "#{session_name}"], {
        ignoreNoServer: true
      });
      return output
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    },

    async resizeWindow(name, cols, rows) {
      await runTmux(["resize-window", "-t", name, "-x", String(cols), "-y", String(rows)], {
        ignoreFailure: true
      });
    }
  };
}

interface RunOptions {
  ignoreFailure?: boolean;
  ignoreNoServer?: boolean;
}

function runTmux(args: string[], options: RunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("tmux", args, {
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
      if (options.ignoreFailure) {
        resolve("");
        return;
      }
      reject(error);
    });
    child.on("close", (exitCode) => {
      if (options.ignoreNoServer && stderr.includes("no server running")) {
        resolve("");
        return;
      }

      if (exitCode === 0 || options.ignoreFailure) {
        resolve(stdout);
        return;
      }

      reject(new Error(stderr.trim() || `tmux exited with ${exitCode}`));
    });
  });
}
