/**
 * Session tools for the Copilot harness — the "sessions" seam. Read tools
 * expose AI CLI session state; the operate tool (launch a session) is
 * approval-gated and only fires after the owner approves it.
 *
 * The read queries live in services/copilot-bridge/bridge-service.ts so the
 * internal copilot-bridge HTTP API and these tools share one implementation.
 */
import { z } from "zod";
import {
  getSessionDetail,
  listSessionSummaries
} from "../../copilot-bridge/bridge-service.js";
import type { Database } from "../../../db/types.js";
import type { AgentTool, AgentToolContext } from "../tool-registry.js";

const listSessionsInput = z.object({
  projectId: z.string().max(128).optional(),
  limit: z.number().int().min(1).max(100).optional()
}).strict();

const getSessionInput = z.object({
  sessionId: z.string().min(1).max(128)
}).strict();

function toolDb(context: AgentToolContext): { db: Database; userId: string } {
  return { db: context.db as Database, userId: context.userId as string };
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
        const { db, userId } = toolDb(context);
        const sessions = listSessionSummaries(db, userId, {
          ...(projectId !== undefined ? { projectId } : {}),
          ...(limit !== undefined ? { limit } : {})
        });
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
        const { db, userId } = toolDb(context);
        const session = getSessionDetail(db, userId, sessionId);
        if (!session) return { found: false, session: null };
        return { found: true, session };
      }
    }
  ];
}
