/**
 * Builtin skills seeded once per user when the skill list is first read.
 *
 * These three skills previously shipped as the builtin Claude Code plugins
 * (claude-code-review / claude-safe-edits / claude-github-context). The plugin
 * module is retired; their markdown content survives here as ordinary skills
 * with `source: "builtin"` so users keep managing them through the Skills page.
 *
 * Seeding is idempotent (`createIfMissing`) and never overwrites user edits.
 */
export interface BuiltinSkillSeed {
  name: string;
  description: string;
  content: string;
}

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
  {
    name: "github-context",
    description:
      "Summarize GitHub issue, pull request, and CI context before implementation work. (Builtin, formerly the Claude GitHub Context plugin)",
    content: [
      "---",
      "description: Gather and summarize GitHub issue, pull request, and CI context.",
      "---",
      "",
      "# GitHub Context",
      "",
      "Before implementing GitHub-linked work, identify the relevant issue or pull request, summarize acceptance criteria, review comments, and CI status.",
      "Use repository-native evidence and keep implementation recommendations scoped to the requested change.",
    ].join("\n"),
  },
];