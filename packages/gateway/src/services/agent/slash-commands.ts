/**
 * Copilot slash commands — local replies answered straight from platform
 * state. A command short-circuits the regular conversation flow before any
 * history projection or model call; the orchestrator persists the reply as an
 * ordinary assistant turn so clients render it exactly like a normal answer.
 */
import type { CopilotSkillSummary } from "./skills/skill-queries.js";

/**
 * Resolve a user turn that is a local command. Returns the formatted reply,
 * or null when the input must go through the regular model flow. Matching is
 * case-insensitive and tolerates surrounding whitespace.
 *
 * `listSkills` is lazy so a non-command turn pays no store read; it resolves
 * the acting user's enabled skills from the platform Skills store, keeping
 * `/skills` and the `list_skills` tool byte-identical.
 */
export function resolveLocalCommandReply(
  userText: string,
  listSkills: () => readonly CopilotSkillSummary[]
): string | null {
  if (userText.trim().toLowerCase() !== "/skills") return null;
  const skillSummaries = listSkills();
  return [
    `Enabled skills (${skillSummaries.length}):`,
    ...skillSummaries.map((skill) => `- ${skill.name}: ${skill.description}`)
  ].join("\n");
}
