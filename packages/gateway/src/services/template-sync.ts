import { detectConfigConflicts, writeConfigPlan } from "../config-generation/index.js";
import { type CredentialMode, type WriteResult } from "../config-generation/types.js";
import { AuditLogRepository } from "../db/repositories/audit-log-repository.js";
import { ProjectRepository } from "../db/repositories/project-repository.js";
import { TemplateRepository } from "../db/repositories/template-repository.js";
import type { Database } from "../db/types.js";
import { recordActivity } from "./activity-events.js";
import type { OpenForgeEventBus } from "./event-bus.js";
import { buildConfigSyncSummary, buildProjectConfigRenderPlan } from "./project-config-render.js";

export const MAX_SYNC_PROJECTS = 20;

export type TemplateProjectConfigStatus = "compliant" | "stale" | "missing";

export interface TemplateUsageProject {
  id: string;
  name: string;
  path: string;
  aiTool: string | null;
  isImported: boolean;
  configStatus: TemplateProjectConfigStatus;
}

export interface TemplateUsage {
  templateId: string;
  usageCount: number;
  projects: TemplateUsageProject[];
}

export interface TemplateSyncProjectPreview {
  projectId: string;
  projectName: string;
  conflicts: Awaited<ReturnType<typeof detectConfigConflicts>>;
  summary: ReturnType<typeof buildConfigSyncSummary>;
}

export interface TemplateSyncPreview {
  templateId: string;
  projects: TemplateSyncProjectPreview[];
}

export interface TemplateSyncProjectResult {
  projectId: string;
  projectName: string;
  result?: WriteResult;
  summary?: ReturnType<typeof buildConfigSyncSummary>;
  error?: string;
}

export interface TemplateSyncApplyResult {
  templateId: string;
  projects: TemplateSyncProjectResult[];
}

export type TemplateSyncDecisions = Record<string, Record<string, "skip" | "overwrite">>;

export interface TemplateSyncOptions {
  projectIds?: string[];
  credentialMode?: CredentialMode;
  decisions?: TemplateSyncDecisions;
  eventBus?: OpenForgeEventBus;
  ipAddress?: string;
}

export class TemplateSyncError extends Error {
  constructor(message: string, public readonly status: number = 400) {
    super(message);
  }
}

function configStatusFromSummary(
  templateFilePaths: Set<string>,
  summary: ReturnType<typeof buildConfigSyncSummary>
): TemplateProjectConfigStatus {
  const isTemplateFile = (relativePath: string) =>
    templateFilePaths.has(relativePath) ||
    (templateFilePaths.has(".claude/CLAUDE.md") && relativePath === "CLAUDE.md");
  const missing = summary.missingFiles.filter(isTemplateFile);
  if (missing.length > 0) {
    return "missing";
  }
  if (summary.requiresDecision.some(isTemplateFile)) {
    return "stale";
  }
  return "compliant";
}

async function assertTemplateReadable(db: Database, userId: string, templateId: string) {
  const template = new TemplateRepository(db, userId).getById(templateId);
  if (!template) {
    throw new TemplateSyncError("Template not found", 404);
  }
  return template;
}

function resolveSyncProjects(
  db: Database,
  userId: string,
  templateId: string,
  projectIds?: string[]
) {
  const projects = new ProjectRepository(db, userId).list().filter((project) => project.templateId === templateId);
  if (projectIds && projectIds.length > 0) {
    if (projectIds.length > MAX_SYNC_PROJECTS) {
      throw new TemplateSyncError(
        `Too many projects (${projectIds.length}), the limit is ${MAX_SYNC_PROJECTS}`,
        400
      );
    }
    const matched = projects.filter((project) => projectIds.includes(project.id));
    if (matched.length !== projectIds.length) {
      throw new TemplateSyncError("Project not found", 404);
    }
    return matched;
  }
  if (projects.length > MAX_SYNC_PROJECTS) {
    throw new TemplateSyncError(
      `Too many projects (${projects.length}), the limit is ${MAX_SYNC_PROJECTS}; pass an explicit projectIds list`,
      400
    );
  }
  return projects;
}

export async function buildTemplateUsage(
  db: Database,
  userId: string,
  templateId: string,
  projectIds?: string[]
): Promise<TemplateUsage> {
  const template = await assertTemplateReadable(db, userId, templateId);
  const templateFilePaths = new Set((template.files ?? []).map((file) => file.filePath));
  const projects = resolveSyncProjects(db, userId, templateId, projectIds);

  const usageProjects = await Promise.all(
    projects.map(async (project): Promise<TemplateUsageProject> => {
      let configStatus: TemplateProjectConfigStatus = "stale";
      try {
        const plan = await buildProjectConfigRenderPlan(
          db,
          userId,
          project.id,
          templateId,
          "host_environment",
          true
        );
        const conflicts = await detectConfigConflicts(plan);
        configStatus = configStatusFromSummary(templateFilePaths, buildConfigSyncSummary(plan, conflicts));
      } catch {
        configStatus = "stale";
      }
      return {
        id: project.id,
        name: project.name,
        path: project.path,
        aiTool: project.aiTool,
        isImported: project.isImported,
        configStatus
      };
    })
  );

  return {
    templateId,
    usageCount: usageProjects.length,
    projects: usageProjects
  };
}

export async function previewTemplateSync(
  db: Database,
  userId: string,
  templateId: string,
  options: TemplateSyncOptions = {}
): Promise<TemplateSyncPreview> {
  await assertTemplateReadable(db, userId, templateId);
  const projects = resolveSyncProjects(db, userId, templateId, options.projectIds);

  const previews = await Promise.all(
    projects.map(async (project) => {
      const renderPlan = await buildProjectConfigRenderPlan(
        db,
        userId,
        project.id,
        templateId,
        options.credentialMode ?? "host_environment",
        true
      );
      const conflicts = await detectConfigConflicts(renderPlan);
      return {
        projectId: project.id,
        projectName: project.name,
        conflicts,
        summary: buildConfigSyncSummary(renderPlan, conflicts)
      };
    })
  );

  return { templateId, projects: previews };
}

export async function applyTemplateSync(
  db: Database,
  userId: string,
  templateId: string,
  options: TemplateSyncOptions = {}
): Promise<TemplateSyncApplyResult> {
  await assertTemplateReadable(db, userId, templateId);
  const projects = resolveSyncProjects(db, userId, templateId, options.projectIds);

  const results: TemplateSyncProjectResult[] = [];
  for (const project of projects) {
    try {
      const renderPlan = await buildProjectConfigRenderPlan(
        db,
        userId,
        project.id,
        templateId,
        options.credentialMode ?? "host_environment",
        false
      );
      const projectDecisions = options.decisions?.[project.id];
      const result = projectDecisions === undefined
        ? await writeConfigPlan(renderPlan, {})
        : await writeConfigPlan(renderPlan, { decisions: projectDecisions });
      const summary = buildConfigSyncSummary(renderPlan, result.conflicts);

      recordActivity({
        db,
        eventBus: options.eventBus,
        userId,
        projectId: project.id,
        type: "config_sync",
        status: result.outcome === "applied" ? "success" : result.outcome === "rolled_back" ? "warning" : "error",
        message: `Config synced for ${project.name}`,
        metadata: {
          templateId,
          writtenFiles: result.writtenFiles,
          skippedFiles: result.skippedFiles,
          outcome: result.outcome,
          failedFiles: result.failedFiles
        }
      });
      new AuditLogRepository(db, userId).create({
        action: "project.config_sync",
        resourceType: "project",
        resourceId: project.id,
        details: {
          templateId,
          writtenFiles: result.writtenFiles.length,
          skippedFiles: result.skippedFiles.length,
          conflicts: result.conflicts.length,
          decisionRequired: summary.requiresDecision.length,
          outcome: result.outcome,
          failedFiles: result.failedFiles.length
        },
        ipAddress: options.ipAddress
      });

      results.push({ projectId: project.id, projectName: project.name, result, summary });
    } catch (error) {
      results.push({
        projectId: project.id,
        projectName: project.name,
        error: error instanceof Error ? error.message : "Sync failed"
      });
    }
  }

  return { templateId, projects: results };
}