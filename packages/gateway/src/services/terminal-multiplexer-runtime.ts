export type TerminalMultiplexerKind = "tmux" | "psmux";

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
