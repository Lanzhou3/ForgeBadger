import { homedir } from "node:os";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { safeResolve, validateProjectRoot } from "../lib/safe-resolve.js";
import type { AdapterId } from "./adapter-discovery.js";

export interface ProjectAiConfigFile {
  relativePath: string;
  scope: "project" | "global";
  role: "instructions" | "settings" | "agent" | "command" | "skill" | "hook" | "other";
  fileType: string;
  exists: boolean;
  editable: boolean;
  content: string;
  sizeBytes: number;
}

export interface AiConfigForm {
  filePath: string;
  title: string;
  fields: Array<{
    key: string;
    label: string;
    inputType: "text" | "textarea" | "select" | "number" | "boolean" | "list";
    path: string;
    options?: string[] | undefined;
  }>;
}

export interface ProjectAiConfigSnapshot {
  adapter: AdapterId;
  projectRoot: string;
  files: ProjectAiConfigFile[];
  forms: AiConfigForm[];
}

const maxConfigFileBytes = 128 * 1024;
const maxConfigWriteBytes = 128 * 1024;
const maxDiscoveredFiles = 100;
const maxDiscoveryDepth = 8;

const allowedRootFiles = new Set([
  "AGENTS.md",
  "AGENTS.override.md",
  "CLAUDE.md",
  "opencode.json",
  "opencode.jsonc"
]);

const allowedConfigRoots = [".claude", ".opencode", ".codex"];

export async function readProjectAiConfig(
  projectRoot: string,
  adapter: AdapterId
): Promise<ProjectAiConfigSnapshot> {
  const approvedRoot = validateProjectRoot(projectRoot);
  const candidates = new Set([
    ...candidateFilesForAdapter(adapter),
    ...(await discoverExistingConfigFiles(approvedRoot))
  ]);
  const files = await Promise.all([...candidates].sort().map((relativePath) => readProjectConfigFile(approvedRoot, relativePath)));

  return {
    adapter,
    projectRoot: approvedRoot,
    files,
    forms: formsForAdapter(adapter)
  };
}

export async function readGlobalAiConfig(adapter: AdapterId): Promise<ProjectAiConfigSnapshot> {
  const root = globalConfigRoot(adapter);
  const candidates = candidateGlobalFilesForAdapter(adapter);
  const files = await Promise.all(candidates.map((relativePath) => readConfigFile(root, relativePath, {
    scope: "global",
    editable: false,
    redact: true,
    validateRoot: false
  })));

  return {
    adapter,
    projectRoot: root,
    files,
    forms: formsForAdapter(adapter)
  };
}

export async function writeProjectAiConfigFile(
  projectRoot: string,
  relativePath: string,
  content: string,
  adapter: AdapterId
): Promise<ProjectAiConfigSnapshot> {
  if (!isAllowedProjectConfigPath(relativePath)) {
    throw new Error("Unsupported project config path");
  }
  if (Buffer.byteLength(content, "utf8") > maxConfigWriteBytes) {
    throw new Error(`Project config file exceeds maximum size: ${maxConfigWriteBytes} bytes`);
  }

  const approvedRoot = validateProjectRoot(projectRoot);
  const absolutePath = safeResolve(approvedRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");

  return readProjectAiConfig(approvedRoot, adapter);
}

function candidateFilesForAdapter(adapter: AdapterId): string[] {
  if (adapter === "claude") {
    return [
      "CLAUDE.md",
      ".claude/CLAUDE.md",
      ".claude/settings.json",
      ".claude/settings.local.json",
      ".claude/hooks/openforge-guard.mjs"
    ];
  }
  if (adapter === "opencode") {
    return [
      "AGENTS.md",
      "opencode.json",
      "opencode.jsonc",
      ".opencode/agents/code-reviewer.md",
      ".opencode/commands/review.md",
      ".opencode/commands/verify.md"
    ];
  }
  return [
    "AGENTS.md",
    "AGENTS.override.md",
    ".codex/config.toml",
    ".codex/agents/code-reviewer.md",
    ".codex/agents/planner.md"
  ];
}

async function discoverExistingConfigFiles(projectRoot: string): Promise<string[]> {
  const found: string[] = [];
  for (const rootFile of allowedRootFiles) {
    if (await isFile(safeResolve(projectRoot, rootFile))) {
      found.push(rootFile);
    }
  }
  for (const root of allowedConfigRoots) {
    const rootPath = safeResolve(projectRoot, root);
    if (await isDirectory(rootPath)) {
      await walkConfigTree(projectRoot, root, 0, found);
    }
  }
  return found;
}

async function walkConfigTree(
  projectRoot: string,
  relativeDir: string,
  depth: number,
  found: string[]
): Promise<void> {
  if (depth > maxDiscoveryDepth || found.length >= maxDiscoveredFiles) {
    return;
  }

  const directory = safeResolve(projectRoot, relativeDir);
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (found.length >= maxDiscoveredFiles) {
      return;
    }

    const relativePath = path.posix.join(relativeDir, entry.name);
    const absolutePath = safeResolve(projectRoot, relativePath);
    if (entry.isDirectory()) {
      await walkConfigTree(projectRoot, relativePath, depth + 1, found);
      continue;
    }
    if (entry.isFile()) {
      found.push(relativePath);
    }
  }
}

async function readProjectConfigFile(projectRoot: string, relativePath: string): Promise<ProjectAiConfigFile> {
  return readConfigFile(projectRoot, relativePath, {
    scope: "project",
    editable: true,
    redact: false,
    validateRoot: true
  });
}

async function readConfigFile(
  projectRoot: string,
  relativePath: string,
  options: {
    scope: "project" | "global";
    editable: boolean;
    redact: boolean;
    validateRoot: boolean;
  }
): Promise<ProjectAiConfigFile> {
  const base = {
    relativePath,
    scope: options.scope,
    role: roleFor(relativePath),
    fileType: fileTypeFor(relativePath),
    editable: options.editable
  };

  if (options.scope === "project" && !isAllowedProjectConfigPath(relativePath)) {
    return {
      ...base,
      exists: false,
      content: "",
      sizeBytes: 0
    };
  }

  const absolutePath = options.validateRoot
    ? safeResolve(projectRoot, relativePath)
    : path.resolve(projectRoot, relativePath);
  try {
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      return {
        ...base,
        exists: false,
        content: "",
        sizeBytes: 0
      };
    }
    if (fileStat.size > maxConfigFileBytes) {
      return {
        ...base,
        exists: true,
        content: "",
        sizeBytes: fileStat.size
      };
    }
    return {
      ...base,
      exists: true,
      content: options.redact
        ? redactSensitiveContent(await readFile(absolutePath, "utf8"))
        : await readFile(absolutePath, "utf8"),
      sizeBytes: fileStat.size
    };
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return {
        ...base,
        exists: false,
        content: "",
        sizeBytes: 0
      };
    }
    throw error;
  }
}

function globalConfigRoot(adapter: AdapterId): string {
  if (adapter === "claude") {
    return process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(homedir(), ".claude");
  }
  if (adapter === "opencode") {
    return process.env.OPENCODE_CONFIG_DIR?.trim() ||
      path.join(process.env.XDG_CONFIG_HOME?.trim() || path.join(homedir(), ".config"), "opencode");
  }
  return process.env.CODEX_HOME?.trim() || path.join(homedir(), ".codex");
}

function candidateGlobalFilesForAdapter(adapter: AdapterId): string[] {
  if (adapter === "claude") {
    return ["CLAUDE.md", "settings.json", "settings.local.json"];
  }
  if (adapter === "opencode") {
    return ["AGENTS.md", "opencode.json", "opencode.jsonc"];
  }
  return ["AGENTS.md", "AGENTS.override.md", "config.toml"];
}

function formsForAdapter(adapter: AdapterId): AiConfigForm[] {
  if (adapter === "claude") {
    return [
      {
        filePath: ".claude/settings.json",
        title: "Claude Code Settings",
        fields: [
          { key: "permissions.allow", label: "Allowed Tools", inputType: "list", path: "permissions.allow" },
          { key: "permissions.deny", label: "Denied Tools", inputType: "list", path: "permissions.deny" },
          { key: "hooks.PermissionRequest", label: "Permission Request Hooks", inputType: "textarea", path: "hooks.PermissionRequest" }
        ]
      },
      {
        filePath: "CLAUDE.md",
        title: "Claude Instructions",
        fields: [
          { key: "content", label: "Instructions", inputType: "textarea", path: "$content" }
        ]
      }
    ];
  }
  if (adapter === "opencode") {
    return [
      {
        filePath: "opencode.json",
        title: "OpenCode Config",
        fields: [
          { key: "model", label: "Default Model", inputType: "text", path: "model" },
          { key: "default_agent", label: "Default Agent", inputType: "text", path: "default_agent" },
          { key: "share", label: "Sharing", inputType: "select", path: "share", options: ["manual", "auto", "disabled"] },
          { key: "instructions", label: "Instruction Files", inputType: "list", path: "instructions" }
        ]
      },
      {
        filePath: "AGENTS.md",
        title: "OpenCode Instructions",
        fields: [
          { key: "content", label: "Instructions", inputType: "textarea", path: "$content" }
        ]
      }
    ];
  }
  return [
    {
      filePath: ".codex/config.toml",
      title: "Codex Config",
      fields: [
        { key: "model", label: "Default Model", inputType: "text", path: "model" },
        {
          key: "approval_policy",
          label: "Approval Policy",
          inputType: "select",
          path: "approval_policy",
          options: ["untrusted", "on-request", "on-failure", "never"]
        },
        {
          key: "sandbox_mode",
          label: "Sandbox Mode",
          inputType: "select",
          path: "sandbox_mode",
          options: ["read-only", "workspace-write", "danger-full-access"]
        },
        { key: "project_doc_max_bytes", label: "Project Doc Max Bytes", inputType: "number", path: "project_doc_max_bytes" },
        { key: "features.web_search_request", label: "Web Search", inputType: "boolean", path: "features.web_search_request" }
      ]
    },
    {
      filePath: "AGENTS.md",
      title: "Codex Instructions",
      fields: [
        { key: "content", label: "Instructions", inputType: "textarea", path: "$content" }
      ]
    }
  ];
}

function redactSensitiveContent(content: string): string {
  return content
    .replace(/("(?:api[_-]?key|token|secret|password|authorization)"\s*:\s*")[^"]*(")/giu, "$1[REDACTED]$2")
    .replace(/^(\s*(?:api[_-]?key|token|secret|password|authorization)\s*=\s*).+$/gimu, "$1\"[REDACTED]\"")
    .replace(/((?:sk|pk|rk)-[A-Za-z0-9_-]{8,})/gu, "[REDACTED]");
}

function isAllowedProjectConfigPath(relativePath: string): boolean {
  if (allowedRootFiles.has(relativePath)) {
    return true;
  }
  return allowedConfigRoots.some((root) => relativePath.startsWith(`${root}/`));
}

function roleFor(relativePath: string): ProjectAiConfigFile["role"] {
  if (relativePath === "AGENTS.md" || relativePath === "AGENTS.override.md" || relativePath.endsWith("CLAUDE.md")) {
    return "instructions";
  }
  if (relativePath.includes("/agents/")) return "agent";
  if (relativePath.includes("/commands/")) return "command";
  if (relativePath.includes("/skills/")) return "skill";
  if (relativePath.includes("/hooks/")) return "hook";
  if (relativePath.endsWith(".json") || relativePath.endsWith(".jsonc") || relativePath.endsWith(".toml")) {
    return "settings";
  }
  return "other";
}

function fileTypeFor(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".md") return "markdown";
  if (extension === ".json" || extension === ".jsonc") return "json";
  if (extension === ".toml") return "toml";
  if (extension === ".yaml" || extension === ".yml") return "yaml";
  if ([".js", ".mjs", ".cjs", ".ts"].includes(extension)) return "javascript";
  return "text";
}

async function isFile(pathname: string): Promise<boolean> {
  try {
    return (await stat(pathname)).isFile();
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

async function isDirectory(pathname: string): Promise<boolean> {
  try {
    return (await stat(pathname)).isDirectory();
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}
