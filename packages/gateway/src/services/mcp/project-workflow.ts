import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { detectConfigConflicts, writeConfigPlan } from "../../config-generation/index.js";
import type { ConflictReport, RenderPlan } from "../../config-generation/types.js";
import { assertNewProjectResource } from "../../db/repositories/managed-project-access.js";
import { ProjectRepository } from "../../db/repositories/project-repository.js";
import { ProjectSkillRepository } from "../../db/repositories/project-skill-repository.js";
import { TemplateRepository } from "../../db/repositories/template-repository.js";
import type { Database } from "../../db/types.js";
import { validateProjectRoot } from "../../lib/safe-resolve.js";
import { canonical } from "../platform-commands/actions.js";
import { PlatformNoEffectError } from "../platform-commands/errors.js";
import { buildProjectConfigRenderPlan } from "../project-config-render.js";
import { discoverLocalSkills } from "../local-skills.js";

export function importProject(db: Database, userId: string, input: {
  name: string; path: string; description?: string | undefined; techStack?: string | undefined; templateId?: string | undefined;
}, authorize?: (root: string) => void) {
  const target = path.resolve(input.path.trim());
  if (!existsSync(target)) throw new Error("Imported project directory must already exist");
  const root = validateProjectRoot(target);
  authorize?.(root);
  if (!statSync(root).isDirectory()) throw new Error("Imported project path must be a directory");
  assertNewProjectResource(db, userId, root);
  authorize?.(root);
  if (input.templateId && !new TemplateRepository(db, userId).getById(input.templateId)) throw new Error("Template not found");
  return new ProjectRepository(db, userId).import({ ...input, path: root, aiTool: "" });
}

function configDigest(plan: RenderPlan, conflicts: ConflictReport[]): string {
  return createHash("sha256").update(canonical({
    projectId: plan.projectId, targetRoot: plan.targetRoot, templateId: plan.templateId,
    credentialMode: plan.credentialMode,
    files: plan.files.map(file => ({ path: file.relativePath, sha256: file.sha256 })),
    conflicts: conflicts.map(conflict => ({ path: conflict.relativePath, type: conflict.conflictType, sha256: conflict.existingSha256 ?? null }))
  })).digest("hex");
}

function assertSelectedLocalSkillsFresh(db: Database, userId: string, projectId: string): void {
  const selected = new ProjectSkillRepository(db, userId).listByProject(projectId)
    .filter(skill => skill.isEnabled && skill.source === "local");
  if (selected.length === 0) return;
  const discovered = new Map(discoverLocalSkills().map(skill => [skill.path, skill]));
  for (const skill of selected) {
    let sourcePath: string | undefined;
    try { sourcePath = (JSON.parse(skill.resourceManifest ?? "null") as { sourcePath?: string } | null)?.sourcePath; }
    catch { /* A malformed manifest cannot establish freshness. */ }
    const current = sourcePath ? discovered.get(sourcePath) : undefined;
    if (!current || current.content !== skill.content || current.version !== skill.version || current.resourceManifest !== skill.resourceManifest) {
      throw new Error(`Local Skill ${skill.name} changed or was rejected; refresh it in the owner UI before config export`);
    }
  }
}

export async function previewMcpConfig(db: Database, userId: string, projectId: string, templateId: string) {
  assertSelectedLocalSkillsFresh(db, userId, projectId);
  const plan = await buildProjectConfigRenderPlan(db, userId, projectId, templateId, "host_environment", true, { syncSkills: () => ({}), readOnlyTemplates: true });
  const conflicts = await detectConfigConflicts(plan);
  return {
    digest: configDigest(plan, conflicts),
    files: plan.files.map(file => ({ relativePath: file.relativePath, sha256: file.sha256 })),
    conflicts: conflicts.map(conflict => ({ relativePath: conflict.relativePath, conflictType: conflict.conflictType })),
    applicable: conflicts.every(conflict => conflict.conflictType === "exists")
  };
}

export async function applyMcpConfig(db: Database, userId: string, projectId: string, templateId: string, expectedDigest: string, authorize: () => void) {
  assertSelectedLocalSkillsFresh(db, userId, projectId);
  const plan = await buildProjectConfigRenderPlan(db, userId, projectId, templateId, "host_environment", false, { syncSkills: () => ({}), readOnlyTemplates: true });
  const conflicts = await detectConfigConflicts(plan);
  if (configDigest(plan, conflicts) !== expectedDigest) throw new PlatformNoEffectError("Config preview is stale");
  if (conflicts.some(conflict => conflict.conflictType !== "exists")) throw new PlatformNoEffectError("Config conflicts require owner review");
  authorize();
  const result = await writeConfigPlan(plan, { createOnly: true, beforeWrite: authorize });
  if (result.outcome === "rolled_back") throw new PlatformNoEffectError("Config write rolled back");
  if (result.outcome === "rollback_failed") throw new Error("Config rollback failed; inspect project files");
  return { outcome: result.outcome, writtenFiles: result.writtenFiles, skippedFiles: result.skippedFiles };
}
