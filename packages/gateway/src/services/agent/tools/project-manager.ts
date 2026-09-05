import { executeAgentAction } from "../../platform-commands/agent-actions.js";
/** Project Manager reads and governed task preparation. Preparation never launches a CLI. */
import { z } from "zod";

import { ProjectRepository, type Project } from "../../../db/repositories/project-repository.js";
import {
  ProjectManagerRepository,
  type ProjectManagerWorkItem
} from "../../../db/repositories/project-manager-repository.js";
import type { Database } from "../../../db/types.js";
import type { AgentTool, AgentToolContext } from "../tool-registry.js";
import {
  buildTaskPacket,
  resolveTaskPacketSession,
  resolveTaskPacketSessions,
  type ProjectManagerTaskPacket
} from "../../project-manager/task-packets.js";

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
        const items = repo.listWorkItems(projectId, limit === undefined ? {} : { limit });
        const sessionsByWorkItem = resolveTaskPacketSessions(db, userId, projectId, items);
        const packets: ProjectManagerTaskPacket[] = [];
        for (const workItem of items) {
          const session = sessionsByWorkItem.get(workItem.id) ?? null;
          packets.push(buildTaskPacket({ project, workItem, session }));
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
        "Prepare a task packet and an idle linked CLI session. This does not start the CLI or submit a prompt.",
      risk: "operate",
      requiresApproval: true,
      inputSchema: startPacketInput,
      async execute(input, context) {
        return executeAgentAction("pm_start_task_packet", startPacketInput.parse(input), context);
      }
    }
  ];
}
