import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { AgentLlmToolSchema } from './orchestrator-types.js';
import type { RunStep } from './run-ledger.js';

export const DISCOVERY_CORE_TOOLS = new Set(['list_projects', 'read_project_file', 'list_project_files',
  'list_development_tasks', 'get_development_task', 'discover_tools', 'read_tool_result', 'list_playbooks']);
export const discoveryInputSchema = z.object({ query: z.string().trim().min(1).max(100), limit: z.number().int().min(1).max(12).default(8) }).strict();
const receiptSchema = z.object({ version: z.literal(1), query: z.string().min(1).max(100),
  tools: z.array(z.object({ name: z.string().min(1).max(128), summary: z.string().max(240) }).strict()).max(12),
  selectionProof: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
interface DiscoveryIdentity { userId: string; runId: string; stepId: string; masterKey: string }
interface ToolSummary { name: string; summary: string }

/** Search only caller-supplied current visible tools. Discovery never grants execution authority. */
export function discoverToolSchemas(available: AgentLlmToolSchema[], query: string, limit = 8): ToolSummary[] {
  const input = discoveryInputSchema.parse({ query, limit });
  const needle = input.query.toLowerCase();
  const tokens = needle.split(/\s+/u);
  return available.filter(tool => tool.name.length <= 128).map(tool => {
    const name = tool.name.toLowerCase(), description = tool.description.toLowerCase();
    const score = name === needle ? 1000 : tokens.reduce((sum, token) => sum + (name.includes(token) ? 10 : description.includes(token) ? 1 : 0), 0);
    return { name: tool.name, summary: tool.description.slice(0, 240), score };
  }).filter(tool => tool.score > 0).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, input.limit).map(({ name, summary }) => ({ name, summary }));
}

function selectionProof(identity: DiscoveryIdentity, input: z.infer<typeof discoveryInputSchema>, names: string[]): string {
  return createHmac('sha256', identity.masterKey).update('copilot-tool-discovery-v1\0')
    .update(JSON.stringify([identity.userId, identity.runId, identity.stepId, input.query, input.limit, names])).digest('hex');
}

export function createDiscoveryReceipt(identity: DiscoveryIdentity, raw: unknown, available: AgentLlmToolSchema[]) {
  const input = discoveryInputSchema.parse(raw);
  const tools = discoverToolSchemas(available, input.query, input.limit);
  return { version: 1 as const, query: input.query, tools, selectionProof: selectionProof(identity, input, tools.map(tool => tool.name)) };
}

function receiptNames(step: RunStep, identity: Omit<DiscoveryIdentity, 'stepId'>): string[] {
  if (step.user_id !== identity.userId || step.run_id !== identity.runId || step.kind !== 'tool'
    || step.tool_name !== 'discover_tools' || step.status !== 'completed' || step.effect !== 'read' || !step.result_json || !step.input_json) return [];
  if (createHash('sha256').update(step.input_json).digest('hex') !== step.input_digest) return [];
  try {
    const input = discoveryInputSchema.parse(JSON.parse(step.input_json));
    const receipt = receiptSchema.parse(JSON.parse(step.result_json));
    const names = receipt.tools.map(tool => tool.name);
    if (receipt.query !== input.query || names.length > input.limit || new Set(names).size !== names.length) return [];
    const expected = selectionProof({ ...identity, stepId: step.id }, input, names);
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(receipt.selectionProof, 'hex')) ? names : [];
  } catch { return []; }
}

/** Restore at most 32 selected tools from authenticated durable step receipts, then reapply visibility. */
export function selectDiscoveredTools(input: { allVisible: AgentLlmToolSchema[]; steps: RunStep[]; userId: string; runId: string; masterKey: string; enabled: boolean }): AgentLlmToolSchema[] {
  if (!input.enabled) return input.allVisible;
  const visible = new Set(input.allVisible.map(tool => tool.name));
  const selected = new Set<string>();
  for (const step of [...input.steps].sort((a, b) => b.ordinal - a.ordinal)) {
    for (const name of receiptNames(step, input)) {
      if (selected.size >= 32) break;
      if (visible.has(name) && !DISCOVERY_CORE_TOOLS.has(name)) selected.add(name);
    }
    if (selected.size >= 32) break;
  }
  return input.allVisible.filter(tool => DISCOVERY_CORE_TOOLS.has(tool.name) || selected.has(tool.name));
}
