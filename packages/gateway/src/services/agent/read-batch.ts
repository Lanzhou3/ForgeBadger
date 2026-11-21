import type { RunStep } from './run-ledger.js';
import type { AgentToolRegistry } from './tool-registry.js';

// Registration as "read" alone is insufficient: external tools, delegation,
// terminal reads and discovery can carry additional effects or ordering needs.
const PARALLEL_READS = new Set(['get_project_git_status','get_project','list_project_files','read_project_file',
  'search_project_files','machine_search','read_machine_file','machine_tree','verify_retrieval_evidence','read_project_diff']);

function batchKind(step: RunStep, registry: AgentToolRegistry): 'research' | 'read' | 'single' {
  const tool = registry.tools.get(step.tool_name!);
  if (step.kind !== 'tool' || step.status !== 'pending' || step.effect !== 'read'
    || tool?.risk !== 'read' || tool.requiresApproval) return 'single';
  if (tool.name === 'research_project') return 'research';
  return PARALLEL_READS.has(tool.name) ? 'read' : 'single';
}

export function nextReadBatch(steps: RunStep[], registry: AgentToolRegistry) {
  const firstIndex = steps.findIndex(step => step.kind === 'tool' && step.status !== 'completed');
  if (firstIndex === -1) return undefined;
  const first = steps[firstIndex]!;
  const kind = batchKind(first, registry);
  const batch = [first];
  if (kind === 'single') return { kind, steps: batch };
  const limit = kind === 'research' ? 4 : 3;
  for (const step of steps.slice(firstIndex + 1)) {
    if (kind === 'read' && (step.kind !== 'tool' || step.status === 'completed')) continue;
    if (batchKind(step, registry) !== kind) break;
    batch.push(step);
    if (batch.length === limit) break;
  }
  return { kind, steps: batch };
}
