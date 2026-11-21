import { z } from 'zod';
import type { AgentTool } from '../tool-registry.js';
import { ownedProject } from '../project-source.js';

const inputSchema = z.object({
  projectId: z.string().min(1).max(128),
  goal: z.string().trim().min(1).max(4000),
  questions: z.array(z.string().max(500)).max(8).optional(),
  boundaries: z.string().max(1000).optional(),
}).strict();

export type ResearchInput = z.infer<typeof inputSchema>;

export function createResearchTools(): AgentTool[] {
  return [{ name: 'research_project', description: 'Delegate a bounded read-only project investigation in a separate context. 只读研究项目代码，调查故障原因并分析证据。 Up to four consecutive investigations run in parallel. Returns a structured report when submitted, fallback text and the child run ID. Cannot write, dispatch CLIs, use external tools or delegate again. Reports are analysis, not proof that tests passed.',
    risk: 'read', requiresApproval: false, inputSchema,
    async execute(raw, context) {
      const input = inputSchema.parse(raw);
      ownedProject(context, input.projectId);
      if (typeof context.runResearch !== 'function') throw new Error('Research runtime unavailable');
      return context.runResearch(input);
    } }];
}
