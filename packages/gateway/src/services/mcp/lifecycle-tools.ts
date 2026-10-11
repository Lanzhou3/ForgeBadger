import { z } from 'zod';
import type { AgentTool } from '../agent/tool-registry.js';
import { executeAgentAction } from '../platform-commands/agent-actions.js';
import { lifecycleSchemas, readLifecyclePlan, readLifecycleHandoff } from './lifecycle.js';

const projectInput = z.object({ projectId: z.string().min(1).max(128) }).strict();
const planReadInput = projectInput.extend({ offset: z.number().int().min(0).max(100000).default(0), limit: z.number().int().min(1).max(50).default(50) });
const handoffInput = projectInput.extend({ workItemId: z.string().min(1).max(128), offset: z.number().int().min(0).max(100000).default(0), limit: z.number().int().min(1).max(5).default(5) });
const descriptions: Record<string, string> = {
  pm_set_goal: 'Set project goal, constraints and acceptance criteria against the current pm_get_plan digest.',
  pm_update_task_plan: 'Edit task acceptance criteria, stage and metadata against the exact task revision. Existing evidence is not verified.',
  pm_manage_stage: 'Create, update, delete or reorder project stages against the exact plan digest. Deletion requires confirm=true.',
  pm_manage_dependency: 'Add or remove a task dependency against the exact plan digest. Cycles are rejected.',
  pm_attach_evidence: 'Attach operator-declared references against the task revision. Does not execute checks or create verification receipts.',
  pm_review_task: 'Request changes or accept a ready_for_review private task with current criterion-by-criterion declared evidence. Acceptance is operator_declared; it does not prove checks, Git merge or release.',
  pm_delete_work_item: 'Delete a private task with no delivery history or live runtime. Requires exact revision and confirm=true. Ledger audit is retained.'
};
/** Opt-in external capabilities; native Copilot does not gain standing authorization. */
export function createMcpLifecycleTools(): AgentTool[] {
  return [
    { name: 'pm_get_plan', description: 'Read goal summary, stages, dependency graph, task revisions and a complete planning digest. Labels are abbreviated; arrays are paginated (max 50). Follow nextOffset. The digest covers the entire plan, including unseen pages.',
      risk: 'read', requiresApproval: false, inputSchema: planReadInput,
      async execute(raw, ctx) { const v = planReadInput.parse(raw); return readLifecyclePlan(ctx, v.projectId, v.offset, v.limit); } },
    { name: 'pm_get_handoff', description: 'Read task acceptance, declared evidence and outstanding Git/release gates. A handoff is not deployment evidence.',
      risk: 'read', requiresApproval: false, inputSchema: handoffInput,
      async execute(raw, ctx) { const v = handoffInput.parse(raw); return readLifecycleHandoff(ctx, v.projectId, v.workItemId, v.offset, v.limit); } },
    ...Object.entries(lifecycleSchemas).map(([name, inputSchema]): AgentTool => ({ name, description: descriptions[name]!,
      risk: 'operate', requiresApproval: true, inputSchema, async execute(raw, ctx) { return executeAgentAction(name, raw, ctx); } }))
  ];
}
