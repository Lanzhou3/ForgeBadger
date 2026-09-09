/**
 * Environment sanitization for the Session Server.
 *
 * The Session Server process and every pty it spawns must not inherit the
 * Gateway's secrets. Only an explicit allowlist of benign base variables is
 * forwarded (copied from terminal-multiplexer-runtime.ts; the multiplexer
 * identity tombstones are intentionally dropped — the Session Server has no
 * nested-multiplexer problem).
 */

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

/**
 * Defense in depth: these Gateway secrets must never reach the Session
 * Server or a pty, even if they are ever added to the allowlist by mistake.
 */
const ALWAYS_DENIED_ENV_KEYS = new Set([
  "FORGEBADGER_MASTER_KEY",
  "FORGEBADGER_JWT_SECRET"
]);

export function buildSanitizedEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (ALWAYS_DENIED_ENV_KEYS.has(key)) continue;
    if (!isSafeBaseEnvKey(key)) continue;
    env[key] = value;
  }
  return env;
}

function isSafeBaseEnvKey(key: string): boolean {
  const normalizedKey = key.toUpperCase();
  return SAFE_BASE_ENV_KEYS.has(normalizedKey) || normalizedKey.startsWith("LC_");
}
