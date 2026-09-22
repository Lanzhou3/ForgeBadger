import type { Database } from '../types.js';
export interface ToolResultSource {
  runId: string; stepId: string; toolName: string; inputJson: string;
  content: string; runInputJson: string;
}
/** A receipt must still be attached to a live tenant-owned conversation. */
export class CopilotToolResultRepository {
  constructor(private readonly db: Database, private readonly userId: string) {}
  get(conversationId: string, messageId: string): ToolResultSource | undefined {
    return this.db.prepare(`
      SELECT r.id AS runId, s.id AS stepId, s.tool_name AS toolName,
        s.input_json AS inputJson, s.result_json AS content, r.input_json AS runInputJson
      FROM copilot_messages m
      JOIN copilot_conversations c ON c.id=m.conversation_id AND c.user_id=m.user_id
      JOIN copilot_runs r ON r.id=m.run_id AND r.conversation_id=c.id AND r.user_id=m.user_id
      JOIN copilot_run_steps s ON s.id=m.step_id AND s.run_id=r.id AND s.user_id=m.user_id
      WHERE m.user_id=? AND m.conversation_id=? AND m.id=? AND c.status!='deleted'
        AND m.kind='tool_result' AND s.kind='tool' AND s.status='completed'
        AND s.result_json IS NOT NULL AND s.result_json=m.content
        AND s.tool_call_id=m.tool_call_id AND s.tool_name=m.tool_name
    `).get(this.userId, conversationId, messageId) as ToolResultSource | undefined;
  }
}
