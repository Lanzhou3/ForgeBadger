import { z } from "zod";
import { MAX_TOOL_OUTPUT_BYTES, type AgentTool } from "../tool-registry.js";
import { redactAgentValue } from "../redaction.js";

const planFileSchema = z.string().trim().min(1).max(256).refine(value =>
  !/^([/\\~]|[A-Za-z]:)/.test(value) && !value.split(/[\\/]/).includes(".."), "Use a relative path without '..'");

const planTodoSchema = z.object({
  title: z.string().trim().min(1).max(256),
  description: z.string().trim().min(1).max(2000).optional(),
  verifyCommand: z.string().trim().min(1).max(512).optional(),
  dependsOn: z.array(z.number().int().min(0).max(29)).max(10).optional(),
  files: z.array(planFileSchema).max(20).optional(),
  risk: z.enum(["low", "medium", "high"]).optional(),
  parallelizable: z.boolean().optional(),
  executor: z.enum(["copilot", "delegate", "cli"]).optional(),
}).strict();

const planTodosSchema = z.array(planTodoSchema).min(1).max(30).superRefine((todos, ctx) => {
  todos.forEach((todo, index) => {
    const deps = todo.dependsOn ?? [];
    if (deps.some(dep => dep >= index))
      ctx.addIssue({ code: "custom", path: [index, "dependsOn"], message: "dependsOn may only reference earlier TODOs" });
    if (new Set(deps).size !== deps.length)
      ctx.addIssue({ code: "custom", path: [index, "dependsOn"], message: "dependsOn contains duplicates" });
  });
});

export const submitPlanInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(4000),
  constraints: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
  todos: planTodosSchema,
}).strict();

export const planProposalSchema = z.object({
  status: z.literal("plan_proposed"),
  plan: submitPlanInputSchema.extend({
    constraints: z.array(z.string()).max(20),
    acceptanceCriteria: z.array(z.string()).max(20),
  }),
}).strict();

export type ProposedPlan = z.infer<typeof planProposalSchema>["plan"];

export function createPlanTools(): AgentTool[] {
  return [{
    name: "submit_plan",
    description:
      "Submit a structured implementation plan and ordered TODO checklist to the user for review and confirmation in Plan Mode. The proposal never writes files or board tasks. 在计划模式下提交结构化实施计划与 TODO 清单供用户确认。",
    risk: "read",
    requiresApproval: false,
    inputSchema: submitPlanInputSchema,
    async execute(input) {
      const parsed = submitPlanInputSchema.parse(input);
      const proposal = {
        status: "plan_proposed",
        plan: {
          title: parsed.title,
          summary: parsed.summary,
          constraints: parsed.constraints ?? [],
          acceptanceCriteria: parsed.acceptanceCriteria ?? [],
          todos: parsed.todos,
        },
      };
      if (Buffer.byteLength(JSON.stringify(redactAgentValue(proposal))) > MAX_TOOL_OUTPUT_BYTES) {
        throw new Error("Plan exceeds the tool output limit. Shorten the proposal and submit it again.");
      }
      return proposal;
    },
  }];
}
