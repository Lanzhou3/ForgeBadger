/**
 * Platform-specific adapters for the Session Server.
 *
 * Abstracts the differences between Windows (ConPTY) and POSIX (forkpty)
 * so the rest of the Session Server is platform-agnostic.
 */
import { resolvePosixIpcPath } from "./endpoint-lifecycle.js";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, isAbsolute, join, win32 } from "node:path";
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
    return resolvePosixIpcPath(stateDir);
  }

  readonly usesCrlf = false;
}

// ---------------------------------------------------------------------------
// Windows (ConPTY)
// ---------------------------------------------------------------------------

class WindowsPtyAdapter implements PlatformPtyAdapter {
  resolveCommand(command: string, env: NodeJS.ProcessEnv): { command: string; args: string[] } {
    const shim = resolveWindowsShimCommand(command, env, "win32");
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

  getIpcPath(stateDir: string): string {
    // A stable user + canonical state-directory identity survives Gateway exits.
    // The token remains the authentication boundary for named pipes.
    const identity = `${userInfo().username}\0${win32.resolve(stateDir).toLowerCase()}`;
    const digest = createHash("sha256").update(identity).digest("hex").slice(0, 32);
    return `\\\\.\\pipe\\forgebadger-session-server-v2-${digest}`;
  }

  readonly usesCrlf = true;
}

export function createPlatformAdapter(
  platform: NodeJS.Platform = process.platform
): PlatformPtyAdapter {
  return platform === "win32" ? new WindowsPtyAdapter() : new PosixPtyAdapter();
}

// ---------------------------------------------------------------------------
// Windows .cmd shim resolution
// ---------------------------------------------------------------------------

interface ResolvedShim {
  command: string;
  args: string[];
}

/**
 * Windows-only: resolve a bare CLI name (e.g. "opencode") to an executable
 * that child_process.spawn / ConPTY's CreateProcessW can launch directly.
 * npm/cargo installs place a `.cmd` shim on PATH that bare spawn rejects
 * (EINVAL since Node 20.12/CVE-2024-27980) and that CreateProcessW cannot
 * launch (error 193), so read the shim and target its real payload: an
 * `.exe`, or node + a `.js` entry. Returns undefined when no shim resolution
 * applies (mac/Linux, a real .exe on PATH, or an unparseable shim) so callers
 * keep the POSIX behavior of resolving through the shell/execvp unchanged.
 *
 * Some vendors ship a two-level launcher: a stable PATH shim that only
 * `CALL`s a versioned inner launcher, e.g. minimax Code's
 *   `mcode.cmd` -> `CALL "%~dp0releases\%MCODE_RELEASE%\.mcode-launcher.cmd" %*`
 * whose inner file is the actual `node "...\cli.js"` payload. Such a shim has
 * no node_modules reference of its own, so the direct parse below cannot see
 * it and the caller would reject the `.cmd` with an opaque error. One level of
 * that indirection is therefore followed; anything deeper (or cyclic) is left
 * unresolved so the caller keeps surfacing the existing explicit error rather
 * than guessing.
 */
export function resolveWindowsShimCommand(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform
): ResolvedShim | undefined {
  if (platform !== "win32") return undefined;
  return resolveShimLayer(command, env, 0, new Set());
}

/** A vendor launcher indirection is followed at most this many times. */
const MAX_SHIM_INDIRECTION_DEPTH = 1;

function resolveShimLayer(
  command: string,
  env: NodeJS.ProcessEnv,
  depth: number,
  visited: ReadonlySet<string>
): ResolvedShim | undefined {
  const shimPath = isAbsolute(command) ? command : findWindowsExecutable(command, env);
  if (!shimPath || !/\.(?:cmd|bat)$/iu.test(shimPath)) return undefined;

  // npm.cmd selects the Node executable and global prefix at runtime. Run the
  // official shim through cmd.exe so an embedded Gateway Node cannot redirect
  // global installs to a different prefix.
  if (/(?:^|[\\/])npm\.cmd$/iu.test(shimPath)) return undefined;

  // Windows paths are case-insensitive; normalize before the cycle check so
  // differently-cased references to one file cannot recurse into each other.
  const key = win32.resolve(shimPath).toLowerCase();
  if (visited.has(key)) return undefined;
  const seen = new Set(visited);
  seen.add(key);

  let content: string;
  try {
    content = readFileSync(shimPath, "utf8");
  } catch {
    return undefined;
  }

  const direct = parseDirectShimPayload(content, shimPath, env);
  if (direct) return direct;

  if (depth >= MAX_SHIM_INDIRECTION_DEPTH) return undefined;
  return resolveIndirectShimPayload(content, shimPath, env, depth, seen);
}

/**
 * Targets an npm/cargo shim declares inline: a `.js` entry run by node, or an
 * executable path. Only payloads that reference node_modules are trusted, so
 * an unrelated quoted string in the batch file cannot redirect the launch.
 *
 * `%~dp0` — the batch idiom every real shim uses for its own directory — is
 * expanded here; previously only the `dp0\` and `%dp0%` spellings were, so such
 * a shim resolved to a literal, non-existent path that was still handed to the
 * pty. Every candidate must therefore exist on disk before it is returned.
 *
 * When the shim names its own Node runtime, that interpreter wins over the
 * Gateway's `process.execPath`. Some CLIs pin a narrow `engines` range and
 * bundle a matching Node precisely so they cannot be run on an arbitrary host
 * version; launching them on whatever Node the Gateway happens to run would
 * either be rejected or hit a real incompatibility.
 */
function parseDirectShimPayload(
  content: string,
  shimPath: string,
  env: NodeJS.ProcessEnv
): ResolvedShim | undefined {
  const shimDir = dirname(shimPath);
  const quoted = [...content.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);

  let script: string | undefined;
  let executable: string | undefined;
  let declaredNode: string | undefined;

  for (const raw of quoted.reverse()) {
    const expanded = expandBatchPath(raw, shimDir, env);
    if (expanded === "") continue;
    const target = isAbsolute(expanded) ? expanded : win32.join(shimDir, expanded);
    if (expanded.includes("node_modules")) {
      if (script === undefined && /\.js$/iu.test(target) && existsSync(target)) {
        script = target;
        continue;
      }
      if (executable === undefined && (existsSync(target) || /\.exe$/iu.test(target))) {
        executable = target;
        continue;
      }
      continue;
    }
    // A shim that ships its own runtime names the interpreter explicitly. This
    // is not optional politeness: MiniMax Code declares
    // `engines: >=22.19 <23 || >=24 <27` and carries a matching private Node,
    // while the Gateway may run an older 22.x that the CLI would refuse to
    // start under. Honoring the declared interpreter keeps the launch inside
    // the range the shim's author asked for.
    if (declaredNode === undefined
      && /(?:^|[\\/])node(?:\.exe)?$/iu.test(target)
      && existsSync(target)) {
      declaredNode = target;
    }
  }

  if (script !== undefined) {
    return { command: declaredNode ?? process.execPath, args: [script] };
  }

  const regexScript = /node\s+"([^"]+\.js)"/iu.exec(content)?.[1];
  if (regexScript) {
    const expanded = expandBatchPath(regexScript, shimDir, env);
    const absolute = expanded === "" ? "" : isAbsolute(expanded) ? expanded : win32.join(shimDir, expanded);
    if (absolute !== "" && existsSync(absolute)) {
      return { command: declaredNode ?? process.execPath, args: [absolute] };
    }
  }

  // A shim with no script entry still resolves if it points straight at an
  // executable (native install, or a .js-less launcher).
  return executable === undefined ? undefined : { command: executable, args: [] };
}

/**
 * Follows `CALL "<inner shim>" %*` one level. The inner shim inherits the
 * caller's arguments via `%*`, so the resolved payload args are returned as a
 * prefix and the launch plan's own args are appended after them by the caller
 * (see `nodePty.spawn(resolved.command, [...resolved.args, ...launchPlan.args])`).
 */
function resolveIndirectShimPayload(
  content: string,
  shimPath: string,
  env: NodeJS.ProcessEnv,
  depth: number,
  seen: ReadonlySet<string>
): ResolvedShim | undefined {
  const shimDir = dirname(shimPath);
  // `SET /P NAME=<file>` reads a pointer file (minimax Code reads its active
  // release id from `current`), and the CALL target interpolates it as %NAME%.
  const scope: NodeJS.ProcessEnv = { ...env, ...readBatchSetPValues(content, shimDir, env) };

  for (const match of content.matchAll(/\bCALL\s+"([^"]+)"/giu)) {
    const expanded = expandBatchPath(match[1]!, shimDir, scope);
    if (!expanded) continue;
    const target = isAbsolute(expanded) ? expanded : win32.join(shimDir, expanded);
    if (!/\.(?:cmd|bat)$/iu.test(target) || !existsSync(target)) continue;
    const resolved = resolveShimLayer(target, scope, depth + 1, seen);
    if (resolved) return resolved;
  }

  return undefined;
}

/** Reads `SET /P NAME=<file>` pointer values declared by a batch shim. */
function readBatchSetPValues(
  content: string,
  shimDir: string,
  env: NodeJS.ProcessEnv
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const match of content.matchAll(
    /^\s*SET\s+\/P\s+([A-Za-z_][A-Za-z0-9_]*)\s*=<"?([^">\r\n]+)"?/gimu
  )) {
    const name = match[1]!;
    const file = expandBatchPath(match[2]!, shimDir, { ...env, ...values });
    if (!file) continue;
    try {
      const value = readFileSync(file, "utf8").trim();
      if (value) values[name] = value;
    } catch {
      // A missing or unreadable pointer file just leaves the variable
      // unexpanded; the CALL target then fails its existsSync check.
    }
  }
  return values;
}

/** Expands `%~dp0`, bare `dp0\` and `%VAR%` in a batch-quoted path reference.
 *
 * npm's standard shim writes `SET dp0=%~dp0` then references `%dp0%\node_modules\...`,
 * so `dp0` is an implicit alias for the shim's own directory even though it is
 * never exported to the process environment. Without this alias every
 * globally-installed npm CLI (pi, opencode, …) resolves to a literal
 * `%dp0%\...` path that fails existsSync and is rejected as unresolvable. */
function expandBatchPath(
  raw: string,
  shimDir: string,
  scope: NodeJS.ProcessEnv
): string {
  let value = raw.trim().replace(/^"|"$/gu, "").trim();
  value = value.replace(/%~dp0\\?/giu, `${shimDir}\\`).replace(/^dp0\\/iu, `${shimDir}\\`);
  value = value.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/gu, (whole, name: string) => {
    if (name.toLowerCase() === "dp0") return shimDir;
    return lookupBatchVar(scope, name) ?? whole;
  });
  return value.length > 0 ? value : "";
}

function lookupBatchVar(scope: NodeJS.ProcessEnv, name: string): string | undefined {
  for (const [key, value] of Object.entries(scope)) {
    if (value !== undefined && key.toUpperCase() === name.toUpperCase()) return value;
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

/**
 * Windows-only: returns true when `command` resolves (via PATH + PATHEXT) to a
 * .cmd/.bat shim that bare child_process.spawn cannot execute. Always false on
 * POSIX, where the command is run through execvp unchanged.
 */
export function isWindowsShimCommand(
  command: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (process.platform !== "win32") return false;
  if (isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    return /\.(?:cmd|bat)$/iu.test(command);
  }
  const resolved = findWindowsExecutable(command, env);
  if (!resolved) return false;
  return /\.(?:cmd|bat)$/iu.test(resolved);
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
