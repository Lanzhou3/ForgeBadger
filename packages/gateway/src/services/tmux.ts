import { spawn } from "node:child_process";

import { assertSafeProgrammaticMessage } from "./programmatic-terminal-submit.js";

export interface TmuxCreateOptions {
  name: string;
  cwd: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface TmuxPaneSnapshot {
  content: string;
  dead: boolean;
  inMode: boolean;
}

export interface TmuxClient {
  createSession(options: TmuxCreateOptions): Promise<void>;
  configureSession?(name: string): Promise<void>;
  killSession(name: string): Promise<void>;
  capturePane(name: string): Promise<string>;
  listSessions(): Promise<string[]>;
  hasSession(name: string): Promise<boolean>;
  showEnvironment?(name: string): Promise<Record<string, string>>;
  resizeWindow?(name: string, cols: number, rows: number): Promise<void>;
  sendInput?(name: string, data: string): Promise<void>;
  inspectPane?(name: string): Promise<TmuxPaneSnapshot>;
  stageProgrammaticInput?(name: string, data: string): Promise<void>;
  pressEnter?(name: string): Promise<void>;
}

const BRACKETED_PASTE_START = Buffer.from("\x1b[200~", "utf8");
const BRACKETED_PASTE_END = Buffer.from("\x1b[201~", "utf8");
const SAFE_TMUX_TARGET = /^[a-zA-Z0-9_-]+$/;

export function buildProgrammaticInputControlCommand(name: string, data: string): string {
  if (!SAFE_TMUX_TARGET.test(name)) {
    throw new Error("invalid tmux target");
  }
  assertSafeProgrammaticMessage(data);
  const bytes = Buffer.concat([
    BRACKETED_PASTE_START,
    Buffer.from(data, "utf8"),
    BRACKETED_PASTE_END
  ]);
  const hexBytes = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `send-keys -t ${name} -H ${hexBytes.join(" ")}`;
}

export function createTmuxClient(): TmuxClient {
  async function configureSession(name: string): Promise<void> {
    // Mouse mode lets tmux enter copy-mode for CLIs that do not implement
    // terminal mouse input; OpenCode keeps receiving its own mouse events.
    await runTmux(["set-option", "-t", name, "mouse", "on"]);
    await runTmux(["set-option", "-t", name, "history-limit", "10000"]);
    // Pin the window size to manual control. With the default `window-size
    // latest`, any other attached client (e.g. a wider `tmux attach` from a
    // real terminal) can grow the window beyond the browser xterm's columns;
    // full-screen TUIs disable autowrap, so the extra columns render
    // off-screen and right-side text looks occluded. With `manual`, only the
    // Gateway's resize-window — driven by the browser's fit/resize messages —
    // may change the window size.
    await runTmux(["set-option", "-t", name, "window-size", "manual"]);
  }

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
      await configureSession(options.name);
    },

    async configureSession(name) {
      await configureSession(name);
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

    async hasSession(name) {
      const sessions = await this.listSessions();
      return sessions.includes(name);
    },

    async showEnvironment(name) {
      const output = await runTmux(["show-environment", "-t", name], { ignoreFailure: true });
      const env: Record<string, string> = {};
      for (const line of output.split("\n")) {
        const eq = line.indexOf("=");
        if (eq > 0) {
          env[line.slice(0, eq)] = line.slice(eq + 1);
        }
      }
      return env;
    },

    async resizeWindow(name, cols, rows) {
      await runTmux(["resize-window", "-t", name, "-x", String(cols), "-y", String(rows)], {
        ignoreFailure: true
      });
    },

    async sendInput(name, data) {
      const lines = data.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (line) {
          await runTmux(["send-keys", "-t", name, "-l", "--", line]);
        }
        if (index < lines.length - 1) {
          await runTmux(["send-keys", "-t", name, "Enter"]);
        }
      }
    },

    async inspectPane(name) {
      const [content, metadata] = await Promise.all([
        runTmux(["capture-pane", "-e", "-t", name, "-p"]),
        runTmux(["display-message", "-p", "-t", name, "#{pane_dead}|#{pane_in_mode}"])
      ]);
      const [dead, inMode] = metadata.trim().split("|");
      return { content, dead: dead === "1", inMode: inMode === "1" };
    },

    async stageProgrammaticInput(name, data) {
      await runTmuxControl(name, buildProgrammaticInputControlCommand(name, data));
    },

    async pressEnter(name) {
      await runTmux(["send-keys", "-t", name, "Enter"]);
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

function runTmuxControl(name: string, command: string): Promise<string> {
  if (!SAFE_TMUX_TARGET.test(name)) {
    return Promise.reject(new Error("invalid tmux target"));
  }
  return new Promise((resolve, reject) => {
    const child = spawn("tmux", [
      "-C",
      "attach-session",
      "-f",
      "no-output,ignore-size",
      "-t",
      name
    ], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (error && !child.killed) child.kill();
      if (error) reject(error);
      else resolve(stdout);
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", () => finish(new Error("tmux control input failed")));
    child.on("close", (exitCode) => {
      if (exitCode === 0 && !stdout.includes("%error")) {
        finish();
        return;
      }
      finish(new Error(stderr.trim() || "tmux control input failed"));
    });
    child.stdin.on("error", () => finish(new Error("tmux control input failed")));
    timeout = setTimeout(() => finish(new Error("tmux control input timed out")), 5000);
    timeout.unref?.();
    child.stdin.end(`${command}\ndetach-client\n`);
  });
}
