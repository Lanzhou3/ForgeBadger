import type { Database } from '../types.js';

export interface TaskReportCursor { updatedAt: number; workItemId: string; }

export interface TaskReportCandidate extends TaskReportCursor {
  projectId: string;
  workItemId: string;
  runId: string;
  conversationId: string;
}

/** Reads eligible original conversations without granting a new model turn. */
export class TaskReportRepository {
  constructor(private readonly db: Database, private readonly userId: string) {}

  candidates(after?: TaskReportCursor): TaskReportCandidate[] {
    return this.db.prepare(`
      SELECT w.project_id AS projectId, w.id AS workItemId, w.updated_at AS updatedAt,
             r.id AS runId, r.conversation_id AS conversationId
      FROM project_manager_work_items w
      JOIN platform_action_intents i ON i.user_id=w.user_id
        AND i.id=json_extract(w.details_json,'$.taskPacket.attempt.originIntentId')
      JOIN platform_action_receipts receipt ON receipt.user_id=i.user_id AND receipt.intent_id=i.id
      JOIN copilot_runs r ON r.user_id=i.user_id AND r.id=i.origin_run_id
      JOIN copilot_conversations c ON c.user_id=r.user_id AND c.id=r.conversation_id
      WHERE w.user_id=? AND (r.status='completed' OR (r.status='stopped' AND r.stop_reason='step_budget_exhausted')) AND c.channel_owned=0
        AND i.command_id='pm.task.execute' AND receipt.outcome='confirmed'
        AND json_extract(w.details_json,'$.taskPacket.attempt.status')='dispatched'
        AND json_extract(w.details_json,'$.taskPacket.attempt.consumedNotificationId') IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM copilot_messages m WHERE m.user_id=w.user_id
          AND m.conversation_id=c.id AND m.tool_name='pm_task_report'
          AND m.tool_call_id=json_extract(w.details_json,'$.taskPacket.attempt.id'))
        AND (? IS NULL OR w.updated_at > ? OR (w.updated_at = ? AND w.id > ?))
      ORDER BY w.updated_at ASC, w.id ASC LIMIT 100
    `).all(this.userId, after?.updatedAt ?? null, after?.updatedAt ?? null, after?.updatedAt ?? null, after?.workItemId ?? null) as TaskReportCandidate[];
  }

  alreadyReported(conversationId: string, attemptId: string): boolean {
    return !!this.db.prepare(`SELECT 1 FROM copilot_messages WHERE user_id=? AND conversation_id=?
      AND tool_name='pm_task_report' AND tool_call_id=?`).get(this.userId, conversationId, attemptId);
  }
}
