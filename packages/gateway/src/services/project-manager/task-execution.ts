import { assertAdapterAutonomy } from '../adapter-autonomy.js';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ProjectRepository } from '../../db/repositories/project-repository.js';
import { ProjectManagerRepository, type ProjectManagerWorkItem } from '../../db/repositories/project-manager-repository.js';
import { SessionRepository, type Session } from '../../db/repositories/session-repository.js';
import { PlatformActionRepository } from '../../db/repositories/platform-action-repository.js';
import { TaskDispatchEvidenceRepository } from '../../db/repositories/task-dispatch-evidence-repository.js';
import type { CommandContext } from '../platform-commands/types.js';
import { PlatformNoEffectError } from '../platform-commands/errors.js';
import { canonical } from '../platform-commands/actions.js';
import { startSessionRuntime } from '../platform-commands/session-commands.js';
import { dispatchSessionInput } from '../agent/platform-access.js';
import { normalizeAdapter } from '../session-launch-plan.js';
import { assertLegacyTaskExecution } from './access.js';
import { buildTaskPacket, createTaskPacketContext, createTaskPacketSessionName, readTaskPacketDetails, resolveTaskPacketSession, toTaskPacketSessionDto, withTaskPacketSessionLink } from './task-packets.js';

const attemptSchema = z.object({
  id: z.string(), originIntentId: z.string(), sessionId: z.string(), promptDigest: z.string(),
  notificationBaseline: z.number().int().nonnegative(), notificationAnchor: z.string().optional(),
  status: z.enum(['preparing', 'sending', 'dispatched', 'not_sent', 'unknown']),
  createdAt: z.string(), dispatchedAt: z.string().optional(), consumedNotificationId: z.string().optional(),
  runtimeIdentity: z.string().optional(), manualInterventionAt: z.string().optional(),
  report: z.string().optional()
});
export type TaskDispatchAttempt = z.infer<typeof attemptSchema>;
export function readTaskDispatchAttempt(item: ProjectManagerWorkItem): TaskDispatchAttempt | undefined {
  const result = attemptSchema.safeParse(readTaskPacketDetails(item.details).attempt);
  return result.success ? result.data : undefined;
}
export function taskPromptDigest(prompt: string): string { return createHash('sha256').update(prompt).digest('hex'); }
export function taskRuntimeIdentity(session: Session): string {
  return taskPromptDigest(canonical({ id: session.id, runtime: session.runtimeSessionName, token: session.attachToken }));
}

export function assertTaskDispatchable(item: ProjectManagerWorkItem): void {
  if (!['todo', 'in_progress'].includes(item.status)) throw new PlatformNoEffectError(`TASK_NOT_DISPATCHABLE: ${item.status}; explicitly reopen the task before dispatch`);
  const attempt = readTaskDispatchAttempt(item);
  if (attempt && attempt.status !== 'not_sent') throw new PlatformNoEffectError(attempt.status === 'dispatched' ? 'TASK_ALREADY_DISPATCHED: follow progress or close the current attempt' : 'TASK_DISPATCH_UNCERTAIN: inspect the current attempt; automatic replay prohibited');
}

export function patchTaskAttempt(ctx: Pick<CommandContext, 'db' | 'userId'>, projectId: string, workItemId: string, attempt: TaskDispatchAttempt) {
  const repo = new ProjectManagerRepository(ctx.db, ctx.userId);
  const item = repo.getWorkItem(projectId, workItemId)!;
  return repo.updateWorkItem(projectId, workItemId, { details: {
    ...item.details, taskPacket: { ...readTaskPacketDetails(item.details), attempt,
      ...(attempt.dispatchedAt ? { dispatchedAt: attempt.dispatchedAt } : {}) }
  } });
}

/** One invocation owns exactly one attempt; incomplete no-send attempts may be resumed by a new intent. */
export async function executeTaskPacket(ctx: CommandContext, input: { projectId: string; workItemId: string; aiTool?: string | undefined }) {
  assertLegacyTaskExecution(ctx.db, input.projectId);
  const repo = new ProjectManagerRepository(ctx.db, ctx.userId);
  const sessions = new SessionRepository(ctx.db, ctx.userId);
  const project = new ProjectRepository(ctx.db, ctx.userId).getById(input.projectId)!;
  let item = repo.getWorkItem(project.id, input.workItemId)!;
  assertTaskDispatchable(item);
  const manager = ctx.sessionManager;
  if (!manager) throw new PlatformNoEffectError('Session runtime unavailable');
  const origin = ctx.actionIntentId && new PlatformActionRepository(ctx.db, ctx.userId).get(ctx.actionIntentId);
  if (!origin || origin.command_id !== 'pm.task.execute' || origin.status !== 'executing') throw new PlatformNoEffectError('Task execution origin missing');
  const originInput = JSON.parse(origin.input_json) as { projectId: string; workItemId: string };
  if (originInput.projectId !== project.id || originInput.workItemId !== item.id) throw new PlatformNoEffectError('Task execution origin mismatch');
  let session = resolveTaskPacketSession(ctx.db, ctx.userId, project.id, item);
  if (session && repo.getWorkItemByTaskPacketSession(project.id, session.id)?.id !== item.id) throw new PlatformNoEffectError('TASK_SESSION_LINK_AMBIGUOUS');
  const adapter = normalizeAdapter(session?.aiTool ?? input.aiTool ?? project.aiTool);
  if (!adapter || (input.aiTool && input.aiTool !== adapter)) throw new PlatformNoEffectError('Task adapter mismatch');
  assertAdapterAutonomy(adapter);
  const semantics = canonical({ project, title: item.title, description: item.description, acceptanceCriteria: item.acceptanceCriteria, stageId: item.stageId });
  const authorize = () => {
    ctx.authorize?.();
    assertAdapterAutonomy(adapter);
    const fresh = repo.getWorkItem(project.id, item.id)!;
    const currentProject = new ProjectRepository(ctx.db, ctx.userId).getById(project.id);
    if (canonical({ project: currentProject, title: fresh.title, description: fresh.description, acceptanceCriteria: fresh.acceptanceCriteria, stageId: fresh.stageId }) !== semantics) throw new Error('Task execution semantics changed');
    const linked = resolveTaskPacketSession(ctx.db, ctx.userId, project.id, fresh);
    if (session && repo.getWorkItemByTaskPacketSession(project.id, session.id)?.id !== item.id) throw new Error('Task session binding is ambiguous');
    if (session && (!linked || linked.id !== session.id || linked.aiTool !== adapter || linked.workingDir !== project.path)) throw new Error('Task session binding changed');
  };
  const mutate = (write: () => void) => ctx.db.transaction(() => { authorize(); write(); ctx.checkpointResources?.(); }).immediate();
  const completedStages: string[] = [];
  mutate(() => {
    if (!session) {
      session = sessions.create({ projectId: project.id, name: createTaskPacketSessionName(item.title), aiTool: adapter, workingDir: project.path, credentialMode: 'host_environment' });
      item = repo.updateWorkItem(project.id, item.id, { details: withTaskPacketSessionLink(item.details, session, project, createTaskPacketContext(item, project)) });
    }
  });
  const boundSession = session!;
  completedStages.push('session_linked');
  let attempt: TaskDispatchAttempt = { id: randomUUID(), originIntentId: origin.id, sessionId: boundSession.id, promptDigest: taskPromptDigest(buildTaskPacket({ project, workItem: item, session: boundSession }).prompt), notificationBaseline: 0, status: 'preparing', createdAt: new Date().toISOString() };
  mutate(() => { item = patchTaskAttempt(ctx, project.id, item.id, attempt); });
  try {
    const live = manager.getSession(boundSession.id);
    const running = (live?.status === 'running' || live?.status === 'detached' || boundSession.status === 'running')
      && await manager.hasLiveTerminal(boundSession.id, boundSession.runtimeSessionName ?? undefined);
    authorize();
    if (!running) await startSessionRuntime({ ...ctx, authorize }, boundSession.id);
    completedStages.push('session_running');
    const receipt = await dispatchSessionInput(manager, boundSession.id, adapter, buildTaskPacket({ project, workItem: item, session: boundSession }).prompt, {
      authorize,
      beforeStage() {
        mutate(() => {
          const evidence = new TaskDispatchEvidenceRepository(ctx.db, ctx.userId);
          const baseline = evidence.baseline();
          const anchor = evidence.anchor(baseline);
          attempt = { ...attempt, status: 'sending', runtimeIdentity: taskRuntimeIdentity(sessions.getById(boundSession.id)!), notificationBaseline: baseline, ...(anchor ? { notificationAnchor: anchor } : {}) };
          item = patchTaskAttempt(ctx, project.id, item.id, attempt);
        });
      }
    });
    attempt = { ...attempt, status: 'dispatched', dispatchedAt: new Date().toISOString() };
    mutate(() => {
      item = patchTaskAttempt(ctx, project.id, item.id, attempt);
      if (item.status === 'todo') item = repo.updateWorkItemStatus(project.id, item.id, { status: 'in_progress' });
    });
    return { executionStatus: 'dispatched', attemptId: attempt.id, taskPacket: buildTaskPacket({ project, workItem: item, session: sessions.getById(boundSession.id)! }), session: toTaskPacketSessionDto(sessions.getById(boundSession.id)!), dispatch: receipt };
  } catch (error) {
    if (error instanceof PlatformNoEffectError) {
      attempt = { ...attempt, status: 'not_sent' };
      mutate(() => { item = patchTaskAttempt(ctx, project.id, item.id, attempt); });
      return { executionStatus: 'incomplete', attemptId: attempt.id, completedStages, sessionId: boundSession.id, dispatch: { status: 'not_sent' }, error: error.message,
        nextAction: error.message === 'PROGRAMMATIC_SUBMIT_NATIVE_APPROVAL_REQUIRED'
          ? 'Stop dispatch attempts. The native CLI requires a directory or hook trust decision in its terminal. After the owner reviews it, resume only the not-sent stage with a new authorized intent.'
          : 'Check session readiness, then create a new pm.task.execute intent to deliver the remaining prompt.' };
    }
    // Keep the sending/preparing record if authority has gone away. Both block replay after restart.
    try { mutate(() => { patchTaskAttempt(ctx, project.id, item.id, { ...attempt, status: 'unknown' }); }); } catch { /* Preserve the durable fence. */ }
    throw error;
  }
}
