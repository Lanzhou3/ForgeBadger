/**
 * Platform-specific adapters for the Session Server.
 *
 * Abstracts the differences between Windows (ConPTY) and POSIX (forkpty)
 * so the rest of the Session Server is platform-agnostic.
 */
import { randomBytes, createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import type { IPty } from "node-pty";

export interface PlatformPtyAdapter {
  /** Resolve a command name to its executable path / shim. */
  resolveCommand(command: string, env: NodeJS.ProcessEnv): { command: string; args: string[] };
  /** Default shell for fallback sessions. */
  getDefaultShell(env: NodeJS.ProcessEnv): string;
  /** IPC socket / named-pipe path for the Session Server. */
  getIpcPath(stateDir: string): string;
  /** Whether pty output uses CRLF line endings. */
  readonly usesCrlf: boolean;
}

// ---------------------------------------------------------------------------
// POSIX (macOS / Linux / WSL)
// ---------------------------------------------------------------------------

class PosixPtyAdapter implements PlatformPtyAdapter {
  resolveCommand(command: string): { command: string; args: string[] } {
    // On POSIX, execvp resolves PATH automatically. No shim parsing needed.
    return { command, args: [] };
  }

  getDefaultShell(env: NodeJS.ProcessEnv): string {
    return env.SHELL?.trim() || "bash";
  }

  getIpcPath(stateDir: string): string {
    return join(stateDir, "session-server-v1.sock");
  }

  readonly usesCrlf = false;
}

// ---------------------------------------------------------------------------
// Windows (ConPTY)
// ---------------------------------------------------------------------------

class WindowsPtyAdapter implements PlatformPtyAdapter {
  resolveCommand(command: string, env: NodeJS.ProcessEnv): { command: string; args: string[] } {
    const shim = resolveWindowsShimCommand(command, env);
    if (shim) return shim;
    // ConPTY (node-pty win/conpty.cc) resolves relative names via
    // `get_shell_path`, which does an exact filename match against PATH
    // entries — it does NOT search PATHEXT. A bare "Kimi" therefore never
    // matches "claude.exe" on disk, and spawn throws `File not found: `.
    // Always hand ConPTY an absolute path.
    if (!isAbsolute(command)) {
      const executable = findWindowsExecutable(command, env);
      if (!executable) {
        throw new Error(`Command not found on PATH: "${command}"`);
      }
      if (/\.(?:cmd|bat)$/iu.test(executable)) {
        // A .cmd/.bat was found but shim parsing failed (unparseable payload).
        // Passing the .cmd path through would fail later at CreateProcessW
        // (error 193) with an equally opaque message, so surface it here.
        throw new Error(
          `Windows shim could not be resolved to a native executable: ${executable}`
        );
      }
      return { command: executable, args: [] };
    }
    return { command, args: [] };
  }

  getDefaultShell(env: NodeJS.ProcessEnv): string {
    return env.COMSPEC?.trim() || env.ComSpec?.trim() || "cmd.exe";
  }

  getIpcPath(_stateDir: string): string {
    // Named pipe on Windows. The name carries the protocol major version, a
    // per-user component, and a per-process random suffix (memoized so the
    // Gateway reuses one name for its lifetime) to defeat same-user named
    // pipe squatting; node cannot set a pipe SDDL, so the hello token is
    // the real authentication layer.
    return windowsPipeName();
  }

  readonly usesCrlf = true;
}

let memoizedWindowsPipeName: string | undefined;

function windowsPipeName(): string {
  if (!memoizedWindowsPipeName) {
    memoizedWindowsPipeName =
      `\\\\.\\pipe\\forgebadger-session-server-v1-${windowsUserComponent()}-${randomBytes(4).toString("hex")}`;
  }
  return memoizedWindowsPipeName;
}

function windowsUserComponent(): string {
  let username = "";
  try {
    username = userInfo().username;
  } catch {
    // Fall through to the hash of an empty name
  }
  const sanitized = username.replace(/[^a-zA-Z0-9_-]/g, "");
  if (sanitized) return sanitized;
  return createHash("sha256").update(username || "unknown").digest("hex").slice(0, 8);
}

export function createPlatformAdapter(
  platform: NodeJS.Platform = process.platform
): PlatformPtyAdapter {
  return platform === "win32" ? new WindowsPtyAdapter() : new PosixPtyAdapter();
}

// ---------------------------------------------------------------------------
// Windows .cmd shim resolution (migrated from terminal-multiplexer-runtime.ts)
// ---------------------------------------------------------------------------

interface ResolvedShim {
  command: string;
  args: string[];
}

function resolveWindowsShimCommand(
  command: string,
  env: NodeJS.ProcessEnv
): ResolvedShim | undefined {
  if (process.platform !== "win32") return undefined;

  const shimPath = isAbsolute(command)
    ? command
    : findWindowsExecutable(command, env);
  if (!shimPath || !/\.(?:cmd|bat)$/iu.test(shimPath)) return undefined;

  let content: string;
  try {
    content = readFileSync(shimPath, "utf8");
  } catch {
    return undefined;
  }

  const dp0 = dirname(shimPath);
  const quoted = [...content.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);

  for (const raw of quoted.reverse()) {
    const expanded = raw.replace(/%dp0%/giu, dp0).replace(/^dp0\\/iu, `${dp0}\\`);
    if (!expanded.includes("node_modules")) continue;
    const target = expanded.startsWith(`"`) ? expanded.slice(1, -1) : expanded;
    if (/\.js$/iu.test(target)) {
      return { command: process.execPath, args: [target] };
    }
    if (existsSync(target) || /\.exe$/iu.test(target)) {
      return { command: target, args: [] };
    }
  }

  const script = /node\s+"([^"]+\.js)"/iu.exec(content)?.[1];
  if (script) {
    const target = script.replace(/%dp0%/giu, dp0);
    return { command: process.execPath, args: [target] };
  }

  return undefined;
}

function findWindowsExecutable(command: string, env: NodeJS.ProcessEnv): string | undefined {
  const pathValue = env.Path ?? env.PATH ?? "";
  const pathExt = env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
  const extensions = pathExt.split(";").filter(Boolean);
  for (const dir of pathValue.split(";").filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = join(dir, `${command}${extension.toLowerCase()}`);
      if (existsSync(candidate)) return candidate;
    }
    const bare = join(dir, command);
    if (existsSync(bare)) return bare;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Windows node-pty 1.1.0 leak workaround
// ---------------------------------------------------------------------------

/**
 * node-pty 1.1.0 (the version this repo pins) never releases all of a
 * ConPTY session's handles, so a process whose sessions have all exited
 * hangs: the worker thread's MessagePort and the conin/conout sockets
 * keep the event loop alive.
 *
 * Per-path gaps in the installed build (src/windowsPtyAgent.ts):
 *   - natural exit: `_outSocket` is destroyed after a 1s flush timer,
 *     but `_inSocket` and `_conoutSocketWorker` are never torn down
 *   - kill(): the worker is disposed (non-conptydll) but neither socket
 *     is destroyed
 *   - conptydll paths: almost nothing is cleaned up
 *
 * disposePty closes what the library leaves behind. It is a no-op on
 * POSIX, idempotent, and degrades to a no-op if node-pty's internals
 * ever change — re-verify against the new layout on any node-pty
 * upgrade and remove this workaround if the upstream release fixes
 * the leak (1.2.0-beta still leaves the natural-exit path open).
 */
export function disposePty(pty: IPty): void {
  if (process.platform !== "win32") return;

  const terminal = pty as unknown as {
    _agent?: {
      _inSocket?: { destroy: (cb?: (err?: Error | null) => void) => void };
      _outSocket?: { destroy: (cb?: (err?: Error | null) => void) => void };
      _conoutSocketWorker?: { dispose: () => void };
    };
  };
  const agent = terminal._agent;
  if (!agent) return;

  try {
    agent._conoutSocketWorker?.dispose();
  } catch {
    // worker already disposed
  }
  try {
    agent._inSocket?.destroy();
  } catch {
    // socket already destroyed
  }
  try {
    agent._outSocket?.destroy();
  } catch {
    // socket already destroyed
  }
}
