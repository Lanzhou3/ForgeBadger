export type TerminalMultiplexerKind = "tmux" | "psmux";

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

export interface TerminalMultiplexerControlPlan {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export interface TerminalMultiplexerRuntime {
  kind: TerminalMultiplexerKind;
  command: TerminalMultiplexerKind;
  versionArgs: string[];
  buildAttachArgs(sessionName: string): string[];
  buildGlobalEnvironmentCleanupArgs(environmentOutput: string): string[][];
  buildControlPlan(
    sessionName: string,
    inheritedEnv: NodeJS.ProcessEnv
  ): TerminalMultiplexerControlPlan;
}

const SAFE_SESSION_TARGET = /^[a-zA-Z0-9_-]+$/;

/**
 * Size a multiplexer session is created with and the attach pty is spawned
 * with, before the browser's first fit/resize message lands. Keeping both on
 * the same value avoids a SIGWINCH flicker on attach.
 */
export const DEFAULT_TERMINAL_COLS = 120;
export const DEFAULT_TERMINAL_ROWS = 40;

const SAFE_BASE_ENV_KEYS = new Set([
  "APPDATA",
  "COLORTERM",
  "COMSPEC",
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
  "HOMEDRIVE",
  "HOME",
  "HOMEPATH",
  "LANG",
  "LANGUAGE",
  "LOCALAPPDATA",
  "LOGNAME",
  "KIMI_CODE_HOME",
  "OPENCODE_CONFIG_DIR",
  "PATH",
  "PATHEXT",
  "PROGRAMDATA",
  "PSMUX_CONFIG_FILE",
  "PSMUX_DATA_DIR",
  "SHELL",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TERM",
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
  "TMP",
  "TMPDIR",
  "USER",
  "USERPROFILE",
  "WINDIR",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_RUNTIME_DIR",
  "XDG_STATE_HOME",
  "__CF_USER_TEXT_ENCODING"
]);

export const STALE_MULTIPLEXER_IDENTITY_KEYS = [
  "TMUX",
  "TMUX_PANE",
  "PSMUX_ACTIVE",
  "PSMUX_ALLOW_NESTING",
  "PSMUX_REMOTE_ATTACH",
  "PSMUX_SESSION",
  "PSMUX_SESSION_NAME",
  "PSMUX_TARGET_SESSION",
  "PSMUX_TARGET_FULL",
  "PSMUX_SWITCH_TO",
  "PSMUX_CLIENT_LAST_SESSION",
  "PSMUX_SESSION_DISPLAY_NAME",
  "PSMUX_POPUP"
] as const;

export function resolveTerminalMultiplexerRuntime(
  platform: NodeJS.Platform = process.platform
): TerminalMultiplexerRuntime {
  return platform === "win32" ? createPsmuxRuntime() : createTmuxRuntime();
}

export function clearInheritedMultiplexerIdentity(
  inheritedEnv: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  return buildSanitizedMultiplexerEnv(inheritedEnv);
}

/**
 * Multiplexer servers outlive the Gateway process and their global environment
 * becomes the default for every subsequently created terminal session. Keep
 * that base environment deliberately small so Gateway credentials and other
 * host-process secrets cannot become tenant-readable terminal variables.
 */
export function buildSanitizedMultiplexerEnv(
  inheritedEnv: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(inheritedEnv)) {
    if (value !== undefined && isSafeMultiplexerBaseEnvKey(key)) {
      env[key] = value;
    }
  }
  for (const key of STALE_MULTIPLEXER_IDENTITY_KEYS) {
    env[key] = "";
  }
  return env;
}

export function buildGlobalEnvironmentCleanupArgs(environmentOutput: string): string[][] {
  const commands: string[][] = [];
  for (const line of environmentOutput.split("\n")) {
    if (!line) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const name = line.slice(0, separator);
    if (!isSafeMultiplexerBaseEnvKey(name)) {
      commands.push(["set-environment", "-gu", "--", name]);
    }
  }
  return commands;
}

function isSafeMultiplexerBaseEnvKey(key: string): boolean {
  const normalizedKey = key.toUpperCase();
  return SAFE_BASE_ENV_KEYS.has(normalizedKey) || normalizedKey.startsWith("LC_");
}

function createTmuxRuntime(): TerminalMultiplexerRuntime {
  return {
    kind: "tmux",
    command: "tmux",
    versionArgs: ["-V"],
    buildAttachArgs: buildAttachArgs,
    buildGlobalEnvironmentCleanupArgs,
    buildControlPlan(sessionName, inheritedEnv) {
      assertSafeSessionTarget(sessionName);
      return {
        command: "tmux",
        args: ["-C", "attach-session", "-E", "-f", "no-output,ignore-size", "-t", sessionName],
        env: clearInheritedMultiplexerIdentity(inheritedEnv)
      };
    }
  };
}

function createPsmuxRuntime(): TerminalMultiplexerRuntime {
  return {
    kind: "psmux",
    command: "psmux",
    versionArgs: ["-V"],
    buildAttachArgs: buildAttachArgs,
    buildGlobalEnvironmentCleanupArgs,
    buildControlPlan(sessionName, inheritedEnv) {
      assertSafeSessionTarget(sessionName);
      return {
        command: "psmux",
        args: ["-CC"],
        env: {
          ...clearInheritedMultiplexerIdentity(inheritedEnv),
          PSMUX_SESSION_NAME: sessionName
        }
      };
    }
  };
}

function buildAttachArgs(sessionName: string): string[] {
  assertSafeSessionTarget(sessionName);
  return ["attach-session", "-E", "-t", sessionName];
}

function assertSafeSessionTarget(sessionName: string): void {
  if (!SAFE_SESSION_TARGET.test(sessionName)) {
    throw new Error("invalid terminal multiplexer target");
  }
}

export interface ResolvedWindowsCommand {
  command: string;
  args: string[];
}

/**
 * Windows-only: resolve a bare CLI name (e.g. "opencode") to an executable that
 * child_process.spawn / psmux's CreateProcessW can launch directly. npm/cargo
 * installs place a `.cmd` shim on PATH that bare spawn rejects (EINVAL since
 * Node 20.12/CVE-2024-27980) and that psmux cannot CreateProcessW (error 193),
 * so read the shim and target its real payload: an `.exe`, or node + a `.js`
 * entry. Returns undefined when no shim resolution applies (mac/Linux, a real
 * .exe on PATH, or an unparseable shim) so callers keep the POSIX behavior of
 * resolving through the shell/execvp unchanged.
 */
export function resolveWindowsShimCommand(
  command: string,
  env: NodeJS.ProcessEnv = process.env
): ResolvedWindowsCommand | undefined {
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

  // npm shims end with a quoted payload, either an .exe or a node script:
  //   "%dp0%\node_modules\<pkg>\bin\<tool>.exe" %*
  //   "%_prog%"  "%dp0%\node_modules\<pkg>\...\index.js" %*
  const payload = extractShimPayload(content, shimPath);
  if (!payload) return undefined;

  if (payload.isNodeScript) {
    return { command: process.execPath, args: [payload.path] };
  }
  return { command: payload.path, args: [] };
}

function findWindowsExecutable(
  command: string,
  env: NodeJS.ProcessEnv
): string | undefined {
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

function extractShimPayload(
  content: string,
  shimPath: string
): { path: string; isNodeScript: boolean } | undefined {
  const dp0 = dirname(shimPath);
  const quoted = [...content.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  const nodeMarker = /%_prog%|node(?:\s|")/iu;

  for (const raw of quoted.reverse()) {
    const expanded = raw.replace(/%dp0%/giu, dp0).replace(/^dp0\\/iu, `${dp0}\\`);
    if (!expanded.includes("node_modules")) continue;
    const target = expanded.startsWith(`"`) ? expanded.slice(1, -1) : expanded;
    if (/\.js$/iu.test(target)) {
      return { path: target, isNodeScript: true };
    }
    if (existsSync(target) || /\.exe$/iu.test(target)) {
      return { path: target, isNodeScript: false };
    }
  }

  // Older npm shims keep a plain `node "<script>"` line without node_modules.
  const script = /node\s+"([^"]+\.js)"/iu.exec(content)?.[1];
  if (script) {
    const target = script.replace(/%dp0%/giu, dp0);
    return { path: target, isNodeScript: true };
  }

  // Fallback: only a node marker with a quoted path (e.g. "%_prog%" "script").
  if (nodeMarker.test(content)) {
    const targets = [...content.matchAll(/"([^"]+\.js)"/giu)].map((m) => m[1]!);
    if (targets.length > 0) {
      return { path: targets[targets.length - 1]!.replace(/%dp0%/giu, dp0), isNodeScript: true };
    }
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
  const pathValue = env.Path ?? env.PATH ?? "";
  const pathExt = env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
  const extensions = pathExt.split(";").filter(Boolean);
  for (const dir of pathValue.split(";").filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = join(dir, `${command}${extension.toLowerCase()}`);
      if (existsSync(candidate)) return /\.(?:cmd|bat)$/iu.test(candidate);
    }
    if (existsSync(join(dir, command))) return false;
  }
  return false;
}
