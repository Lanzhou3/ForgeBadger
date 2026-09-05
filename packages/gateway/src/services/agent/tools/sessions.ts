import { executeAgentAction } from "../../platform-commands/agent-actions.js";
/**
 * Session tools for the Copilot harness — the "sessions" seam. Read tools
 * expose AI CLI session state; the operate tool (launch a session) is
 * approval-gated and only fires after the owner approves it.
 *
 * Tenant-scoped reads and programmatic delivery live in the native Copilot
 * platform-access service.
 */
import { z } from "zod";
import {
  getSessionDetail,
  listSessionSummaries
} from "../platform-access.js";
import { SessionRepository } from "../../../db/repositories/session-repository.js";
import type { Database } from "../../../db/types.js";
import type { AgentTool, AgentToolContext } from "../tool-registry.js";

const listSessionsInput = z.object({
  projectId: z.string().max(128).optional(),
  limit: z.number().int().min(1).max(100).optional()
}).strict();

const getSessionInput = z.object({
  sessionId: z.string().min(1).max(128)
}).strict();

const getSessionOutputInput = z.object({
  sessionId: z.string().min(1).max(128),
  maxLines: z.number().int().min(1).max(500).optional()
}).strict();

const dispatchSessionInputToolSchema = z.object({
  sessionId: z.string().min(1).max(128),
  message: z.string().min(1).max(4000)
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
    },
    {
      name: "get_session_output",
      description:
        "Read the tail of a session's buffered terminal output (last CLI screen lines). Use it to inspect progress or completion of a dispatched task. Requires the session to be live in this Gateway process.",
      risk: "read",
      requiresApproval: false,
      inputSchema: getSessionOutputInput,
      async execute(input, context) {
        const { sessionId, maxLines } = getSessionOutputInput.parse(input);
        const { db, userId } = toolDb(context);
        const session = new SessionRepository(db, userId).getById(sessionId);
        if (!session) return { found: false, output: "" };
        const sessionManager = context.sessionManager as
          | { getSessionOutput(id: string): { getTail(maxLines: number): { output: string; truncated: boolean; lineCount: number } } | undefined }
          | undefined;
        const ring = sessionManager?.getSessionOutput(sessionId);
        if (!ring) return { found: true, live: false, output: "", truncated: false, lineCount: 0 };
        const tail = ring.getTail(maxLines ?? 80);
        return { found: true, live: true, ...tail };
      }
    },
    {
      name: "dispatch_task_to_session",
      description:
        "Dispatch a task message into a running AI CLI session's terminal as its next instruction, confirming delivery by reading back the terminal screen (approval required).",
      risk: "operate",
      requiresApproval: true,
      inputSchema: dispatchSessionInputToolSchema,
      async execute(input, context) {
        return executeAgentAction("dispatch_task_to_session", dispatchSessionInputToolSchema.parse(input), context);
      }
    }
  ];
}
