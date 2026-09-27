import { randomUUID } from "node:crypto";
import { CliSkillRevisionRepository } from "../db/repositories/cli-skill-revision-repository.js";
import { ProjectRepository } from "../db/repositories/project-repository.js";
import { ProjectSkillRepository } from "../db/repositories/project-skill-repository.js";
import {
  SkillRepository,
  type Skill,
} from "../db/repositories/skill-repository.js";
import { UserRepository } from "../db/repositories/user-repository.js";
import type { Database } from "../db/types.js";
import {
  computeContentHash,
  parseSkillRemoteProvenance,
  type GitHubRequestOptions,
  type SkillRemoteProvenance,
} from "./github-skill-source.js";
import {
  packageResourceManifest,
  parseSkillPackage,
  skillPackageHash,
  storedSkillFiles,
  validateSkillFiles,
  type SkillPackageFile,
} from "./skill-package.js";
import {
  resolveRegistryPackage,
  skillLocatorSchema,
  type RegistryPackage,
  type SkillLocator,
} from "./skill-registry-package.js";

export class SkillLifecycleError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}
export interface SkillFileChange {
  path: string;
  kind: "added" | "removed" | "modified";
  before?: string | undefined;
  after?: string | undefined;
}
export interface SkillInstallPreview extends RegistryPackage {
  token: string;
  expiresAt: string;
  operation: "install" | "update" | "rollback";
  skillId?: string | undefined;
  changes: SkillFileChange[];
}
interface PendingPreview {
  userId: string;
  preview: SkillInstallPreview;
  baseHash?: string | undefined;
  expiresAt: number;
}
const MAX_PREVIEWS = 32;

export class SkillInstallService {
  private readonly pending = new Map<string, PendingPreview>();
  private readonly inflight = new Set<string>();
  constructor(
    private readonly db: Database,
    private readonly options: GitHubRequestOptions = {},
    private readonly now: () => number = Date.now,
  ) {}

  async preview(
    userId: string,
    input: {
      locator?: SkillLocator | undefined;
      skillId?: string | undefined;
      revisionId?: string | undefined;
    },
  ): Promise<SkillInstallPreview> {
    this.assertActive(userId);
    this.prune();
    if (this.inflight.has(userId) || this.inflight.size >= 8)
      throw new SkillLifecycleError(
        "Another Skill preview is running; retry shortly",
        429,
      );
    this.inflight.add(userId);
    try {
      const skill = input.skillId
        ? this.ownedSkill(userId, input.skillId)
        : undefined;
      if (input.revisionId && !skill)
        throw new SkillLifecycleError("A Skill is required for rollback", 400);
      const before = skill ? storedSkillFiles(skill) : [];
      if (skill && !input.revisionId) this.assertUnmodified(skill);
      const operation = input.revisionId
        ? "rollback"
        : skill
          ? "update"
          : "install";
      const resolved =
        input.revisionId && skill
          ? this.revisionPackage(userId, skill, input.revisionId)
          : await resolveRegistryPackage(
              skill
                ? this.locator(skill)
                : skillLocatorSchema.parse(input.locator),
              this.options,
            );
      this.assertActive(userId);
      if (skill && resolved.package.name !== skill.name)
        throw new SkillLifecycleError(
          "Upstream renamed this Skill; install it separately",
        );
      const expiresAt = this.now() + 5 * 60_000;
      const preview: SkillInstallPreview = {
        ...resolved,
        token: randomUUID(),
        expiresAt: new Date(expiresAt).toISOString(),
        operation,
        ...(skill ? { skillId: skill.id } : {}),
        changes: diffFiles(before, resolved.package.files),
      };
      for (const [token, item] of this.pending)
        if (item.userId === userId) this.pending.delete(token);
      while (this.pending.size >= MAX_PREVIEWS)
        this.pending.delete(this.pending.keys().next().value!);
      this.pending.set(preview.token, {
        userId,
        preview,
        expiresAt,
        ...(skill ? { baseHash: this.baseHash(skill) } : {}),
      });
      return preview;
    } finally {
      this.inflight.delete(userId);
    }
  }

  consume(
    userId: string,
    token: string,
    options: {
      skillId?: string | undefined;
      projectId?: string | undefined;
      operation?: "install" | "update" | "rollback" | undefined;
    } = {},
  ): { skill: Skill; projectId?: string | undefined } {
    this.assertActive(userId);
    this.prune();
    const pending = this.pending.get(token);
    if (!pending || pending.userId !== userId)
      throw new SkillLifecycleError(
        "Preview expired or unavailable; preview this Skill again",
      );
    const preview = pending.preview;
    if (
      preview.skillId !== options.skillId ||
      (options.operation && options.operation !== preview.operation)
    )
      throw new SkillLifecycleError("Preview does not match this operation");
    const result = this.db.transaction(() => {
      this.assertActive(userId);
      const repo = new SkillRepository(this.db, userId);
      const existing = preview.skillId
        ? this.ownedSkill(userId, preview.skillId)
        : undefined;
      if (existing && this.baseHash(existing) !== pending.baseHash)
        throw new SkillLifecycleError(
          "Skill changed after preview; review it again",
        );
      if (!existing && repo.getByName(preview.package.name))
        throw new SkillLifecycleError("A Skill with this name already exists");
      if (
        options.projectId &&
        !new ProjectRepository(this.db, userId).getById(options.projectId)
      )
        throw new SkillLifecycleError("Project not found", 404);
      const revisions = new CliSkillRevisionRepository(this.db, userId);
      if (existing && !revisions.list(existing.id).length)
        revisions.create(
          existing.id,
          "legacy",
          this.snapshot(existing),
          skillPackageHash(storedSkillFiles(existing)),
        );
      const pkg = preview.package;
      const main = pkg.files.find((file) => file.path === "SKILL.md")!.content;
      const provenance = this.provenance(preview, existing);
      const data = {
        name: pkg.name,
        description: pkg.description,
        version: pkg.version,
        content: main,
        resourceManifest: packageResourceManifest(pkg, preview.canonicalId),
        remoteProvenance: JSON.stringify(provenance),
        source: `${preview.locator.kind}:${preview.canonicalId.replace(/^[^:]+:/u, "")}`,
      };
      const skill = existing
        ? repo.update(existing.id, data)!
        : repo.create({ ...data, isEnabled: false });
      revisions.create(
        skill.id,
        preview.operation,
        this.snapshot(skill),
        pkg.packageHash,
      );
      if (options.projectId)
        new ProjectSkillRepository(this.db, userId).setSkill(
          options.projectId,
          skill.id,
          true,
        );
      return {
        skill,
        ...(options.projectId ? { projectId: options.projectId } : {}),
      };
    })();
    this.pending.delete(token);
    return result;
  }

  async checkUpdate(userId: string, skillId: string) {
    if (this.inflight.has(userId) || this.inflight.size >= 8)
      throw new SkillLifecycleError(
        "Another Skill request is running; retry shortly",
        429,
      );
    this.inflight.add(userId);
    try {
      return await this.checkUpdatePackage(userId, skillId);
    } finally {
      this.inflight.delete(userId);
    }
  }

  private async checkUpdatePackage(userId: string, skillId: string) {
    this.assertActive(userId);
    const skill = this.ownedSkill(userId, skillId);
    const provenance = parseSkillRemoteProvenance(skill.remoteProvenance)!;
    const resolved = await resolveRegistryPackage(
      this.locator(skill),
      this.options,
    );
    this.assertActive(userId);
    const current = this.ownedSkill(userId, skillId);
    if (this.baseHash(current) !== this.baseHash(skill))
      throw new SkillLifecycleError("Skill changed while checking updates");
    const updateAvailable =
      resolved.package.packageHash !==
      (provenance.packageHash ?? skillPackageHash(storedSkillFiles(skill)));
    const checkedAt = new Date(this.now()).toISOString();
    new SkillRepository(this.db, userId).update(skill.id, {
      remoteProvenance: JSON.stringify({
        ...provenance,
        lastCheck: {
          checkedAt,
          latestCommitSha: resolved.revision,
          updateAvailable,
        },
      }),
    });
    return {
      skillId: skill.id,
      name: skill.name,
      kind: provenance.kind,
      currentSha: provenance.resolvedCommitSha,
      latestSha: resolved.revision,
      updateAvailable,
      checkedAt,
    };
  }

  history(userId: string, skillId: string) {
    this.ownedSkill(userId, skillId);
    return new CliSkillRevisionRepository(this.db, userId)
      .list(skillId)
      .map(({ snapshotJson, ...revision }) => revision);
  }
  private assertActive(userId: string) {
    if (new UserRepository(this.db).findById(userId)?.status !== "active")
      throw new SkillLifecycleError("Skill owner is inactive", 403);
  }
  private ownedSkill(userId: string, id: string): Skill {
    const skill = new SkillRepository(this.db, userId).getOwnedById(id);
    if (!skill) throw new SkillLifecycleError("Skill not found", 404);
    return skill;
  }
  private locator(skill: Skill): SkillLocator {
    const provenance = parseSkillRemoteProvenance(skill.remoteProvenance);
    if (!provenance)
      throw new SkillLifecycleError("This Skill has no remote origin", 400);
    if (provenance.locator) return skillLocatorSchema.parse(provenance.locator);
    if (provenance.kind !== "github" && provenance.kind !== "marketplace")
      throw new SkillLifecycleError("Remote origin is unsupported", 400);
    return {
      kind: "github",
      repo: provenance.repo,
      path: provenance.path,
      ...(provenance.ref ? { ref: provenance.ref } : {}),
    };
  }
  private assertUnmodified(skill: Skill) {
    const origin = parseSkillRemoteProvenance(skill.remoteProvenance);
    if (!origin) return;
    const changed = origin.packageHash
      ? origin.packageHash !== skillPackageHash(storedSkillFiles(skill))
      : origin.contentHash !== computeContentHash(skill.content);
    if (changed)
      throw new SkillLifecycleError(
        "Local edits detected; save a separate Skill or restore a retained revision before updating",
      );
  }
  private baseHash(skill: Skill) {
    const origin = parseSkillRemoteProvenance(skill.remoteProvenance);
    return computeContentHash(
      JSON.stringify([
        skill.name,
        skill.description,
        skill.version,
        skill.source,
        skill.content,
        skill.resourceManifest,
        origin?.resolvedCommitSha,
        origin?.packageHash,
      ]),
    );
  }
  private snapshot(skill: Skill) {
    let metadataMode: "standard" | "legacy" = "standard";
    try {
      parseSkillPackage(storedSkillFiles(skill));
    } catch {
      metadataMode = "legacy";
    }
    return {
      metadataMode,
      name: skill.name,
      description: skill.description,
      version: skill.version,
      content: skill.content,
      resourceManifest: skill.resourceManifest,
      remoteProvenance: skill.remoteProvenance,
    };
  }
  private revisionPackage(
    userId: string,
    skill: Skill,
    revisionId: string,
  ): RegistryPackage {
    const revision = new CliSkillRevisionRepository(this.db, userId).get(
      skill.id,
      revisionId,
    );
    if (!revision) throw new SkillLifecycleError("Revision not found", 404);
    const snapshot = JSON.parse(revision.snapshotJson) as Pick<
      Skill,
      | "name"
      | "description"
      | "version"
      | "content"
      | "resourceManifest"
      | "remoteProvenance"
    > & { metadataMode?: "standard" | "legacy" };
    const origin = parseSkillRemoteProvenance(snapshot.remoteProvenance);
    if (!origin)
      throw new SkillLifecycleError("Revision has no remote origin", 400);
    const files = validateSkillFiles(storedSkillFiles(snapshot));
    // Historical installs permitted plain Markdown. Restore its exact bytes and stored metadata.
    const pkg =
      snapshot.metadataMode === "legacy"
        ? {
            name: snapshot.name,
            description: snapshot.description ?? "",
            version: snapshot.version ?? "1.0.0",
            warnings: ["legacy-metadata"],
            files,
            packageHash: skillPackageHash(files),
            sizeBytes: files.reduce(
              (sum, file) => sum + Buffer.byteLength(file.content),
              0,
            ),
          }
        : parseSkillPackage(files);
    if (pkg.packageHash !== revision.packageHash)
      throw new SkillLifecycleError("Revision integrity check failed");
    const locator = origin.locator ?? {
      kind: "github" as const,
      repo: origin.repo,
      path: origin.path,
      ...(origin.ref ? { ref: origin.ref } : {}),
    };
    return {
      package: pkg,
      locator,
      revision: origin.resolvedCommitSha,
      canonicalId: origin.canonicalId ?? `github:${origin.repo}/${origin.path}`,
      sourceUrl: origin.sourceUrl ?? `https://github.com/${origin.repo}`,
    };
  }
  private provenance(
    preview: SkillInstallPreview,
    existing?: Skill,
  ): SkillRemoteProvenance {
    const old = parseSkillRemoteProvenance(existing?.remoteProvenance);
    return {
      kind: preview.locator.kind,
      repo: preview.locator.kind === "github" ? preview.locator.repo : "",
      path:
        preview.locator.kind === "github"
          ? (preview.locator.path ?? "SKILL.md")
          : "SKILL.md",
      ...(preview.locator.kind === "github" && preview.locator.ref
        ? { ref: preview.locator.ref }
        : {}),
      resolvedCommitSha: preview.revision,
      contentHash: computeContentHash(
        preview.package.files.find((file) => file.path === "SKILL.md")!.content,
      ),
      packageHash: preview.package.packageHash,
      installedAt: old?.installedAt ?? new Date(this.now()).toISOString(),
      storage: "database",
      legacyGlobalMirror: old
        ? old.legacyGlobalMirror === true || old.storage !== "database"
        : false,
      locator: preview.locator,
      canonicalId: preview.canonicalId,
      sourceUrl: preview.sourceUrl,
    };
  }
  private prune() {
    for (const [token, item] of this.pending)
      if (item.expiresAt <= this.now()) this.pending.delete(token);
  }
}

export function diffFiles(
  before: SkillPackageFile[],
  after: SkillPackageFile[],
): SkillFileChange[] {
  const a = new Map(before.map((file) => [file.path, file.content]));
  const b = new Map(after.map((file) => [file.path, file.content]));
  return [...new Set([...a.keys(), ...b.keys()])]
    .sort()
    .flatMap((path) =>
      a.get(path) === b.get(path)
        ? []
        : [
            {
              path,
              kind: !a.has(path)
                ? ("added" as const)
                : !b.has(path)
                  ? ("removed" as const)
                  : ("modified" as const),
              before: a.get(path),
              after: b.get(path),
            },
          ],
    );
}

const services = new WeakMap<Database, SkillInstallService>();
export function skillInstallService(
  db: Database,
  options: GitHubRequestOptions = {},
): SkillInstallService {
  let service = services.get(db);
  if (!service) {
    service = new SkillInstallService(db, options);
    services.set(db, service);
  }
  return service;
}
