import { z } from 'zod';
import { ProjectRepository } from '../../db/repositories/project-repository.js';
import { ProjectManagerRepository } from '../../db/repositories/project-manager-repository.js';
import { PlatformActionRepository, type DispatchHistory } from '../../db/repositories/platform-action-repository.js';
import { TaskDispatchEvidenceRepository, type TaskNotificationEvidence } from '../../db/repositories/task-dispatch-evidence-repository.js';
import type { Database } from '../../db/types.js';
import type { CommandContext } from '../platform-commands/types.js';
import { assertLegacyTaskExecution } from './access.js';
import { buildTaskPacket, resolveTaskPacketSession } from './task-packets.js';
import { patchTaskAttempt, readTaskDispatchAttempt, taskPromptDigest, taskRuntimeIdentity, type TaskDispatchAttempt } from './task-execution.js';

export const taskProgressInput = z.object({ projectId: z.string().min(1).max(128), workItemId: z.string().min(1).max(128), waitMs: z.number().int().min(0).max(5000).optional() }).strict();
export const taskCloseInput = taskProgressInput.omit({ waitMs: true }).extend({ attemptId: z.string().min(1).max(128), notificationId: z.string().min(1).max(128), summary: z.string().trim().min(1).max(350).optional() }).strict();
type Context = Pick<CommandContext, 'db' | 'userId'>;

/** A hook is candidate-completion evidence only after a confirmed receipt for this exact prompt and attempt. */
export function verifiedDispatchEvidence(ctx: Context, projectId: string, workItemId: string, notificationId?: string) {
  assertLegacyTaskExecution(ctx.db, projectId);
  const project = new ProjectRepository(ctx.db, ctx.userId).getById(projectId);
  const item = new ProjectManagerRepository(ctx.db, ctx.userId).getWorkItem(projectId, workItemId);
  if (!project || !item) return undefined;
  const attempt = readTaskDispatchAttempt(item);
  if (!attempt || attempt.status !== 'dispatched' || attempt.manualInterventionAt) return undefined;
  const session = resolveTaskPacketSession(ctx.db, ctx.userId, projectId, item);
  if (session && new ProjectManagerRepository(ctx.db, ctx.userId).getWorkItemByTaskPacketSession(projectId, session.id)?.id !== item.id) return undefined;
  if (!session || session.id !== attempt.sessionId || taskRuntimeIdentity(session) !== attempt.runtimeIdentity
      || taskPromptDigest(buildTaskPacket({ project, workItem: item, session }).prompt) !== attempt.promptDigest) return undefined;
  const actions = new PlatformActionRepository(ctx.db, ctx.userId);
  const origin = actions.get(attempt.originIntentId);
  const receipt = actions.receipt(attempt.originIntentId);
  if (!origin || origin.command_id !== 'pm.task.execute' || receipt?.outcome !== 'confirmed') return undefined;
  const originInput = JSON.parse(origin.input_json) as { projectId?: string; workItemId?: string };
  const result = receipt.result as { attemptId?: string; dispatch?: { dispatched?: boolean }; session?: { id?: string } } | null;
  if (originInput.projectId !== projectId || originInput.workItemId !== workItemId || result?.attemptId !== attempt.id || result.session?.id !== session.id || result.dispatch?.dispatched !== true) return undefined;
  const evidenceRepo = new TaskDispatchEvidenceRepository(ctx.db, ctx.userId);
  // Deletion can cause SQLite rowid reuse. An erased/replaced baseline cannot establish a causal window.
  if (attempt.notificationBaseline > 0 && evidenceRepo.anchor(attempt.notificationBaseline) !== attempt.notificationAnchor) return undefined;
  const notifications = evidenceRepo.notifications(session.id, attempt.notificationBaseline, notificationId);
  return { item, attempt, notifications };
}

function missingAttemptGuidance(history: DispatchHistory | null) {
  const dispatchStatus = history?.status === 'indeterminate' || history?.receiptOutcome === 'unknown' ? 'unknown' as const
    : history?.status === 'executing' ? 'in_flight' as const : 'unverified' as const;
  const inspection = history
    ? `Inspect dispatch intent ${history.intentId}, its receipt and the linked session before deciding how to recover.`
    : 'Inspect the task history and linked session before deciding whether a new dispatch is appropriate.';
  return { dispatchStatus, evidenceStatus: 'missing_attempt' as const, dispatchHistory: history,
    nextAction: `Reliable attempt evidence is missing; this cannot establish whether the task was dispatched. ${inspection} Automatic replay is prohibited.` };
}

function notSentGuidance(ctx: Context, attempt: TaskDispatchAttempt): string {
  const receipt = new PlatformActionRepository(ctx.db, ctx.userId).receipt(attempt.originIntentId);
  const result = receipt?.result as { attemptId?: string; error?: string } | null | undefined;
  if (receipt?.outcome === 'confirmed' && result?.attemptId === attempt.id && result.error === 'PROGRAMMATIC_SUBMIT_NATIVE_APPROVAL_REQUIRED') {
    return 'Stop dispatch attempts. The native CLI requires an owner trust or permission decision in its terminal. After owner review, resume only the not-sent stage with a new authorized intent.';
  }
  return 'Check session readiness, then execute the remaining dispatch using a new intent.';
}

function currentAttemptGuidance(ctx: Context, attempt: TaskDispatchAttempt, status: string, evidence: ReturnType<typeof verifiedDispatchEvidence>, history: DispatchHistory | null) {
  const unresolvedHistory = history && (history.status === 'indeterminate' || history.receiptOutcome === 'unknown' || history.status === 'executing') ? history : null;
  const historicalStatus = unresolvedHistory ? (unresolvedHistory.status === 'indeterminate' || unresolvedHistory.receiptOutcome === 'unknown' ? 'unknown' as const : 'in_flight' as const) : undefined;
  const dispatchStatus = historicalStatus ?? (attempt.status === 'unknown' ? 'unknown' as const
    : attempt.status === 'preparing' || attempt.status === 'sending' ? 'in_flight' as const
    : attempt.status === 'not_sent' ? 'not_sent' as const : evidence ? 'confirmed' as const : 'unverified' as const);
  const interruptedOnly = !!evidence?.notifications.length
    && evidence.notifications.every(notification => notification.notificationType === 'task_interrupted');
  const evidenceStatus = attempt.manualInterventionAt ? 'manual_intervention' as const
    : evidence ? (interruptedOnly ? 'interrupted' as const
      : evidence.notifications.length ? 'available' as const : 'awaiting_notification' as const) : 'unverified' as const;
  let nextAction = 'Follow the linked session and wait for persisted CLI evidence.';
  if (attempt.manualInterventionAt) nextAction = 'Manual input or takeover interrupted automatic evidence attribution. Inspect the session and verify the task independently.';
  else if (dispatchStatus === 'unknown' || dispatchStatus === 'in_flight') nextAction = 'Inspect delivery and the referenced dispatch intent; automatic replay is prohibited.';
  else if (attempt.status === 'not_sent') nextAction = notSentGuidance(ctx, attempt);
  else if (status === 'ready_for_review') nextAction = 'Review the CLI report and independently verify acceptance before marking done.';
  else if (status === 'done' || status === 'cancelled') nextAction = 'The task is closed. Review its history; do not dispatch it automatically.';
  else if (status === 'blocked') nextAction = 'Inspect the failure and existing evidence before explicitly reopening the task; do not redispatch automatically.';
  else if (!evidence) nextAction = 'Dispatch attribution is unverified. Inspect the current session and receipt; automatic replay is prohibited.';
  else if (interruptedOnly) nextAction = 'The CLI was interrupted. Inspect the linked session and task evidence before deciding how to continue; do not redispatch automatically.';
  else if (evidence.notifications.length) nextAction = 'Review the persisted CLI lifecycle evidence and independently verify acceptance.';
  return { dispatchStatus, evidenceStatus, dispatchHistory: unresolvedHistory, nextAction };
}

export function getTaskProgress(ctx: Context, projectId: string, workItemId: string) {
  const project = new ProjectRepository(ctx.db, ctx.userId).getById(projectId);
  const item = new ProjectManagerRepository(ctx.db, ctx.userId).getWorkItem(projectId, workItemId);
  if (!project || !item) return { found: false as const };
  const session = resolveTaskPacketSession(ctx.db, ctx.userId, projectId, item);
  const attempt = readTaskDispatchAttempt(item);
  const evidence = verifiedDispatchEvidence(ctx, projectId, workItemId);
  const history = !attempt || attempt.status === 'not_sent' ? new PlatformActionRepository(ctx.db, ctx.userId).findDispatchHistory(projectId, workItemId, session?.id) : null;
  const guidance = attempt ? currentAttemptGuidance(ctx, attempt, item.status, evidence, history)
    : missingAttemptGuidance(history);
  return { found: true as const, taskPacket: buildTaskPacket({ project, workItem: item, session }), attempt: attempt ?? null,
    notifications: evidence?.notifications ?? [], independentlyVerified: false, ...guidance };
}

export function taskCompletionReport(notification: TaskNotificationEvidence, summary?: string): string {
  const state = notification.notificationType === 'task_completed' ? 'CLI reports completion; acceptance is not independently verified.' : 'CLI reports failure; investigate before reopening.';
  return `${state}${summary ? ` Summary: ${summary}` : ''}`;
}

export function closeTask(ctx: CommandContext, input: z.infer<typeof taskCloseInput>) {
  const evidence = verifiedDispatchEvidence(ctx, input.projectId, input.workItemId, input.notificationId);
  if (!evidence || evidence.attempt.id !== input.attemptId || evidence.notifications.length !== 1) throw new Error('TASK_CLOSE_EVIDENCE_MISMATCH');
  const notification = evidence.notifications[0]!;
  if (notification.notificationType !== 'task_completed' || !['in_progress', 'ready_for_review'].includes(evidence.item.status)) throw new Error('TASK_NOT_READY_FOR_REVIEW');
  if (evidence.attempt.consumedNotificationId && evidence.attempt.consumedNotificationId !== notification.id) throw new Error('TASK_NOTIFICATION_ALREADY_CONSUMED');
  ctx.authorize?.();
  const report = taskCompletionReport(notification, input.summary);
  const attempt: TaskDispatchAttempt = { ...evidence.attempt, consumedNotificationId: notification.id, report };
  ctx.db.transaction(() => {
    patchTaskAttempt(ctx, input.projectId, input.workItemId, attempt);
    new ProjectManagerRepository(ctx.db, ctx.userId).updateWorkItemStatus(input.projectId, input.workItemId, { status: 'ready_for_review' });
  }).immediate();
  return { workItemId: input.workItemId, attemptId: attempt.id, status: 'ready_for_review', independentlyVerified: false, notificationId: notification.id, report };
}

/** Persistent reconciliation owns writes; read tools never call this. */
export function reconcileTaskDispatch(ctx: Context, projectId: string, workItemId: string): boolean {
  const evidence = verifiedDispatchEvidence(ctx, projectId, workItemId);
  if (!evidence || evidence.item.status !== 'in_progress' || evidence.attempt.consumedNotificationId) return false;
  // An interruption is observable, but does not prove task completion or failure.
  const notification = evidence.notifications.find(entry => entry.notificationType !== 'task_interrupted');
  if (!notification) return false;
  ctx.db.transaction(() => {
    patchTaskAttempt(ctx, projectId, workItemId, { ...evidence.attempt, consumedNotificationId: notification.id, report: taskCompletionReport(notification) });
    new ProjectManagerRepository(ctx.db, ctx.userId).updateWorkItemStatus(projectId, workItemId, { status: notification.notificationType === 'task_completed' ? 'ready_for_review' : 'blocked' });
  }).immediate();
  return true;
}

export function reconcilePendingTaskDispatches(db: Database): void {
  for (const userId of TaskDispatchEvidenceRepository.pendingOwners(db)) {
    const repo = new TaskDispatchEvidenceRepository(db, userId);
    for (const task of repo.pendingTasks()) {
      try { reconcileTaskDispatch({ db, userId }, task.projectId, task.workItemId); } catch { /* A stale/invalid task cannot stop other pending tasks. */ }
    }
  }
}
