import { z } from "zod";
import type { AgentTool } from "../tool-registry.js";

const reasonSchema = z.string().trim().min(1).max(500);

export const enterPlanModeInputSchema = z.object({ reason: reasonSchema }).strict();

export const proposeModeSwitchInputSchema = z.object({
  target: z.enum(["execute", "goal"]),
  reason: reasonSchema,
  title: z.string().trim().min(1).max(200).optional(),
  spec: z.string().trim().min(1).max(8000).optional(),
}).strict();

export const modeProposalSchema = z.object({
  status: z.literal("mode_switch_proposed"),
  target: z.enum(["execute", "goal"]),
  reason: z.string(),
  title: z.string().optional(),
  spec: z.string().optional(),
}).strict();

export type ModeProposal = z.infer<typeof modeProposalSchema>;

export function createModeTools(): AgentTool[] {
  return [{
    name: "enter_plan_mode",
    description:
      "Switch this conversation to Plan Mode (read-only exploration, then submit_plan) when the request is large, multi-file, ambiguous, irreversible, or asks for a design/approach. The current run continues in Plan Mode from the next step. 进入计划模式。",
    risk: "read",
    requiresApproval: false,
    inputSchema: enterPlanModeInputSchema,
    async execute(input, context) {
      const parsed = enterPlanModeInputSchema.parse(input);
      if (context["mode"] === "plan") throw new Error("Already in Plan Mode");
      return { status: "mode_changed", mode: "plan", reason: parsed.reason };
    },
  }, {
    name: "propose_mode_switch",
    description:
      "Propose (never perform) a mode change for the owner to accept: target \"execute\" from Plan Mode, or target \"goal\" (long-running multi-task work; title and spec required, needs a selected project) from Execute Mode. Changes no state; end your turn right after proposing. 提议切换模式，需用户确认。",
    risk: "read",
    requiresApproval: false,
    inputSchema: proposeModeSwitchInputSchema,
    async execute(input, context) {
      const parsed = proposeModeSwitchInputSchema.parse(input);
      const mode = context["mode"] === "plan" ? "plan" : "execute";
      if (parsed.target === "execute" && mode !== "plan") throw new Error("target execute is only proposed from Plan Mode");
      if (parsed.target === "goal") {
        if (mode === "plan") throw new Error("target goal is only proposed from Execute Mode");
        if (!context.projectId) throw new Error("target goal requires a selected project");
        if (!parsed.title || !parsed.spec) throw new Error("target goal requires title and spec");
      }
      return {
        status: "mode_switch_proposed", target: parsed.target, reason: parsed.reason,
        ...(parsed.title ? { title: parsed.title } : {}), ...(parsed.spec ? { spec: parsed.spec } : {}),
      };
    },
  }];
}
