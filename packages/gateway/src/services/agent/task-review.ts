import { randomUUID } from 'node:crypto';
import type { AgentStackDeps } from './agent-stack.js';
import { CopilotRunLedger, type TurnInput } from './run-ledger.js';
import { redactAgentText } from './redaction.js';

export interface TaskReviewOrigin { projectId: string; workItemId: string; attemptId: string; notificationId: string; intentId: string }

/** Called in the same transaction as the verified completion report. */
export function admitTaskReview(ledger: CopilotRunLedger, originRunId: string, origin: TaskReviewOrigin, report: string): void {
  const parent = ledger.get(originRunId);
  if (!parent) return;
  const input = JSON.parse(parent.input_json) as TurnInput;
  if (!input.reviewTaskResults || input.executionMode || (input.source && input.source !== 'user')) return;
  // A selected context is stricter than ordinary owner dispatch. Optional review
  // must not suppress a valid deterministic completion report for another project.
  if (input.projectId && input.projectId !== origin.projectId) return;
  const key = `review:${origin.attemptId}`;
  if (ledger.db.prepare('SELECT 1 FROM copilot_research_jobs WHERE user_id=? AND source_key=?').get(ledger.userId, key)) return;
  const conversation = ledger.log.createConversation('任务结果只读复核');
  const child = ledger.admit({ userId: ledger.userId, conversationId: conversation.id, projectId: origin.projectId,
    executionMode: 'review', parentRunId: originRunId, reviewOrigin: origin, ...(input.modelId ? { modelId: input.modelId } : {}),
    userText: 'Review this task result using read-only project tools. Compare actual evidence with acceptance criteria. '
      + 'State verified facts, missing checks and a proposed next action. Do not mark work accepted, execute tests, dispatch or modify anything.\n'
      + JSON.stringify(origin) + '\n' + report }, 6);
  ledger.db.prepare('INSERT INTO copilot_research_jobs(id,user_id,origin_run_id,source_key,conversation_id,child_run_id,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(randomUUID(), ledger.userId, originRunId, key, conversation.id, child, Date.now());
}

const reviewCursors = new WeakMap<AgentStackDeps['db'], Map<string, number>>();

export function publishTaskReviews(deps: AgentStackDeps, userId: string): void {
  let cursors = reviewCursors.get(deps.db);
  if (!cursors) { cursors = new Map(); reviewCursors.set(deps.db, cursors); }
  const after = cursors.get(userId) ?? 0;
  const rows = deps.db.prepare(`SELECT j.rowid AS position,j.id,j.origin_run_id,j.child_run_id FROM copilot_research_jobs j
    JOIN copilot_runs r ON r.user_id=j.user_id AND r.id=j.child_run_id
    WHERE j.user_id=? AND j.rowid>? AND j.source_key LIKE 'review:%' AND j.report_message_id IS NULL
      AND r.status IN ('completed','stopped','failed','cancelled') ORDER BY j.rowid LIMIT 100`)
    .all(userId, after) as Array<{ position: number; id: string; origin_run_id: string; child_run_id: string }>;
  cursors.set(userId, rows.length === 100 ? rows.at(-1)!.position : 0);
  for (const row of rows) {
    try {
      const published = deps.db.transaction(() => {
        const ledger = new CopilotRunLedger(deps.db, userId);
        const child = ledger.get(row.child_run_id), parent = ledger.get(row.origin_run_id);
        if (!child || !parent) return;
        ledger.validateScope(JSON.parse(child.input_json) as TurnInput);
        const job = deps.db.prepare('SELECT report_message_id FROM copilot_research_jobs WHERE user_id=? AND id=?').get(userId, row.id) as { report_message_id: string | null } | undefined;
        if (!job || job.report_message_id) return;
        const report = ledger.log.listMessages(child.conversation_id).filter(message => message.kind === 'text' && message.role === 'assistant').at(-1)?.content;
        const content = redactAgentText(`只读复核（${child.status}）：\n${report ?? '复核未产生最终报告，请查看执行记录。'}\n复核记录：${child.id}。这不是用户验收或测试执行回执。`);
        const message = ledger.log.appendMessage(parent.conversation_id, { role: 'assistant', kind: 'text', content, toolName: 'pm_task_review', toolCallId: child.id });
        deps.db.prepare('UPDATE copilot_research_jobs SET report_message_id=? WHERE user_id=? AND id=?').run(message.id, userId, row.id);
        return { parent, content };
      }).immediate();
      if (published) deps.eventBus.emitEvent({ type: 'copilot_run_updated', userId, runId: published.parent.id,
        conversationId: published.parent.conversation_id, status: published.parent.status,
        source: published.parent.source, message: published.content, occurredAt: new Date() });
    } catch { /* Revoked origins cannot publish further information. */ }
  }
}
