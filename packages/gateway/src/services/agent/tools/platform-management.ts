import { z } from 'zod';
import type { AgentTool } from '../tool-registry.js';
import { executeAgentAction } from '../../platform-commands/agent-actions.js';
import { workItemCreateInput, workItemUpdateInput } from '../../platform-commands/catalog.js';
import { projectManagementOverview, createManagementCommands } from '../../project-manager/management.js';
import { CopilotGrantRepository } from '../../../db/repositories/copilot-grant-repository.js';
export function createPlatformManagementTools(): AgentTool[] {
    const writes = [
        { name: 'pm_create_work_item', description: 'Create a planned work item with acceptance criteria. Does not execute it.', schema: workItemCreateInput },
        { name: 'pm_update_work_item', description: 'Update task title, description or priority. Cannot change acceptance criteria or claim completion.', schema: workItemUpdateInput.omit({ acceptanceCriteria: true, stageId: true }) },
        { name: 'pm_update_management', description: 'Update project management mode, owner and next action at the expected revision.', schema: createManagementCommands()[0]!.inputSchema },
        { name: 'update_project', description: 'Update project name or description.', schema: z.object({ projectId: z.string().min(1), name: z.string().min(1).max(200).optional(), description: z.string().max(2000).optional() }).strict() },
        { name: 'start_session', description: 'Start an existing CLI session for manual operation. Does not submit a task.', schema: z.object({ sessionId: z.string().min(1) }).strict() },
        { name: 'stop_session', description: 'Stop a tenant-owned CLI session.', schema: z.object({ sessionId: z.string().min(1) }).strict() }
    ];
    return [{ name: 'pm_overview', description: 'Read project progress, manual/CLI planning mode, owner, next action and evidence freshness.', risk: 'read', requiresApproval: false, inputSchema: z.object({}).strict(), async execute(_input, ctx) {
                const g = typeof ctx.grantId === 'string' ? new CopilotGrantRepository(ctx.db, ctx.userId).get(ctx.grantId) : undefined;
                return projectManagementOverview({ db: ctx.db, userId: ctx.userId }, g?.scope.projectIds);
            } }, ...writes.map(v => ({ name: v.name, description: v.description, risk: 'operate' as const, requiresApproval: true, inputSchema: v.schema, execute: (input: unknown, ctx: Parameters<typeof executeAgentAction>[2]) => executeAgentAction(v.name, input, ctx) }))];
}
