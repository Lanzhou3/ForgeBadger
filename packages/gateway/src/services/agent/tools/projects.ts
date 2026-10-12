import { executeAgentAction } from "../../platform-commands/agent-actions.js";
/**
 * Project tools for the Copilot harness — the "projects" seam of the platform
 * tool surface. Read tools expose project state; the operate tool (create
 * project) is approval-gated and only fires after the owner approves it.
 *
 * Queries and writes use the native Copilot platform-access service.
 */
import { z } from "zod";
import { TemplateRepository, builtInTemplateSummaries } from "../../../db/repositories/template-repository.js";
import { previewMcpConfig } from "../../mcp/project-workflow.js";
import {
  getProjectDetail,
  listProjectSummaries
} from "../platform-access.js";
import type { Database } from "../../../db/types.js";
import type { AgentTool, AgentToolContext } from "../tool-registry.js";

const listProjectsInput = z.object({
  limit: z.number().int().min(1).max(100).optional()
}).strict();

const getProjectInput = z.object({
  projectId: z.string().min(1).max(128)
}).strict();

const createProjectInput = z.object({
  name: z.string().min(1).max(200),
  path: z.string().min(1).max(1024),
  description: z.string().max(2000).optional(),
  techStack: z.string().max(2000).optional(),
  templateId: z.string().min(1).max(128).optional()
}).strict();
const previewConfigInput = z.object({ projectId: z.string().min(1).max(128), templateId: z.string().min(1).max(128) }).strict();
const applyConfigInput = previewConfigInput.extend({ expectedDigest: z.string().regex(/^[0-9a-f]{64}$/) }).strict();

function toolDb(context: AgentToolContext): { db: Database; userId: string } {
  return { db: context.db as Database, userId: context.userId as string };
}

export function createProjectTools(): AgentTool[] {
  return [
    {
      name: "list_projects",
      description: "List the user's projects with name, path, status, and AI tool.",
      risk: "read",
      requiresApproval: false,
      inputSchema: listProjectsInput,
      async execute(input, context) {
        const { limit } = listProjectsInput.parse(input);
        const { db, userId } = toolDb(context);
        const allowedProjectIds = Array.isArray(context.allowedProjectIds) ? context.allowedProjectIds as string[] : undefined;
        const projects = listProjectSummaries(db, userId, { ...(limit !== undefined ? { limit } : {}), ...(allowedProjectIds ? { allowedProjectIds } : {}) });
        return { projects, count: projects.length };
      }
    },
    {
      name: "get_project",
      description: "Get a single project by id with full detail.",
      risk: "read",
      requiresApproval: false,
      inputSchema: getProjectInput,
      async execute(input, context) {
        const { projectId } = getProjectInput.parse(input);
        const { db, userId } = toolDb(context);
        const project = getProjectDetail(db, userId, projectId);
        if (!project) return { found: false, project: null };
        return { found: true, project };
      }
    },
    {
      name: "create_project",
      description: "Create a new project (subject to project path policy and exact approval when required).",
      risk: "operate",
      requiresApproval: true,
      riskClass: "medium",
      inputSchema: createProjectInput,
      async execute(input, context) {
        return executeAgentAction("create_project", createProjectInput.parse(input), context);
      }
    }
  ];
}

/** External MCP additions; native Copilot keeps its established tool set. */
export function createMcpProjectTools(): AgentTool[] {
  return [
    {
      name: "list_templates", description: "List templates available to the current user for project setup.",
      risk: "read", requiresApproval: false, inputSchema: z.object({}).strict(),
      async execute(_input, context) {
        const { db, userId } = toolDb(context);
        const repo = new TemplateRepository(db, userId);
        const templates = [...builtInTemplateSummaries(), ...repo.list()];
        return { templates: templates.map(({ id, name, description, version, adapter, isBuiltin, status }) => ({ id, name, description, version, adapter, isBuiltin, status })) };
      }
    },
    {
      name: "preview_project_config", description: "Preview template files and conflicts for a project using host credentials; returns a digest needed to apply.",
      risk: "read", requiresApproval: false, inputSchema: previewConfigInput,
      async execute(input, context) {
        const { projectId, templateId } = previewConfigInput.parse(input);
        const { db, userId } = toolDb(context);
        return previewMcpConfig(db, userId, projectId, templateId);
      }
    },
    {
      name: "import_project", description: "Register an existing project directory with an optional template; does not change its files.",
      risk: "operate", requiresApproval: true, inputSchema: createProjectInput,
      async execute(input, context) { return executeAgentAction("import_project", createProjectInput.parse(input), context); }
    },
    {
      name: "apply_project_config", description: "Apply a matching template preview, creating missing files only; modified or unsafe files require owner review.",
      risk: "operate", requiresApproval: true, inputSchema: applyConfigInput,
      async execute(input, context) { return executeAgentAction("apply_project_config", applyConfigInput.parse(input), context); }
    }
  ];
}
