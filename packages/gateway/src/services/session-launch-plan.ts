import { createAdapterLaunchPlan } from "../adapters/index.js";
import type { LaunchPlan } from "../adapters/claude.js";
import { isAdapterId, type AdapterId } from "./adapter-discovery.js";
import type { Database } from "../db/types.js";
import { ensureClaudeNotificationSettings } from "./claude-notification-settings.js";
import {
  ensureCodexNotificationSettings,
  ensureKimiNotificationSettings
} from "./cli-notification-settings.js";
import { ensureForgeBadgerOpenCodePlugin } from "./opencode-notification-settings.js";

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
  projectRoot: string,
  sessionId: string
): Promise<string[]> {
  if (adapter === "opencode") {
    await ensureForgeBadgerOpenCodePlugin(projectRoot);
    return [];
  }
  if (adapter === "codex") {
    await ensureCodexNotificationSettings(projectRoot);
    return [];
  }
  if (adapter === "kimi") {
    await ensureKimiNotificationSettings(projectRoot);
    return [];
  }
  await ensureClaudeNotificationSettings(projectRoot, getGatewayUrl(), sessionId);
  return [];
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
