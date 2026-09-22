import { SkillRepository, type Skill } from "../db/repositories/skill-repository.js";
import type { Database } from "../db/types.js";
import {
  computeContentHash,
  fetchSkillFile,
  parseGitHubSkillLocator,
  parseSkillMarkdownFrontmatter,
  parseSkillRemoteProvenance,
  resolveGitHubRef,
  serializeSkillRemoteProvenance,
  type GitHubRequestOptions,
  type SkillRemoteProvenance
} from "./github-skill-source.js";
import { normalizeName } from "./local-skills.js";
import { installSkillToAgentsHome, removeManagedSkill, updateManagedSkillFile } from "./skill-fs-install.js";

/**
 * Shared orchestration for remote Skill installs: resolve a GitHub repo to a
 * pinned commit, fetch the single-file SKILL.md, create the tenant-owned Skill
 * row with remote provenance, and mirror the file into AGENTS_HOME. Used by
 * both the /skills/install/github route and marketplace catalog installs.
 */

export class SkillInstallConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillInstallConflictError";
  }
}

export class SkillNotRemoteError extends Error {
  constructor() {
    super("Skill is not a remote Skill");
    this.name = "SkillNotRemoteError";
  }
}

export interface InstallRemoteSkillInput extends GitHubRequestOptions {
  db: Database;
  userId: string;
  /** Plain `owner/repo`; the Skill path is passed separately. */
  repo: string;
  /** SKILL.md path or the directory that contains it. */
  path: string;
  ref?: string | undefined;
  /** Pinned commit SHA (marketplace items); when omitted the ref is resolved. */
  sha?: string | undefined;
  kind: "github" | "marketplace";
  /** Value stored in the Skill `source` column. */
  source: string;
  marketplaceSourceId?: string | undefined;
  pluginName?: string | undefined;
  enable?: boolean | undefined;
}

export interface InstallRemoteSkillResult {
  skill: Skill;
  provenance: SkillRemoteProvenance;
  installedToAgentsHome: boolean;
}

export interface RemoteSkillUpdateCheck {
  skillId: string;
  name: string;
  kind: "github" | "marketplace";
  currentSha: string;
  latestSha: string;
  updateAvailable: boolean;
  checkedAt: string;
  error?: string | undefined;
}

export async function installRemoteSkill(input: InstallRemoteSkillInput): Promise<InstallRemoteSkillResult> {
  const {
    db,
    userId,
    repo,
    path,
    ref,
    sha,
    kind,
    source,
    marketplaceSourceId,
    pluginName,
    enable,
    ...requestOptions
  } = input;
  const locator = parseGitHubSkillLocator(repo);
  if (locator.subpath || locator.ref) {
    throw new Error("Install repo must use the plain owner/repo format; pass the Skill path separately");
  }
  const skillFilePath = toSkillFilePath(path);

  let resolvedSha = sha;
  let resolvedRef = ref;
  if (!resolvedSha) {
    const resolved = await resolveGitHubRef({
      owner: locator.owner,
      repo: locator.repo,
      ...(ref ? { ref } : {}),
      ...requestOptions
    });
    resolvedSha = resolved.sha;
    resolvedRef = resolved.ref;
  }
  const file = await fetchSkillFile({
    owner: locator.owner,
    repo: locator.repo,
    sha: resolvedSha,
    path: skillFilePath,
    ...requestOptions
  });
  const frontmatter = parseSkillMarkdownFrontmatter(file.content);
  const name = resolveSkillName(file.content, skillFilePath, locator.repo);
  const skillRepo = new SkillRepository(db, userId);
  if (skillRepo.getByName(name)) {
    throw new SkillInstallConflictError(`Skill "${name}" already exists`);
  }

  const provenance: SkillRemoteProvenance = {
    kind,
    repo: `${locator.owner}/${locator.repo}`,
    path: skillFilePath,
    resolvedCommitSha: resolvedSha,
    contentHash: computeContentHash(file.content),
    installedAt: new Date().toISOString()
  };
  if (resolvedRef) provenance.ref = resolvedRef;
  if (marketplaceSourceId) provenance.marketplaceSourceId = marketplaceSourceId;
  if (pluginName) provenance.pluginName = pluginName;

  const installed = installSkillToAgentsHome({ name, content: file.content, provenance }, requestOptions.env);
  try {
    const skill = skillRepo.create({
      name,
      description: frontmatter.description,
      source,
      content: file.content,
      version: frontmatter.version ?? "1.0.0",
      isEnabled: enable ?? false,
      remoteProvenance: serializeSkillRemoteProvenance(provenance)
    });
    return { skill, provenance, installedToAgentsHome: true };
  } catch (error) {
    try {
      removeManagedSkill(installed.name, requestOptions.env);
    } catch {
      // Best-effort rollback; the original error is what the user sees.
    }
    throw error;
  }
}

export async function checkRemoteSkillUpdate(
  input: { db: Database; userId: string; skill: Skill } & GitHubRequestOptions
): Promise<RemoteSkillUpdateCheck> {
  const { db, userId, skill, ...requestOptions } = input;
  const provenance = requireProvenance(skill);
  const locator = parseGitHubSkillLocator(provenance.repo);
  const resolved = await resolveGitHubRef({
    owner: locator.owner,
    repo: locator.repo,
    ...(provenance.ref ? { ref: provenance.ref } : {}),
    ...requestOptions
  });
  const checkedAt = new Date().toISOString();
  const updateAvailable = resolved.sha !== provenance.resolvedCommitSha;
  const next: SkillRemoteProvenance = {
    ...provenance,
    lastCheck: { checkedAt, latestCommitSha: resolved.sha, updateAvailable }
  };
  new SkillRepository(db, userId).update(skill.id, {
    remoteProvenance: serializeSkillRemoteProvenance(next)
  });
  const check: RemoteSkillUpdateCheck = {
    skillId: skill.id,
    name: skill.name,
    kind: provenance.kind,
    currentSha: provenance.resolvedCommitSha,
    latestSha: resolved.sha,
    updateAvailable,
    checkedAt
  };
  return check;
}

export async function updateRemoteSkill(
  input: { db: Database; userId: string; skill: Skill } & GitHubRequestOptions
): Promise<{ skill: Skill; provenance: SkillRemoteProvenance }> {
  const { db, userId, skill, ...requestOptions } = input;
  const provenance = requireProvenance(skill);
  const locator = parseGitHubSkillLocator(provenance.repo);
  const resolved = await resolveGitHubRef({
    owner: locator.owner,
    repo: locator.repo,
    ...(provenance.ref ? { ref: provenance.ref } : {}),
    ...requestOptions
  });
  const skillFilePath = toSkillFilePath(provenance.path);
  const file = await fetchSkillFile({
    owner: locator.owner,
    repo: locator.repo,
    sha: resolved.sha,
    path: skillFilePath,
    ...requestOptions
  });
  const frontmatter = parseSkillMarkdownFrontmatter(file.content);
  const name = resolveSkillName(file.content, skillFilePath, locator.repo);
  if (name !== skill.name) {
    throw new Error(`Remote Skill was renamed to "${name}"; uninstall and reinstall it instead`);
  }
  const checkedAt = new Date().toISOString();
  const next: SkillRemoteProvenance = {
    ...provenance,
    resolvedCommitSha: resolved.sha,
    contentHash: computeContentHash(file.content),
    lastCheck: { checkedAt, latestCommitSha: resolved.sha, updateAvailable: false }
  };
  const skillRepo = new SkillRepository(db, userId);
  const updated = skillRepo.update(skill.id, {
    content: file.content,
    version: frontmatter.version ?? skill.version,
    description: frontmatter.description ?? skill.description ?? undefined,
    remoteProvenance: serializeSkillRemoteProvenance(next)
  });
  if (!updated) {
    throw new Error("Skill not found");
  }
  try {
    updateManagedSkillFile(skill.name, file.content, next, requestOptions.env);
  } catch {
    // The database stays authoritative; a missing/unwritable managed directory
    // must not roll back a successful content update.
  }
  return { skill: updated, provenance: next };
}

function requireProvenance(skill: Skill): SkillRemoteProvenance {
  const provenance = parseSkillRemoteProvenance(skill.remoteProvenance);
  if (!provenance) {
    throw new SkillNotRemoteError();
  }
  return provenance;
}

function toSkillFilePath(path: string): string {
  const normalized = path.trim().replace(/^\.\//u, "").replace(/\/+$/u, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.includes("\\") ||
    normalized.includes("\0") ||
    normalized.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error("Skill path is invalid");
  }
  return normalized.endsWith("/SKILL.md") || normalized === "SKILL.md"
    ? normalized
    : `${normalized}/SKILL.md`;
}

function resolveSkillName(content: string, skillFilePath: string, repo: string): string {
  const frontmatter = parseSkillMarkdownFrontmatter(content);
  const fallback = skillFilePath === "SKILL.md"
    ? repo.split("/")[1] ?? repo
    : (skillFilePath.slice(0, skillFilePath.length - "/SKILL.md".length).split("/").pop() ?? repo);
  return normalizeName(frontmatter.name ?? fallback);
}
