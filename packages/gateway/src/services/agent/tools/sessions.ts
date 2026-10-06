/**
 * Session tools for the Copilot harness — the "sessions" seam. Read tools
 * expose tenant-scoped AI CLI session state and current terminal output.
 *
 * Tenant-scoped reads and programmatic delivery live in the native Copilot
 * platform-access service.
 */
import { z } from "zod";
import { createSessionStopTarget, sessionRuntimeRevision } from "../../session-stop-target.js";
import {
  getSessionDetail,
  listSessionSummaries
} from "../platform-access.js";
import { SessionRepository } from "../../../db/repositories/session-repository.js";
import type { Database } from "../../../db/types.js";
import type { AgentTool, AgentToolContext } from "../tool-registry.js";
import type { InMemorySessionManager } from '../../session-manager.js';
import { SessionOutputRing } from '../../session-output-buffer.js';
import { assertManagedSessionAccess } from '../../../db/repositories/managed-project-access.js';
import { channelSessionAllowed } from '../../channels/channel-run-scope.js';

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
        const allowedProjectIds = Array.isArray(context.allowedProjectIds) ? context.allowedProjectIds as string[] : undefined;
        const sessions = listSessionSummaries(db, userId, {
          ...(projectId !== undefined ? { projectId } : {}),
          ...(limit !== undefined ? { limit } : {}),
          ...(allowedProjectIds ? { allowedProjectIds } : {}),
          ...(context.channelScope ? { isSessionAllowed: (id: string) => channelSessionAllowed(context, id) } : {})
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
        "Read a session screen and its server-bound target (sessionId, taskTitle, observationId). Keep every target attached to its own output. For stop_session copy target.observationId and target.taskTitle exactly; never infer IDs by list position. Cached output cannot authorize stop.",
      risk: "read",
      requiresApproval: false,
      inputSchema: getSessionOutputInput,
      async execute(input, context) {
        const { sessionId, maxLines } = getSessionOutputInput.parse(input);
        const { db, userId } = toolDb(context);
        const session = new SessionRepository(db, userId).getById(sessionId);
        if (!session) return { sessionId, found: false, output: "" };
        const authorizeRead = () => assertManagedSessionAccess(db, userId, sessionId, session.workingDir);
        authorizeRead();
        const sessionManager = context.sessionManager as InMemorySessionManager | undefined;
        try {
          if (sessionManager?.captureScreen) {
            const before = sessionRuntimeRevision(session, sessionManager);
            const snapshot = await sessionManager.captureScreen(userId, sessionId);
            authorizeRead();
            const ring = new SessionOutputRing();
            ring.append(snapshot.output.trimEnd());
            const fresh = new SessionRepository(db, userId).getById(sessionId);
            const stable = fresh && before === sessionRuntimeRevision(fresh, sessionManager);
            const tail = ring.getTail(maxLines ?? 80);
            const target = snapshot.live && stable
              ? createSessionStopTarget(db, fresh, sessionManager, context.stepId, snapshot.output) : undefined;
            // Keep identity intact under the tool registry's 48 KiB wire limit.
            const output = tail.output.slice(-5000);
            return { sessionId, found: true, live: snapshot.live && !!stable, source: 'session_server',
              ...tail, output, truncated: tail.truncated || output.length < tail.output.length, ...(target ? { target } : {}) };
          }
        } catch {
          // The daemon may be reconnecting; cached output cannot assert liveness.
        }
        authorizeRead();
        const tail = sessionManager?.getSessionOutput(sessionId)?.getTail(maxLines ?? 80);
        return { sessionId, found: true, live: false, source: tail ? 'cached' : 'unavailable',
          ...(tail ?? { output: '', truncated: false, lineCount: 0 }) };
      }
    }
  ];
}
