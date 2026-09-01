/**
 * Project tools for the Copilot harness — the "projects" seam of the platform
 * tool surface. Read tools expose project state; the operate tool (create
 * project) is approval-gated and only fires after the owner approves it.
 *
 * Queries and writes use the native Copilot platform-access service.
 */
import { z } from "zod";
import {
  createProjectRecord,
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
  description: z.string().max(2000).optional()
}).strict();

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
        const projects = listProjectSummaries(db, userId, { ...(limit !== undefined ? { limit } : {}) });
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
      description: "Create a new project (approval required outside home directory).",
      risk: "operate",
      requiresApproval: true,
      riskClass: "medium",
      inputSchema: createProjectInput,
      async execute(input, context) {
        const parsed = createProjectInput.parse(input);
        const { db, userId } = toolDb(context);
        const created = createProjectRecord(db, userId, {
          name: parsed.name,
          path: parsed.path,
          ...(parsed.description !== undefined ? { description: parsed.description } : {})
        });
        return { created: true, ...created };
      }
    }
  ];
}
