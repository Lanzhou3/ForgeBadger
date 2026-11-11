import { z } from 'zod';
import { readSource } from '../../development/workspace.js';
import { sourcePathSchema } from '../../development/contracts.js';
import { redactAgentText } from '../redaction.js';
import { CopilotMachineRootRepository } from '../../../db/repositories/copilot-machine-root-repository.js';
import { GROUNDING_LEVELS, type GroundingLevel, verifyEvidence } from '../retrieval-grounding.js';
import { routeQuery } from '../retrieval-routing.js';
import type { AgentTool } from '../tool-registry.js';

const id = z.string().min(1).max(128);
const groundingSchema = z.enum(GROUNDING_LEVELS);

const evidenceInput = z.object({
  root: id,
  /** Slash-relative file path within the root. */
  path: sourcePathSchema,
  /** 1-based line number of the cited evidence. */
  line: z.number().int().min(1).max(65536),
  /** The cited text; must be present (whitespace-normalized) on that line or the claim is falsified. */
  snippet: z.string().trim().min(1).max(500),
  /** The grounding level the agent proposes for this evidence. */
  proposedGrounding: groundingSchema,
}).strict();

const routeInput = z.object({
  query: z.string().trim().min(1).max(4000),
}).strict();

export function createDeepResearchTools(): AgentTool[] {
  return [
    {
      name: 'verify_retrieval_evidence',
      description: 'Falsify/ground a cited piece of evidence: re-read the exact path+line from an owner-registered local root and check the cited snippet is really there. '
        + 'OA-RAG grounding levels: entailed > supported > related > unrelated. A strong label is returned only if the evidence is present on the cited line; otherwise it is downgraded to unrelated. '
        + 'Use it to back a claim before reporting, so no claim rests on unverified evidence (FALCA-style propose/falsify).',
      risk: 'read',
      requiresApproval: false,
      inputSchema: evidenceInput,
      async execute(raw, context) {
        const input = evidenceInput.parse(raw);
        const rootEntry = new CopilotMachineRootRepository(context.db, context.userId).getById(input.root);
        if (!rootEntry)
          throw new Error('MACHINE_ROOT_NOT_FOUND: register this local path first with register_machine_root');
        const source = readSource(rootEntry.path, input.path);
        const lines = source.content.split('\n');
        const result = verifyEvidence(lines[input.line - 1], input.snippet, input.proposedGrounding, input.line);
        return { ...result, line: input.line, snippet: redactAgentText(input.snippet), lineText: redactAgentText(lines[input.line - 1] ?? '').slice(0, 500) };
      },
    },
    {
      name: 'route_query',
      description: 'Decide whether a document question warrants multi-step research or a direct answer (RouteDRAG-style routing). Returns mode (direct|research) with the signals that drove it. Heuristic, not learned.',
      risk: 'read',
      requiresApproval: false,
      inputSchema: routeInput,
      async execute(raw) {
        const input = routeInput.parse(raw);
        return { ...routeQuery(input.query) };
      },
    },
  ];
}
