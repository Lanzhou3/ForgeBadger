/**
 * Builtin skills seeded once per user when the skill list is first read.
 *
 * These skills previously shipped as the builtin Claude Code plugins
 * (claude-code-review / claude-safe-edits). The plugin module is retired;
 * their markdown content survives here as ordinary skills with
 * `source: "builtin"` so users keep managing them through the Skills page.
 *
 * The Copilot's builtin engineering playbooks are seeded the same way so the
 * agent seam and the Skills page share one source of truth.
 *
 * Seeding is idempotent (`createIfMissing`) and never overwrites user edits.
 */
import { BUILTIN_COPILOT_SKILLS } from "./agent/skills/copilot-skills.js";
import type { SkillRepository } from "../db/repositories/skill-repository.js";

export interface BuiltinSkillSeed {
  name: string;
  description: string;
  content: string;
}

/**
 * The Copilot's builtin engineering playbooks, seeded into the platform Skills
 * store as `source: "builtin"` rows. Their content is plain body text (no YAML
 * frontmatter) so `load_skill` serves it directly.
 */
export const copilotBuiltinSkillSeeds: BuiltinSkillSeed[] = BUILTIN_COPILOT_SKILLS.map((skill) => ({
  name: skill.name,
  description: skill.description,
  content: skill.body
}));

export const builtinSkillSeeds: BuiltinSkillSeed[] = [
  {
    name: "code-review",
    description:
      "Review changes for correctness, regressions, security risk, and missing tests. (Builtin, formerly the Claude Code Review plugin)",
    content: [
      "---",
      "description: Review code changes with concrete file and line evidence.",
      "---",
      "",
      "# Code Review",
      "",
      "Review the current change for bugs, regressions, security risks, and missing tests.",
      "Lead with findings ordered by severity and reference concrete files or commands.",
      "Keep summaries brief and do not treat passing tests as proof of correctness.",
    ].join("\n"),
  },
  {
    name: "safe-edits",
    description:
      "Check planned file edits and shell commands stay inside project safety boundaries. (Builtin, formerly the Claude Safe Edits plugin)",
    content: [
      "---",
      "description: Review file edits and shell commands before execution for safety boundaries.",
      "---",
      "",
      "# Safe Edits",
      "",
      "Review file edits and shell commands for path traversal, destructive operations, secret exposure, and tenant isolation risk.",
      "Prefer minimal scoped changes. Do not overwrite unrelated user changes or run destructive git commands unless explicitly requested.",
    ].join("\n"),
  },
];

/** Seed every builtin skill (legacy + Copilot playbooks) for one user. */
export function seedBuiltinSkills(repo: SkillRepository): void {
  for (const seed of [...builtinSkillSeeds, ...copilotBuiltinSkillSeeds]) {
    repo.createIfMissing({
      name: seed.name,
      description: seed.description,
      source: "builtin",
      content: seed.content,
      version: "1.0.0",
      visibility: "private",
      isEnabled: true
    });
  }
}
