import { z } from "zod";

import { ActivityRepository, type SessionActivity } from "../../db/repositories/activity-repository.js";
import { ProjectRepository, type Project } from "../../db/repositories/project-repository.js";
import { SessionRepository, type Session } from "../../db/repositories/session-repository.js";
import { discoverAdapters } from "../adapter-discovery.js";
import { getDashboardSummary } from "../dashboard-summary.js";
import type { CopilotToolDefinition } from "./tool-registry.js";

const emptyInput = z.object({}).strict();
const limitInput = z.object({
  limit: z.number().int().min(1).max(50).optional()
}).strict();

export function createCopilotReadTools(): CopilotToolDefinition[] {
  return [
    {
      name: "openforge.get_dashboard_summary",
      description: "Read the current OpenForge dashboard summary and health checks.",
      risk: "read",
      requiresApproval: false,
      inputSchema: emptyInput,
      execute: async (_input, context) => getDashboardSummary(context.db, context.userId, context.masterKey)
    },
    {
      name: "openforge.list_projects",
      description: "List OpenForge projects visible to the current user.",
      risk: "read",
      requiresApproval: false,
      inputSchema: limitInput,
      execute: async (input, context) => ({
        projects: new ProjectRepository(context.db, context.userId)
          .list()
          .slice(0, readLimit(input))
          .map(toProjectSummary)
      })
    },
    {
      name: "openforge.list_sessions",
      description: "List OpenForge sessions visible to the current user.",
      risk: "read",
      requiresApproval: false,
      inputSchema: limitInput,
      execute: async (input, context) => ({
        sessions: new SessionRepository(context.db, context.userId)
          .list()
          .slice(0, readLimit(input))
          .map(toSessionSummary)
      })
    },
    {
      name: "openforge.get_adapter_discovery",
      description: "Read local AI CLI adapter availability and launch readiness.",
      risk: "read",
      requiresApproval: false,
      inputSchema: emptyInput,
      execute: async (_input, context) => ({
        adapters: await discoverAdapters(context.adapterCommandRunner)
      })
    },
    {
      name: "openforge.get_recent_activity",
      description: "Read recent OpenForge activity for the current user.",
      risk: "read",
      requiresApproval: false,
      inputSchema: limitInput,
      execute: async (input, context) => ({
        activities: new ActivityRepository(context.db, context.userId)
          .list({ limit: readLimit(input) })
          .map(toActivitySummary)
      })
    }
  ];
}

function readLimit(input: unknown): number {
  if (!input || typeof input !== "object" || Array.isArray(input)) return 20;
  const value = (input as { limit?: unknown }).limit;
  return typeof value === "number" ? value : 20;
}

function toProjectSummary(project: Project) {
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    aiTool: project.aiTool,
    status: project.status,
    isImported: project.isImported
  };
}

function toSessionSummary(session: Session) {
  return {
    id: session.id,
    projectId: session.projectId,
    name: session.name,
    aiTool: session.aiTool,
    status: session.status,
    credentialMode: session.credentialMode,
    tmuxSession: session.tmuxSession
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

function parseMetadata(metadata: string | null): unknown {
  if (!metadata) return null;
  try {
    return JSON.parse(metadata) as unknown;
  } catch {
    return null;
  }
}
