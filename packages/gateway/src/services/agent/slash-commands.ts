/**
 * Copilot slash commands — local replies answered straight from platform
 * state. A command short-circuits the regular conversation flow before any
 * history projection or model call; the orchestrator persists the reply as an
 * ordinary assistant turn so clients render it exactly like a normal answer.
 */
import type { CopilotPlaybookSummary } from "./skills/skill-queries.js";

/**
 * Resolve a user turn that is a local command. Returns the formatted reply,
 * or null when the input must go through the regular model flow. Matching is
 * case-insensitive and tolerates surrounding whitespace.
 *
 * `listPlaybooks` is lazy so a non-command turn pays no store read; it resolves
 * the acting user's enabled compatible Copilot playbooks, keeping
 * `/playbooks` and the `list_playbooks` tool byte-identical.
 */
export function resolveLocalCommandReply(
  userText: string,
  listPlaybooks: () => readonly CopilotPlaybookSummary[]
): string | null {
  const command = userText.trim().toLowerCase();
  if (command === "/skills") return "CLI Skills are managed on the Skills page. Use /playbooks for Copilot operating guides.";
  if (command !== "/playbooks") return null;
  const skillSummaries = listPlaybooks();
  return [
    `Available Copilot playbooks (${skillSummaries.length}):`,
    ...skillSummaries.map((skill) => `- ${skill.name}: ${skill.description}`)
  ].join("\n");
}
