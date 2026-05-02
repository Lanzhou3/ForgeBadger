export interface PluginSkillDefinition {
  name: string;
  description: string;
  content: string;
}

export interface PluginDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  adapter: "claude";
  category: "workflow" | "safety" | "integration";
  configPath: string;
  skills: PluginSkillDefinition[];
}

export interface PluginSummary extends PluginDefinition {
  enabled: boolean;
  status: "enabled" | "disabled";
}

const claudePlugins: PluginDefinition[] = [
  {
    id: "claude-code-review",
    name: "Claude Code Review",
    description: "Enables review-oriented prompts and checks for Claude Code sessions.",
    version: "1.0.0",
    adapter: "claude",
    category: "workflow",
    configPath: ".claude/plugins/code-review/plugin.json",
    skills: [
      {
        name: "code-review",
        description: "Review changes for correctness, regressions, security risk, and missing tests.",
        content: [
          "---",
          "description: Review code changes with concrete file and line evidence.",
          "---",
          "",
          "# Code Review",
          "",
          "Review the current change for bugs, regressions, security risks, and missing tests.",
          "Lead with findings ordered by severity and reference concrete files or commands.",
          "Keep summaries brief and do not treat passing tests as proof of correctness."
        ].join("\n")
      }
    ]
  },
  {
    id: "claude-safe-edits",
    name: "Claude Safe Edits",
    description: "Adds guardrails for file edits, shell commands, and protected paths.",
    version: "1.0.0",
    adapter: "claude",
    category: "safety",
    configPath: ".claude/plugins/safe-edits/plugin.json",
    skills: [
      {
        name: "safe-edits",
        description: "Check whether planned file edits and shell commands stay inside project safety boundaries.",
        content: [
          "---",
          "description: Review file edits and shell commands before execution for safety boundaries.",
          "---",
          "",
          "# Safe Edits",
          "",
          "Review file edits and shell commands for path traversal, destructive operations, secret exposure, and tenant isolation risk.",
          "Prefer minimal scoped changes. Do not overwrite unrelated user changes or run destructive git commands unless explicitly requested."
        ].join("\n")
      }
    ]
  },
  {
    id: "claude-github-context",
    name: "Claude GitHub Context",
    description: "Provides GitHub issue and pull request context to Claude Code workflows.",
    version: "1.0.0",
    adapter: "claude",
    category: "integration",
    configPath: ".claude/plugins/github-context/plugin.json",
    skills: [
      {
        name: "github-context",
        description: "Summarize GitHub issue, pull request, and CI context before implementation work.",
        content: [
          "---",
          "description: Gather and summarize GitHub issue, pull request, and CI context.",
          "---",
          "",
          "# GitHub Context",
          "",
          "Before implementing GitHub-linked work, identify the relevant issue or pull request, summarize acceptance criteria, review comments, and CI status.",
          "Use repository-native evidence and keep implementation recommendations scoped to the requested change."
        ].join("\n")
      }
    ]
  }
];

export function listClaudePlugins(): PluginDefinition[] {
  return claudePlugins.map((plugin) => ({ ...plugin }));
}

export function getClaudePlugin(pluginId: string): PluginDefinition | undefined {
  return claudePlugins.find((plugin) => plugin.id === pluginId);
}

export function mergePluginStates(
  enabledPluginIds: Set<string>,
  installedPlugins: PluginDefinition[] = []
): PluginSummary[] {
  const builtinIds = new Set(claudePlugins.map((plugin) => plugin.id));
  const mergedPlugins = [
    ...claudePlugins,
    ...installedPlugins.filter((plugin) => !builtinIds.has(plugin.id))
  ];
  return mergedPlugins.map((plugin) => {
    const enabled = enabledPluginIds.has(plugin.id);
    return {
      ...plugin,
      enabled,
      status: enabled ? "enabled" : "disabled"
    };
  });
}
