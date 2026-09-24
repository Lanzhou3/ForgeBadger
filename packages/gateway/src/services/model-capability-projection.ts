/**
 * Projection of Model Center metadata onto CLI-native model configuration.
 *
 * Capability tags are free-form strings stored on `model_profiles.capabilities`.
 * Each CLI adapter consumes only the subset it can express in its own config
 * file; this module centralizes those mappings so the apply writers and the
 * route validation share a single source of truth.
 */

/**
 * Thinking effort levels understood by Kimi Code model entries
 * (`support_efforts` / `default_effort` in config.toml). Codex uses its own
 * `minimal|low|medium|high` ladder for `model_reasoning_effort` and is
 * deliberately not part of this enum.
 */
export const THINKING_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingEffortLevel = (typeof THINKING_EFFORT_LEVELS)[number];

export function isThinkingEffortLevel(value: unknown): value is ThinkingEffortLevel {
  return typeof value === "string" && (THINKING_EFFORT_LEVELS as readonly string[]).includes(value);
}

/**
 * ForgeBadger capability tag -> Kimi Code `capabilities` entries.
 * Deliberately conservative: `always_thinking` is never projected (it forces
 * thinking on, a user-level decision), and `chat` / `code` / `embedding`
 * have no Kimi Code counterpart.
 */
const KIMI_CAPABILITY_PROJECTION: Readonly<Record<string, readonly string[]>> = {
  vision: ["image_in"],
  video: ["video_in"],
  audio: ["audio_in"],
  reasoning: ["thinking"],
  tools: ["tool_use"]
};

/**
 * Projects a model's free-form capability tags onto Kimi Code capability
 * entries. De-duplicated, first-seen order preserved.
 */
export function projectedKimiCapabilities(capabilities: readonly string[]): string[] {
  const projected: string[] = [];
  for (const capability of capabilities) {
    for (const target of KIMI_CAPABILITY_PROJECTION[capability] ?? []) {
      if (!projected.includes(target)) projected.push(target);
    }
  }
  return projected;
}
