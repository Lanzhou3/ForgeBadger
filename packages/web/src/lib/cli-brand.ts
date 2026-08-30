import type { AdapterDiscovery as RuntimeAdapter } from "@/lib/api";
import type { TranslationKey } from "@/lib/i18n";

export type CliBrandId = "claude" | "codex" | "kimi" | "opencode";

export interface CliBrand {
  id: CliBrandId | "unknown";
  /** Full display name, e.g. "Claude Code". */
  label: string;
  /** Compact display name for dense UI, e.g. "Claude". */
  shortLabel: string;
  /** Accent color taken from the CLI's own brand/theme. */
  color: string;
}

/**
 * Accent colors follow each CLI's own branding:
 * - Claude Code: Anthropic terracotta/coral (#D97757, taken from the official mark)
 * - Codex: OpenAI monochrome (near-white on dark surfaces; the Codex mark is
 *   intentionally monochrome)
 * - Kimi Code: Kimi blue (#1783FF, taken from the official mark)
 * - OpenCode: OpenCode grayscale (#B7B1B1, from the official dark logo variant;
 *   the opencode.ai brand is deliberately monochrome)
 */
const CLI_BRANDS: Record<CliBrandId, CliBrand> = {
  claude: { id: "claude", label: "Claude Code", shortLabel: "Claude", color: "#d97757" },
  codex: { id: "codex", label: "Codex", shortLabel: "Codex", color: "#e4e4e7" },
  kimi: { id: "kimi", label: "Kimi Code", shortLabel: "Kimi", color: "#1783ff" },
  opencode: { id: "opencode", label: "OpenCode", shortLabel: "OpenCode", color: "#b7b1b1" },
};

const UNKNOWN_CLI_BRAND: CliBrand = {
  id: "unknown",
  label: "CLI",
  shortLabel: "CLI",
  color: "#71717a",
};

export function getCliBrand(aiTool?: string | null): CliBrand {
  if (!aiTool) return UNKNOWN_CLI_BRAND;
  const normalized = aiTool.trim().toLowerCase() as CliBrandId;
  return CLI_BRANDS[normalized] ?? UNKNOWN_CLI_BRAND;
}

/** Option label for a runtime CLI adapter, with availability suffixes. */
export function runtimeAdapterLabel(
  adapter: Pick<RuntimeAdapter, "label" | "available" | "launchEnabled">,
  t: (key: TranslationKey) => string
): string {
  if (!adapter.available) {
    return `${adapter.label} (${t("projects.runtimeUnavailable")})`;
  }
  if (!adapter.launchEnabled) {
    return `${adapter.label} (${t("projects.runtimeLaunchDisabled")})`;
  }
  return adapter.label;
}
