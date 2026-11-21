import { z } from 'zod';
import { MAX_TOOL_OUTPUT_BYTES, type AgentTool } from '../tool-registry.js';
import { redactAgentValue } from '../redaction.js';

// Leave room in the parent tool result for the envelope and text fallback.
const MAX_RESEARCH_REPORT_BYTES = MAX_TOOL_OUTPUT_BYTES - 8 * 1024;

export const researchReportSchema = z.object({
  summary: z.string().max(4000),
  findings: z.array(z.object({
    claim: z.string().max(1000),
    evidence: z.array(z.object({
      path: z.string().max(512),
      line: z.number().int().optional(),
      note: z.string().max(500).optional(),
    }).strict()).max(10),
    confidence: z.enum(['high', 'medium', 'low']),
  }).strict()).max(20),
  openQuestions: z.array(z.string()).max(10).optional(),
}).strict();

export const researchReportReceipt = { status: 'research_report_submitted' } as const;

export function researchReportFits(report: z.infer<typeof researchReportSchema>): boolean {
  return Buffer.byteLength(JSON.stringify(redactAgentValue(report))) <= MAX_RESEARCH_REPORT_BYTES;
}

export function createResearchReportTool(): AgentTool {
  return {
    name: 'submit_research_report',
    description: 'Submit your final read-only research report with file evidence and confidence. Limit the report to 40 KiB of JSON, then finish without calling further tools.',
    risk: 'read',
    requiresApproval: false,
    inputSchema: researchReportSchema,
    async execute(input, context) {
      if (context.executionMode !== 'research') throw new Error('Research run required');
      const report = researchReportSchema.parse(input);
      if (!researchReportFits(report)) throw new Error('Research report exceeds the 40 KiB limit. Shorten it and submit it again.');
      // The validated arguments are already durable on the tool step. Keep the receipt compact.
      return researchReportReceipt;
    },
  };
}
