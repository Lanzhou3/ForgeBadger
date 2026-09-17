/**
 * Frontmatter handling shared by the Copilot skill seam and the Skills
 * product surface.
 *
 * A skill body is its markdown content minus an optional leading YAML
 * frontmatter block (--- ... ---). Imported skills (ClawHub / GitHub) carry
 * frontmatter; builtin seeds are plain body text. The Copilot `load_skill`
 * tool returns the stripped body so metadata never leaks into the model's
 * playbook view.
 */

export function hasFrontmatter(content: string): boolean {
  return content.startsWith("---\n") || content.startsWith("---\r\n");
}

/** Return the body with any leading YAML frontmatter block removed. */
export function stripFrontmatter(content: string): string {
  if (!hasFrontmatter(content)) return content;
  const closing = content.indexOf("\n---", 4);
  if (closing === -1) return content;
  // `closing` is the index of the "\n" immediately before the closing "---".
  let cursor = closing + 1;
  cursor += 3; // skip "---"
  if (content[cursor] === "\r") cursor += 1;
  if (content[cursor] === "\n") cursor += 1;
  return content.slice(cursor);
}
