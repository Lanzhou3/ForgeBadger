import type { Database } from "../types.js";

export interface PlanConfirmation {
  action: "save" | "execute" | "goal";
  todoIndexes: number[];
  runId?: string;
  goalId?: string;
}

export interface PlanConfirmationReceipt {
  confirmation: PlanConfirmation;
  modelId?: string;
}

export interface PlanProposalRow {
  message_id: string;
  sequence: number;
  step_id: string;
  run_id: string;
  project_id: string | null;
  content: string;
  receipt_json: string | null;
}

// Require both the visible receipt and its completed runtime step. Editing a
// message truncates the transcript, even though historical steps still exist.
const proposalQuery = `
  SELECT m.id AS message_id, m.sequence, m.step_id, m.run_id, m.content, c.receipt_json,
    json_extract(r.input_json, '$.projectId') AS project_id
  FROM copilot_messages m
  JOIN copilot_runs r ON r.user_id=m.user_id AND r.conversation_id=m.conversation_id AND r.id=m.run_id
  JOIN copilot_run_steps s ON s.user_id=m.user_id AND s.run_id=m.run_id AND s.id=m.step_id
  LEFT JOIN copilot_plan_confirmations c ON c.user_id=m.user_id AND c.run_id=m.run_id AND c.step_id=m.step_id
  WHERE m.user_id=? AND m.conversation_id=? AND m.kind='tool_result' AND m.tool_name='submit_plan'
    AND s.kind='tool' AND s.tool_name='submit_plan' AND s.tool_call_id=m.tool_call_id
    AND s.status='completed' AND s.result_json=m.content
    AND r.source='user' AND json_extract(r.input_json, '$.mode')='plan'`;

export class CopilotPlanRepository {
  constructor(private readonly db: Database, private readonly userId: string) {}

  listProposals(conversationId: string): PlanProposalRow[] {
    return this.db.prepare(`${proposalQuery} ORDER BY m.sequence ASC`).all(this.userId, conversationId) as PlanProposalRow[];
  }

  findProposal(conversationId: string, stepId: string): PlanProposalRow | undefined {
    return this.db.prepare(`${proposalQuery} AND m.step_id=?`)
      .get(this.userId, conversationId, stepId) as PlanProposalRow | undefined;
  }

  recordConfirmation(proposal: PlanProposalRow, receipt: PlanConfirmationReceipt): void {
    this.db.prepare("INSERT INTO copilot_plan_confirmations(step_id,user_id,run_id,receipt_json) VALUES(?,?,?,?)")
      .run(proposal.step_id, this.userId, proposal.run_id, JSON.stringify(receipt));
  }
}

export interface ModeProposalRow {
  message_id: string;
  step_id: string;
  run_id: string;
  project_id: string | null;
  model_id: string | null;
  content: string;
  receipt_json: string | null;
  has_later_turn: 0 | 1;
}

// A propose_mode_switch step is valid evidence only while its transcript row is
// live and the completed tool step carries exactly the same result.
const modeProposalQuery = `
  SELECT m.id AS message_id, m.step_id, m.run_id, m.content, c.receipt_json,
    json_extract(r.input_json, '$.projectId') AS project_id,
    json_extract(r.input_json, '$.modelId') AS model_id,
    EXISTS (
      SELECT 1 FROM copilot_messages later
      WHERE later.user_id=m.user_id AND later.conversation_id=m.conversation_id
        AND later.sequence>m.sequence AND later.run_id IS NOT m.run_id
    ) AS has_later_turn
  FROM copilot_messages m
  JOIN copilot_runs r ON r.user_id=m.user_id AND r.conversation_id=m.conversation_id AND r.id=m.run_id
  JOIN copilot_run_steps s ON s.user_id=m.user_id AND s.run_id=m.run_id AND s.id=m.step_id
  LEFT JOIN copilot_plan_confirmations c ON c.user_id=m.user_id AND c.run_id=m.run_id AND c.step_id=m.step_id
  WHERE m.user_id=? AND m.conversation_id=? AND m.kind='tool_result' AND m.tool_name='propose_mode_switch'
    AND s.kind='tool' AND s.tool_name='propose_mode_switch' AND s.tool_call_id=m.tool_call_id
    AND s.status='completed' AND s.result_json=m.content AND r.source='user'`;

/** Mode-proposal receipts share the generic per-step receipt table. */
export class CopilotModeProposalRepository {
  constructor(private readonly db: Database, private readonly userId: string) {}

  list(conversationId: string): ModeProposalRow[] {
    return this.db.prepare(modeProposalQuery).all(this.userId, conversationId) as ModeProposalRow[];
  }

  find(conversationId: string, stepId: string): ModeProposalRow | undefined {
    return this.db.prepare(`${modeProposalQuery} AND m.step_id=?`)
      .get(this.userId, conversationId, stepId) as ModeProposalRow | undefined;
  }

  record(proposal: ModeProposalRow, receipt: unknown): void {
    this.db.prepare("INSERT INTO copilot_plan_confirmations(step_id,user_id,run_id,receipt_json) VALUES(?,?,?,?)")
      .run(proposal.step_id, this.userId, proposal.run_id, JSON.stringify(receipt));
  }
}
