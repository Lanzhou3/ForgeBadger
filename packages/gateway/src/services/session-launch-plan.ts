import { createAdapterLaunchPlan } from "../adapters/index.js";
import type { LaunchPlan } from "../adapters/claude.js";
import { isAdapterId, type AdapterId } from "./adapter-discovery.js";
import type { Database } from "../db/types.js";
import { ensureClaudeNotificationSettings } from "./claude-notification-settings.js";
import {
  ensureCodexNotificationSettings,
  ensureKimiNotificationSettings,
  ensurePiNotificationSettings
} from "./cli-notification-settings.js";
import { ensureForgeBadgerOpenCodePlugin } from "./opencode-notification-settings.js";
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
  await ensureClaudeTerminalNotificationSettings();
  if (!hooksDisabled.has("claude")) {
    await ensureClaudeNotificationSettings(projectRoot, getGatewayUrl());
  }
  return [];
}

/**
 * FORGEBADGER_DISABLE_CLI_HOOKS: comma-separated adapter names whose hook
 * injection is skipped because the terminal-native channel (OSC 9/99/BEL
 * interception) covers them. Only claude/kimi/opencode have a terminal
 * channel; codex/pi are silently ignored (they must keep their hooks).
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
