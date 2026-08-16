/**
 * Session tools for the Copilot harness — the "sessions" seam. Read tools
 * expose AI CLI session state; the operate tool (launch a session) is
 * approval-gated and only fires after the owner approves it.
 */
import { z } from "zod";
import { SessionRepository } from "../../../db/repositories/session-repository.js";
import type { AgentTool, AgentToolContext } from "../tool-registry.js";

const listSessionsInput = z.object({
  projectId: z.string().max(128).optional(),
  limit: z.number().int().min(1).max(100).optional()
}).strict();

const getSessionInput = z.object({
  sessionId: z.string().min(1).max(128)
}).strict();

function sessionsRepo(context: AgentToolContext): SessionRepository {
  return new SessionRepository(context.db as import("../../../db/types.js").Database, context.userId as string);
}

export function createSessionTools(): AgentTool[] {
  return [
    {
      name: "list_sessions",
      description: "List the user's AI CLI sessions with status, adapter, and project.",
      risk: "read",
      requiresApproval: false,
      inputSchema: listSessionsInput,
      async execute(input, context) {
        const { projectId, limit } = listSessionsInput.parse(input);
        const rows = projectId ? sessionsRepo(context).listByProject(projectId) : sessionsRepo(context).list();
        const sessions = rows.slice(0, limit ?? 50).map((s) => ({
          id: s.id,
          name: s.name,
          aiTool: s.aiTool,
          status: s.status,
          projectId: s.projectId,
          projectName: s.projectName ?? null,
          modelId: s.modelId
        }));
        return { sessions, count: sessions.length };
      }
    },
    {
      name: "get_session",
      description: "Get a single session by id with status and details.",
      risk: "read",
      requiresApproval: false,
      inputSchema: getSessionInput,
      async execute(input, context) {
        const { sessionId } = getSessionInput.parse(input);
        const s = sessionsRepo(context).getById(sessionId);
        if (!s) return { found: false, session: null };
        return {
          found: true,
          session: {
            id: s.id,
            name: s.name,
            aiTool: s.aiTool,
            status: s.status,
            projectId: s.projectId,
            workingDir: s.workingDir,
            credentialMode: s.credentialMode,
            errorMessage: s.errorMessage
          }
        };
      }
    }
  ];
}
