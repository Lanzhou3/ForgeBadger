import type { CliAccountAdapter, CliAccountOverview } from "./types.js";
import type { CliAccountProbeOptions } from "./claude-account.js";
import { buildClaudeAccountOverview } from "./claude-account.js";
import { buildCodexAccountOverview } from "./codex-account.js";
import { buildKimiAccountOverview } from "./kimi-account.js";

export type { CliAccountAdapter, CliAccountOverview, CliLoginStatus, CliQuotaEntry, CliQuotaResult } from "./types.js";
export type { CliAccountProbeOptions } from "./claude-account.js";
export { CliProbeLimitError } from "./probe-runner.js";

// opencode/pi are intentionally absent: neither ships a native
// account/quota surface to observe yet.

export const cliAccountAdapters: readonly CliAccountAdapter[] = ["claude", "codex", "kimi"];

export function isCliAccountAdapter(value: string): value is CliAccountAdapter {
  return (cliAccountAdapters as readonly string[]).includes(value);
}

export async function buildCliAccountOverview(
  adapter: CliAccountAdapter,
  userId: string,
  options: CliAccountProbeOptions = {}
): Promise<CliAccountOverview> {
  switch (adapter) {
    case "claude":
      return buildClaudeAccountOverview(userId, options);
    case "codex":
      return buildCodexAccountOverview(userId, options);
    case "kimi":
      return buildKimiAccountOverview(userId, options);
  }
}

export async function buildAllCliAccountOverviews(
  userId: string,
  options: CliAccountProbeOptions = {}
): Promise<CliAccountOverview[]> {
  return Promise.all(cliAccountAdapters.map((adapter) => buildCliAccountOverview(adapter, userId, options)));
}
