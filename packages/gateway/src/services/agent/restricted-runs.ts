import { assertRepairPlan, repairJob } from '../development/repair-scope.js';
import type { AgentToolContext } from './tool-registry.js';
import type { TurnInput } from './run-ledger.js';

const PROJECT_READS = new Set(['get_project_git_status', 'read_project_diff', 'read_tool_result', 'get_project', 'list_project_files', 'read_project_file', 'search_project_files',
  'project_graph_search', 'project_graph_symbol_detail', 'project_graph_impact', 'project_graph_affected_paths',
  'get_development_task', 'list_development_tasks', 'pm_get_task_progress']);

export function restrictedToolAllowed(input: TurnInput, name: string): boolean {
  return !input.executionMode || PROJECT_READS.has(name) || (input.executionMode === 'repair' && name === 'submit_development_task');
}

/** Execution-time enforcement also covers forged calls and recovered steps. */
export function assertRestrictedTool(context: AgentToolContext, name: string, raw: unknown): void {
  if (!context.executionMode) return;
  if (context.executionMode === 'repair' && name === 'submit_development_task') {
    if(typeof context.runId !== 'string' || typeof context.stepId !== 'string' || !repairJob(context.db,context.userId,context.runId)) throw new Error('COPILOT_REPAIR_ORIGIN_MISSING');
    assertRepairPlan(context.db,context.userId,context.runId,context.stepId,raw);return;
  }
  if (!PROJECT_READS.has(name) || !context.projectId || !raw || typeof raw !== 'object'
    || !('projectId' in raw) || raw.projectId !== context.projectId)
    throw new Error('COPILOT_RESTRICTED_TOOL: read-only project scope required');
}
