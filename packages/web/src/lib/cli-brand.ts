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
 * Accent colors follow each CLI's default branding:
 * - Claude Code: Anthropic terracotta/coral
 * - Codex: OpenAI monochrome (near-white on dark surfaces)
 * - Kimi Code: Kimi violet
 * - OpenCode: terminal green used across opencode.ai
 */
const CLI_BRANDS: Record<CliBrandId, CliBrand> = {
  claude: { id: "claude", label: "Claude Code", shortLabel: "Claude", color: "#d97757" },
  codex: { id: "codex", label: "Codex", shortLabel: "Codex", color: "#e4e4e7" },
  kimi: { id: "kimi", label: "Kimi Code", shortLabel: "Kimi", color: "#8b5cf6" },
  opencode: { id: "opencode", label: "OpenCode", shortLabel: "OpenCode", color: "#22c55e" },
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
