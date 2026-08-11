import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

import { createRenderPlan, detectConfigConflicts } from "../config-generation/index.js";
import { type CredentialMode } from "../config-generation/types.js";
import { AgentRepository } from "../db/repositories/agent-repository.js";
import { ProjectRepository } from "../db/repositories/project-repository.js";
import { ProjectSkillRepository } from "../db/repositories/project-skill-repository.js";
import { SkillRepository } from "../db/repositories/skill-repository.js";
import { TemplateRepository } from "../db/repositories/template-repository.js";
import type { Database } from "../db/types.js";
import { buildProjectConfigFiles } from "./project-config-files.js";
import { syncLocalSkills } from "./local-skills.js";

const aiToolSchema = z.enum(["claude", "opencode", "codex", "kimi"]);

export type ProjectConfigSkillSync = (repo: Pick<SkillRepository, "create" | "getByName" | "update">) => unknown;

export function getGatewayUrl(): string {
  return (
    process.env.OPENFORGE_GATEWAY_URL ||
    process.env.NEXT_PUBLIC_GATEWAY_URL ||
    `http://${process.env.OPENFORGE_HOST || "127.0.0.1"}:${process.env.OPENFORGE_PORT || "3000"}`
  );
}

export function normalizeTemplateFilesForProject(
  project: { aiTool: string; isImported: boolean; path: string },
  files: Array<{ id: string; relativePath: string; content: string }>
): Array<{ id: string; relativePath: string; content: string }> {
  if (project.aiTool !== "claude" || !project.isImported) {
    return files;
  }

  const hasRootClaude = existsSync(resolve(project.path, "CLAUDE.md"));
  return files.flatMap((file) => {
    if (file.relativePath === ".claude/settings.json") {
      return [];
    }
    if (file.relativePath === ".claude/CLAUDE.md" && hasRootClaude) {
      return [{ ...file, relativePath: "CLAUDE.md" }];
    }
    return [file];
  });
}

export async function buildProjectConfigRenderPlan(
  db: Database,
  userId: string,
  projectId: string,
  templateId: string,
  credentialMode: CredentialMode,
  dryRun: boolean,
  options: { syncSkills?: ProjectConfigSkillSync } = {}
) {
  const projectRepo = new ProjectRepository(db, userId);
  const project = projectRepo.getById(projectId);
  if (!project) {
    throw new Error("Project not found");
  }

  const templateRepo = new TemplateRepository(db, userId);
  const template = templateRepo.getById(templateId);
  if (!template || !template.files) {
    throw new Error("Template not found");
  }

  const agentRepo = new AgentRepository(db, userId);
  const skillRepo = new ProjectSkillRepository(db, userId);
  // A plan must include the same locally discovered Skills as later compliance checks.
  (options.syncSkills ?? syncLocalSkills)(new SkillRepository(db, userId));

  return createRenderPlan({
    projectId: project.id,
    targetRoot: project.path,
    templateId: template.id,
    variables: {
      projectName: project.name,
      projectRoot: project.path,
      gatewayUrl: getGatewayUrl()
    },
    templateFiles: buildProjectConfigFiles({
      adapter: aiToolSchema.parse(project.aiTool),
      templateFiles: normalizeTemplateFilesForProject(project, template.files.map((file) => ({
        id: String(file.id),
        relativePath: file.filePath,
        content: file.content
      }))),
      agents: agentRepo.list().filter((agent) => agent.projectId === project.id),
      skills: skillRepo.listByProject(project.id)
    }),
    credentialMode,
    dryRun
  });
}

export function buildConfigSyncSummary(
  plan: ReturnType<typeof createRenderPlan>,
  conflicts: Awaited<ReturnType<typeof detectConfigConflicts>>
) {
  const conflictByPath = new Map(conflicts.map((conflict) => [conflict.relativePath, conflict]));
  const missingFiles = plan.files
    .filter((file) => !conflictByPath.has(file.relativePath))
    .map((file) => file.relativePath);
  const identicalFiles = conflicts
    .filter((conflict) => conflict.conflictType === "exists")
    .map((conflict) => conflict.relativePath);
  const modifiedFiles = conflicts
    .filter((conflict) => conflict.conflictType === "modified")
    .map((conflict) => conflict.relativePath);
  const unsafeFiles = conflicts
    .filter((conflict) => conflict.conflictType === "unsafe_path")
    .map((conflict) => conflict.relativePath);

  return {
    templateId: plan.templateId,
    totalFiles: plan.files.length,
    missingFiles,
    identicalFiles,
    modifiedFiles,
    unsafeFiles,
    requiresDecision: [...modifiedFiles, ...unsafeFiles]
  };
}