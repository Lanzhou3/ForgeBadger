/**
 * Copilot slash commands — local replies answered straight from platform
 * state. A command short-circuits the regular conversation flow before any
 * history projection or model call; the orchestrator persists the reply as an
 * ordinary assistant turn so clients render it exactly like a normal answer.
 */
import { listCopilotSkillSummaries } from "./skills/copilot-skills.js";

/**
 * Resolve a user turn that is a local command. Returns the formatted reply,
 * or null when the input must go through the regular model flow. Matching is
 * case-insensitive and tolerates surrounding whitespace.
 */
export function resolveLocalCommandReply(userText: string): string | null {
  if (userText.trim().toLowerCase() !== "/skills") return null;
  const skills = listCopilotSkillSummaries();
  return [
    `Enabled skills (${skills.length}):`,
    ...skills.map((skill) => `- ${skill.name}: ${skill.description}`)
  ].join("\n");
}
