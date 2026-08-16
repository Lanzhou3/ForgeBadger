/**
 * Project tools for the Copilot harness — the "projects" seam of the platform
 * tool surface. Read tools expose project state; the operate tool (create
 * project) is approval-gated and only fires after the owner approves it.
 */
import { z } from "zod";
import { ProjectRepository } from "../../../db/repositories/project-repository.js";
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
  description: z.string().max(2000).optional()
}).strict();

function projectsRepo(context: AgentToolContext): ProjectRepository {
  return new ProjectRepository(context.db as import("../../../db/types.js").Database, context.userId as string);
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
        const projects = projectsRepo(context).list().slice(0, limit ?? 50).map((p) => ({
          id: p.id,
          name: p.name,
          path: p.path,
          status: p.status,
          aiTool: p.aiTool,
          description: p.description
        }));
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
        const p = projectsRepo(context).getById(projectId);
        if (!p) return { found: false, project: null };
        return {
          found: true,
          project: {
            id: p.id,
            name: p.name,
            path: p.path,
            status: p.status,
            aiTool: p.aiTool,
            isImported: p.isImported,
            templateId: p.templateId,
            description: p.description
          }
        };
      }
    },
    {
      name: "create_project",
      description: "Create a new project (approval required outside home directory).",
      risk: "operate",
      requiresApproval: true,
      riskClass: "medium",
      inputSchema: createProjectInput,
      async execute(input, context) {
        const parsed = createProjectInput.parse(input);
        const created = projectsRepo(context).create({
          name: parsed.name,
          path: parsed.path,
          aiTool: "",
          ...(parsed.description !== undefined ? { description: parsed.description } : {})
        });
        return { created: true, projectId: created.id, name: created.name };
      }
    }
  ];
}
