import { z } from "zod";

import { ActivityRepository, type SessionActivity } from "../../db/repositories/activity-repository.js";
import { CopilotRepository } from "../../db/repositories/copilot-repository.js";
import { ProjectRepository, type Project } from "../../db/repositories/project-repository.js";
import { SessionRepository, type Session } from "../../db/repositories/session-repository.js";
import { discoverAdapters } from "../adapter-discovery.js";
import { getDashboardSummary } from "../dashboard-summary.js";
import { buildLocalDiagnosticsExport } from "../diagnostics.js";
import { createCopilotMemoryTools } from "./memory.js";
import { CopilotToolValidationError, type CopilotToolContext, type CopilotToolDefinition } from "./tool-registry.js";
import { redactCopilotPayload } from "./redaction.js";

const emptyInput = z.object({}).strict();
const limitInput = z.object({
  limit: z.number().int().min(1).max(50).optional()
}).strict();
const projectDetailInput = z.object({
  projectId: z.string().min(1)
}).strict();
const sessionDetailInput = z.object({
  sessionId: z.string().min(1)
}).strict();
const proposeSessionCreateInput = z.object({
  projectId: z.string().min(1),
  aiTool: z.enum(["claude", "opencode", "codex"]),
  name: z.string().min(1).optional()
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
const projectDetailModelInputSchema = {
  type: "object",
  properties: {
    projectId: { type: "string", minLength: 1 }
  },
  required: ["projectId"],
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
const proposeSessionCreateModelInputSchema = {
  type: "object",
  properties: {
    projectId: { type: "string", minLength: 1 },
    aiTool: { type: "string", enum: ["claude", "opencode", "codex"] },
    name: { type: "string", minLength: 1 }
  },
  required: ["projectId", "aiTool"],
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
      description: "List OpenForge projects visible to the current user.",
      risk: "read",
      requiresApproval: false,
      inputSchema: limitInput,
      modelInputSchema: limitModelInputSchema,
      execute: async (input, context) => ({
        projects: new ProjectRepository(context.db, context.userId)
          .list()
          .slice(0, readLimit(input))
          .map(toProjectSummary)
      })
    },
    {
      name: "openforge.get_project_detail",
      description: "Read one OpenForge project visible to the current user.",
      risk: "read",
      requiresApproval: false,
      inputSchema: projectDetailInput,
      modelInputSchema: projectDetailModelInputSchema,
      execute: async (input, context) => {
        const { projectId } = projectDetailInput.parse(input);
        const project = new ProjectRepository(context.db, context.userId).getById(projectId);
        return { project: project ? toProjectDetail(project) : null };
      }
    },
    {
      name: "openforge.list_sessions",
      description: "List OpenForge sessions visible to the current user.",
      risk: "read",
      requiresApproval: false,
      inputSchema: limitInput,
      modelInputSchema: limitModelInputSchema,
      execute: async (input, context) => ({
        sessions: new SessionRepository(context.db, context.userId)
          .list()
          .slice(0, readLimit(input))
          .map(toSessionSummary)
      })
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
        return { session: session ? toSessionDetail(session) : null };
      }
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

function toProjectDetail(project: Project) {
  return {
    ...toProjectSummary(project),
    description: project.description,
    techStack: project.techStack,
    templateId: project.templateId,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString()
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

function toSessionDetail(session: Session) {
  return {
    ...toSessionSummary(session),
    modelId: session.modelId,
    agentId: session.agentId,
    workingDir: session.workingDir,
    lastActive: session.lastActive?.toISOString() ?? null,
    errorMessage: session.errorMessage,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString()
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
  const project = new ProjectRepository(context.db, context.userId).getById(parsed.projectId);
  if (!project) {
    throw new CopilotToolValidationError("Copilot session draft project is not available");
  }
  return createPendingProposal(context, "openforge.propose_session_create", parsed);
}

function safeActionInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const redacted = redactCopilotPayload(input);
  if (!redacted || typeof redacted !== "object" || Array.isArray(redacted)) return {};
  return redacted as Record<string, unknown>;
}
