import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CopilotModeProposalRepository, type ModeProposalRow } from "../../db/repositories/copilot-plan-repository.js";
import { ProjectRepository } from "../../db/repositories/project-repository.js";
import type { Database } from "../../db/types.js";
import { CopilotConversationLog } from "./conversation-log.js";
import { CopilotGoalStore } from "./goal-store.js";
import { assertGoalProjectWritable } from "./goal-workspace.js";
import type { TurnInput } from "./run-ledger.js";
import { modeProposalSchema, type ModeProposal } from "./tools/mode.js";
import { AgentError, type AgentMessage } from "./types.js";

export const confirmModeProposalSchema = z.object({ decision: z.enum(["accept", "dismiss"]) }).strict();
export type ModeDecision = z.infer<typeof confirmModeProposalSchema>["decision"];

export interface ModeReceipt {
  decision: ModeDecision;
  target: ModeProposal["target"];
  mode?: "plan" | "execute";
  goalId?: string;
  runId?: string;
}

const EXECUTE_TEXT = "The owner approved switching to Execute Mode. Continue the request discussed above.";

function parseProposal(content: string): ModeProposal | undefined {
  try {
    const result = modeProposalSchema.safeParse(JSON.parse(content));
    return result.success ? result.data : undefined;
  } catch { return undefined; }
}

function parseReceipt(json: string | null): ModeReceipt | undefined {
  if (!json) return undefined;
  const value = JSON.parse(json) as { modeReceipt?: ModeReceipt };
  return value.modeReceipt;
}

export function attachModeProposals(db: Database, userId: string, conversationId: string, messages: AgentMessage[]) {
  if (!messages.some(message => message.kind === "tool_result" && message.toolName === "propose_mode_switch")) return messages;
  const rows = new Map(new CopilotModeProposalRepository(db, userId).list(conversationId).map(row => [row.message_id, row]));
  return messages.map(message => {
    const row = rows.get(message.id);
    const proposal = row && parseProposal(row.content);
    if (!row || !proposal) return message;
    const receipt = parseReceipt(row.receipt_json);
    const stale = !receipt && proposal.target === "execute" && row.has_later_turn === 1;
    return { ...message, modeProposal: { target: proposal.target, ...(receipt ? { receipt } : {}), ...(stale ? { stale: true } : {}) } };
  });
}

function sameReceiptOrConflict(receipt: ModeReceipt, decision: ModeDecision): ModeReceipt {
  if (receipt.decision !== decision)
    throw new AgentError("COPILOT_REQUEST_CONFLICT", "This proposal has already been decided differently");
  return receipt;
}

function acceptProposal(db: Database, userId: string, conversationId: string, row: ModeProposalRow,
  proposal: ModeProposal, enqueue: (turn: TurnInput) => string): ModeReceipt {
  const conversation = new CopilotConversationLog(db, userId).getConversation(conversationId);
  if (!conversation) throw new AgentError("COPILOT_NOT_FOUND", "Conversation not found");
  // Same rule as plan confirmation: a proposal made for one project never acts on another.
  if ((conversation.project_id ?? null) !== (row.project_id ?? null))
    throw new AgentError("COPILOT_PLAN_PROJECT_CHANGED", "The conversation no longer uses the proposal's original project context");
  const goals = new CopilotGoalStore(db, userId);
  if (goals.hasActiveRun(conversationId))
    throw new AgentError("COPILOT_CONVERSATION_BUSY", "Conversation already has an active run");
  const base = { userId, conversationId, source: "user" as const,
    ...(conversation.project_id ? { projectId: conversation.project_id } : {}),
    ...(row.model_id ? { modelId: row.model_id } : {}) };
  if (proposal.target === "execute") {
    // The execution prompt uses the conversation context. A later turn is
    // outside the scope of the owner's decision on this proposal.
    if (row.has_later_turn)
      throw new AgentError("COPILOT_REQUEST_CONFLICT", "A newer conversation turn superseded this Execute proposal");
    const runId = enqueue({ ...base, userText: EXECUTE_TEXT, mode: "execute" });
    return { decision: "accept", target: "execute", mode: "execute", runId };
  }
  if (!conversation.project_id || !proposal.title || !proposal.spec)
    throw new AgentError("COPILOT_PLAN_PROJECT_REQUIRED", "A goal needs a project, title and spec");
  const project = new ProjectRepository(db, userId).getById(conversation.project_id);
  if (!project) throw new AgentError("COPILOT_NOT_FOUND", "Project not found");
  assertGoalProjectWritable(db, userId, conversation.project_id, project.path);
  const goal = goals.createGoal({
    conversationId, projectId: conversation.project_id, title: proposal.title, spec: proposal.spec });
  const runId = enqueue({ ...base, goalId: goal.id, userText: proposal.spec, clientRequestId: randomUUID() });
  return { decision: "accept", target: "goal", mode: conversation.mode, goalId: goal.id, runId };
}

/** Owner decision on a model-proposed mode switch; idempotent per step, atomic with the run it enqueues. */
export function confirmModeProposal(db: Database, userId: string, conversationId: string, stepId: string,
  decision: ModeDecision, enqueue: (turn: TurnInput) => string): ModeReceipt {
  return db.transaction(() => {
    const repo = new CopilotModeProposalRepository(db, userId);
    const row = repo.find(conversationId, stepId);
    const proposal = row && parseProposal(row.content);
    if (!row || !proposal) throw new AgentError("COPILOT_NOT_FOUND", "Successful mode proposal not found");
    const stored = parseReceipt(row.receipt_json);
    if (stored) return sameReceiptOrConflict(stored, decision);
    const receipt: ModeReceipt = decision === "dismiss"
      ? { decision, target: proposal.target }
      : acceptProposal(db, userId, conversationId, row, proposal, enqueue);
    repo.record(row, { modeReceipt: receipt });
    return receipt;
  }).immediate();
}
