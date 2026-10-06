import { createAdapterLaunchPlan } from "../adapters/index.js";
import type { LaunchPlan } from "../adapters/claude.js";
import { isAdapterId, type AdapterId } from "./adapter-discovery.js";
import { checkCommand, type CommandRunner } from "../lib/dependency-check.js";
import type { Database } from "../db/types.js";
import { ensureClaudeNotificationSettings } from "./claude-notification-settings.js";
import {
  ensureCodexNotificationSettings,
  ensureKimiNotificationSettings,
  ensurePiNotificationSettings
} from "./cli-notification-settings.js";
import { ensureForgeBadgerOpenCodePlugin } from "./opencode-notification-settings.js";
import { ensureMcodeNotificationPreference } from "./mcode-notification-preference.js";
import {
  ensureClaudeTerminalNotificationSettings,
  ensureKimiTerminalNotificationSettings,
  ensureOpenCodeTerminalNotificationSettings
} from "./terminal-notification-settings.js";

export interface LaunchPlanInput {
  adapter: AdapterId;
  projectRoot: string;
  sessionId: string;
  pluginDirs?: string[];
}

/**
 * Internal launch-only material. Every session launches against the host
 * environment: provider/model/credential selection lives in each CLI's global
 * config (see cli-config-apply), never in launch-time env injection.
 */
export function createLaunchPlan(input: LaunchPlanInput): LaunchPlan {
  const env: Record<string, string> = {
    FORGEBADGER_SESSION_ID: input.sessionId,
    FORGEBADGER_GATEWAY_URL: getGatewayUrl()
  };
  if (input.adapter === "kimi") {
    // Kimi Code upgrades its bare BEL notifications to rich OSC 9 text only
    // when TERM_PROGRAM hits its allowlist (iTerm.app/WezTerm/ghostty/
    // WarpTerminal). A user-set TERM_PROGRAM survives the Session Server env
    // sanitization allowlist, so only fall back to WezTerm when none is set.
    env.TERM_PROGRAM = process.env.TERM_PROGRAM?.trim() || "WezTerm";
  }
  return createAdapterLaunchPlan({
    adapter: input.adapter,
    projectRoot: input.projectRoot,
    credentialMode: "host_environment",
    env,
    secretEnvNames: [],
    pluginDirs: input.pluginDirs
  });
}

export async function prepareAdapterLaunchExtras(
  db: Database,
  userId: string,
  adapter: AdapterId,
  projectRoot: string
): Promise<string[]> {
  const hooksDisabled = disabledCliHookAdapters();
  if (adapter === "opencode") {
    // Native terminal notification config always runs — it is plain config,
    // not a hook, so FORGEBADGER_DISABLE_CLI_HOOKS does not gate it.
    await ensureOpenCodeTerminalNotificationSettings();
    if (!hooksDisabled.has("opencode")) {
      await ensureForgeBadgerOpenCodePlugin(projectRoot);
    }
    return [];
  }
  if (adapter === "codex") {
    await ensureCodexNotificationSettings(projectRoot);
    return [];
  }
  if (adapter === "kimi") {
    await ensureKimiTerminalNotificationSettings();
    if (!hooksDisabled.has("kimi")) {
      await ensureKimiNotificationSettings(projectRoot);
    }
    return [];
  }
  if (adapter === "pi") {
    // Global extension in <PI_CODING_AGENT_DIR | ~/.pi/agent>/extensions/;
    // session identity comes from the FORGEBADGER_* session env at runtime.
    await ensurePiNotificationSettings();
    return [];
  }
  if (adapter === "mcode") {
    // MiniMax Code has no hook surface at all, so the PTY OSC stream is the
    // only channel. Under `auto` its notifier degrades to a bare BEL here (no
    // TERM_PROGRAM allowlist hit, no KITTY_WINDOW_ID, no WT_SESSION) and the
    // event kind is lost, so pin the payload-carrying method in config.yaml.
    ensureMcodeNotificationPreference();
    return [];
  }
  await ensureClaudeTerminalNotificationSettings();
  if (!hooksDisabled.has("claude")) {
    await ensureClaudeNotificationSettings(projectRoot, getGatewayUrl());
  }
  return [];
}

/**
 * FORGEBADGER_DISABLE_CLI_HOOKS: skip hook injection for claude/kimi/opencode.
 * Disabling hooks removes structured lifecycle notifications; generic terminal
 * bells cannot safely recover them. Codex/pi are silently ignored because
 * those adapters require their managed hooks/extensions.
 */
export function disabledCliHookAdapters(
  value: string | undefined = process.env.FORGEBADGER_DISABLE_CLI_HOOKS
): Set<"claude" | "kimi" | "opencode"> {
  const disabled = new Set<"claude" | "kimi" | "opencode">();
  for (const entry of value?.split(",") ?? []) {
    const name = entry.trim();
    if (name === "claude" || name === "kimi" || name === "opencode") {
      disabled.add(name);
    }
  }
  return disabled;
}

export function normalizeAdapter(value: string): AdapterId | undefined {
  return isAdapterId(value) ? value : undefined;
}

function getGatewayUrl(): string {
  return (
    process.env.FORGEBADGER_GATEWAY_URL
    || process.env.NEXT_PUBLIC_GATEWAY_URL
    || `http://${process.env.FORGEBADGER_HOST || "127.0.0.1"}:${process.env.FORGEBADGER_PORT || "3000"}`
  );
}

/**
 * Session kind: a CLI adapter id, or the CLI-agnostic "terminal" shell kind.
 * Stored verbatim in the `sessions.ai_tool` text column (no CHECK constraint).
 */
export type SessionKind = AdapterId | "terminal";

/**
 * Normalize a raw session-kind string. Returns undefined for anything that is
 * neither a canonical adapter id nor the terminal kind.
 */
export function normalizeSessionKind(value: string): SessionKind | undefined {
  if (value === "terminal") return "terminal";
  return isAdapterId(value) ? value : undefined;
}

/** Shells offered for a terminal session, per platform. Single source of
 * truth for the union type AND the zod route enum (keep both in lockstep). */
export const TERMINAL_SHELLS = ["pwsh", "powershell", "cmd", "bash", "zsh", "sh"] as const;
export type TerminalShell = (typeof TERMINAL_SHELLS)[number];

export interface TerminalLaunchPlanInput {
  projectRoot: string;
  sessionId: string;
  /** Explicit shell choice; omitted → platform default is resolved. */
  shell?: TerminalShell;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

/**
 * Resolve the preferred shell without probing availability. Windows prefers
 * pwsh; POSIX uses $SHELL then sh. Use resolveAvailableTerminalShell to launch.
 */
export function defaultTerminalShell(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): TerminalShell {
  if (platform === "win32") {
    return "pwsh";
  }
  const shell = env.SHELL?.trim();
  if (shell === "/bin/zsh" || shell?.endsWith("/zsh")) return "zsh";
  if (shell === "/bin/bash" || shell?.endsWith("/bash")) return "bash";
  return "sh";
}

/** Resolve a launchable default, including Windows hosts without PowerShell 7. */
export async function resolveAvailableTerminalShell(
  platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env,
  runner?: CommandRunner
): Promise<TerminalShell> {
  const preferred = defaultTerminalShell(platform, env);
  const fallback: TerminalShell[] = platform === "win32" ? ["pwsh", "powershell", "cmd"] : ["bash", "zsh", "sh"];
  for (const shell of new Set([preferred, ...fallback])) {
    if ((await checkTerminalShell(shell, platform, env, runner)).available) return shell;
  }
  throw new Error("TERMINAL_SHELL_UNAVAILABLE: no supported shell is installed");
}

/**
 * Build a launch plan for a CLI-agnostic terminal (shell) session. Unlike the
 * CLI adapter launch plans, no hooks/notifications are injected and no
 * provider credentials are touched — env is host_environment + session id.
 */
export function createTerminalLaunchPlan(input: TerminalLaunchPlanInput): LaunchPlan {
  const platform = input.platform ?? process.platform;
  const env = input.env ?? process.env;
  const shell = input.shell ?? defaultTerminalShell(platform, env);
  const { command, args } = resolveShellCommand(shell, platform, env);
  return {
    command,
    args,
    cwd: input.projectRoot,
    env: {
      FORGEBADGER_SESSION_ID: input.sessionId,
      FORGEBADGER_GATEWAY_URL: getGatewayUrl()
    },
    secretEnvNames: [],
    credentialMode: "host_environment"
  };
}

function resolveShellCommand(
  shell: TerminalShell,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv
): { command: string; args: string[] } {
  switch (shell) {
    case "pwsh":
      return { command: "pwsh", args: [] };
    case "powershell":
      // Windows PowerShell 5.1 (powershell.exe, always present on Windows).
      // Distinct from pwsh 7: a user who installed Oh My Posh into the 5.1
      // profile needs this shell to see their prompt.
      return { command: "powershell.exe", args: [] };
    case "cmd":
      return { command: env.ComSpec?.trim() || env.COMSPEC?.trim() || "cmd.exe", args: [] };
    case "bash":
      return { command: "bash", args: ["-l"] };
    case "zsh":
      return { command: "zsh", args: ["-l"] };
    case "sh":
      return { command: env.SHELL?.trim() || "sh", args: [] };
  }
}

/**
 * Probe whether a shell binary is launchable. Returns the resolved command on
 * success, or an error message on failure. Used as the terminal equivalent of
 * `getAdapterLaunchStatus` (no adapter discovery to lean on for shells).
 */
export async function checkTerminalShell(
  shell: TerminalShell,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  runner: CommandRunner | undefined = undefined
): Promise<{ available: boolean; command: string; error?: string }> {
  const { command, args } = resolveShellCommand(shell, platform, env);
  // A cheap, universally-supported probe: print nothing and exit 0.
  const probeArgs = shell === "cmd" ? ["/c", "exit", "0"] : [...args, "-c", "exit", "0"];
  const status = await checkCommand(command, probeArgs, runner, { timeoutMs: 5000 });
  return {
    available: status.available,
    command,
    ...(status.error ? { error: status.error } : {})
  };
}
