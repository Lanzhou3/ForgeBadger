import type { RunStep } from './run-ledger.js';
import type { AgentToolRegistry } from './tool-registry.js';

// Registration as "read" alone is insufficient: external tools, delegation,
// terminal reads and discovery can carry additional effects or ordering needs.
const PARALLEL_READS = new Set(['get_project_git_status','get_project','list_project_files','read_project_file',
  'search_project_files','read_project_diff','get_development_task','list_development_tasks']);

export function nextReadBatch(steps: RunStep[], registry: AgentToolRegistry): RunStep[] {
  const pending = steps.filter(step => step.kind === 'tool' && step.status !== 'completed');
  const batch: RunStep[] = [];
  for (const step of pending) {
    const tool = registry.tools.get(step.tool_name!);
    if (step.status !== 'pending' || step.effect !== 'read' || tool?.risk !== 'read'
      || tool.requiresApproval || !PARALLEL_READS.has(step.tool_name!)) break;
    batch.push(step); if (batch.length === 3) break;
  }
  return batch.length ? batch : pending.slice(0, 1);
}
