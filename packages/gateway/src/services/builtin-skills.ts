/** CLI skill seeds and separately scoped, versioned Copilot playbook upgrades. */
import { BUILTIN_COPILOT_SKILLS } from "./agent/skills/copilot-skills.js";
import { LEGACY_COPILOT_SKILLS } from "./agent/skills/legacy-copilot-skills.js";
import type { SkillRepository } from "../db/repositories/skill-repository.js";

export interface BuiltinSkillSeed {
  name: string;
  description: string;
  content: string;
}

/** Copilot seed metadata; never included in the CLI seed list. */
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

/** Seed CLI skills only; playbooks use the explicit Copilot repository below. */
export function seedBuiltinSkills(repo: SkillRepository): void {
  if (repo.runtimeTarget !== "cli") throw new Error("CLI repository scope required");
  for (const seed of builtinSkillSeeds) {
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

/** Target-scoped seeding preserves IDs, disable choices and edited legacy bodies. */
export function seedBuiltinCopilotPlaybooks(repo: SkillRepository): void {
  if (repo.runtimeTarget !== "copilot") throw new Error("Copilot repository scope required");
  for (const bundled of BUILTIN_COPILOT_SKILLS) {
    const existing = repo.getByName(bundled.name);
    if (!existing) {
      repo.create({name: bundled.name, description: bundled.description, content: bundled.body,
        version: bundled.version, source: "builtin", visibility: "private", isEnabled: true});
      continue;
    }
    const legacy = LEGACY_COPILOT_SKILLS.find(skill => skill.name === bundled.name);
    if (existing.source === "builtin" && existing.version === "1.0.0" && legacy &&
        existing.content === legacy.body && existing.description === legacy.description) {
      repo.update(existing.id, {content: bundled.body, description: bundled.description, version: bundled.version});
    }
  }
}
