import { homedir } from "node:os";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
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

export interface ProjectAiConfigSnapshot {
  adapter: AdapterId;
  projectRoot: string;
  files: ProjectAiConfigFile[];
}

const maxConfigFileBytes = 128 * 1024;
const maxConfigWriteBytes = 128 * 1024;

const allowedRootFiles = new Set([
  "AGENTS.md",
  "AGENTS.override.md",
  "CLAUDE.md",
  "opencode.json",
  "opencode.jsonc"
]);

export async function readProjectAiConfig(
  projectRoot: string,
  adapter: AdapterId
): Promise<ProjectAiConfigSnapshot> {
  const approvedRoot = validateProjectRoot(projectRoot);
  const discoveredFiles = await discoverExistingConfigFiles(approvedRoot);
  const candidates = new Set(projectCandidateFilesForAdapter(adapter, discoveredFiles));
  const files = await Promise.all([...candidates].sort().map((relativePath) => readProjectConfigFile(approvedRoot, relativePath)));

  return {
    adapter,
    projectRoot: approvedRoot,
    files
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
    files
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

function projectCandidateFilesForAdapter(adapter: AdapterId, discoveredFiles: string[]): string[] {
  const candidates = new Set(discoveredFiles);

  if (adapter === "claude") {
    if (!hasInstructionFile(discoveredFiles, adapter)) {
      candidates.add("CLAUDE.md");
    }
    return [...candidates];
  }

  for (const relativePath of candidateFilesForAdapter(adapter)) {
    candidates.add(relativePath);
  }
  return [...candidates];
}

function hasInstructionFile(files: string[], adapter: AdapterId): boolean {
  const instructionFiles = new Set(primaryInstructionFilesForAdapter(adapter));
  return files.some((file) => instructionFiles.has(file));
}

function primaryInstructionFilesForAdapter(adapter: AdapterId): string[] {
  if (adapter === "claude") return ["CLAUDE.md"];
  return ["AGENTS.md"];
}

function candidateFilesForAdapter(adapter: AdapterId): string[] {
  if (adapter === "claude") {
    return ["CLAUDE.md"];
  }
  if (adapter === "opencode") {
    return [
      "AGENTS.md",
      "opencode.json",
      "opencode.jsonc"
    ];
  }
  if (adapter === "kimi") {
    return ["AGENTS.md"];
  }
  return [
    "AGENTS.md",
    "AGENTS.override.md"
  ];
}

async function discoverExistingConfigFiles(projectRoot: string): Promise<string[]> {
  const found: string[] = [];
  for (const rootFile of allowedRootFiles) {
    if (await isFile(safeResolve(projectRoot, rootFile))) {
      found.push(rootFile);
    }
  }
  return found;
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
  if (adapter === "kimi") {
    return process.env.KIMI_CODE_HOME?.trim() || path.join(homedir(), ".kimi-code");
  }
  return process.env.CODEX_HOME?.trim() || path.join(homedir(), ".codex");
}

function candidateGlobalFilesForAdapter(adapter: AdapterId): string[] {
  if (adapter === "claude") {
    return ["settings.json"];
  }
  if (adapter === "opencode") {
    return ["AGENTS.md", "opencode.json", "opencode.jsonc"];
  }
  if (adapter === "kimi") {
    return ["AGENTS.md", "config.toml", "mcp.json"];
  }
  return ["AGENTS.md", "AGENTS.override.md", "config.toml"];
}

function redactSensitiveContent(content: string): string {
  return content
    .replace(/("(?:api[_-]?key|token|secret|password|authorization)"\s*:\s*")[^"]*(")/giu, "$1[REDACTED]$2")
    .replace(/^(\s*(?:api[_-]?key|token|secret|password|authorization)\s*=\s*).+$/gimu, "$1\"[REDACTED]\"")
    .replace(/((?:sk|pk|rk)-[A-Za-z0-9_-]{8,})/gu, "[REDACTED]");
}

function isAllowedProjectConfigPath(relativePath: string): boolean {
  return allowedRootFiles.has(relativePath);
}

function roleFor(relativePath: string): ProjectAiConfigFile["role"] {
  if (relativePath === "AGENTS.md" || relativePath === "AGENTS.override.md") {
    return "instructions";
  }
  if (relativePath.endsWith("CLAUDE.md")) return "instructions";
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

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}
