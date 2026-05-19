import { z } from "zod";

import { ActivityRepository, type SessionActivity } from "../../db/repositories/activity-repository.js";
import { AgentRepository, type Agent } from "../../db/repositories/agent-repository.js";
import { CopilotRepository } from "../../db/repositories/copilot-repository.js";
import { ModelProviderRepository, type ModelProfile, type ProviderProfile } from "../../db/repositories/model-provider-repository.js";
import { NotificationRepository, type Notification } from "../../db/repositories/notification-repository.js";
import { PluginRepository } from "../../db/repositories/plugin-repository.js";
import { ProjectRepository, type Project } from "../../db/repositories/project-repository.js";
import { ProjectSkillRepository, type ProjectSkill } from "../../db/repositories/project-skill-repository.js";
import { SessionRepository, type Session } from "../../db/repositories/session-repository.js";
import { SkillRepository, type Skill } from "../../db/repositories/skill-repository.js";
import { TemplateRepository, type Template, type TemplateFile } from "../../db/repositories/template-repository.js";
import { UsageRepository, type UsageRate } from "../../db/repositories/usage-repository.js";
import type { PluginSummary } from "../plugin-catalog.js";
import { loadProviderCatalog, type ProviderCatalogPreset } from "../model-catalog.js";
import { discoverAdapters } from "../adapter-discovery.js";
import { getDashboardSummary } from "../dashboard-summary.js";
import { buildLocalDiagnosticsExport } from "../diagnostics.js";
import { createCopilotMemoryTools } from "./memory.js";
import { selectCopilotProvider } from "./provider-selection.js";
import { CopilotToolValidationError, type CopilotToolContext, type CopilotToolDefinition } from "./tool-registry.js";
import { redactCopilotPayload } from "./redaction.js";

const emptyInput = z.object({}).strict();
const limitInput = z.object({
  limit: z.number().int().min(1).max(50).optional()
}).strict();
const projectScopedLimitInput = z.object({
  projectId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).optional()
}).strict();
const projectDetailInput = z.object({
  projectId: z.string().min(1)
}).strict();
const skillDetailInput = z.object({
  skillId: z.string().min(1),
  projectId: z.string().min(1).optional()
}).strict();
const sessionDetailInput = z.object({
  sessionId: z.string().min(1)
}).strict();
const sessionTerminalSnapshotInput = z.object({
  sessionId: z.string().min(1),
  maxBytes: z.number().int().min(1).max(16_000).default(8_000)
}).strict();
const proposeSessionCreateInput = z.object({
  projectId: z.string().min(1).nullable().optional(),
  aiTool: z.enum(["claude", "opencode", "codex"]),
  name: z.string().min(1).optional()
}).strict();
const proposeProjectCreateInput = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  description: z.string().min(1).optional(),
  techStack: z.string().min(1).optional(),
  aiTool: z.enum(["claude", "opencode", "codex"]).optional(),
  templateId: z.string().min(1).optional()
}).strict();
const proposeProjectImportInput = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  description: z.string().min(1).optional(),
  techStack: z.string().min(1).optional(),
  aiTool: z.enum(["claude", "opencode", "codex"]).optional(),
  templateId: z.string().min(1).optional()
}).strict();
const proposeProjectDeleteInput = z.object({
  projectId: z.string().min(1),
  reason: z.string().min(1).optional()
}).strict();
const proposeProjectConfigSyncInput = z.object({
  projectId: z.string().min(1),
  templateId: z.string().min(1).optional(),
  credentialMode: z.enum(["host_environment", "stored_encrypted_key"]).default("host_environment"),
  decisions: z.record(z.enum(["skip", "overwrite"])).optional()
}).strict();
const proposeSessionInputInput = z.object({
  sessionId: z.string().min(1),
  input: z.string().min(1).max(8_000),
  submit: z.boolean().optional()
}).strict();
const proposeSessionStartInput = z.object({
  sessionId: z.string().min(1),
  reason: z.string().min(1).optional()
}).strict();
const proposeSessionStopInput = z.object({
  sessionId: z.string().min(1),
  reason: z.string().min(1).optional()
}).strict();
const proposeSessionDeleteInput = z.object({
  sessionId: z.string().min(1),
  reason: z.string().min(1).optional()
}).strict();
const proposeAgentCreateInput = z.object({
  projectId: z.string().min(1).optional(),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  tools: z.string().min(1).optional(),
  allowedDirs: z.string().min(1).optional(),
  customPrompt: z.string().min(1).optional(),
  reason: z.string().min(1).optional()
}).strict();
const proposeAgentUpdateInput = z.object({
  agentId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  tools: z.string().min(1).optional(),
  allowedDirs: z.string().min(1).optional(),
  customPrompt: z.string().min(1).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  reason: z.string().min(1).optional()
}).strict();
const proposeAgentDeleteInput = z.object({
  agentId: z.string().min(1),
  reason: z.string().min(1).optional()
}).strict();
const templateDraftFileInput = z.object({
  filePath: z.string().min(1),
  content: z.string().max(16_000),
  fileType: z.string().min(1).optional()
}).strict();
const proposeTemplateCreateInput = z.object({
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  visibility: z.enum(["private", "shared", "admin"]).optional(),
  files: z.array(templateDraftFileInput).max(20).optional(),
  reason: z.string().min(1).optional()
}).strict();
const proposeTemplateUpdateInput = z.object({
  templateId: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  visibility: z.enum(["private", "shared", "admin"]).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  reason: z.string().min(1).optional()
}).strict();
const proposeTemplateDeleteInput = z.object({
  templateId: z.string().min(1),
  reason: z.string().min(1).optional()
}).strict();
const proposeSkillToggleInput = z.object({
  skillId: z.string().min(1),
  enabled: z.boolean(),
  reason: z.string().min(1).optional()
}).strict();
const proposePluginToggleInput = z.object({
  pluginId: z.string().min(1),
  enabled: z.boolean(),
  reason: z.string().min(1).optional()
}).strict();
const proposeProjectSkillToggleInput = z.object({
  projectId: z.string().min(1),
  skillId: z.string().min(1),
  enabled: z.boolean(),
  reason: z.string().min(1).optional()
}).strict();
const proposeCopilotModelSelectionInput = z.object({
  providerProfileId: z.string().min(1),
  modelProfileId: z.string().min(1),
  reason: z.string().min(1).optional()
}).strict();
const proposeModelProviderSyncInput = z.object({
  providerProfileId: z.string().min(1),
  credentialId: z.string().min(1).optional(),
  timeoutMs: z.number().int().min(100).max(30_000).optional(),
  reason: z.string().min(1).optional()
}).strict();
const proposeModelProviderApplyInput = z.object({
  adapter: z.enum(["claude", "opencode", "openforge-copilot"]),
  providerProfileId: z.string().min(1),
  modelProfileId: z.string().min(1).optional(),
  credentialId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  reason: z.string().min(1).optional()
}).strict();
const proposeDiagnosticsExportInput = z.object({
  reason: z.string().min(1).optional()
}).strict();
const proposeAdapterRefreshInput = z.object({
  reason: z.string().min(1).optional()
}).strict();
const proposeTroubleshootingStepsInput = z.object({
  summary: z.string().min(1).optional(),
  steps: z.array(z.string().min(1)).min(1).max(10).optional()
}).strict();
const feishuIdInput = z.string().min(1).max(128);
const feishuTextInput = z.string().min(1).max(16_000);
const feishuReasonInput = z.string().min(1).max(1024).optional();
const proposeFeishuMessageSendInput = z.object({
  chatId: feishuIdInput,
  text: feishuTextInput,
  reason: feishuReasonInput
}).strict();
const proposeFeishuDocCreateInput = z.object({
  title: z.string().min(1).max(256),
  content: feishuTextInput,
  folderId: feishuIdInput.optional(),
  reason: feishuReasonInput
}).strict();
const proposeFeishuDocUpdateInput = z.object({
  documentId: feishuIdInput,
  content: feishuTextInput,
  reason: feishuReasonInput
}).strict();
const proposeFeishuTaskCreateInput = z.object({
  summary: z.string().min(1).max(256),
  description: z.string().max(4_000).optional(),
  assigneeFeishuUserId: feishuIdInput.optional(),
  dueDate: z.string().min(1).max(32).optional(),
  tasklistId: feishuIdInput.optional(),
  reason: feishuReasonInput
}).strict();
const proposeFeishuTaskUpdateInput = z.object({
  taskId: feishuIdInput,
  summary: z.string().min(1).max(256).optional(),
  description: z.string().max(4_000).optional(),
  status: z.enum(["done"]).optional(),
  reason: feishuReasonInput
}).strict();

const emptyModelInputSchema = {
  type: "object",
  properties: {},
  additionalProperties: false
};
const limitModelInputSchema = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 50 }
  },
  additionalProperties: false
};
const projectScopedLimitModelInputSchema = {
  type: "object",
  properties: {
    projectId: { type: "string", minLength: 1 },
    limit: { type: "integer", minimum: 1, maximum: 50 }
  },
  additionalProperties: false
};
const projectDetailModelInputSchema = {
  type: "object",
  properties: {
    projectId: { type: "string", minLength: 1 }
  },
  required: ["projectId"],
  additionalProperties: false
};
const skillDetailModelInputSchema = {
  type: "object",
  properties: {
    skillId: { type: "string", minLength: 1 },
    projectId: { type: "string", minLength: 1 }
  },
  required: ["skillId"],
  additionalProperties: false
};
const sessionDetailModelInputSchema = {
  type: "object",
  properties: {
    sessionId: { type: "string", minLength: 1 }
  },
  required: ["sessionId"],
  additionalProperties: false
};
const sessionTerminalSnapshotModelInputSchema = {
  type: "object",
  properties: {
    sessionId: { type: "string", minLength: 1 },
    maxBytes: { type: "integer", minimum: 1, maximum: 16_000 }
  },
  required: ["sessionId"],
  additionalProperties: false
};
const proposeSessionCreateModelInputSchema = {
  type: "object",
  properties: {
    projectId: {
      type: ["string", "null"],
      minLength: 1,
      description: "Target project id. Use null only when the user has exactly one visible project."
    },
    aiTool: { type: "string", enum: ["claude", "opencode", "codex"] },
    name: { type: "string", minLength: 1 }
  },
  required: ["aiTool"],
  additionalProperties: false
};
const proposeProjectCreateModelInputSchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1 },
    path: { type: "string", minLength: 1 },
    description: { type: "string", minLength: 1 },
    techStack: { type: "string", minLength: 1 },
    aiTool: { type: "string", enum: ["claude", "opencode", "codex"] },
    templateId: { type: "string", minLength: 1 }
  },
  required: ["name", "path"],
  additionalProperties: false
};
const proposeProjectImportModelInputSchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1 },
    path: { type: "string", minLength: 1 },
    description: { type: "string", minLength: 1 },
    techStack: { type: "string", minLength: 1 },
    aiTool: { type: "string", enum: ["claude", "opencode", "codex"] },
    templateId: { type: "string", minLength: 1 }
  },
  required: ["name", "path"],
  additionalProperties: false
};
const proposeProjectDeleteModelInputSchema = {
  type: "object",
  properties: {
    projectId: { type: "string", minLength: 1 },
    reason: { type: "string", minLength: 1 }
  },
  required: ["projectId"],
  additionalProperties: false
};
const proposeProjectConfigSyncModelInputSchema = {
  type: "object",
  properties: {
    projectId: { type: "string", minLength: 1 },
    templateId: { type: "string", minLength: 1 },
    credentialMode: { type: "string", enum: ["host_environment", "stored_encrypted_key"] },
    decisions: {
      type: "object",
      additionalProperties: { type: "string", enum: ["skip", "overwrite"] }
    }
  },
  required: ["projectId"],
  additionalProperties: false
};
const proposeSessionInputModelInputSchema = {
  type: "object",
  properties: {
    sessionId: { type: "string", minLength: 1 },
    input: { type: "string", minLength: 1, maxLength: 8_000 },
    submit: { type: "boolean" }
  },
  required: ["sessionId", "input"],
  additionalProperties: false
};
const proposeSessionStartModelInputSchema = {
  type: "object",
  properties: {
    sessionId: { type: "string", minLength: 1 },
    reason: { type: "string", minLength: 1 }
  },
  required: ["sessionId"],
  additionalProperties: false
};
const proposeSessionStopModelInputSchema = {
  type: "object",
  properties: {
    sessionId: { type: "string", minLength: 1 },
    reason: { type: "string", minLength: 1 }
  },
  required: ["sessionId"],
  additionalProperties: false
};
const proposeSessionDeleteModelInputSchema = {
  type: "object",
  properties: {
    sessionId: { type: "string", minLength: 1 },
    reason: { type: "string", minLength: 1 }
  },
  required: ["sessionId"],
  additionalProperties: false
};
const proposeAgentCreateModelInputSchema = {
  type: "object",
  properties: {
    projectId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    description: { type: "string", minLength: 1 },
    modelId: { type: "string", minLength: 1 },
    tools: { type: "string", minLength: 1 },
    allowedDirs: { type: "string", minLength: 1 },
    customPrompt: { type: "string", minLength: 1 },
    reason: { type: "string", minLength: 1 }
  },
  required: ["name"],
  additionalProperties: false
};
const proposeAgentUpdateModelInputSchema = {
  type: "object",
  properties: {
    agentId: { type: "string", minLength: 1 },
    projectId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    description: { type: "string", minLength: 1 },
    modelId: { type: "string", minLength: 1 },
    tools: { type: "string", minLength: 1 },
    allowedDirs: { type: "string", minLength: 1 },
    customPrompt: { type: "string", minLength: 1 },
    status: { type: "string", enum: ["active", "disabled"] },
    reason: { type: "string", minLength: 1 }
  },
  required: ["agentId"],
  additionalProperties: false
};
const proposeAgentDeleteModelInputSchema = {
  type: "object",
  properties: {
    agentId: { type: "string", minLength: 1 },
    reason: { type: "string", minLength: 1 }
  },
  required: ["agentId"],
  additionalProperties: false
};
const templateDraftFileModelInputSchema = {
  type: "object",
  properties: {
    filePath: { type: "string", minLength: 1 },
    content: { type: "string", maxLength: 16_000 },
    fileType: { type: "string", minLength: 1 }
  },
  required: ["filePath", "content"],
  additionalProperties: false
};
const proposeTemplateCreateModelInputSchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1 },
    description: { type: "string", minLength: 1 },
    version: { type: "string", minLength: 1 },
    visibility: { type: "string", enum: ["private", "shared", "admin"] },
    files: {
      type: "array",
      items: templateDraftFileModelInputSchema,
      maxItems: 20
    },
    reason: { type: "string", minLength: 1 }
  },
  required: ["name"],
  additionalProperties: false
};
const proposeTemplateUpdateModelInputSchema = {
  type: "object",
  properties: {
    templateId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    description: { type: "string", minLength: 1 },
    version: { type: "string", minLength: 1 },
    visibility: { type: "string", enum: ["private", "shared", "admin"] },
    status: { type: "string", enum: ["active", "disabled"] },
    reason: { type: "string", minLength: 1 }
  },
  required: ["templateId"],
  additionalProperties: false
};
const proposeTemplateDeleteModelInputSchema = {
  type: "object",
  properties: {
    templateId: { type: "string", minLength: 1 },
    reason: { type: "string", minLength: 1 }
  },
  required: ["templateId"],
  additionalProperties: false
};
const proposeSkillToggleModelInputSchema = {
  type: "object",
  properties: {
    skillId: { type: "string", minLength: 1 },
    enabled: { type: "boolean" },
    reason: { type: "string", minLength: 1 }
  },
  required: ["skillId", "enabled"],
  additionalProperties: false
};
const proposePluginToggleModelInputSchema = {
  type: "object",
  properties: {
    pluginId: { type: "string", minLength: 1 },
    enabled: { type: "boolean" },
    reason: { type: "string", minLength: 1 }
  },
  required: ["pluginId", "enabled"],
  additionalProperties: false
};
const proposeProjectSkillToggleModelInputSchema = {
  type: "object",
  properties: {
    projectId: { type: "string", minLength: 1 },
    skillId: { type: "string", minLength: 1 },
    enabled: { type: "boolean" },
    reason: { type: "string", minLength: 1 }
  },
  required: ["projectId", "skillId", "enabled"],
  additionalProperties: false
};
const proposeCopilotModelSelectionModelInputSchema = {
  type: "object",
  properties: {
    providerProfileId: { type: "string", minLength: 1 },
    modelProfileId: { type: "string", minLength: 1 },
    reason: { type: "string", minLength: 1 }
  },
  required: ["providerProfileId", "modelProfileId"],
  additionalProperties: false
};
const proposeModelProviderSyncModelInputSchema = {
  type: "object",
  properties: {
    providerProfileId: { type: "string", minLength: 1 },
    credentialId: { type: "string", minLength: 1 },
    timeoutMs: { type: "integer", minimum: 100, maximum: 30_000 },
    reason: { type: "string", minLength: 1 }
  },
  required: ["providerProfileId"],
  additionalProperties: false
};
const proposeModelProviderApplyModelInputSchema = {
  type: "object",
  properties: {
    adapter: { type: "string", enum: ["claude", "opencode", "openforge-copilot"] },
    providerProfileId: { type: "string", minLength: 1 },
    modelProfileId: { type: "string", minLength: 1 },
    credentialId: { type: "string", minLength: 1 },
    projectId: { type: "string", minLength: 1 },
    reason: { type: "string", minLength: 1 }
  },
  required: ["adapter", "providerProfileId"],
  additionalProperties: false
};
const proposeDiagnosticsExportModelInputSchema = {
  type: "object",
  properties: {
    reason: { type: "string", minLength: 1 }
  },
  additionalProperties: false
};
const proposeAdapterRefreshModelInputSchema = {
  type: "object",
  properties: {
    reason: { type: "string", minLength: 1 }
  },
  additionalProperties: false
};
const proposeTroubleshootingStepsModelInputSchema = {
  type: "object",
  properties: {
    summary: { type: "string", minLength: 1 },
    steps: {
      type: "array",
      items: { type: "string", minLength: 1 },
      minItems: 1,
      maxItems: 10
    }
  },
  additionalProperties: false
};
const proposeFeishuMessageSendModelInputSchema = {
  type: "object",
  properties: {
    chatId: { type: "string", minLength: 1, maxLength: 128 },
    text: { type: "string", minLength: 1, maxLength: 16_000 },
    reason: { type: "string", minLength: 1, maxLength: 1024 }
  },
  required: ["chatId", "text"],
  additionalProperties: false
};
const proposeFeishuDocCreateModelInputSchema = {
  type: "object",
  properties: {
    title: { type: "string", minLength: 1, maxLength: 256 },
    content: { type: "string", minLength: 1, maxLength: 16_000 },
    folderId: { type: "string", minLength: 1, maxLength: 128 },
    reason: { type: "string", minLength: 1, maxLength: 1024 }
  },
  required: ["title", "content"],
  additionalProperties: false
};
const proposeFeishuDocUpdateModelInputSchema = {
  type: "object",
  properties: {
    documentId: { type: "string", minLength: 1, maxLength: 128 },
    content: { type: "string", minLength: 1, maxLength: 16_000 },
    reason: { type: "string", minLength: 1, maxLength: 1024 }
  },
  required: ["documentId", "content"],
  additionalProperties: false
};
const proposeFeishuTaskCreateModelInputSchema = {
  type: "object",
  properties: {
    summary: { type: "string", minLength: 1, maxLength: 256 },
    description: { type: "string", maxLength: 4_000 },
    assigneeFeishuUserId: { type: "string", minLength: 1, maxLength: 128 },
    dueDate: { type: "string", minLength: 1, maxLength: 32 },
    tasklistId: { type: "string", minLength: 1, maxLength: 128 },
    reason: { type: "string", minLength: 1, maxLength: 1024 }
  },
  required: ["summary"],
  additionalProperties: false
};
const proposeFeishuTaskUpdateModelInputSchema = {
  type: "object",
  properties: {
    taskId: { type: "string", minLength: 1, maxLength: 128 },
    summary: { type: "string", minLength: 1, maxLength: 256 },
    description: { type: "string", maxLength: 4_000 },
    status: { type: "string", enum: ["done"] },
    reason: { type: "string", minLength: 1, maxLength: 1024 }
  },
  required: ["taskId"],
  additionalProperties: false
};

export function createCopilotReadTools(): CopilotToolDefinition[] {
  return [
    {
      name: "openforge.get_dashboard_summary",
      description: "Read the current OpenForge dashboard summary and health checks.",
      risk: "read",
      requiresApproval: false,
      inputSchema: emptyInput,
      modelInputSchema: emptyModelInputSchema,
      execute: async (_input, context) => getDashboardSummary(context.db, context.userId, context.masterKey)
    },
    {
      name: "openforge.list_projects",
      description:
        "List OpenForge projects visible to the current user. Project record status is not session status; use runningSessionCount or list_sessions for running AI CLI sessions.",
      risk: "read",
      requiresApproval: false,
      inputSchema: limitInput,
      modelInputSchema: limitModelInputSchema,
      execute: async (input, context) => {
        const sessions = new SessionRepository(context.db, context.userId).list();
        const runtimeSessions = readRuntimeSessions(context);
        return {
          projects: new ProjectRepository(context.db, context.userId)
            .list()
            .slice(0, readLimit(input))
            .map((project) =>
              toProjectSummary(
                project,
                sessions.filter((session) => session.projectId === project.id),
                runtimeSessions
              )
            )
        };
      }
    },
    {
      name: "openforge.get_project_detail",
      description:
        "Read one OpenForge project visible to the current user, including session counts. Project record status is not proof of a running AI CLI session.",
      risk: "read",
      requiresApproval: false,
      inputSchema: projectDetailInput,
      modelInputSchema: projectDetailModelInputSchema,
      execute: async (input, context) => {
        const { projectId } = projectDetailInput.parse(input);
        const project = new ProjectRepository(context.db, context.userId).getById(projectId);
        const sessions = project ? new SessionRepository(context.db, context.userId).listByProject(project.id) : [];
        return { project: project ? toProjectDetail(project, sessions, readRuntimeSessions(context)) : null };
      }
    },
    {
      name: "openforge.list_agents",
      description: "List OpenForge agents visible to the current user, optionally scoped to one project.",
      risk: "read",
      requiresApproval: false,
      inputSchema: projectScopedLimitInput,
      modelInputSchema: projectScopedLimitModelInputSchema,
      execute: async (input, context) => listAgents(input, context)
    },
    {
      name: "openforge.list_skills",
      description:
        "List OpenForge skills visible to the current user, optionally with per-project enabled or disabled state.",
      risk: "read",
      requiresApproval: false,
      inputSchema: projectScopedLimitInput,
      modelInputSchema: projectScopedLimitModelInputSchema,
      execute: async (input, context) => listSkills(input, context)
    },
    {
      name: "openforge.get_skill_detail",
      description:
        "Read one OpenForge skill visible to the current user, including a bounded content preview and optional per-project state.",
      risk: "read",
      requiresApproval: false,
      inputSchema: skillDetailInput,
      modelInputSchema: skillDetailModelInputSchema,
      execute: async (input, context) => getSkillDetail(input, context)
    },
    {
      name: "openforge.list_templates",
      description: "List OpenForge project templates visible to the current user without returning full template file contents.",
      risk: "read",
      requiresApproval: false,
      inputSchema: limitInput,
      modelInputSchema: limitModelInputSchema,
      execute: async (input, context) => listTemplates(input, context)
    },
    {
      name: "openforge.list_plugins",
      description:
        "List OpenForge plugin catalog entries visible to the current user, including enabled/disabled state and bounded skill metadata.",
      risk: "read",
      requiresApproval: false,
      inputSchema: limitInput,
      modelInputSchema: limitModelInputSchema,
      execute: async (input, context) => listPlugins(input, context)
    },
    {
      name: "openforge.get_notifications_summary",
      description:
        "Read recent OpenForge notifications for the current user, including unread count, without exposing sensitive payload fields.",
      risk: "read",
      requiresApproval: false,
      inputSchema: limitInput,
      modelInputSchema: limitModelInputSchema,
      execute: async (input, context) => getNotificationsSummary(input, context)
    },
    {
      name: "openforge.get_usage_summary",
      description:
        "Read OpenForge session usage and model cost-rate summary for the current user.",
      risk: "read",
      requiresApproval: false,
      inputSchema: emptyInput,
      modelInputSchema: emptyModelInputSchema,
      execute: async (_input, context) => getUsageSummary(context)
    },
    {
      name: "openforge.list_sessions",
      description: "List OpenForge sessions visible to the current user.",
      risk: "read",
      requiresApproval: false,
      inputSchema: limitInput,
      modelInputSchema: limitModelInputSchema,
      execute: async (input, context) => {
        const projects = new ProjectRepository(context.db, context.userId).list();
        const projectById = new Map(projects.map((project) => [project.id, project]));
        const runtimeSessions = readRuntimeSessions(context);
        return {
          sessions: new SessionRepository(context.db, context.userId)
            .list()
            .slice(0, readLimit(input))
            .map((session) => toSessionSummary(session, projectById.get(session.projectId), runtimeSessions))
        };
      }
    },
    {
      name: "openforge.get_session_detail",
      description: "Read one OpenForge session visible to the current user.",
      risk: "read",
      requiresApproval: false,
      inputSchema: sessionDetailInput,
      modelInputSchema: sessionDetailModelInputSchema,
      execute: async (input, context) => {
        const { sessionId } = sessionDetailInput.parse(input);
        const session = new SessionRepository(context.db, context.userId).getById(sessionId);
        const project = session ? new ProjectRepository(context.db, context.userId).getById(session.projectId) : null;
        return { session: session ? toSessionDetail(session, project ?? undefined, readRuntimeSessions(context)) : null };
      }
    },
    {
      name: "openforge.get_session_terminal_snapshot",
      description:
        "Read a bounded terminal snapshot for one visible running OpenForge session. Use this to observe Claude Code, Codex, or OpenCode output before deciding next steps.",
      risk: "read",
      requiresApproval: false,
      inputSchema: sessionTerminalSnapshotInput,
      modelInputSchema: sessionTerminalSnapshotModelInputSchema,
      execute: async (input, context) =>
        getSessionTerminalSnapshot(input, context)
    },
    {
      name: "openforge.get_adapter_discovery",
      description: "Read local AI CLI adapter availability and launch readiness.",
      risk: "read",
      requiresApproval: false,
      inputSchema: emptyInput,
      modelInputSchema: emptyModelInputSchema,
      execute: async (_input, context) => ({
        adapters: await discoverAdapters(context.adapterCommandRunner)
      })
    },
    {
      name: "openforge.get_model_provider_summary",
      description:
        "Read configured model providers, active models, credential readiness, and the current default Copilot provider/model selection without exposing secrets.",
      risk: "read",
      requiresApproval: false,
      inputSchema: emptyInput,
      modelInputSchema: emptyModelInputSchema,
      execute: async (_input, context) => getModelProviderSummary(context)
    },
    {
      name: "openforge.get_model_provider_catalog",
      description:
        "Read provider catalog products OpenForge can configure, including regions, product types, supported adapters, API formats, endpoints, and default model presets without exposing credentials.",
      risk: "read",
      requiresApproval: false,
      inputSchema: limitInput,
      modelInputSchema: limitModelInputSchema,
      execute: async (input) => listModelProviderCatalog(input)
    },
    {
      name: "openforge.get_recent_activity",
      description: "Read recent OpenForge activity for the current user.",
      risk: "read",
      requiresApproval: false,
      inputSchema: limitInput,
      modelInputSchema: limitModelInputSchema,
      execute: async (input, context) => ({
        activities: new ActivityRepository(context.db, context.userId)
          .list({ limit: readLimit(input) })
          .map(toActivitySummary)
      })
    },
    {
      name: "openforge.get_diagnostics_summary",
      description: "Read a bounded local diagnostics summary without exporting full diagnostics.",
      risk: "read",
      requiresApproval: false,
      inputSchema: emptyInput,
      modelInputSchema: emptyModelInputSchema,
      execute: async (_input, context) => {
        const diagnostics = buildLocalDiagnosticsExport({
          db: context.db,
          userId: context.userId,
          masterKey: context.masterKey,
          appVersion: "0.0.0"
        });
        return {
          diagnostics: {
            generatedAt: diagnostics.generatedAt,
            runtime: diagnostics.runtime,
            counts: diagnostics.counts,
            dashboardHealth: diagnostics.dashboardHealth,
            adapters: diagnostics.adapters,
            modelProviders: diagnostics.modelProviders,
            copilot: diagnostics.copilot
          }
        };
      }
    },
    {
      name: "openforge.propose_session_create",
      description: "Prepare a session creation draft for user approval.",
      risk: "prepare",
      requiresApproval: true,
      inputSchema: proposeSessionCreateInput,
      modelInputSchema: proposeSessionCreateModelInputSchema,
      execute: async (input, context) =>
        createSessionCreateProposal(input, context)
    },
    {
      name: "openforge.propose_project_create",
      description:
        "Prepare a new OpenForge project draft for user approval. This does not create directories or database records until the user approves it.",
      risk: "prepare",
      requiresApproval: true,
      inputSchema: proposeProjectCreateInput,
      modelInputSchema: proposeProjectCreateModelInputSchema,
      execute: async (input, context) =>
        createProjectCreateProposal(input, context)
    },
    {
      name: "openforge.propose_project_import",
      description:
        "Prepare importing an existing project directory into OpenForge for user approval. This does not write database records until the user approves it.",
      risk: "prepare",
      requiresApproval: true,
      inputSchema: proposeProjectImportInput,
      modelInputSchema: proposeProjectImportModelInputSchema,
      execute: async (input, context) =>
        createProjectImportProposal(input, context)
    },
    {
      name: "openforge.propose_project_delete",
      description:
        "Prepare deleting an OpenForge project record for user approval. This is destructive and may stop running sessions for that project when approved.",
      risk: "prepare",
      requiresApproval: true,
      inputSchema: proposeProjectDeleteInput,
      modelInputSchema: proposeProjectDeleteModelInputSchema,
      execute: async (input, context) =>
        createProjectDeleteProposal(input, context)
    },
    {
      name: "openforge.propose_project_config_sync",
      description:
        "Prepare a project AI configuration sync for user approval. This does not write config files until the user approves it.",
      risk: "prepare",
      requiresApproval: true,
      inputSchema: proposeProjectConfigSyncInput,
      modelInputSchema: proposeProjectConfigSyncModelInputSchema,
      execute: async (input, context) =>
        createProjectConfigSyncProposal(input, context)
    },
    {
      name: "openforge.propose_session_input",
      description:
        "Prepare raw terminal input for an existing running OpenForge session for user approval. Use submit=true only when the user explicitly asked to send/execute it.",
      risk: "prepare",
      requiresApproval: true,
      inputSchema: proposeSessionInputInput,
      modelInputSchema: proposeSessionInputModelInputSchema,
      execute: async (input, context) =>
        createSessionInputProposal(input, context)
    },
    {
      name: "openforge.propose_session_start",
      description: "Prepare starting or resuming an existing non-running OpenForge terminal session for user approval.",
      risk: "prepare",
      requiresApproval: true,
      inputSchema: proposeSessionStartInput,
      modelInputSchema: proposeSessionStartModelInputSchema,
      execute: async (input, context) =>
        createSessionStartProposal(input, context)
    },
    {
      name: "openforge.propose_session_stop",
      description: "Prepare stopping an existing running OpenForge terminal session for user approval.",
      risk: "prepare",
      requiresApproval: true,
      inputSchema: proposeSessionStopInput,
      modelInputSchema: proposeSessionStopModelInputSchema,
      execute: async (input, context) =>
        createSessionStopProposal(input, context)
    },
    {
      name: "openforge.propose_session_delete",
      description:
        "Prepare deleting an OpenForge session record for user approval. If the session is running, approval will stop the terminal session before deleting the record.",
      risk: "prepare",
      requiresApproval: true,
      inputSchema: proposeSessionDeleteInput,
      modelInputSchema: proposeSessionDeleteModelInputSchema,
      execute: async (input, context) =>
        createSessionDeleteProposal(input, context)
    },
    {
      name: "openforge.propose_agent_create",
      description:
        "Prepare creating an OpenForge Agent for user approval. This does not create the Agent until the user approves it.",
      risk: "prepare",
      requiresApproval: true,
      inputSchema: proposeAgentCreateInput,
      modelInputSchema: proposeAgentCreateModelInputSchema,
      execute: async (input, context) =>
        createAgentCreateProposal(input, context)
    },
    {
      name: "openforge.propose_agent_update",
      description:
        "Prepare updating an existing OpenForge Agent for user approval. This does not change the Agent until approval.",
      risk: "prepare",
      requiresApproval: true,
      inputSchema: proposeAgentUpdateInput,
      modelInputSchema: proposeAgentUpdateModelInputSchema,
      execute: async (input, context) =>
        createAgentUpdateProposal(input, context)
    },
    {
      name: "openforge.propose_agent_delete",
      description:
        "Prepare deleting an OpenForge Agent for user approval. This does not delete the Agent until approval.",
      risk: "prepare",
      requiresApproval: true,
      inputSchema: proposeAgentDeleteInput,
      modelInputSchema: proposeAgentDeleteModelInputSchema,
      execute: async (input, context) =>
        createAgentDeleteProposal(input, context)
    },
    {
      name: "openforge.propose_template_create",
      description:
        "Prepare creating a custom OpenForge project template for user approval. This does not create the template until approval.",
      risk: "prepare",
      requiresApproval: true,
      inputSchema: proposeTemplateCreateInput,
      modelInputSchema: proposeTemplateCreateModelInputSchema,
      execute: async (input, context) =>
        createTemplateCreateProposal(input, context)
    },
    {
      name: "openforge.propose_template_update",
      description:
        "Prepare updating a custom OpenForge template for user approval. Built-in templates are read-only.",
      risk: "prepare",
      requiresApproval: true,
      inputSchema: proposeTemplateUpdateInput,
      modelInputSchema: proposeTemplateUpdateModelInputSchema,
      execute: async (input, context) =>
        createTemplateUpdateProposal(input, context)
    },
    {
      name: "openforge.propose_template_delete",
      description:
        "Prepare deleting a custom OpenForge template for user approval. Built-in templates are read-only.",
      risk: "prepare",
      requiresApproval: true,
      inputSchema: proposeTemplateDeleteInput,
      modelInputSchema: proposeTemplateDeleteModelInputSchema,
      execute: async (input, context) =>
        createTemplateDeleteProposal(input, context)
    },
    {
      name: "openforge.propose_skill_toggle",
      description:
        "Prepare enabling or disabling a global OpenForge skill for user approval. This does not change the skill until the user approves it.",
      risk: "prepare",
      requiresApproval: true,
      inputSchema: proposeSkillToggleInput,
      modelInputSchema: proposeSkillToggleModelInputSchema,
      execute: async (input, context) =>
        createSkillToggleProposal(input, context)
    },
    {
      name: "openforge.propose_plugin_toggle",
      description:
        "Prepare enabling or disabling an OpenForge plugin for user approval. This does not change plugin state until the user approves it.",
      risk: "prepare",
      requiresApproval: true,
      inputSchema: proposePluginToggleInput,
      modelInputSchema: proposePluginToggleModelInputSchema,
      execute: async (input, context) =>
        createPluginToggleProposal(input, context)
    },
    {
      name: "openforge.propose_project_skill_toggle",
      description:
        "Prepare enabling or disabling one OpenForge skill for a specific project for user approval. This does not change project skill state until approval.",
      risk: "prepare",
      requiresApproval: true,
      inputSchema: proposeProjectSkillToggleInput,
      modelInputSchema: proposeProjectSkillToggleModelInputSchema,
      execute: async (input, context) =>
        createProjectSkillToggleProposal(input, context)
    },
    {
      name: "openforge.propose_copilot_model_selection",
      description:
        "Prepare changing the OpenForge Copilot default provider and model for user approval.",
      risk: "prepare",
      requiresApproval: true,
      inputSchema: proposeCopilotModelSelectionInput,
      modelInputSchema: proposeCopilotModelSelectionModelInputSchema,
      execute: async (input, context) =>
        createCopilotModelSelectionProposal(input, context)
    },
    {
      name: "openforge.propose_model_provider_sync",
      description:
        "Prepare syncing models for a configured model provider for user approval. This uses an existing saved credential and does not expose secrets.",
      risk: "prepare",
      requiresApproval: true,
      inputSchema: proposeModelProviderSyncInput,
      modelInputSchema: proposeModelProviderSyncModelInputSchema,
      execute: async (input, context) =>
        createModelProviderSyncProposal(input, context)
    },
    {
      name: "openforge.propose_model_provider_apply",
      description:
        "Prepare applying a configured model provider to Claude Code, OpenCode, or OpenForge Copilot for user approval. Claude Code and OpenCode require a target project.",
      risk: "prepare",
      requiresApproval: true,
      inputSchema: proposeModelProviderApplyInput,
      modelInputSchema: proposeModelProviderApplyModelInputSchema,
      execute: async (input, context) =>
        createModelProviderApplyProposal(input, context)
    },
    {
      name: "openforge.propose_diagnostics_export",
      description: "Prepare a local diagnostics export for user approval.",
      risk: "prepare",
      requiresApproval: true,
      inputSchema: proposeDiagnosticsExportInput,
      modelInputSchema: proposeDiagnosticsExportModelInputSchema,
      execute: async (input, context) =>
        createPendingProposal(context, "openforge.propose_diagnostics_export", input)
    },
    {
      name: "openforge.propose_adapter_refresh",
      description: "Prepare a local AI CLI adapter discovery refresh for user approval.",
      risk: "prepare",
      requiresApproval: true,
      inputSchema: proposeAdapterRefreshInput,
      modelInputSchema: proposeAdapterRefreshModelInputSchema,
      execute: async (input, context) =>
        createPendingProposal(context, "openforge.propose_adapter_refresh", input)
    },
    {
      name: "openforge.propose_feishu_message_send",
      description: "Prepare sending a Feishu chat message for user approval. This does not invoke Feishu CLI until approved.",
      risk: "prepare",
      requiresApproval: true,
      inputSchema: proposeFeishuMessageSendInput,
      modelInputSchema: proposeFeishuMessageSendModelInputSchema,
      execute: async (input, context) =>
        createFeishuProposal(context, "openforge.propose_feishu_message_send", input, proposeFeishuMessageSendInput)
    },
    {
      name: "openforge.propose_feishu_doc_create",
      description: "Prepare creating a Feishu document for user approval. This does not invoke Feishu CLI until approved.",
      risk: "prepare",
      requiresApproval: true,
      inputSchema: proposeFeishuDocCreateInput,
      modelInputSchema: proposeFeishuDocCreateModelInputSchema,
      execute: async (input, context) =>
        createFeishuProposal(context, "openforge.propose_feishu_doc_create", input, proposeFeishuDocCreateInput)
    },
    {
      name: "openforge.propose_feishu_doc_update",
      description: "Prepare updating a Feishu document for user approval. This does not invoke Feishu CLI until approved.",
      risk: "prepare",
      requiresApproval: true,
      inputSchema: proposeFeishuDocUpdateInput,
      modelInputSchema: proposeFeishuDocUpdateModelInputSchema,
      execute: async (input, context) =>
        createFeishuProposal(context, "openforge.propose_feishu_doc_update", input, proposeFeishuDocUpdateInput)
    },
    {
      name: "openforge.propose_feishu_task_create",
      description: "Prepare creating a Feishu task for user approval. This does not invoke Feishu CLI until approved.",
      risk: "prepare",
      requiresApproval: true,
      inputSchema: proposeFeishuTaskCreateInput,
      modelInputSchema: proposeFeishuTaskCreateModelInputSchema,
      execute: async (input, context) =>
        createFeishuProposal(context, "openforge.propose_feishu_task_create", input, proposeFeishuTaskCreateInput)
    },
    {
      name: "openforge.propose_feishu_task_update",
      description: "Prepare updating a Feishu task for user approval. This does not invoke Feishu CLI until approved.",
      risk: "prepare",
      requiresApproval: true,
      inputSchema: proposeFeishuTaskUpdateInput,
      modelInputSchema: proposeFeishuTaskUpdateModelInputSchema,
      execute: async (input, context) =>
        createFeishuProposal(context, "openforge.propose_feishu_task_update", input, proposeFeishuTaskUpdateInput)
    },
    {
      name: "openforge.propose_troubleshooting_steps",
      description: "Prepare troubleshooting steps for user approval.",
      risk: "prepare",
      requiresApproval: true,
      inputSchema: proposeTroubleshootingStepsInput,
      modelInputSchema: proposeTroubleshootingStepsModelInputSchema,
      execute: async (input, context) =>
        createPendingProposal(context, "openforge.propose_troubleshooting_steps", input)
    },
    ...createCopilotMemoryTools()
  ];
}

function readLimit(input: unknown): number {
  if (!input || typeof input !== "object" || Array.isArray(input)) return 20;
  const value = (input as { limit?: unknown }).limit;
  return typeof value === "number" ? value : 20;
}

interface RuntimeSessionSummary {
  id: string;
  status: string;
  tmuxName: string;
}

type RuntimeSessionIndex = Map<string, RuntimeSessionSummary> | null;

function readRuntimeSessions(context: Pick<CopilotToolContext, "sessionManager">): RuntimeSessionIndex {
  try {
    const sessions = context.sessionManager?.listSessions?.();
    if (!sessions) return null;
    return new Map(sessions.map((session) => [session.id, session]));
  } catch {
    return null;
  }
}

function toProjectSummary(project: Project, sessions: Session[] = [], runtimeSessions: RuntimeSessionIndex = null) {
  const sessionStates = sessions.map((session) => toSessionRuntimeState(session, runtimeSessions));
  const runningSessionCount = sessionStates.filter((state) => state.isLive).length;
  const staleRunningSessionCount = sessionStates.filter((state) => state.isStaleRunningRecord).length;
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    aiTool: project.aiTool,
    projectStatus: project.status,
    sessionStatus: projectSessionStatus(runningSessionCount, staleRunningSessionCount),
    isImported: project.isImported,
    totalSessionCount: sessions.length,
    runningSessionCount,
    staleRunningSessionCount,
    hasRunningSession: runningSessionCount > 0
  };
}

function toProjectDetail(project: Project, sessions: Session[], runtimeSessions: RuntimeSessionIndex = null) {
  return {
    ...toProjectSummary(project, sessions, runtimeSessions),
    description: project.description,
    techStack: project.techStack,
    templateId: project.templateId,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString()
  };
}

function toSessionSummary(session: Session, project?: Project, runtimeSessions: RuntimeSessionIndex = null) {
  const runtimeState = toSessionRuntimeState(session, runtimeSessions);
  return {
    id: session.id,
    projectId: session.projectId,
    projectName: project?.name ?? null,
    projectPath: project?.path ?? null,
    name: session.name,
    aiTool: session.aiTool,
    status: session.status,
    runtimeStatus: runtimeState.runtimeStatus,
    isLive: runtimeState.isLive,
    isStaleRunningRecord: runtimeState.isStaleRunningRecord,
    credentialMode: session.credentialMode,
    tmuxSession: session.tmuxSession
  };
}

function toSessionDetail(session: Session, project?: Project, runtimeSessions: RuntimeSessionIndex = null) {
  return {
    ...toSessionSummary(session, project, runtimeSessions),
    modelId: session.modelId,
    agentId: session.agentId,
    workingDir: session.workingDir,
    lastActive: session.lastActive?.toISOString() ?? null,
    errorMessage: session.errorMessage,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString()
  };
}

function toSessionRuntimeState(session: Session, runtimeSessions: RuntimeSessionIndex) {
  const dbRunning = session.status === "running" || session.status === "detached";
  if (!dbRunning) {
    return {
      runtimeStatus: session.status,
      isLive: false,
      isStaleRunningRecord: false
    };
  }
  if (!runtimeSessions) {
    return {
      runtimeStatus: session.status,
      isLive: true,
      isStaleRunningRecord: false
    };
  }
  const runtime = runtimeSessions.get(session.id);
  const tmuxMatches = !session.tmuxSession || !runtime?.tmuxName || runtime.tmuxName === session.tmuxSession;
  const live = Boolean(runtime && tmuxMatches && (runtime.status === "running" || runtime.status === "detached"));
  return {
    runtimeStatus: live ? runtime?.status ?? session.status : "stale",
    isLive: live,
    isStaleRunningRecord: !live
  };
}

function projectSessionStatus(runningSessionCount: number, staleRunningSessionCount: number): string {
  if (runningSessionCount > 0) return "has_running_sessions";
  if (staleRunningSessionCount > 0) return "no_live_sessions_stale_records";
  return "no_running_sessions";
}

function listAgents(
  input: unknown,
  context: Pick<CopilotToolContext, "db" | "userId">
) {
  const parsed = projectScopedLimitInput.parse(input);
  const projects = new ProjectRepository(context.db, context.userId).list();
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const agents = new AgentRepository(context.db, context.userId)
    .list()
    .filter((agent) => !parsed.projectId || agent.projectId === parsed.projectId)
    .slice(0, readLimit(parsed))
    .map((agent) => toAgentSummary(agent, agent.projectId ? projectById.get(agent.projectId) : undefined));
  return { agents };
}

function toAgentSummary(agent: Agent, project?: Project) {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    projectId: agent.projectId,
    projectName: project?.name ?? null,
    modelId: agent.modelId,
    tools: agent.tools,
    allowedDirs: agent.allowedDirs,
    status: agent.status
  };
}

function listSkills(
  input: unknown,
  context: Pick<CopilotToolContext, "db" | "userId">
) {
  const parsed = projectScopedLimitInput.parse(input);
  if (parsed.projectId) {
    const project = new ProjectRepository(context.db, context.userId).getById(parsed.projectId);
    if (!project) return { project: null, skills: [] };
    return {
      project: { id: project.id, name: project.name },
      skills: new ProjectSkillRepository(context.db, context.userId)
        .listByProject(project.id)
        .slice(0, readLimit(parsed))
        .map(toProjectSkillSummary)
    };
  }
  return {
    skills: new SkillRepository(context.db, context.userId)
      .list()
      .slice(0, readLimit(parsed))
      .map(toSkillSummary)
  };
}

function getSkillDetail(
  input: unknown,
  context: Pick<CopilotToolContext, "db" | "userId">
) {
  const parsed = skillDetailInput.parse(input);
  const skill = new SkillRepository(context.db, context.userId).getById(parsed.skillId);
  if (!skill) return { skill: null };
  const projectSkill = parsed.projectId
    ? new ProjectSkillRepository(context.db, context.userId)
      .listByProject(parsed.projectId)
      .find((item) => item.skillId === skill.id)
    : undefined;
  return {
    skill: {
      ...toSkillSummary(skill),
      ...(projectSkill ? {
        projectSelectionState: projectSkill.selectionState,
        projectEnabled: projectSkill.isEnabled
      } : {}),
      contentPreview: tailByUtf8Bytes(skill.content, 4_000).text
    }
  };
}

function toSkillSummary(skill: Skill) {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    source: skill.source,
    version: skill.version,
    visibility: skill.visibility,
    isEnabled: skill.isEnabled
  };
}

function toProjectSkillSummary(skill: ProjectSkill) {
  return {
    skillId: skill.skillId,
    name: skill.name,
    description: skill.description,
    source: skill.source,
    version: skill.version,
    isEnabled: skill.isEnabled,
    selectionState: skill.selectionState
  };
}

function listTemplates(
  input: unknown,
  context: Pick<CopilotToolContext, "db" | "userId">
) {
  const parsed = limitInput.parse(input);
  const repo = new TemplateRepository(context.db, context.userId);
  return {
    templates: [...repo.listBuiltIn(), ...repo.list()]
      .slice(0, readLimit(parsed))
      .map((template) => toTemplateSummary(repo.getById(template.id) ?? template))
  };
}

function toTemplateSummary(template: Template & { files?: TemplateFile[] }) {
  const files = "files" in template && Array.isArray(template.files) ? template.files : [];
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    version: template.version,
    visibility: template.visibility,
    status: template.status,
    isBuiltin: template.isBuiltin,
    usageCount: template.usageCount,
    fileCount: files.length,
    filePaths: files.map((file) => file.filePath).slice(0, 20)
  };
}

function listPlugins(
  input: unknown,
  context: Pick<CopilotToolContext, "db" | "userId">
) {
  const parsed = limitInput.parse(input);
  return {
    plugins: new PluginRepository(context.db, context.userId)
      .list()
      .slice(0, readLimit(parsed))
      .map(toPluginSummary)
  };
}

function toPluginSummary(plugin: PluginSummary) {
  return {
    id: plugin.id,
    name: plugin.name,
    description: plugin.description,
    version: plugin.version,
    adapter: plugin.adapter,
    category: plugin.category,
    status: plugin.status,
    enabled: plugin.enabled,
    configPath: plugin.configPath,
    skillCount: plugin.skills.length,
    skills: plugin.skills.map((skill) => ({
      name: skill.name,
      description: skill.description
    })).slice(0, 20)
  };
}

function getNotificationsSummary(
  input: unknown,
  context: Pick<CopilotToolContext, "db" | "userId">
) {
  const parsed = limitInput.parse(input);
  const repo = new NotificationRepository(context.db, context.userId);
  return {
    unreadCount: repo.unreadCount(),
    notifications: repo.list(readLimit(parsed)).map(toNotificationSummary)
  };
}

function toNotificationSummary(notification: Notification) {
  return {
    id: notification.id,
    type: notification.type,
    titleKey: notification.titleKey,
    message: notification.message,
    href: notification.href,
    sessionId: notification.sessionId,
    payload: parseMetadata(notification.payload),
    read: notification.isRead,
    createdAt: notification.createdAt.toISOString(),
    updatedAt: notification.updatedAt.toISOString()
  };
}

function getUsageSummary(context: Pick<CopilotToolContext, "db" | "userId">) {
  const repo = new UsageRepository(context.db, context.userId);
  return {
    summary: repo.getSummary(),
    rates: repo.listModelRates().map(toUsageRateSummary)
  };
}

function toUsageRateSummary(rate: UsageRate) {
  return {
    modelId: rate.modelId,
    hourlyRateUsd: rate.hourlyRateUsd
  };
}

function toActivitySummary(activity: SessionActivity) {
  return {
    id: activity.id,
    sessionId: activity.sessionId,
    projectId: activity.projectId,
    type: activity.type,
    status: activity.status,
    message: activity.message,
    metadata: parseMetadata(activity.metadata),
    createdAt: activity.createdAt.toISOString()
  };
}

function getModelProviderSummary(context: Pick<CopilotToolContext, "db" | "userId" | "masterKey">) {
  const repo = new ModelProviderRepository(context.db, context.userId, context.masterKey);
  const providers = repo.listProviderProfiles();
  const models = repo.listModelProfiles();
  const credentials = repo.listCredentials();
  const selection = selectCopilotProvider({
    db: context.db,
    userId: context.userId,
    masterKey: context.masterKey,
    allowOpenAiCompatible: true
  });
  return {
    copilotSelection: selection.ok
      ? toCopilotSelectionSummary(selection.selection)
      : {
          configured: false,
          errorCode: selection.error.code,
          message: selection.error.message
        },
    providers: providers.map((provider) => toModelProviderSummary(provider, models, credentials))
  };
}

async function listModelProviderCatalog(input: unknown) {
  const parsed = limitInput.parse(input);
  const providers = await loadProviderCatalog();
  return {
    providers: providers
      .slice(0, readLimit(parsed))
      .map(toModelProviderCatalogSummary)
  };
}

function toModelProviderCatalogSummary(provider: ProviderCatalogPreset) {
  const protocols = [
    provider.endpoints.anthropic ? "anthropic" : null,
    provider.endpoints.openai ? "openai" : null
  ].filter((protocol): protocol is "anthropic" | "openai" => Boolean(protocol));
  return {
    id: provider.id,
    name: provider.name,
    description: provider.description,
    region: provider.region,
    productType: provider.productType,
    authType: provider.authType,
    apiFormat: provider.apiFormat,
    supportedAdapters: provider.supportedAdapters,
    modelSource: provider.modelSource,
    source: provider.source ?? "verified",
    protocols,
    endpoints: {
      ...(provider.endpoints.anthropic ? { anthropic: provider.endpoints.anthropic.baseUrl } : {}),
      ...(provider.endpoints.openai ? { openai: provider.endpoints.openai.baseUrl } : {})
    },
    modelFetch: provider.modelFetch ? {
      strategy: provider.modelFetch.strategy,
      hasModelsUrl: Boolean(provider.modelFetch.modelsUrl)
    } : null,
    defaultModelCount: provider.defaultModels.length,
    defaultModels: provider.defaultModels.slice(0, 20).map((model) => ({
      id: model.id,
      name: model.name,
      modelId: model.modelId,
      capabilities: model.capabilities,
      contextWindow: model.contextWindow ?? null
    }))
  };
}

function toCopilotSelectionSummary(selection: {
  provider: ProviderProfile;
  model: ModelProfile;
  format: string;
  clientKind: string;
  apiKey: string | null;
}) {
  return {
    configured: true,
    providerProfileId: selection.provider.id,
    providerName: selection.provider.name,
    providerKey: selection.provider.providerKey,
    modelProfileId: selection.model.id,
    modelName: selection.model.name,
    modelId: selection.model.modelId,
    apiFormat: selection.format,
    clientKind: selection.clientKind,
    credentialConfigured: selection.provider.authType === "none" || selection.apiKey !== null
  };
}

function toModelProviderSummary(
  provider: ProviderProfile,
  models: ModelProfile[],
  credentials: Array<{ providerProfileId: string; status: string }>
) {
  const providerModels = models.filter((model) => model.providerProfileId === provider.id);
  const providerCredentials = credentials.filter((credential) => credential.providerProfileId === provider.id);
  const activeModelCount = providerModels.filter((model) => model.status === "active").length;
  const activeCredentialCount = providerCredentials.filter((credential) => credential.status === "active").length;
  const defaultModel = providerModels.find((model) => model.isDefault) ?? null;
  return {
    id: provider.id,
    name: provider.name,
    providerKey: provider.providerKey,
    status: provider.status,
    apiFormat: provider.apiFormat,
    supportedAdapters: provider.supportedAdapters,
    baseUrl: provider.baseUrl,
    anthropicBaseUrl: provider.anthropicBaseUrl,
    openaiBaseUrl: provider.openaiBaseUrl,
    region: provider.region,
    productType: provider.productType,
    authType: provider.authType,
    modelCount: providerModels.length,
    activeModelCount,
    credentialCount: providerCredentials.length,
    activeCredentialCount,
    readyForCopilot: provider.status === "active" &&
      activeModelCount > 0 &&
      (provider.authType === "none" || activeCredentialCount > 0) &&
      (provider.apiFormat === "openai" || provider.apiFormat === "openai-compatible" || provider.apiFormat === "anthropic"),
    defaultModelId: defaultModel?.id ?? null
  };
}

function parseMetadata(metadata: string | null): unknown {
  if (!metadata) return null;
  try {
    return JSON.parse(metadata) as unknown;
  } catch {
    return null;
  }
}

function createPendingProposal(
  context: Pick<CopilotToolContext, "db" | "userId" | "runId">,
  type: string,
  input: unknown
) {
  if (!context.runId) {
    throw new Error("Copilot run is required for pending actions");
  }
  const action = new CopilotRepository(context.db, context.userId).createPendingAction(context.runId, {
    type,
    input: safeActionInput(input)
  });
  return {
    actionId: action.id,
    type: action.type,
    status: action.status,
    summary: "Pending user approval"
  };
}

function createSessionCreateProposal(
  input: unknown,
  context: Pick<CopilotToolContext, "db" | "userId" | "runId">
) {
  const parsed = proposeSessionCreateInput.parse(input);
  const projectRepo = new ProjectRepository(context.db, context.userId);
  const project = resolveSessionDraftProject(projectRepo, parsed.projectId);
  if (!project) {
    throw new CopilotToolValidationError("Copilot session draft project is not available");
  }
  return createPendingProposal(context, "openforge.propose_session_create", {
    ...parsed,
    projectId: project.id
  });
}

function resolveSessionDraftProject(projectRepo: ProjectRepository, rawProjectId: string | null | undefined): Project | null {
  const projectId = normalizeProjectId(rawProjectId);
  if (projectId) {
    return projectRepo.getById(projectId) ?? null;
  }

  const projects = projectRepo.list();
  if (projects.length === 1) {
    return projects[0] ?? null;
  }
  if (projects.length === 0) {
    throw new CopilotToolValidationError("Copilot session draft requires an existing project");
  }
  throw new CopilotToolValidationError("Copilot session draft requires a project when multiple projects are available");
}

function normalizeProjectId(projectId: string | null | undefined): string | null {
  if (typeof projectId !== "string") {
    return null;
  }
  const trimmed = projectId.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") {
    return null;
  }
  return trimmed;
}

function createProjectCreateProposal(
  input: unknown,
  context: Pick<CopilotToolContext, "db" | "userId" | "runId">
) {
  const parsed = proposeProjectCreateInput.parse(input);
  return createPendingProposal(context, "openforge.propose_project_create", parsed);
}

function createProjectImportProposal(
  input: unknown,
  context: Pick<CopilotToolContext, "db" | "userId" | "runId">
) {
  const parsed = proposeProjectImportInput.parse(input);
  return createPendingProposal(context, "openforge.propose_project_import", parsed);
}

function createProjectDeleteProposal(
  input: unknown,
  context: Pick<CopilotToolContext, "db" | "userId" | "runId">
) {
  const parsed = proposeProjectDeleteInput.parse(input);
  const project = new ProjectRepository(context.db, context.userId).getById(parsed.projectId);
  if (!project) {
    throw new CopilotToolValidationError("Copilot project delete target is not available");
  }
  return createPendingProposal(context, "openforge.propose_project_delete", parsed);
}

function createFeishuProposal<T>(
  context: Pick<CopilotToolContext, "db" | "userId" | "runId">,
  type: string,
  input: unknown,
  schema: z.ZodType<T>
) {
  return createPendingProposal(context, type, schema.parse(input));
}

function createProjectConfigSyncProposal(
  input: unknown,
  context: Pick<CopilotToolContext, "db" | "userId" | "runId">
) {
  const parsed = proposeProjectConfigSyncInput.parse(input);
  const project = new ProjectRepository(context.db, context.userId).getById(parsed.projectId);
  if (!project) {
    throw new CopilotToolValidationError("Copilot project config sync target is not available");
  }
  return createPendingProposal(context, "openforge.propose_project_config_sync", parsed);
}

function createSessionInputProposal(
  input: unknown,
  context: Pick<CopilotToolContext, "db" | "userId" | "runId">
) {
  const parsed = proposeSessionInputInput.parse(input);
  const session = new SessionRepository(context.db, context.userId).getById(parsed.sessionId);
  if (!session || session.status !== "running" || !session.tmuxSession) {
    throw new CopilotToolValidationError("Copilot session input target is not a running terminal session");
  }
  if (!hasSameRunSessionInputEvidence(context, parsed.sessionId)) {
    throw new CopilotToolValidationError(
      "Copilot session input requires same-run session detail and terminal snapshot evidence"
    );
  }
  return createPendingProposal(context, "openforge.propose_session_input", parsed);
}

function hasSameRunSessionInputEvidence(
  context: Pick<CopilotToolContext, "db" | "userId" | "runId">,
  sessionId: string
): boolean {
  if (!context.runId) return false;
  const events = new CopilotRepository(context.db, context.userId).listEvents(context.runId);
  const hasDetail = events.some((event) =>
    event.type === "tool_result" &&
    event.message === "openforge.get_session_detail" &&
    outputSessionId(event.payload) === sessionId
  );
  const hasTerminalSnapshot = events.some((event) =>
    event.type === "tool_result" &&
    event.message === "openforge.get_session_terminal_snapshot" &&
    outputSessionId(event.payload) === sessionId &&
    outputTerminalAvailable(event.payload)
  );
  return hasDetail && hasTerminalSnapshot;
}

function outputSessionId(payload: Record<string, unknown>): string | null {
  const output = toPlainRecord(payload.output);
  const session = toPlainRecord(output?.session);
  const id = session?.id;
  return typeof id === "string" && id.trim() ? id : null;
}

function outputTerminalAvailable(payload: Record<string, unknown>): boolean {
  const output = toPlainRecord(payload.output);
  const terminal = toPlainRecord(output?.terminal);
  return terminal?.available === true;
}

function toPlainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function createSessionStartProposal(
  input: unknown,
  context: Pick<CopilotToolContext, "db" | "userId" | "runId">
) {
  const parsed = proposeSessionStartInput.parse(input);
  const session = new SessionRepository(context.db, context.userId).getById(parsed.sessionId);
  if (!session) {
    throw new CopilotToolValidationError("Copilot session start target is not available");
  }
  if (session.status === "running") {
    throw new CopilotToolValidationError("Copilot session start target is already running");
  }
  return createPendingProposal(context, "openforge.propose_session_start", parsed);
}

function createSessionStopProposal(
  input: unknown,
  context: Pick<CopilotToolContext, "db" | "userId" | "runId">
) {
  const parsed = proposeSessionStopInput.parse(input);
  const session = new SessionRepository(context.db, context.userId).getById(parsed.sessionId);
  if (!session || session.status !== "running" || !session.tmuxSession) {
    throw new CopilotToolValidationError("Copilot session stop target is not a running terminal session");
  }
  return createPendingProposal(context, "openforge.propose_session_stop", parsed);
}

function createSessionDeleteProposal(
  input: unknown,
  context: Pick<CopilotToolContext, "db" | "userId" | "runId">
) {
  const parsed = proposeSessionDeleteInput.parse(input);
  const session = new SessionRepository(context.db, context.userId).getById(parsed.sessionId);
  if (!session) {
    throw new CopilotToolValidationError("Copilot session delete target is not available");
  }
  return createPendingProposal(context, "openforge.propose_session_delete", parsed);
}

function createAgentCreateProposal(
  input: unknown,
  context: Pick<CopilotToolContext, "db" | "userId" | "runId">
) {
  const parsed = proposeAgentCreateInput.parse(input);
  if (parsed.projectId && !new ProjectRepository(context.db, context.userId).getById(parsed.projectId)) {
    throw new CopilotToolValidationError("Copilot agent create project is not available");
  }
  return createPendingProposal(context, "openforge.propose_agent_create", parsed);
}

function createAgentUpdateProposal(
  input: unknown,
  context: Pick<CopilotToolContext, "db" | "userId" | "runId">
) {
  const parsed = proposeAgentUpdateInput.parse(input);
  const agent = new AgentRepository(context.db, context.userId).getById(parsed.agentId);
  if (!agent) {
    throw new CopilotToolValidationError("Copilot agent update target is not available");
  }
  if (parsed.projectId && !new ProjectRepository(context.db, context.userId).getById(parsed.projectId)) {
    throw new CopilotToolValidationError("Copilot agent update project is not available");
  }
  return createPendingProposal(context, "openforge.propose_agent_update", parsed);
}

function createAgentDeleteProposal(
  input: unknown,
  context: Pick<CopilotToolContext, "db" | "userId" | "runId">
) {
  const parsed = proposeAgentDeleteInput.parse(input);
  const agent = new AgentRepository(context.db, context.userId).getById(parsed.agentId);
  if (!agent) {
    throw new CopilotToolValidationError("Copilot agent delete target is not available");
  }
  return createPendingProposal(context, "openforge.propose_agent_delete", parsed);
}

function createTemplateCreateProposal(
  input: unknown,
  context: Pick<CopilotToolContext, "db" | "userId" | "runId">
) {
  const parsed = proposeTemplateCreateInput.parse(input);
  return createPendingProposal(context, "openforge.propose_template_create", parsed);
}

function createTemplateUpdateProposal(
  input: unknown,
  context: Pick<CopilotToolContext, "db" | "userId" | "runId">
) {
  const parsed = proposeTemplateUpdateInput.parse(input);
  const template = new TemplateRepository(context.db, context.userId).getById(parsed.templateId);
  if (!template || template.isBuiltin) {
    throw new CopilotToolValidationError("Copilot template update target is not an editable custom template");
  }
  return createPendingProposal(context, "openforge.propose_template_update", parsed);
}

function createTemplateDeleteProposal(
  input: unknown,
  context: Pick<CopilotToolContext, "db" | "userId" | "runId">
) {
  const parsed = proposeTemplateDeleteInput.parse(input);
  const template = new TemplateRepository(context.db, context.userId).getById(parsed.templateId);
  if (!template || template.isBuiltin) {
    throw new CopilotToolValidationError("Copilot template delete target is not an editable custom template");
  }
  return createPendingProposal(context, "openforge.propose_template_delete", parsed);
}

function createSkillToggleProposal(
  input: unknown,
  context: Pick<CopilotToolContext, "db" | "userId" | "runId">
) {
  const parsed = proposeSkillToggleInput.parse(input);
  const skill = new SkillRepository(context.db, context.userId).getById(parsed.skillId);
  if (!skill) {
    throw new CopilotToolValidationError("Copilot skill toggle target is not available");
  }
  return createPendingProposal(context, "openforge.propose_skill_toggle", parsed);
}

function createPluginToggleProposal(
  input: unknown,
  context: Pick<CopilotToolContext, "db" | "userId" | "runId">
) {
  const parsed = proposePluginToggleInput.parse(input);
  const plugin = new PluginRepository(context.db, context.userId).getByPluginId(parsed.pluginId);
  if (!plugin) {
    throw new CopilotToolValidationError("Copilot plugin toggle target is not available");
  }
  return createPendingProposal(context, "openforge.propose_plugin_toggle", parsed);
}

function createProjectSkillToggleProposal(
  input: unknown,
  context: Pick<CopilotToolContext, "db" | "userId" | "runId">
) {
  const parsed = proposeProjectSkillToggleInput.parse(input);
  const project = new ProjectRepository(context.db, context.userId).getById(parsed.projectId);
  if (!project) {
    throw new CopilotToolValidationError("Copilot project skill toggle project is not available");
  }
  const skill = new SkillRepository(context.db, context.userId).getById(parsed.skillId);
  if (!skill) {
    throw new CopilotToolValidationError("Copilot project skill toggle skill is not available");
  }
  return createPendingProposal(context, "openforge.propose_project_skill_toggle", parsed);
}

function createCopilotModelSelectionProposal(
  input: unknown,
  context: Pick<CopilotToolContext, "db" | "userId" | "masterKey" | "runId">
) {
  const parsed = proposeCopilotModelSelectionInput.parse(input);
  const repo = new ModelProviderRepository(context.db, context.userId, context.masterKey);
  const validation = validateCopilotModelSelectionTarget(repo, parsed.providerProfileId, parsed.modelProfileId);
  if (!validation.ok) {
    throw new CopilotToolValidationError(validation.message);
  }
  return createPendingProposal(context, "openforge.propose_copilot_model_selection", parsed);
}

function createModelProviderSyncProposal(
  input: unknown,
  context: Pick<CopilotToolContext, "db" | "userId" | "masterKey" | "runId">
) {
  const parsed = proposeModelProviderSyncInput.parse(input);
  const repo = new ModelProviderRepository(context.db, context.userId, context.masterKey);
  const provider = repo.getProviderProfile(parsed.providerProfileId);
  if (!provider) {
    throw new CopilotToolValidationError("Copilot model provider sync provider is not available");
  }
  if (!provider.openaiBaseUrl && !provider.baseUrl) {
    throw new CopilotToolValidationError("Copilot model provider sync requires a provider base URL");
  }
  const credential = selectProviderApplyCredential(repo, provider.id, parsed.credentialId);
  if (provider.authType !== "none" && !credential) {
    throw new CopilotToolValidationError("Copilot model provider sync provider has no active credential");
  }
  return createPendingProposal(context, "openforge.propose_model_provider_sync", {
    providerProfileId: provider.id,
    ...(credential ? { credentialId: credential.id } : {}),
    ...(parsed.timeoutMs ? { timeoutMs: parsed.timeoutMs } : {}),
    ...(parsed.reason ? { reason: parsed.reason } : {})
  });
}

function createModelProviderApplyProposal(
  input: unknown,
  context: Pick<CopilotToolContext, "db" | "userId" | "masterKey" | "runId">
) {
  const parsed = proposeModelProviderApplyInput.parse(input);
  const repo = new ModelProviderRepository(context.db, context.userId, context.masterKey);
  const target = getModelProviderApplyProposalTarget(repo, context.userId, context.db, parsed);
  if (!target.ok) {
    throw new CopilotToolValidationError(target.message);
  }
  return createPendingProposal(context, "openforge.propose_model_provider_apply", {
    adapter: parsed.adapter,
    providerProfileId: target.provider.id,
    modelProfileId: target.model.id,
    ...(target.credential ? { credentialId: target.credential.id } : {}),
    ...(target.project ? { projectId: target.project.id } : {}),
    ...(parsed.reason ? { reason: parsed.reason } : {})
  });
}

function getModelProviderApplyProposalTarget(
  repo: ModelProviderRepository,
  userId: string,
  db: CopilotToolContext["db"],
  input: z.infer<typeof proposeModelProviderApplyInput>
): (
  { ok: true; provider: ProviderProfile; model: ModelProfile; credential?: { id: string } | undefined; project?: Project | undefined } |
  { ok: false; message: string }
) {
  const provider = repo.getProviderProfile(input.providerProfileId);
  if (!provider || provider.status !== "active") {
    return { ok: false, message: "Copilot model provider apply provider is not available" };
  }
  if (input.adapter !== "openforge-copilot" && !provider.supportedAdapters.includes(input.adapter)) {
    return { ok: false, message: "Copilot model provider apply adapter is not supported by this provider" };
  }
  if (input.adapter === "openforge-copilot" && !isCopilotCompatibleApiFormat(provider.apiFormat)) {
    return { ok: false, message: "Copilot model provider apply provider format is not supported" };
  }
  const model = selectProviderApplyModel(repo, provider.id, input.modelProfileId);
  if (!model) {
    return { ok: false, message: "Copilot model provider apply model is not available" };
  }
  const credential = selectProviderApplyCredential(repo, provider.id, input.credentialId);
  if (provider.authType !== "none" && !credential) {
    return { ok: false, message: "Copilot model provider apply provider has no active credential" };
  }
  if (input.adapter === "openforge-copilot") {
    return { ok: true, provider, model, ...(credential ? { credential } : {}) };
  }
  if (!input.projectId) {
    return { ok: false, message: "Copilot model provider apply requires a target project" };
  }
  const project = new ProjectRepository(db, userId).getById(input.projectId);
  if (!project) {
    return { ok: false, message: "Copilot model provider apply project is not available" };
  }
  return { ok: true, provider, model, ...(credential ? { credential } : {}), project };
}

function selectProviderApplyModel(
  repo: ModelProviderRepository,
  providerId: string,
  modelProfileId: string | undefined
): ModelProfile | undefined {
  if (modelProfileId) {
    const model = repo.getModelProfile(modelProfileId);
    return model?.providerProfileId === providerId && model.status === "active" ? model : undefined;
  }
  return repo.listModelProfiles(providerId).find((model) => model.status === "active");
}

function selectProviderApplyCredential(
  repo: ModelProviderRepository,
  providerId: string,
  credentialId: string | undefined
): { id: string } | undefined {
  if (credentialId) {
    const credential = repo.getCredential(credentialId);
    return credential?.providerProfileId === providerId && credential.status === "active" ? credential : undefined;
  }
  return repo.listCredentials(providerId).find((credential) => credential.status === "active");
}

function validateCopilotModelSelectionTarget(
  repo: ModelProviderRepository,
  providerProfileId: string,
  modelProfileId: string
): { ok: true } | { ok: false; message: string } {
  const provider = repo.getProviderProfile(providerProfileId);
  if (!provider || provider.status !== "active") {
    return { ok: false, message: "Copilot model selection provider is not available" };
  }
  const model = repo.getModelProfile(modelProfileId);
  if (!model || model.providerProfileId !== provider.id || model.status !== "active") {
    return { ok: false, message: "Copilot model selection model is not available" };
  }
  if (!isCopilotCompatibleApiFormat(provider.apiFormat)) {
    return { ok: false, message: "Copilot model selection provider format is not supported" };
  }
  const hasCredential = provider.authType === "none" ||
    repo.listCredentials(provider.id).some((credential) => credential.status === "active");
  if (!hasCredential) {
    return { ok: false, message: "Copilot model selection provider has no active credential" };
  }
  return { ok: true };
}

function isCopilotCompatibleApiFormat(apiFormat: string): boolean {
  return apiFormat === "openai" || apiFormat === "openai-compatible" || apiFormat === "anthropic";
}

async function getSessionTerminalSnapshot(
  input: unknown,
  context: Pick<CopilotToolContext, "db" | "userId" | "sessionManager">
) {
  const parsed = sessionTerminalSnapshotInput.parse(input);
  const session = new SessionRepository(context.db, context.userId).getById(parsed.sessionId);
  if (!session) {
    return {
      session: null,
      terminal: {
        available: false,
        reason: "session_not_found"
      }
    };
  }
  const project = new ProjectRepository(context.db, context.userId).getById(session.projectId) ?? undefined;
  const runtimeSessions = readRuntimeSessions(context);
  const sessionDetail = toSessionDetail(session, project, runtimeSessions);
  if (!session.tmuxSession || (session.status !== "running" && session.status !== "detached")) {
    return {
      session: sessionDetail,
      terminal: {
        available: false,
        reason: "session_not_running"
      }
    };
  }
  if (runtimeSessions && !toSessionRuntimeState(session, runtimeSessions).isLive) {
    return {
      session: sessionDetail,
      terminal: {
        available: false,
        reason: "terminal_session_not_attached"
      }
    };
  }
  if (!context.sessionManager) {
    return {
      session: sessionDetail,
      terminal: {
        available: false,
        reason: "terminal_history_unavailable"
      }
    };
  }
  try {
    const history = await context.sessionManager.captureHistory(session.id);
    const bounded = tailByUtf8Bytes(history, parsed.maxBytes);
    return {
      session: sessionDetail,
      terminal: {
        available: true,
        maxBytes: parsed.maxBytes,
        truncated: bounded.truncated,
        text: bounded.text
      }
    };
  } catch {
    return {
      session: sessionDetail,
      terminal: {
        available: false,
        reason: "terminal_capture_failed"
      }
    };
  }
}

function safeActionInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const redacted = redactCopilotPayload(input);
  if (!redacted || typeof redacted !== "object" || Array.isArray(redacted)) return {};
  return redacted as Record<string, unknown>;
}

function tailByUtf8Bytes(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.byteLength <= maxBytes) return { text, truncated: false };
  return {
    text: buffer.subarray(buffer.byteLength - maxBytes).toString("utf8").replace(/^\uFFFD/u, ""),
    truncated: true
  };
}
