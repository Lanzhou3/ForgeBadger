/**
 * Project Manager tools for the Copilot harness — the "development management"
 * seam. Gives the Copilot visibility into the PM board's task-packet queue and
 * the one-shot dispatch flow: ensure a linked CLI session exists, launch its
 * runtime, and deliver the packet prompt (prompt + acceptance criteria +
 * verification + evidence requirements) to the session terminal.
 *
 * Packet construction and session linking reuse services/project-manager/
 * task-packets.ts — the exact implementation behind the project-manager HTTP
 * routes; runtime launching reuses services/session-runtime.ts, the same path
 * as POST /api/v1/sessions/:id/start.
 */
import { z } from "zod";

import { ProjectRepository, type Project } from "../../../db/repositories/project-repository.js";
import { SessionRepository } from "../../../db/repositories/session-repository.js";
import {
  ProjectManagerRepository,
  type ProjectManagerWorkItem
} from "../../../db/repositories/project-manager-repository.js";
import type { Database } from "../../../db/types.js";
import type { AgentTool, AgentToolContext } from "../tool-registry.js";
import {
  buildTaskPacket,
  createTaskPacketContext,
  createTaskPacketSessionName,
  resolveTaskPacketSession,
  withTaskPacketSessionLink,
  isActiveSessionStatus,
  type ProjectManagerTaskPacket
} from "../../project-manager/task-packets.js";
import { dispatchSessionInput } from "../../copilot-bridge/bridge-service.js";
import { startSessionRuntime } from "../../session-runtime.js";
import { isAdapterId } from "../../adapter-discovery.js";

const projectIdInput = z.object({
  projectId: z.string().min(1).max(128)
}).strict();

const listPacketsInput = projectIdInput.extend({
  limit: z.number().int().min(1).max(100).optional()
}).strict();

const getPacketInput = z.object({
  projectId: z.string().min(1).max(128),
  workItemId: z.string().min(1).max(128)
}).strict();

const startPacketInput = getPacketInput.extend({
  aiTool: z.enum(["claude", "opencode", "codex", "kimi"]).optional()
}).strict();

interface PmDeps {
  db: Database;
  userId: string;
  sessionManager?: unknown;
}

function requireSessionManager(context: AgentToolContext):
  | NonNullable<PmDeps["sessionManager"]>
  | undefined {
  return context.sessionManager as NonNullable<PmDeps["sessionManager"]> | undefined;
}

/** Load project + work item, or a recoverable not-found marker. */
function loadWorkItem(
  db: Database,
  userId: string,
  projectId: string,
  workItemId: string
): { error: { code: string; message: string } } | { project: Project; workItem: ProjectManagerWorkItem } {
  const project = new ProjectRepository(db, userId).getById(projectId);
  if (!project) return { error: { code: "PROJECT_NOT_FOUND", message: `Project not found: ${projectId}` } };
  const workItem = new ProjectManagerRepository(db, userId).getWorkItem(projectId, workItemId);
  if (!workItem) return { error: { code: "WORK_ITEM_NOT_FOUND", message: `Work item not found: ${workItemId}` } };
  return { project, workItem };
}

export function createProjectManagerTools(): AgentTool[] {
  return [
    {
      name: "pm_list_task_packets",
      description:
        "List the Project Manager task packets for a project — the development queue with per-item prompt, acceptance criteria, verification expectations, linked session, and queue status (planned/running/waiting_for_review/blocked/completed/cancelled).",
      risk: "read",
      requiresApproval: false,
      inputSchema: listPacketsInput,
      async execute(input, context) {
        const { projectId, limit } = listPacketsInput.parse(input);
        const db = context.db as Database;
        const userId = context.userId as string;
        const project = new ProjectRepository(db, userId).getById(projectId);
        if (!project) return { found: false, taskPackets: [] };
        const repo = new ProjectManagerRepository(db, userId);
        const items = repo.listWorkItems(projectId);
        const packets: ProjectManagerTaskPacket[] = [];
        for (const workItem of items) {
          const session = resolveTaskPacketSession(db, userId, projectId, workItem);
          packets.push(buildTaskPacket({ project, workItem, session }));
          if (limit !== undefined && packets.length >= limit) break;
        }
        return { found: true, count: packets.length, taskPackets: packets };
      }
    },
    {
      name: "pm_get_task_packet",
      description:
        "Get one Project Manager task packet by work item id: full prompt, acceptance criteria, expected verification, evidence requirements, runtime adapter, and linked-session status.",
      risk: "read",
      requiresApproval: false,
      inputSchema: getPacketInput,
      async execute(input, context) {
        const { projectId, workItemId } = getPacketInput.parse(input);
        const db = context.db as Database;
        const userId = context.userId as string;
        const loaded = loadWorkItem(db, userId, projectId, workItemId);
        if ("error" in loaded) return { found: false, ...loaded.error };
        const session = resolveTaskPacketSession(db, userId, projectId, loaded.workItem);
        return { found: true, taskPacket: buildTaskPacket({ project: loaded.project, workItem: loaded.workItem, session }) };
      }
    },
    {
      name: "pm_start_task_packet",
      description:
        "Start executing a development work item autonomously: ensure a linked CLI session exists (create one when needed), launch its runtime, bind the task packet context, and deliver the packet prompt to the session terminal. Idempotent when the packet already has a live linked session (re-dispatches the prompt). Approval required.",
      risk: "operate",
      requiresApproval: true,
      inputSchema: startPacketInput,
      async execute(input, context) {
        const { projectId, workItemId, aiTool } = startPacketInput.parse(input);
        const db = context.db as Database;
        const userId = context.userId as string;
        const sessionManager = requireSessionManager(context);
        const loaded = loadWorkItem(db, userId, projectId, workItemId);
        if ("error" in loaded) return { started: false, ...loaded.error };

        const { project, workItem: current } = loaded;
        let workItem = current;
        let session = resolveTaskPacketSession(db, userId, projectId, workItem);
        if (!session) {
          // Create the durable session record bound to this work item.
          session = new SessionRepository(db, userId).create({
            projectId: project.id,
            name: createTaskPacketSessionName(workItem.title),
            aiTool: aiTool ?? project.aiTool ?? "",
            workingDir: project.path,
            credentialMode: "host_environment"
          });
          workItem = new ProjectManagerRepository(db, userId).updateWorkItem(project.id, workItem.id, {
            details: withTaskPacketSessionLink(workItem.details, session, project, createTaskPacketContext(workItem, project))
          });
        }

        // Ensure the runtime is live (no-op when already running/detached-live).
        if (!isActiveSessionStatus(session.status)) {
          await startSessionRuntime({
            db,
            userId,
            masterKey: context.masterKey as string,
            eventBus: undefined,
            adapterCommandRunner: context.adapterCommandRunner as never,
            sessionManager: sessionManager as never
          }, session.id);
          session = new SessionRepository(db, userId).getById(session.id) ?? session;
        }

        // Deliver the packet prompt to the session terminal.
        const packet = buildTaskPacket({ project, workItem, session });
        if (!isAdapterId(session.aiTool)) {
          throw new Error("PROGRAMMATIC_SUBMIT_ADAPTER_MISMATCH");
        }
        const delivery = await dispatchSessionInput(
          sessionManager as never,
          session.id,
          session.aiTool,
          packet.prompt
        );

        return {
          started: true,
          sessionId: session.id,
          delivery: delivery.delivery ?? null,
          taskPacket: packet
        };
      }
    }
  ];
}
