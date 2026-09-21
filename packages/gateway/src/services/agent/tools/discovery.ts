import type { AgentLlmToolSchema } from '../orchestrator-types.js';
import type { AgentTool } from '../tool-registry.js';
import { createDiscoveryReceipt, discoveryInputSchema } from '../tool-discovery.js';

export function createDiscoveryTools(): AgentTool[] {
  return [{ name: 'discover_tools',
    description: 'Search currently available platform tool names and descriptions by keyword. Returns up to 12 names and summaries. In optional discovery mode, successful selections load on the next model round. Descriptions do not grant permission; all actions retain current scope and approvals.',
    risk: 'read', requiresApproval: false, inputSchema: discoveryInputSchema,
    async execute(raw, context) {
      const { runId, stepId, checkExecutionAuthority, availableToolSchemas } = context;
      if (typeof runId !== 'string' || typeof stepId !== 'string' || typeof checkExecutionAuthority !== 'function'
        || !checkExecutionAuthority() || !Array.isArray(availableToolSchemas)) throw new Error('COPILOT_DISCOVERY_CONTEXT_UNAVAILABLE');
      return createDiscoveryReceipt({ userId: context.userId, runId, stepId, masterKey: context.masterKey }, raw, availableToolSchemas as AgentLlmToolSchema[]);
    } }];
}
