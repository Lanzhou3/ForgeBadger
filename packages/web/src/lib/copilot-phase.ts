import type { TranslationKey } from "@/lib/i18n";

const PHASE_KEYS: Record<string, TranslationKey> = {
  context: "copilot.phase.context",
  summarizing: "copilot.phase.summarizing",
  model: "copilot.phase.model",
  tool: "copilot.phase.tool",
  queued: "copilot.phase.queued",
};

/**
 * Label for a run's execution phase. Both chat surfaces (the /copilot
 * console and the floating pet panel) share this so a long run reports the
 * same "what is it doing right now" progress instead of a bare spinner.
 */
export function copilotPhaseLabel(phase: string | undefined): TranslationKey {
  return PHASE_KEYS[phase ?? "queued"] ?? "copilot.phase.default";
}
