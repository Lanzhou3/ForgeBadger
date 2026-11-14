import { CODING_READS, PROJECT_READS } from './tool-surface.js';
import type { AgentToolContext } from './tool-registry.js';

/** Execution-time enforcement also covers forged calls and recovered steps. */
export function assertRestrictedTool(context: AgentToolContext, name: string, raw: unknown): void {
  if (!context.executionMode) return;
  // Coding sub-runs: the delegate contract surface (sandbox tools + reads).
  // Sandbox tools address the goal sandbox, not the raw project, so the
  // projectId-in-input check of the read-only modes does not apply.
  if (context.executionMode === 'coding') {
    if (!CODING_READS.has(name)) throw new Error('COPILOT_RESTRICTED_TOOL: coding sub-run scope required');
    return;
  }
  if (!PROJECT_READS.has(name) || !context.projectId || !raw || typeof raw !== 'object'
    || !('projectId' in raw) || raw.projectId !== context.projectId)
    throw new Error('COPILOT_RESTRICTED_TOOL: read-only project scope required');
}
