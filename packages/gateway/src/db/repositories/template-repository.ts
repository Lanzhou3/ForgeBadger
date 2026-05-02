import { and, desc, eq, notInArray, or } from "drizzle-orm";

import { drizzle } from "drizzle-orm/better-sqlite3";
import type { Database } from "../types.js";

import { auditLogs, templateFiles, templates, users } from "../schema.js";
import { buildOpenForgeClaudeHookSettings } from "../../services/claude-notification-settings.js";

export interface Template {
  id: string;
  userId: string | null;
  name: string;
  description: string | null;
  version: string;
  isBuiltin: boolean;
  visibility: string;
  usageCount: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TemplateFile {
  id: number;
  templateId: string;
  filePath: string;
  content: string;
  fileType: string;
}

export interface CreateTemplateInput {
  name: string;
  description?: string | undefined;
  version?: string | undefined;
  visibility?: "private" | "shared" | "admin" | undefined;
  files?: Array<{
    filePath: string;
    content: string;
    fileType?: string | undefined;
  }> | undefined;
}

export interface UpdateTemplateInput {
  name?: string | undefined;
  description?: string | undefined;
  version?: string | undefined;
  visibility?: "private" | "shared" | "admin" | undefined;
  status?: string | undefined;
}

export interface TemplatePackage {
  name: string;
  description?: string | null;
  version: string;
  files: Array<{
    filePath: string;
    content: string;
    fileType: string;
  }>;
  exportedAt: string;
}

export interface TemplateVersionSnapshot extends TemplatePackage {
  id: number;
  templateId: string;
  action: string;
  createdAt: Date;
}

const BUILTIN_CLAUDE_TEMPLATE_ID = "builtin-claude-code";
const BUILTIN_CLAUDE_TEMPLATE_VERSION = "2.1.0";
const BUILTIN_OPENCODE_TEMPLATE_ID = "builtin-opencode";
const BUILTIN_CODEX_TEMPLATE_ID = "builtin-codex";
const BUILTIN_ADAPTER_TEMPLATE_VERSION = "1.0.0";

function builtInClaudeTemplate(): typeof templates.$inferInsert {
  return {
    id: BUILTIN_CLAUDE_TEMPLATE_ID,
    userId: null,
    name: "Claude Code",
    description: "Built-in Claude Code template with project memory, hooks, and OpenForge session integration",
    version: BUILTIN_CLAUDE_TEMPLATE_VERSION,
    isBuiltin: true,
    visibility: "shared",
    usageCount: 0,
    status: "active"
  };
}

function builtInClaudeFiles(): Array<typeof templateFiles.$inferInsert> {
  return [
    {
      templateId: BUILTIN_CLAUDE_TEMPLATE_ID,
      filePath: ".claude/CLAUDE.md",
      content: builtInClaudeMd(),
      fileType: "markdown"
    },
    {
      templateId: BUILTIN_CLAUDE_TEMPLATE_ID,
      filePath: ".claude/settings.json",
      content: builtInClaudeSettings(),
      fileType: "json"
    },
    {
      templateId: BUILTIN_CLAUDE_TEMPLATE_ID,
      filePath: ".claude/hooks/openforge-guard.mjs",
      content: builtInGuardHook(),
      fileType: "javascript"
    },
    {
      templateId: BUILTIN_CLAUDE_TEMPLATE_ID,
      filePath: ".claude/rules/security.md",
      content: builtInRule("Security", [
        "Never hardcode secrets, tokens, private keys, or API keys.",
        "Validate all user input at API, shell, HTML, path, and WebSocket boundaries.",
        "Resolve filesystem paths through trusted project-root checks before reading or writing.",
        "Do not log plaintext credentials, JWTs, decrypted API keys, or terminal input that may contain secrets."
      ]),
      fileType: "markdown"
    },
    {
      templateId: BUILTIN_CLAUDE_TEMPLATE_ID,
      filePath: ".claude/rules/api.md",
      content: builtInRule("API", [
        "Keep handlers thin: authenticate, validate, call services, and return the standard envelope.",
        "Use `{ \"code\": 0, \"data\": {}, \"message\": \"\" }` for success and `{ \"code\": 1, \"message\": \"...\" }` for errors.",
        "Use `GET` for reads, `POST` for creation/actions, `PUT` for replacement, `PATCH` for partial updates, and `DELETE` for idempotent deletion.",
        "Do not trust frontend validation; validate request params, query, and bodies server-side."
      ]),
      fileType: "markdown"
    },
    {
      templateId: BUILTIN_CLAUDE_TEMPLATE_ID,
      filePath: ".claude/rules/backend.md",
      content: builtInRule("Backend", [
        "Keep business logic in services or repositories rather than route handlers.",
        "Apply tenant filtering at repository boundaries.",
        "Prefer early returns over deep nesting.",
        "Use structured logs with action, userId, resource id, and duration; omit sensitive values."
      ]),
      fileType: "markdown"
    },
    {
      templateId: BUILTIN_CLAUDE_TEMPLATE_ID,
      filePath: ".claude/rules/frontend.md",
      content: builtInRule("Frontend", [
        "Build dense, functional developer-tool screens with clear loading, empty, and error states.",
        "Keep component names PascalCase and hooks focused on one responsibility.",
        "Use existing UI components and icons before introducing new patterns.",
        "Do not put feature explanations or keyboard-shortcut instructions into the main app surface unless users need them to complete a task."
      ]),
      fileType: "markdown"
    },
    {
      templateId: BUILTIN_CLAUDE_TEMPLATE_ID,
      filePath: ".claude/rules/testing.md",
      content: builtInRule("Testing", [
        "Use TDD for behavior changes where practical.",
        "Cover error paths, boundary cases, tenant isolation, and security-sensitive behavior.",
        "Run the narrowest useful test first, then broader typecheck/build checks when the change crosses modules.",
        "Do not claim completion without fresh verification evidence."
      ]),
      fileType: "markdown"
    },
    {
      templateId: BUILTIN_CLAUDE_TEMPLATE_ID,
      filePath: "WORKFLOW.md",
      content: builtInWorkflowMd(),
      fileType: "markdown"
    },
    {
      templateId: BUILTIN_CLAUDE_TEMPLATE_ID,
      filePath: "PLAN.md",
      content: builtInPlanMd(),
      fileType: "markdown"
    },
    {
      templateId: BUILTIN_CLAUDE_TEMPLATE_ID,
      filePath: "CHANGELOG.md",
      content: builtInChangelogMd(),
      fileType: "markdown"
    },
    {
      templateId: BUILTIN_CLAUDE_TEMPLATE_ID,
      filePath: "CONTRIBUTING.md",
      content: builtInContributingMd(),
      fileType: "markdown"
    }
  ];
}

function builtInOpenCodeTemplate(): typeof templates.$inferInsert {
  return {
    id: BUILTIN_OPENCODE_TEMPLATE_ID,
    userId: null,
    name: "OpenCode",
    description: "Built-in OpenCode template with AGENTS.md, project config, agents, and commands",
    version: BUILTIN_ADAPTER_TEMPLATE_VERSION,
    isBuiltin: true,
    visibility: "shared",
    usageCount: 0,
    status: "active"
  };
}

function builtInOpenCodeFiles(): Array<typeof templateFiles.$inferInsert> {
  return [
    {
      templateId: BUILTIN_OPENCODE_TEMPLATE_ID,
      filePath: "AGENTS.md",
      content: builtInAdapterAgentsMd("OpenCode"),
      fileType: "markdown"
    },
    {
      templateId: BUILTIN_OPENCODE_TEMPLATE_ID,
      filePath: "opencode.json",
      content: builtInOpenCodeJson(),
      fileType: "json"
    },
    {
      templateId: BUILTIN_OPENCODE_TEMPLATE_ID,
      filePath: ".opencode/agents/code-reviewer.md",
      content: builtInAdapterAgentMd("code-reviewer", "Review diffs for correctness, security, maintainability, and missing tests.", false),
      fileType: "markdown"
    },
    {
      templateId: BUILTIN_OPENCODE_TEMPLATE_ID,
      filePath: ".opencode/agents/planner.md",
      content: builtInAdapterAgentMd("planner", "Turn scoped requirements into a verifiable implementation plan before code changes.", false),
      fileType: "markdown"
    },
    {
      templateId: BUILTIN_OPENCODE_TEMPLATE_ID,
      filePath: ".opencode/commands/review.md",
      content: builtInAdapterCommandMd("Review the current diff. Lead with bugs, regressions, security risks, and missing tests. Reference concrete files and lines."),
      fileType: "markdown"
    },
    {
      templateId: BUILTIN_OPENCODE_TEMPLATE_ID,
      filePath: ".opencode/commands/verify.md",
      content: builtInAdapterCommandMd("Run the narrowest relevant tests first, then typecheck/build as needed. Report exact commands and failures."),
      fileType: "markdown"
    }
  ];
}

function builtInCodexTemplate(): typeof templates.$inferInsert {
  return {
    id: BUILTIN_CODEX_TEMPLATE_ID,
    userId: null,
    name: "Codex",
    description: "Built-in Codex template with AGENTS.md, project config preset, and review agents",
    version: BUILTIN_ADAPTER_TEMPLATE_VERSION,
    isBuiltin: true,
    visibility: "shared",
    usageCount: 0,
    status: "active"
  };
}

function builtInCodexFiles(): Array<typeof templateFiles.$inferInsert> {
  return [
    {
      templateId: BUILTIN_CODEX_TEMPLATE_ID,
      filePath: "AGENTS.md",
      content: builtInAdapterAgentsMd("Codex"),
      fileType: "markdown"
    },
    {
      templateId: BUILTIN_CODEX_TEMPLATE_ID,
      filePath: ".codex/config.toml",
      content: builtInCodexConfigToml(),
      fileType: "toml"
    },
    {
      templateId: BUILTIN_CODEX_TEMPLATE_ID,
      filePath: ".codex/agents/code-reviewer.md",
      content: builtInAdapterAgentMd("code-reviewer", "Review changes as a read-only reviewer. Prioritize correctness, security, tenant isolation, and test gaps.", false),
      fileType: "markdown"
    },
    {
      templateId: BUILTIN_CODEX_TEMPLATE_ID,
      filePath: ".codex/agents/planner.md",
      content: builtInAdapterAgentMd("planner", "Create a concrete implementation plan with validation gates and rollback notes.", false),
      fileType: "markdown"
    }
  ];
}

function builtInClaudeMd(): string {
  return [
    "# {{projectName}}",
    "",
    "You are working inside an OpenForge-managed Claude Code session.",
    "",
    "## Project Context",
    "",
    "- Project root: `{{projectRoot}}`",
    "- Treat this file as shared project memory, not a scratchpad.",
    "- CLAUDE.md is startup context, not an enforcement layer. Use settings for hard permission policy.",
    "- Keep it concise, concrete, and easy to verify. Target fewer than 200 lines per memory file.",
    "- Put narrow or file-specific rules in `.claude/rules/` instead of growing this file indefinitely.",
    "- Use `@path/to/file.md` imports only for stable, high-value context that should load at session start.",
    "- Run `/init` to let Claude propose project-specific memory improvements; set `CLAUDE_CODE_NEW_INIT=1` when you want the newer multi-phase setup for memory, Skills, and hooks.",
    "",
    "## What Belongs In This File",
    "",
    "- Keep commands Claude cannot reliably infer: install, typecheck, test, build, dev server, migration, and release commands.",
    "- Keep project-specific architecture decisions, non-obvious constraints, safety boundaries, and repository etiquette.",
    "- Keep coding and testing conventions that differ from common defaults.",
    "- Keep durable gotchas that caused repeated mistakes or came from code review feedback.",
    "- Keep environment quirks such as required variables, local ports, or tool versions when they affect normal work.",
    "",
    "## What To Move Elsewhere",
    "",
    "- Use Skills for multi-step procedures, repeatable workflows, long checklists, or task-specific playbooks.",
    "- Use `.claude/rules/` for modular always-on or path-scoped policy that should stay separate from project memory.",
    "- Use `@docs/...` imports for stable reference documents instead of pasting long API or product documentation here.",
    "- Use `CLAUDE.local.md` or `@~/.claude/...` imports for personal paths, sandbox URLs, and private preferences.",
    "- Remove anything Claude can discover by reading code, package manifests, or short project docs.",
    "",
    "## Instruction Priority",
    "",
    "- Follow direct user instructions first.",
    "- Then follow repository instructions in `CLAUDE.md`, `.claude/CLAUDE.md`, and `.claude/rules/`.",
    "- Then follow narrower path-scoped rules and task-specific Skills when they apply.",
    "- If instructions conflict, pause and ask instead of guessing.",
    "",
    "## Common Commands",
    "",
    "- Install dependencies: `pnpm install`",
    "- Build all packages: `pnpm build`",
    "- Typecheck all packages: `pnpm -r typecheck`",
    "- Run all tests: `pnpm -r test`",
    "- Gateway dev server: `cd packages/gateway && pnpm dev`",
    "- Web dev server: `cd packages/web && pnpm dev`",
    "- Gateway production start: `cd packages/gateway && pnpm start`",
    "- Web production start: `cd packages/web && pnpm start`",
    "",
    "## Operating Pattern",
    "",
    "- Give Claude a way to verify every meaningful change: focused tests, typechecks, screenshots, command output, or explicit acceptance criteria.",
    "- Explore first, then plan, then code for multi-file or cross-module changes.",
    "- For a narrow bugfix, reproduce the symptom and patch the smallest responsible unit.",
    "- Ask for concrete acceptance criteria when the task changes behavior or UI.",
    "- Prefer one focused change per commit; keep unrelated cleanup out of the diff.",
    "- When the user provides screenshots, logs, or failing commands, treat them as primary evidence.",
    "- Manage context aggressively: stop broad reading once enough evidence exists, and move rarely used details into Skills or imported docs.",
    "",
    "## Context Management",
    "",
    "- Start by reading the smallest set of files that can answer the question.",
    "- Prefer `rg` and targeted file reads over broad directory scans.",
    "- Keep long command output out of the conversation unless the user asks for it.",
    "- Move repeatable multi-step procedures into Skills, not always-loaded project memory.",
    "- Use `/memory` when a durable project instruction should be edited during a Claude Code session.",
    "- Use `/memory` to verify which CLAUDE.md, CLAUDE.local.md, rules, and auto-memory files actually loaded.",
    "- Store large reference material in imported files or Skills; keep this memory useful at session start.",
    "- Use `CLAUDE.local.md` for private per-worktree preferences and add it to `.gitignore`.",
    "- Prefer `@~/.claude/<file>.md` imports for personal instructions that must follow you across worktrees.",
    "",
    "## Permissions And Safety",
    "",
    "- Use `/permissions` or project settings for durable allow/deny rules; do not rely on prose instructions for enforcement.",
    "- Use hooks for deterministic checks that must happen every time, such as formatting, audit capture, or notification forwarding.",
    "- Use plugin packages when the same Skills, hooks, subagents, MCP servers, or LSP settings should travel together across projects.",
    "- Keep shared `.claude/settings.json` free of personal tokens, absolute local paths, and machine-specific URLs.",
    "- Use `.claude/settings.local.json` for OpenForge session hooks and other machine-local runtime configuration.",
    "- Official Claude Code references: memory (`https://code.claude.com/docs/en/memory`), settings (`https://code.claude.com/docs/en/settings`), hooks (`https://code.claude.com/docs/en/hooks`), best practices (`https://code.claude.com/docs/en/best-practices`).",
    "",
    "## Instruction Loading",
    "",
    "- `CLAUDE.md` and `.claude/CLAUDE.md` are always-loaded project memory.",
    "- Claude loads ancestor `CLAUDE.md` and `CLAUDE.local.md` files from filesystem root down to the launch directory; closer instructions are read later.",
    "- `CLAUDE.local.md` loads beside `CLAUDE.md`, is appended after the shared file at the same level, and must stay gitignored.",
    "- Subdirectory `CLAUDE.md` and `CLAUDE.local.md` files load on demand when Claude reads files in those directories.",
    "- If this repository also has `AGENTS.md`, keep one source of truth and import it from CLAUDE.md when appropriate.",
    "- `.claude/settings.local.json` is local machine configuration and should not contain shared policy.",
    "- Use `.claude/rules/*.md` for modular policy; rules without `paths` frontmatter load every session, while path-scoped rules load when Claude works with matching files.",
    "- Use `.claude/skills/<skill-name>/SKILL.md` for repeatable workflows that should load only on demand or when Claude decides they are relevant.",
    "- Use `.claude/commands/*.md` for legacy/custom slash commands; Claude Code now treats commands and Skills as the same invocation surface.",
    "- Prefer concise Skill frontmatter: `name` when needed, a strong `description`, and optional invocation or version metadata.",
    "- If Claude is launched with `--add-dir`, set `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` only when extra directory memory should load.",
    "- If unrelated parent memories are being loaded in a monorepo, configure `claudeMdExcludes` in local settings.",
    "",
    "## Auto Memory",
    "",
    "- Auto Memory is machine-local and may store reusable project notes outside the repository.",
    "- Claude loads only the first 200 lines or 25KB of auto-memory `MEMORY.md`; keep it as a concise index and move detailed notes into topic files.",
    "- Use `/memory` to audit or edit auto memory. Disable it with `autoMemoryEnabled: false` or `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` only when local policy requires it.",
    "",
    "## AGENTS.md Compatibility",
    "",
    "- Claude Code reads `CLAUDE.md`; other coding agents may read `AGENTS.md`.",
    "- When a repo already standardizes on `AGENTS.md`, prefer a small CLAUDE.md bridge such as `@AGENTS.md` plus Claude-specific notes.",
    "- Do not duplicate large instruction sets across both files unless there is a clear ownership reason.",
    "",
    "## Skills And Rules",
    "",
    "- Project Skills live at `.claude/skills/<skill-name>/SKILL.md` with concise frontmatter and task-specific instructions.",
    "- Keep this file for facts that should load every session; move repeatable procedures into Skills so they load only when relevant.",
    "- Project rules live under `.claude/rules/`; use one topic per file and `paths:` frontmatter for file-specific guidance.",
    "- User Skills live under `~/.claude/skills` or the directory pointed to by `CLAUDE_CONFIG_DIR`; user rules live under `~/.claude/rules`.",
    "- Skill precedence is enterprise, then personal, then project. Plugin Skills use `plugin-name:skill-name` namespaces.",
    "- Claude Code watches existing Skill directories for live edits; if a top-level Skill directory did not exist at session start, restart Claude Code.",
    "- User commands may live under `~/.claude/commands`; plugin commands may live under a plugin root `commands/` directory.",
    "- Plugin-provided Skills and commands are namespaced by plugin and may be loaded through `--plugin-dir`, the Claude plugin cache, or installed marketplaces.",
    "- If a Skill or rule conflicts with direct user instructions or repository policy, stop and clarify.",
    "",
    "## Subagents MCP And Plugins",
    "",
    "- Use subagents for isolated investigation, review, or long context reads that would pollute the main conversation.",
    "- Use MCP when Claude needs external systems such as GitHub, issue trackers, databases, browsers, or design tools.",
    "- Use plugins to package reusable Skills, hooks, subagents, MCP/LSP configuration, and default settings across projects.",
    "- Prefer a plugin over copy-pasting the same Skill/hook bundle into many repositories.",
    "",
    "## Claude Code Hooks And Notifications",
    "",
    "- OpenForge writes hooks into `.claude/settings.local.json` at session launch.",
    "- `PermissionRequest`, `PermissionDenied`, and `Notification(permission_prompt)` use HTTP hooks that POST Claude Code's hook JSON directly to OpenForge with env-backed headers.",
    "- Permission requests should appear in the OpenForge notification center and link back to the session terminal.",
    "- If notifications do not appear, check that `OPENFORGE_SESSION_ID`, `OPENFORGE_ATTACH_TOKEN`, and `OPENFORGE_GATEWAY_URL` are present in the launched tmux environment.",
    "- Use Claude Code `/hooks` inside the terminal to inspect which project, local, user, and plugin hooks are active.",
    "- Keep project-shared `.claude/settings.json` free of machine-local tokens or absolute hook URLs.",
    "",
    "## Repository Orientation",
    "",
    "- Check for existing `CLAUDE.md`, `AGENTS.md`, README, package manifests, and test configuration before changing code.",
    "- Follow the repository's established package manager, formatter, import style, and naming conventions.",
    "- Prefer narrow reads and targeted diffs. Avoid broad rewrites unless the task explicitly requires them.",
    "- For generated configuration, preserve user-owned files and require explicit conflict decisions before overwriting.",
    "",
    "## Architecture",
    "",
    "- Keep Gateway responsibilities in `packages/gateway`; do not add Next.js API routes for Gateway behavior.",
    "- Keep Web console responsibilities in `packages/web`; call Gateway through `/api/v1` and WebSocket endpoints.",
    "- REST responses use the OpenForge envelope: `{ \"code\": 0, \"data\": {}, \"message\": \"\" }` or `{ \"code\": 1, \"message\": \"...\", \"details\": {} }`.",
    "- Terminal sessions are tmux-backed. Gateway restarts and browser reconnects must not kill the underlying CLI session.",
    "- Store project, session, model, agent, skill, template, and plugin state in SQLite. Do not store terminal scrollback in SQLite.",
    "",
    "## Coding Standards",
    "",
    "- Read existing patterns before editing. Keep changes scoped to the user's request.",
    "- Validate all API params and request bodies at the boundary.",
    "- Use tenant-scoped repository methods for user-owned records.",
    "- Resolve filesystem paths through safe project-root checks before reading or writing.",
    "- Never log secrets, API keys, decrypted credentials, tokens, or private environment values.",
    "- Avoid broad refactors while fixing focused behavior.",
    "",
    "## Development Workflow",
    "",
    "- Reproduce bugs before fixing them.",
    "- Add or update focused tests for behavior changes.",
    "- Run the narrowest useful verification first, then broader checks when the change crosses modules.",
    "- Do not claim work is complete unless the relevant test, typecheck, build, or manual verification has run.",
    "- Preserve user changes in the worktree. Do not revert unrelated files.",
    "",
    "## Verification Contract",
    "",
    "- For backend changes, run the focused `node --import tsx --test ...` command that covers the touched service or route.",
    "- For frontend changes, run the focused Vitest file or component test before broader checks.",
    "- For cross-package changes, run `pnpm -r typecheck` and `git diff --check` before handoff.",
    "- If a verification command cannot run in the current environment, state the exact command and failure reason.",
    "",
    "## Review And Handoff",
    "",
    "- Lead reviews with bugs, regressions, security risks, and missing tests.",
    "- Reference concrete files and lines when reporting issues.",
    "- Summarize what changed and what was verified before handing work back.",
    "- State explicitly when a command could not be run and why.",
    "",
    "## Security Boundaries",
    "",
    "- Hardcoded secrets are forbidden.",
    "- Use environment variables for runtime secrets and validate required values at startup.",
    "- Use parameterized SQL or ORM-safe query builders.",
    "- Treat generated configuration, Skill content, Agent prompts, and template imports as untrusted text.",
    "- Reject path traversal, symlink escapes, and writes outside the approved project root.",
    "",
    "## Claude Code Notes",
    "",
    "- Project rules may live under `.claude/rules/`; keep topic-specific rules there instead of growing this file indefinitely.",
    "- Skills may live under `.claude/skills/`; invoke them only when relevant to the task.",
    "- OpenForge installs notification hooks in `.claude/settings.json` or `.claude/settings.local.json` so permission prompts and relevant Claude Code notifications can appear in the Web console.",
    "- OpenForge may pass enabled Claude plugins through `claude --plugin-dir`; plugin Skills are reusable, versioned workflow extensions.",
    "",
    "## When To Update This File",
    "",
    "- Update this file when a rule would otherwise be repeated in future sessions.",
    "- Update this file when code review finds a project convention Claude should have known.",
    "- Remove stale or contradictory instructions as the project evolves.",
    ""
  ].join("\n");
}

function builtInClaudeSettings(): string {
  const settings = buildOpenForgeClaudeHookSettings("{{gatewayUrl}}");
  settings.hooks.PreToolUse = [
    {
      matcher: "Bash",
      hooks: [
        {
          type: "command",
          command: "node .claude/hooks/openforge-guard.mjs",
          timeout: 5
        }
      ]
    }
  ];
  return `${JSON.stringify(settings, null, 2)}\n`;
}

function builtInGuardHook(): string {
  return [
    "#!/usr/bin/env node",
    "",
    "const input = await readStdin();",
    "let payload = {};",
    "try { payload = input ? JSON.parse(input) : {}; } catch { payload = {}; }",
    "const command = String(payload.tool_input?.command ?? payload.command ?? \"\");",
    "const blockedPatterns = [",
    "  /(^|\\s)rm\\s+-rf\\s+(\\/|~|\\$HOME)(\\s|$)/,",
    "  /(^|\\s)sudo\\s+rm\\s+-rf\\b/,",
    "  /(^|\\s)git\\s+reset\\s+--hard\\b/,",
    "  /(^|\\s)git\\s+clean\\s+-fdx\\b/,",
    "  /(^|\\s)chmod\\s+-R\\s+777\\b/",
    "];",
    "if (blockedPatterns.some((pattern) => pattern.test(command))) {",
    "  console.error(\"OpenForge guard blocked a dangerous Bash command. Ask the user for explicit approval or choose a safer operation.\");",
    "  process.exit(2);",
    "}",
    "process.exit(0);",
    "",
    "function readStdin() {",
    "  return new Promise((resolve) => {",
    "    let data = \"\";",
    "    process.stdin.setEncoding(\"utf8\");",
    "    process.stdin.on(\"data\", (chunk) => { data += chunk; });",
    "    process.stdin.on(\"end\", () => resolve(data));",
    "    process.stdin.resume();",
    "  });",
    "}",
    ""
  ].join("\n");
}

function builtInRule(title: string, bullets: string[]): string {
  return [`# ${title} Rules`, "", ...bullets.map((bullet) => `- ${bullet}`), ""].join("\n");
}

function builtInWorkflowMd(): string {
  return [
    "# Workflow",
    "",
    "1. Clarify the request and identify the smallest safe scope.",
    "2. Read the relevant docs, code, and tests before changing files.",
    "3. Add or update focused tests for behavior changes.",
    "4. Implement narrowly and preserve unrelated user changes.",
    "5. Run verification and record skipped commands with concrete reasons.",
    ""
  ].join("\n");
}

function builtInPlanMd(): string {
  return [
    "# Plan",
    "",
    "Use this file for project-level milestones and open decisions.",
    "",
    "## Current Focus",
    "",
    "- Define the next concrete change before editing code.",
    "",
    "## Open Decisions",
    "",
    "- Record decisions that affect architecture, security, or user workflows.",
    ""
  ].join("\n");
}

function builtInChangelogMd(): string {
  return [
    "# Changelog",
    "",
    "All notable project changes can be recorded here.",
    "",
    "## Unreleased",
    "",
    "- Initial OpenForge scaffold.",
    ""
  ].join("\n");
}

function builtInContributingMd(): string {
  return [
    "# Contributing",
    "",
    "- Follow the repository instructions in `CLAUDE.md` and `.claude/CLAUDE.md`.",
    "- Keep changes scoped and include relevant verification evidence.",
    "- Do not commit secrets, generated credentials, database files, or local-only settings.",
    "- Prefer small, reviewable changes over broad rewrites.",
    ""
  ].join("\n");
}

function builtInAdapterAgentsMd(adapterName: "OpenCode" | "Codex"): string {
  const configFile = adapterName === "OpenCode" ? "opencode.json" : ".codex/config.toml";
  return [
    "# {{projectName}}",
    "",
    `You are working inside an OpenForge-managed ${adapterName} session.`,
    "",
    "## Project Context",
    "",
    "- Project root: `{{projectRoot}}`",
    "- Treat this file as shared project instructions. Keep personal paths, tokens, and local preferences out of it.",
    "- Keep instructions concise and project-specific. Move long procedures into referenced docs or tool-specific command files.",
    "- Prefer `@docs/...` references for stable long-form documentation instead of pasting large documents here.",
    `- ${adapterName} should use this root \`AGENTS.md\` as the primary project-level instruction file.`,
    `- Tool-specific runtime defaults live in \`${configFile}\`; do not put secrets in that file.`,
    "",
    "## Instruction Priority",
    "",
    "- Follow direct user instructions first.",
    "- Then follow this repository's project instructions and narrower path-scoped instructions.",
    "- If instructions conflict, pause and ask instead of guessing.",
    "- Preserve user changes in the worktree. Never revert unrelated edits unless explicitly asked.",
    "",
    "## Common Commands",
    "",
    "- Install dependencies: `pnpm install`",
    "- Typecheck all packages: `pnpm -r typecheck`",
    "- Run all tests: `pnpm -r test`",
    "- Build all packages: `pnpm -r build`",
    "- Gateway dev server: `cd packages/gateway && pnpm dev`",
    "- Web dev server: `cd packages/web && pnpm dev`",
    "",
    "## Operating Pattern",
    "",
    "- Read the smallest set of docs, code, and tests that can answer the current question.",
    "- Use `rg` for text and file discovery before slower search tools.",
    "- For behavior changes, add or update focused tests before implementation where practical.",
    "- Keep changes scoped to the request and follow existing repository patterns.",
    "- Prefer small, reviewable commits with verification evidence.",
    "- When the user provides logs, screenshots, or failing commands, treat them as primary evidence.",
    "",
    "## Architecture Notes",
    "",
    "- Keep API, service, repository, WebSocket, and CLI adapter behavior in the Gateway package.",
    "- Keep React pages, components, hooks, and styling in the Web package.",
    "- Do not implement Gateway behavior in Next.js API routes.",
    "- Terminal sessions are tmux-backed; browser disconnects must not kill the underlying CLI process.",
    "",
    "## Safety Boundaries",
    "",
    "- Do not hardcode secrets, API keys, JWTs, private keys, or credentials.",
    "- Do not log plaintext secrets or decrypted API keys.",
    "- Validate request params, request bodies, file paths, shell inputs, and WebSocket messages at boundaries.",
    "- Resolve filesystem access through the project root and reject path traversal or symlink escapes.",
    "- Do not run destructive commands such as `git reset --hard`, `git clean -fdx`, or broad deletes without explicit user approval.",
    "",
    "## Verification Contract",
    "",
    "- Run the narrowest relevant test first.",
    "- Run `pnpm -r typecheck` when TypeScript contracts or cross-package APIs change.",
    "- Run `git diff --check` before handoff or commit.",
    "- If a command cannot run in the environment, report the exact command and concrete reason.",
    "",
    "## Review Contract",
    "",
    "- In code review, lead with bugs, regressions, security risks, and missing tests.",
    "- Reference concrete files and line numbers when reporting findings.",
    "- Keep summaries secondary to actionable findings.",
    "",
    "## When To Update This File",
    "",
    "- Add durable project-specific rules that future sessions should know immediately.",
    "- Remove stale, duplicated, or contradictory instructions.",
    "- Move long workflows into referenced docs or tool-specific command files.",
    ""
  ].join("\n");
}

function builtInOpenCodeJson(): string {
  return `${JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    instructions: ["AGENTS.md"],
    share: "manual",
    default_agent: "build"
  }, null, 2)}\n`;
}

function builtInCodexConfigToml(): string {
  return [
    "# OpenForge project-level Codex preset.",
    "# Codex normally reads config.toml from CODEX_HOME; OpenForge treats this file as the project preset source.",
    "# Keep secrets and personal authentication outside the repository.",
    "",
    'model = "gpt-5.1-codex"',
    'approval_policy = "on-request"',
    'sandbox_mode = "workspace-write"',
    "project_doc_max_bytes = 32768",
    "",
    "[features]",
    "web_search_request = false",
    "",
    "[shell_environment_policy]",
    'inherit = "core"',
    "ignore_default_excludes = false",
    ""
  ].join("\n");
}

function builtInAdapterAgentMd(name: string, description: string, canWrite: boolean): string {
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    `tools: ${canWrite ? "read,write,edit,bash" : "read,bash"}`,
    "---",
    "",
    description,
    "",
    "- Stay within the current task scope.",
    "- Preserve unrelated user changes.",
    "- Report verification evidence or exact blockers.",
    ""
  ].join("\n");
}

function builtInAdapterCommandMd(instruction: string): string {
  return [
    "# Command",
    "",
    instruction,
    "",
    "Keep output concise and actionable.",
    ""
  ].join("\n");
}

function builtInTemplateDefinitions(): Array<{
  template: typeof templates.$inferInsert;
  files: Array<typeof templateFiles.$inferInsert>;
}> {
  return [
    { template: builtInClaudeTemplate(), files: builtInClaudeFiles() },
    { template: builtInOpenCodeTemplate(), files: builtInOpenCodeFiles() },
    { template: builtInCodexTemplate(), files: builtInCodexFiles() }
  ];
}

function isBuiltInTemplateId(id: string): boolean {
  return id === BUILTIN_CLAUDE_TEMPLATE_ID ||
    id === BUILTIN_OPENCODE_TEMPLATE_ID ||
    id === BUILTIN_CODEX_TEMPLATE_ID;
}

export class TemplateRepository {
  private drizzle;

  constructor(db: Database, private userId: string) {
    this.drizzle = drizzle(db);
  }

  listBuiltIn(): Template[] {
    this.ensureBuiltInTemplates();
    return this.drizzle
      .select()
      .from(templates)
      .where(eq(templates.isBuiltin, true))
      .all() as Template[];
  }

  getBuiltInClaude(): Template {
    this.ensureBuiltInTemplates();
    const result = this.drizzle
      .select()
      .from(templates)
      .where(eq(templates.id, BUILTIN_CLAUDE_TEMPLATE_ID))
      .get() as Template | undefined;
    if (!result) {
      throw new Error("Built-in Claude template not found");
    }
    return result;
  }

  list(): Template[] {
    const readableVisibility = this.readableVisibility();
    return this.drizzle
      .select()
      .from(templates)
      .where(
        and(
          eq(templates.isBuiltin, false),
          readableVisibility
        )
      )
      .all() as Template[];
  }

  create(input: CreateTemplateInput): Template {
    const template = this.drizzle
      .insert(templates)
      .values({
        userId: this.userId,
        name: input.name,
        description: input.description ?? null,
        version: input.version ?? "1.0.0",
        visibility: input.visibility ?? "private",
        isBuiltin: false,
        usageCount: 0,
        status: "active"
      })
      .returning()
      .get() as Template;

    for (const file of input.files ?? []) {
      this.upsertFile(template.id, file.filePath, file.content, file.fileType ?? "markdown");
    }

    return template;
  }

  clone(sourceTemplateId: string, name: string): Template {
    const source = this.getById(sourceTemplateId);
    if (!source || !source.files) {
      throw new Error("Template not found");
    }

    return this.create({
      name,
      description: source.description ?? undefined,
      version: source.version,
      files: source.files.map((file) => ({
        filePath: file.filePath,
        content: file.content,
        fileType: file.fileType
      }))
    });
  }

  exportPackage(id: string): TemplatePackage {
    const template = this.getById(id);
    if (!template || !template.files) {
      throw new Error("Template not found");
    }

    return {
      name: template.name,
      description: template.description,
      version: template.version,
      files: template.files.map((file) => ({
        filePath: file.filePath,
        content: file.content,
        fileType: file.fileType
      })),
      exportedAt: new Date().toISOString()
    };
  }

  importPackage(input: TemplatePackage): Template {
    return this.create({
      name: input.name,
      description: input.description ?? undefined,
      version: input.version,
      files: input.files.map((file) => ({
        filePath: file.filePath,
        content: file.content,
        fileType: file.fileType
      }))
    });
  }

  listVersions(templateId: string): TemplateVersionSnapshot[] {
    const template = this.getOwnedCustomTemplate(templateId);
    if (!template) {
      return [];
    }

    const rows = this.drizzle
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.userId, this.userId),
          eq(auditLogs.resourceType, "template_version"),
          eq(auditLogs.resourceId, templateId)
        )
      )
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .all() as Array<{
        id: number;
        resourceId: string | null;
        action: string;
        details: string | null;
        createdAt: Date;
      }>;

    return rows.flatMap((row) => {
      if (!row.details || !row.resourceId) return [];
      try {
        const snapshot = JSON.parse(row.details) as TemplatePackage;
        return [{
          ...snapshot,
          id: row.id,
          templateId: row.resourceId,
          action: row.action,
          createdAt: row.createdAt
        }];
      } catch {
        return [];
      }
    });
  }

  restoreVersion(templateId: string, versionId: number): (Template & { files?: TemplateFile[] }) | undefined {
    const template = this.getOwnedCustomTemplate(templateId);
    if (!template) {
      return undefined;
    }

    const row = this.drizzle
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.id, versionId),
          eq(auditLogs.userId, this.userId),
          eq(auditLogs.resourceType, "template_version"),
          eq(auditLogs.resourceId, templateId)
        )
      )
      .get() as { details: string | null } | undefined;
    if (!row?.details) {
      return undefined;
    }

    let snapshot: TemplatePackage;
    try {
      snapshot = JSON.parse(row.details) as TemplatePackage;
    } catch {
      return undefined;
    }

    this.recordVersionSnapshot(templateId, "template.restore");
    this.drizzle
      .update(templates)
      .set({
        name: snapshot.name,
        description: snapshot.description ?? null,
        version: snapshot.version
      })
      .where(
        and(
          eq(templates.id, templateId),
          eq(templates.userId, this.userId),
          eq(templates.isBuiltin, false)
        )
      )
      .run();
    this.drizzle.delete(templateFiles).where(eq(templateFiles.templateId, templateId)).run();
    for (const file of snapshot.files) {
      this.drizzle
        .insert(templateFiles)
        .values({
          templateId,
          filePath: file.filePath,
          content: file.content,
          fileType: file.fileType
        })
        .run();
    }

    return this.getById(templateId);
  }

  getById(id: string): (Template & { files?: TemplateFile[] }) | undefined {
    if (isBuiltInTemplateId(id)) {
      this.ensureBuiltInTemplates();
    }

    const template = this.drizzle
      .select()
      .from(templates)
      .where(
        and(
          eq(templates.id, id),
          this.readableVisibility(true)
        )
      )
      .get() as Template | undefined;
    if (!template) return undefined;

    const files = this.drizzle
      .select()
      .from(templateFiles)
      .where(eq(templateFiles.templateId, id))
      .all() as TemplateFile[];

    return { ...template, files };
  }

  updateFile(templateId: string, filePath: string, content: string): TemplateFile | undefined {
    this.recordVersionSnapshot(templateId, "template.file.update");
    return this.upsertFile(templateId, filePath, content, "markdown");
  }

  update(id: string, input: UpdateTemplateInput): Template | undefined {
    const updateData: Record<string, unknown> = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.version !== undefined) updateData.version = input.version;
    if (input.visibility !== undefined) updateData.visibility = input.visibility;
    if (input.status !== undefined) updateData.status = input.status;
    if (Object.keys(updateData).length === 0) {
      return this.getOwnedCustomTemplate(id);
    }
    this.recordVersionSnapshot(id, "template.update");

    return this.drizzle
      .update(templates)
      .set(updateData)
      .where(
        and(
          eq(templates.id, id),
          eq(templates.userId, this.userId),
          eq(templates.isBuiltin, false)
        )
      )
      .returning()
      .get() as Template | undefined;
  }

  upsertFile(
    templateId: string,
    filePath: string,
    content: string,
    fileType = "markdown"
  ): TemplateFile | undefined {
    const ownedTemplate = this.drizzle
      .select({ id: templates.id })
      .from(templates)
      .where(
        and(
          eq(templates.id, templateId),
          eq(templates.userId, this.userId),
          eq(templates.isBuiltin, false)
        )
      )
      .get();
    if (!ownedTemplate) {
      return undefined;
    }

    const existing = this.drizzle
      .select()
      .from(templateFiles)
      .where(and(eq(templateFiles.templateId, templateId), eq(templateFiles.filePath, filePath)))
      .get() as TemplateFile | undefined;

    if (existing) {
      return this.drizzle
        .update(templateFiles)
        .set({ content, fileType })
        .where(and(eq(templateFiles.templateId, templateId), eq(templateFiles.filePath, filePath)))
        .returning()
        .get() as TemplateFile | undefined;
    }

    return this.drizzle
      .insert(templateFiles)
      .values({ templateId, filePath, content, fileType })
      .returning()
      .get() as TemplateFile | undefined;
  }

  delete(id: string): boolean {
    const result = this.drizzle
      .delete(templates)
      .where(
        and(
          eq(templates.id, id),
          eq(templates.userId, this.userId),
          eq(templates.isBuiltin, false)
        )
      )
      .run();
    return result.changes > 0;
  }

  private ensureBuiltInTemplates(): void {
    for (const definition of builtInTemplateDefinitions()) {
      this.ensureBuiltInTemplate(definition.template, definition.files);
    }
  }

  private ensureBuiltInTemplate(
    builtin: typeof templates.$inferInsert,
    files: Array<typeof templateFiles.$inferInsert>
  ): void {
    const templateId = builtin.id;
    if (!templateId) {
      throw new Error("Built-in template id is required");
    }
    const existing = this.drizzle
      .select()
      .from(templates)
      .where(eq(templates.id, templateId))
      .get();
    if (existing) {
      this.drizzle
        .update(templates)
        .set({
          name: builtin.name ?? "Built-in Template",
          description: builtin.description ?? null,
          version: builtin.version ?? "1.0.0",
          visibility: builtin.visibility ?? "shared",
          status: builtin.status ?? "active"
        })
        .where(eq(templates.id, templateId))
        .run();
      for (const file of files) {
        this.upsertBuiltInFile(file);
      }
      this.deleteStaleBuiltInFiles(templateId, files.map((file) => file.filePath));
      return;
    }

    this.drizzle.insert(templates).values(builtin).run();
    for (const file of files) {
      this.drizzle.insert(templateFiles).values(file).run();
    }
  }

  private upsertBuiltInFile(file: typeof templateFiles.$inferInsert): void {
    const existing = this.drizzle
      .select()
      .from(templateFiles)
      .where(
        and(
          eq(templateFiles.templateId, file.templateId),
          eq(templateFiles.filePath, file.filePath)
        )
      )
      .get();
    if (existing) {
      this.drizzle
        .update(templateFiles)
        .set({ content: file.content, fileType: file.fileType })
        .where(
          and(
            eq(templateFiles.templateId, file.templateId),
            eq(templateFiles.filePath, file.filePath)
          )
        )
        .run();
      return;
    }
    this.drizzle.insert(templateFiles).values(file).run();
  }

  private deleteStaleBuiltInFiles(templateId: string, expectedFilePaths: string[]): void {
    if (expectedFilePaths.length === 0) return;
    this.drizzle
      .delete(templateFiles)
      .where(
        and(
          eq(templateFiles.templateId, templateId),
          notInArray(templateFiles.filePath, expectedFilePaths)
        )
      )
      .run();
  }

  private getOwnedCustomTemplate(id: string): Template | undefined {
    return this.drizzle
      .select()
      .from(templates)
      .where(
        and(
          eq(templates.id, id),
          eq(templates.userId, this.userId),
          eq(templates.isBuiltin, false)
        )
      )
      .get() as Template | undefined;
  }

  private readableVisibility(includeBuiltIn = false) {
    const base = [
      eq(templates.userId, this.userId),
      eq(templates.visibility, "shared")
    ];
    if (includeBuiltIn) {
      base.unshift(eq(templates.isBuiltin, true));
    }
    if (this.isAdminUser()) {
      base.push(eq(templates.visibility, "admin"));
    }
    return or(...base);
  }

  private isAdminUser(): boolean {
    const user = this.drizzle
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, this.userId))
      .get() as { role: string } | undefined;
    return user?.role === "admin";
  }

  private recordVersionSnapshot(templateId: string, action: string): void {
    const template = this.getById(templateId);
    if (!template || template.isBuiltin || template.userId !== this.userId) {
      return;
    }

    const snapshot: TemplatePackage = {
      name: template.name,
      description: template.description,
      version: template.version,
      files: (template.files ?? []).map((file) => ({
        filePath: file.filePath,
        content: file.content,
        fileType: file.fileType
      })),
      exportedAt: new Date().toISOString()
    };

    this.drizzle
      .insert(auditLogs)
      .values({
        userId: this.userId,
        action,
        resourceType: "template_version",
        resourceId: templateId,
        details: JSON.stringify(snapshot)
      })
      .run();
  }
}
