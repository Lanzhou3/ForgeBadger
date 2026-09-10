import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { CreateSkillInput, Skill, SkillRepository } from "../db/repositories/skill-repository.js";
import { expandUserPath } from "../lib/user-path.js";

export interface DiscoveredLocalSkill {
  name: string;
  description?: string | undefined;
  source: "local";
  content: string;
  version: string;
  path: string;
  root: string;
}

export interface DiscoverLocalSkillsOptions {
  roots?: string[] | undefined;
  cwd?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  maxFiles?: number | undefined;
}

export interface LocalSkillSyncResult {
  roots: string[];
  discoveredRoots: string[];
  discoveredCount: number;
  createdCount: number;
  updatedCount: number;
  deletedCount: number;
  skippedCount: number;
}

const maxSkillBytes = 128 * 1024;
const maxSkillDepth = 8;

export function discoverLocalSkills(options: DiscoverLocalSkillsOptions = {}): DiscoveredLocalSkill[] {
  const roots = options.roots ?? defaultLocalSkillRoots(options.cwd ?? process.cwd(), options.env ?? process.env);
  const maxFiles = options.maxFiles ?? 2000;
  const seenPaths = new Set<string>();
  const seenNames = new Set<string>();
  const discovered: DiscoveredLocalSkill[] = [];

  for (const root of roots) {
    const realRoot = safeRealpath(expandHome(root)) ?? root;
    for (const filePath of findSkillFiles(root, maxFiles - discovered.length)) {
      if (discovered.length >= maxFiles) break;
      const realPath = safeRealpath(filePath);
      if (!realPath || seenPaths.has(realPath)) continue;
      seenPaths.add(realPath);

      const skill = readSkillFile(realPath);
      if (!skill || seenNames.has(skill.name)) continue;
      seenNames.add(skill.name);
      discovered.push({
        ...skill,
        path: realPath,
        root: realRoot
      });
    }
  }

  return discovered;
}

export function syncLocalSkills(
  repo: Pick<SkillRepository, "create" | "getByName" | "update">,
  options: DiscoverLocalSkillsOptions = {}
): LocalSkillSyncResult {
  const roots = options.roots ?? defaultLocalSkillRoots(options.cwd ?? process.cwd(), options.env ?? process.env);
  const discovered = discoverLocalSkills({ ...options, roots });
  const result: LocalSkillSyncResult = {
    roots,
    discoveredRoots: uniqueRoots(discovered.map((skill) => skill.root)),
    discoveredCount: discovered.length,
    createdCount: 0,
    updatedCount: 0,
    deletedCount: 0,
    skippedCount: 0
  };

  for (const skill of discovered) {
    const existing = repo.getByName(skill.name);
    if (!existing) {
      repo.create(skill);
      result.createdCount += 1;
      continue;
    }
    if (existing.source !== "local") {
      result.skippedCount += 1;
      continue;
    }
    if (!skillChanged(existing, skill)) {
      result.skippedCount += 1;
      continue;
    }
    repo.update(existing.id, {
      description: skill.description,
      source: skill.source,
      content: skill.content,
      version: skill.version
    });
    result.updatedCount += 1;
  }

  return result;
}

export function defaultLocalSkillRoots(cwd: string, env: NodeJS.ProcessEnv): string[] {
  const claudeConfigDir = expandConfiguredHome(
    env.CLAUDE_CONFIG_DIR?.trim() || path.join(homedir(), ".claude")
  );
  const agentsHome = expandConfiguredHome(
    env.AGENTS_HOME?.trim() || path.join(homedir(), ".agents")
  );
  const configuredRoots = (env.FORGEBADGER_SKILL_DIRS ?? "")
    .split(path.delimiter)
    .map((root) => root.trim())
    .filter(Boolean)
    .map((root) => path.resolve(cwd, expandConfiguredHome(root)));

  return uniqueRoots([
    path.resolve(cwd, claudeConfigDir, "skills"),
    path.resolve(cwd, agentsHome, "skills"),
    ...configuredRoots
  ]);
}

function expandConfiguredHome(value: string): string {
  return expandUserPath(value);
}

function skillChanged(existing: Skill, incoming: CreateSkillInput): boolean {
  return (
    existing.description !== (incoming.description ?? null) ||
    existing.source !== (incoming.source ?? "local") ||
    existing.content !== incoming.content ||
    existing.version !== (incoming.version ?? "1.0.0")
  );
}

function findSkillFiles(root: string, limit: number): string[] {
  const resolvedRoot = safeRealpath(expandHome(root));
  if (!resolvedRoot || limit <= 0) return [];
  const stats = safeStat(resolvedRoot);
  if (!stats?.isDirectory()) return [];

  const files: string[] = [];
  walk(resolvedRoot, 0, files, limit, new Set<string>());
  return files;
}

function walk(current: string, depth: number, files: string[], limit: number, visitedDirs: Set<string>): void {
  if (files.length >= limit || depth > maxSkillDepth) return;
  const realCurrent = safeRealpath(current);
  if (!realCurrent || visitedDirs.has(realCurrent)) return;
  visitedDirs.add(realCurrent);

  for (const entry of safeReadDir(current)) {
    if (files.length >= limit) break;
    const fullPath = path.join(current, entry.name);
    const realPath = safeRealpath(fullPath);
    if (!realPath) continue;
    const stats = safeStat(realPath);

    if (stats?.isDirectory()) {
      walk(realPath, depth + 1, files, limit, visitedDirs);
      continue;
    }

    if (!stats?.isFile()) continue;
    if (isSkillMarkdownFile(entry.name)) {
      files.push(realPath);
    }
  }
}

function isSkillMarkdownFile(fileName: string): boolean {
  if (fileName === "SKILL.md") return true;
  return false;
}

function readSkillFile(filePath: string): Omit<DiscoveredLocalSkill, "path" | "root"> | undefined {
  const stats = safeStat(filePath);
  if (!stats?.isFile() || stats.size <= 0 || stats.size > maxSkillBytes) {
    return undefined;
  }

  const content = readFileSync(filePath, "utf8");
  const frontmatter = parseFrontmatter(content);
  const fallbackName = path.basename(filePath) === "SKILL.md"
    ? path.basename(path.dirname(filePath))
    : path.basename(filePath, ".md");
  const name = normalizeName(frontmatter.name ?? fallbackName);
  if (!name) return undefined;

  return {
    name,
    description: frontmatter.description ?? firstMarkdownDescription(content),
    source: "local",
    content,
    version: frontmatter.version ?? "1.0.0"
  };
}

function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith("---\n")) return {};
  const end = content.indexOf("\n---", 4);
  if (end === -1) return {};

  const result: Record<string, string> = {};
  const body = content.slice(4, end);
  for (const line of body.split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && value) result[key] = value;
  }
  return result;
}

function firstMarkdownDescription(content: string): string | undefined {
  const line = content
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value.length > 0 && !value.startsWith("#") && value !== "---");
  return line?.slice(0, 240);
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function expandHome(value: string): string {
  return expandUserPath(value);
}

function uniqueRoots(roots: string[]): string[] {
  const seen = new Set<string>();
  return roots.filter((root) => {
    if (seen.has(root)) return false;
    seen.add(root);
    return true;
  });
}

function safeRealpath(value: string): string | undefined {
  try {
    return realpathSync(value);
  } catch {
    return undefined;
  }
}

function safeStat(value: string) {
  try {
    return statSync(value);
  } catch {
    return undefined;
  }
}

function safeReadDir(value: string) {
  try {
    return readdirSync(value, { withFileTypes: true });
  } catch {
    return [];
  }
}
