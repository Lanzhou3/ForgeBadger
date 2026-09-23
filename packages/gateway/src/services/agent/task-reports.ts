import { TaskReportRepository, type TaskReportCursor } from '../../db/repositories/task-report-repository.js';
import { ProjectManagerRepository } from '../../db/repositories/project-manager-repository.js';
import { PlatformActionRepository } from '../../db/repositories/platform-action-repository.js';
import { verifiedDispatchEvidence } from '../project-manager/task-progress.js';
import { readTaskDispatchAttempt } from '../project-manager/task-execution.js';
import { CopilotRunLedger, type TurnInput } from './run-ledger.js';
import type { AgentStackDeps } from './agent-stack.js';
import type { Database } from '../../db/types.js';

const scanCursors = new WeakMap<Database, Map<string, TaskReportCursor>>();

/** Deterministic status report only: no provider request, new grant, or external message. */
export function publishTaskReports(deps: AgentStackDeps, userId: string): void {
  const reports = new TaskReportRepository(deps.db, userId);
  let cursors = scanCursors.get(deps.db);
  if (!cursors) { cursors = new Map(); scanCursors.set(deps.db, cursors); }
  const candidates = reports.candidates(cursors.get(userId));
  // One bounded page per pump. Invalid/revoked origins must not starve later tasks.
  // Returning to the beginning after the last page also retries transient failures.
  const last = candidates.at(-1);
  if (candidates.length === 100 && last) cursors.set(userId, { updatedAt: last.updatedAt, workItemId: last.workItemId });
  else cursors.delete(userId);
  for (const candidate of candidates) {
    try {
      const published = deps.db.transaction(() => {
        const ledger = new CopilotRunLedger(deps.db, userId);
        const run = ledger.get(candidate.runId);
        if (!run || (run.status !== 'completed' && !(run.status === 'stopped' && run.stop_reason === 'step_budget_exhausted'))) return;
        ledger.validateScope(JSON.parse(run.input_json) as TurnInput);
        const item = new ProjectManagerRepository(deps.db, userId).getWorkItem(candidate.projectId, candidate.workItemId);
        const attempt = item && readTaskDispatchAttempt(item);
        if (!item || !attempt?.consumedNotificationId || reports.alreadyReported(candidate.conversationId, attempt.id)) return;
        const actions = new PlatformActionRepository(deps.db, userId);
        const intent = actions.get(attempt.originIntentId);
        const receipt = actions.receipt(attempt.originIntentId);
        if (intent?.origin_run_id !== run.id || receipt?.outcome !== 'confirmed') return;
        const result = receipt.result as { executionStatus?: string; attemptId?: string } | null;
        if (result?.executionStatus !== 'dispatched' || result.attemptId !== attempt.id) return;
        const verified = verifiedDispatchEvidence({ db: deps.db, userId }, candidate.projectId, candidate.workItemId, attempt.consumedNotificationId);
        const evidence = verified?.notifications[0];
        if (!evidence) return;
        const completed = evidence.notificationType === 'task_completed';
        const content = [
          `任务进度：${item.title}`,
          completed ? 'CLI 已报告本轮执行完成；验收结论仍需独立证据。' : `CLI 需要跟进：${evidence.notificationType}。`,
          `会话：/sessions/${attempt.sessionId}`,
          `派发回执：${attempt.originIntentId}；通知证据：${evidence.id}。`,
          '此报告确认派发与 CLI 生命周期结果，不代表测试通过、代码合入或部署完成。',
          ...(attempt.report ? [attempt.report] : []),
        ].join('\n');
        ledger.log.appendMessage(candidate.conversationId, {
          role: 'assistant', kind: 'text', content, toolName: 'pm_task_report', toolCallId: attempt.id,
        });
        return { run, content };
      }).immediate();
      if (published) deps.eventBus.emitEvent({ type: 'copilot_run_updated', userId,
        runId: published.run.id, conversationId: published.run.conversation_id,
        status: published.run.status, source: published.run.source, revision: published.run.revision,
        message: published.content, occurredAt: new Date() });
    } catch {
      // A revoked/deleted origin cannot be used to publish further information.
      // A later sweep retries transient DB failures with the same message key.
    }
  }
}
