import { spawn } from "node:child_process";

import { assertSafeProgrammaticMessage } from "./programmatic-terminal-submit.js";
import {
  buildSanitizedMultiplexerEnv,
  clearInheritedMultiplexerIdentity,
  resolveTerminalMultiplexerRuntime,
  resolveWindowsShimCommand,
  type TerminalMultiplexerRuntime
} from "./terminal-multiplexer-runtime.js";

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
// psmux rejects -e assignments whose names are not portable environment
// variable names (Windows hosts inherit e.g. "ProgramFiles(x86)").
const SAFE_MULTIPLEXER_ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

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

export function buildCreateSessionArgs(
  options: TmuxCreateOptions,
  inheritedEnv: NodeJS.ProcessEnv = process.env
): string[] {
  const args = [
    "new-session",
    "-d",
    "-s",
    options.name,
    "-c",
    options.cwd,
    // Do not let tmux's update-environment option copy client variables into
    // the new session. The explicit -e values below are the complete trusted
    // launch-plan overlay.
    "-E"
  ];

  // These variables are supplied by the trusted launch plan for this session
  // only. They intentionally bypass the inherited-environment sanitizer so a
  // model credential is available to its CLI without entering the
  // multiplexer server's global environment.
  const sessionEnv = buildSessionEnvironmentOverrides(inheritedEnv, options.env);
  for (const [name, value] of Object.entries(sessionEnv)) {
    args.push("-e", `${name}=${value}`);
  }

  args.push("--", options.command, ...options.args);
  return args;
}

function buildSessionEnvironmentOverrides(
  inheritedEnv: NodeJS.ProcessEnv,
  explicitEnv: Record<string, string>
): Record<string, string> {
  const safeBaseEnv = buildSanitizedMultiplexerEnv(inheritedEnv);
  const overrides: Record<string, string> = {};

  // A pre-fix multiplexer server may still retain the Gateway environment in
  // its global state. Copy only allowlisted runtime variables and empty every
  // other inherited variable on the new session before the CLI starts.
  for (const [name, value] of Object.entries(inheritedEnv)) {
    if (value === undefined) continue;
    if (!SAFE_MULTIPLEXER_ENV_NAME.test(name)) continue;
    overrides[name] = safeBaseEnv[name] === value ? value : "";
  }

  // Clear stale identity even when it is only present in a long-running
  // pre-fix server and no longer present in this Gateway process.
  for (const [name, value] of Object.entries(safeBaseEnv)) {
    if (value === "") overrides[name] = "";
  }

  // Trusted per-session launch variables, including model credentials, must
  // override both the safe host defaults and the inherited-secret tombstones.
  Object.assign(overrides, explicitEnv);
  return overrides;
}

export function createTmuxClient(
  runtime: TerminalMultiplexerRuntime = resolveTerminalMultiplexerRuntime()
): TmuxClient {
  async function configureSession(name: string): Promise<void> {
    // Mouse mode lets tmux enter copy-mode for CLIs that do not implement
    // terminal mouse input; OpenCode keeps receiving its own mouse events.
    await runMultiplexer(runtime, ["set-option", "-t", name, "mouse", "on"]);
    await runMultiplexer(runtime, ["set-option", "-t", name, "history-limit", "10000"]);
    // Pin the window size to manual control. With the default `window-size
    // latest`, any other attached client (e.g. a wider `tmux attach` from a
    // real terminal) can grow the window beyond the browser xterm's columns;
    // full-screen TUIs disable autowrap, so the extra columns render
    // off-screen and right-side text looks occluded. With `manual`, only the
    // Gateway's resize-window — driven by the browser's fit/resize messages —
    // may change the window size.
    await runMultiplexer(runtime, ["set-option", "-t", name, "window-size", "manual"]);
  }

  return {
    async createSession(options) {
      await sanitizeMultiplexerGlobalEnvironment(runtime);
      // On Windows, npm/cargo CLI shims (e.g. opencode.cmd) cannot be launched
      // by psmux's CreateProcessW (error 193: not a valid Win32 application).
      // Resolve the command to its real executable (or node + script) before
      // building the session args. POSIX passes through unchanged.
      const resolved = resolveWindowsShimCommand(options.command);
      const command = resolved?.command ?? options.command;
      const args = resolved ? [...resolved.args, ...options.args] : options.args;
      await runMultiplexer(runtime, buildCreateSessionArgs({ ...options, command, args }));
      await configureSession(options.name);
    },

    async configureSession(name) {
      await configureSession(name);
    },

    async killSession(name) {
      await runMultiplexer(runtime, ["kill-session", "-t", name], { ignoreFailure: true });
    },

    async capturePane(name) {
      return runMultiplexer(runtime, ["capture-pane", "-e", "-S", "-500", "-t", name, "-p"]);
    },

    async listSessions() {
      // Startup recovery calls listSessions before terminal WebSockets are
      // mounted, so stale server-global variables are removed before the
      // first browser attach can occur.
      await sanitizeMultiplexerGlobalEnvironment(runtime);
      const output = await runMultiplexer(runtime, ["list-sessions", "-F", "#{session_name}"], {
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
      const output = await runMultiplexer(runtime, ["show-environment", "-t", name], { ignoreFailure: true });
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
      await runMultiplexer(runtime, ["resize-window", "-t", name, "-x", String(cols), "-y", String(rows)], {
        ignoreFailure: true
      });
    },

    async sendInput(name, data) {
      const lines = data.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (line) {
          await runMultiplexer(runtime, ["send-keys", "-t", name, "-l", "--", line]);
        }
        if (index < lines.length - 1) {
          await runMultiplexer(runtime, ["send-keys", "-t", name, "Enter"]);
        }
      }
    },

    async inspectPane(name) {
      const [content, metadata] = await Promise.all([
        runMultiplexer(runtime, ["capture-pane", "-e", "-t", name, "-p"]),
        runMultiplexer(runtime, ["display-message", "-p", "-t", name, "#{pane_dead}|#{pane_in_mode}"])
      ]);
      const [dead, inMode] = metadata.trim().split("|");
      return { content, dead: dead === "1", inMode: inMode === "1" };
    },

    async stageProgrammaticInput(name, data) {
      await runMultiplexerControl(runtime, name, buildProgrammaticInputControlCommand(name, data));
    },

    async pressEnter(name) {
      await runMultiplexer(runtime, ["send-keys", "-t", name, "Enter"]);
    }
  };
}

interface RunOptions {
  ignoreFailure?: boolean;
  ignoreNoServer?: boolean;
}

function runMultiplexer(
  runtime: TerminalMultiplexerRuntime,
  args: string[],
  options: RunOptions = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(runtime.command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: clearInheritedMultiplexerIdentity(process.env)
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

      reject(new Error(stderr.trim() || `${runtime.command} exited with ${exitCode}`));
    });
  });
}

function runMultiplexerControl(
  runtime: TerminalMultiplexerRuntime,
  name: string,
  command: string
): Promise<string> {
  if (!SAFE_TMUX_TARGET.test(name)) {
    return Promise.reject(new Error("invalid tmux target"));
  }
  return sanitizeMultiplexerGlobalEnvironment(runtime).then(() => runMultiplexerControlRaw(
    runtime,
    name,
    command
  ));
}

function runMultiplexerControlRaw(
  runtime: TerminalMultiplexerRuntime,
  name: string,
  command: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const plan = runtime.buildControlPlan(name, process.env);
    const child = spawn(plan.command, plan.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: plan.env
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
    child.on("error", () => finish(new Error(`${runtime.command} control input failed`)));
    child.on("close", (exitCode) => {
      if (exitCode === 0 && !stdout.includes("%error")) {
        finish();
        return;
      }
      finish(new Error(stderr.trim() || `${runtime.command} control input failed`));
    });
    child.stdin.on("error", () => finish(new Error(`${runtime.command} control input failed`)));
    timeout = setTimeout(() => finish(new Error(`${runtime.command} control input timed out`)), 5000);
    timeout.unref?.();
    child.stdin.end(`${command}\ndetach-client\n`);
  });
}

async function sanitizeMultiplexerGlobalEnvironment(
  runtime: TerminalMultiplexerRuntime
): Promise<void> {
  const output = await runMultiplexer(runtime, ["show-environment", "-g"], {
    ignoreNoServer: true
  });
  for (const args of runtime.buildGlobalEnvironmentCleanupArgs(output)) {
    await runMultiplexer(runtime, args);
  }
}
