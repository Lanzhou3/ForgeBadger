import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { normalizeName } from "./local-skills.js";
import type { SkillRemoteProvenance } from "./github-skill-source.js";

/**
 * Filesystem installation of remote Skills into `${AGENTS_HOME}/skills`.
 * Every managed install carries a `.forgebadger-managed.json` marker; update
 * and removal refuse to touch directories without that marker so a user's own
 * Skill directory is never deleted by ForgeBadger. All writes are atomic
 * (temp file + rename) and validated to stay inside the skills root.
 */

const managedMarkerFile = ".forgebadger-managed.json";
const managedMarkerVersion = 1;

export interface ManagedSkillMarker {
  managedBy: "forgebadger";
  markerVersion: number;
  name: string;
  installedAt: string;
  provenance: SkillRemoteProvenance;
}

export interface InstallSkillToAgentsHomeInput {
  name: string;
  content: string;
  provenance: SkillRemoteProvenance;
}

export interface ManagedSkillInstallResult {
  dir: string;
  skillPath: string;
  markerPath: string;
  name: string;
}

export function installSkillToAgentsHome(
  input: InstallSkillToAgentsHomeInput,
  env: NodeJS.ProcessEnv = process.env
): ManagedSkillInstallResult {
  const slug = normalizeName(input.name);
  if (!slug) {
    throw new Error("Skill name is invalid for filesystem install");
  }
  const layout = resolveManagedLayout(slug, env, { createRoot: true });
  mkdirSync(layout.dir, { recursive: true });
  atomicWrite(path.join(layout.dir, "SKILL.md"), input.content);
  writeManagedMarker(layout, slug, input.provenance);
  return {
    dir: layout.dir,
    skillPath: path.join(layout.dir, "SKILL.md"),
    markerPath: layout.markerPath,
    name: slug
  };
}

export function updateManagedSkillFile(
  name: string,
  content: string,
  provenance: SkillRemoteProvenance,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const slug = normalizeName(name);
  if (!slug) return false;
  const layout = resolveManagedLayout(slug, env, { createRoot: false });
  const marker = readManagedMarker(layout.markerPath);
  if (!marker) return false;
  atomicWrite(path.join(layout.dir, "SKILL.md"), content);
  writeManagedMarker(layout, slug, provenance);
  return true;
}

export function removeManagedSkill(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const slug = normalizeName(name);
  if (!slug) return false;
  const layout = resolveManagedLayout(slug, env, { createRoot: false });
  const marker = readManagedMarker(layout.markerPath);
  if (!marker) return false;
  // Re-validate after marker check: the directory may have been swapped for a
  // symlink since layout resolution.
  const realDir = safeRealpath(layout.dir);
  if (!realDir || realDir !== layout.expectedDir || !isInsideRoot(realDir, layout.realRoot)) {
    return false;
  }
  rmSync(layout.dir, { recursive: true, force: true });
  return true;
}

export function isManagedSkill(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const slug = normalizeName(name);
  if (!slug) return false;
  const layout = resolveManagedLayout(slug, env, { createRoot: false });
  return readManagedMarker(layout.markerPath) !== undefined;
}

export function defaultAgentsSkillsRoot(env: NodeJS.ProcessEnv = process.env): string {
  const agentsHome = env.AGENTS_HOME?.trim() || path.join(homedir(), ".agents");
  return path.join(agentsHome, "skills");
}

interface ManagedLayout {
  root: string;
  realRoot: string;
  dir: string;
  expectedDir: string;
  markerPath: string;
}

function resolveManagedLayout(
  slug: string,
  env: NodeJS.ProcessEnv,
  options: { createRoot: boolean }
): ManagedLayout {
  if (path.isAbsolute(slug) || slug.includes("/") || slug.includes("\\") || slug === ".." || slug === ".") {
    throw new Error("Skill name is invalid for filesystem install");
  }
  const root = defaultAgentsSkillsRoot(env);
  if (options.createRoot) {
    mkdirSync(root, { recursive: true });
  }
  const realRoot = safeRealpath(root);
  if (!realRoot) {
    throw new Error(`Skills directory does not exist: ${root}`);
  }
  const dir = path.join(root, slug);
  if (existsSync(dir)) {
    const realDir = safeRealpath(dir);
    if (!realDir || !isInsideRoot(realDir, realRoot)) {
      throw new Error(`Skill directory escapes the skills root: ${slug}`);
    }
  }
  return {
    root,
    realRoot,
    dir,
    expectedDir: path.join(realRoot, slug),
    markerPath: path.join(dir, managedMarkerFile)
  };
}

function writeManagedMarker(layout: ManagedLayout, name: string, provenance: SkillRemoteProvenance): void {
  const marker: ManagedSkillMarker = {
    managedBy: "forgebadger",
    markerVersion: managedMarkerVersion,
    name,
    installedAt: new Date().toISOString(),
    provenance
  };
  atomicWrite(layout.markerPath, `${JSON.stringify(marker, null, 2)}\n`);
}

function readManagedMarker(markerPath: string): ManagedSkillMarker | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(markerPath, "utf8"));
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const record = parsed as Partial<ManagedSkillMarker>;
  if (record.managedBy !== "forgebadger" || typeof record.name !== "string" || !record.provenance) {
    return undefined;
  }
  return parsed as ManagedSkillMarker;
}

function atomicWrite(filePath: string, content: string): void {
  const tempPath = `${filePath}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  try {
    writeFileSync(tempPath, content, { encoding: "utf8", mode: 0o600 });
    renameSync(tempPath, filePath);
  } catch (error) {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // Best-effort temp cleanup; the original error matters more.
    }
    throw error;
  }
}

function safeRealpath(value: string): string | undefined {
  try {
    return realpathSync(value);
  } catch {
    return undefined;
  }
}

function isInsideRoot(target: string, root: string): boolean {
  return target === root || target.startsWith(root + path.sep);
}
