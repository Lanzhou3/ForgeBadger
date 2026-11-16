import { z } from 'zod';
import type { Database } from '../../../db/types.js';
import { ProjectRepository } from '../../../db/repositories/project-repository.js';
import { SessionRepository, type Session } from '../../../db/repositories/session-repository.js';
import { isAdapterId } from '../../adapter-discovery.js';
import type { CommandRunner } from '../../../lib/dependency-check.js';
import type { ForgeBadgerEventBus } from '../../event-bus.js';
import { normalizeAdapter } from '../../session-launch-plan.js';
import type { InMemorySessionManager } from '../../session-manager.js';
import { recordStartFailure, startSessionRuntime, type SessionRuntimeDeps } from '../../session-runtime.js';
import { ensureGoalWorkspace, type GoalWorkspace } from '../goal-workspace.js';
import { linkedWorkItem } from '../goal-board.js';
import { assertTaskDependenciesResolved } from '../../project-manager/task-execution.js';
import { dispatchSessionInput } from '../platform-access.js';
import { assertAdapterAutonomy } from '../goal-grants.js';
import { copilotTeamRoster, writerMemberById, writerMemberFor, type TeamMember } from '../team-roster.js';
import { ensureTaskWorkspace, sharedTreeWriters, taskWorkspaceState } from '../goal-task-workspace.js';
import type { GoalRow, GoalTaskRow } from '../goal-store.js';
import { isFleetStore, workStore, type WorkStore } from '../work-store.js';
import { assertFleetTaskDispatchable, assertNoFileScopeOverlap, assertScopeTaskOpen, fleetDispatchNotes } from '../../fleet/fleet-dispatch.js';
import { runningReviews } from '../goal-review.js';
import { AgentError } from '../types.js';
import { goalIdForRun } from './goals.js';
import type { AgentTool, AgentToolContext } from '../tool-registry.js';

/**
 * Goal delegation tools (M3).
 *
 * - `goal_delegate` spawns a write-capable coding sub-run whose tool surface
 *   is the goal sandbox tools plus read-only platform tools, budgeted from
 *   the parent run. The sub-run is orchestration-owned (context
 *   `runCodingDelegate`), so it executes on the real ReAct loop with durable
 *   steps and trace, and its report returns as this tool's result.
 * - `goal_dispatch_task` hands a task to a real CLI session working inside the
 *   goal workspace (the same tree the sandbox tools and verify commands use).
 *   The session is launched through the shared session runtime (adapter
 *   gating + CLI lifecycle hooks), reused while the task's previous session
 *   still runs there, and fed through the programmatic-terminal-submit path
 *   with delivery confirmation. The CLI's turn-end hook settles the task's
 *   dispatch status for the goal driver. It is operate-risk: without the
 *   `pm_dispatch` grant it goes through the normal pending-action approval;
 *   the adapter must also have an enabled writer member in the Copilot team roster.
 */

const delegateInput = z.object({
  taskId: z.string().trim().min(1).max(128),
  instructions: z.string().trim().min(1).max(8000)
}).strict();

const dispatchInput = z.object({
  taskId: z.string().trim().min(1).max(128),
  aiTool: z.string().trim().min(1).max(64).optional(),
  memberId: z.string().trim().min(1).max(64).optional(),
  instructions: z.string().trim().min(1).max(4000),
  /** Work in a dedicated git worktree of this task (needs a verify_command); other members may then work at the same time. */
  parallel: z.boolean().optional()
}).strict().refine(value => value.aiTool !== undefined || value.memberId !== undefined, { message: 'memberId or aiTool is required' });

function goalContextFor(context: AgentToolContext): { goalId: string; store: WorkStore; projectId: string } {
  const db = context.db as Database;
  const goalId = goalIdForRun(context);
  const store = workStore(db, context.userId, goalId);
  const goal = store.getGoal(goalId);
  if (!goal?.project_id)
    throw new AgentError('COPILOT_GOAL_PROJECT_REQUIRED', 'This goal has no project; delegation and dispatch are unavailable');
  return { goalId, store, projectId: goal.project_id };
}

function taskOf(store: WorkStore, goalId: string, taskId: string) {
  const task = store.listTasks(goalId).find(entry => entry.id === taskId);
  if (!task) throw new AgentError('COPILOT_NOT_FOUND', 'Task not found');
  return task;
}

export interface CodingDelegateResult { runId: string; status: string; report: string }

function resolveDispatchMember(memberId: string | undefined, requestedTool: string | undefined): { member: TeamMember | undefined; aiTool: string } {
  if (memberId !== undefined) {
    const member = writerMemberById(memberId);
    if (!member) throw new AgentError('COPILOT_GOAL_INPUT_INVALID', `Team member '${memberId}' is not an enabled writer`);
    if (requestedTool !== undefined && requestedTool !== member.adapter)
      throw new AgentError('COPILOT_GOAL_INPUT_INVALID', `Team member '${memberId}' uses '${member.adapter}', not '${requestedTool}'`);
    return { member, aiTool: member.adapter };
  }
  return { member: writerMemberFor(requestedTool!), aiTool: requestedTool! };
}

function rolePreamble(member: TeamMember | undefined): string {
  if (!member) return '';
  const intro = `You are ${member.name}${member.title ? `, ${member.title}` : ''}.`;
  return `\n\n[ForgeBadger] ${[intro, member.description].filter(Boolean).join(' ')}`;
}

function workspaceNote(workspace: GoalWorkspace, taskTree: boolean): string {
  if (taskTree)
    return `\n\n[ForgeBadger] You are in an isolated git worktree dedicated to this task, on branch ${workspace.branch}. Other team members work in parallel in their own worktrees: stay in this directory and do not touch, switch to or merge other branches; do not rebase or push. You do not need to commit; if you do, never commit ForgeBadger hook files (.claude/settings.local.json, .codex/hooks.json, .codex/hooks/, the opencode plugin) - leave them untracked. The lead verifies your work here and integrates it after the checks pass.`;
  return workspace.kind === 'worktree'
    ? `\n\n[ForgeBadger] You are in an isolated git worktree of the project on branch ${workspace.branch}. Keep all changes in this directory; do not switch branches, rebase or push. The owner reviews and merges the result.`
    : '\n\n[ForgeBadger] You are in an isolated copy of the project. Keep all changes in this directory; the owner reviews and merges the result.';
}

const PARALLEL_LIMIT_HINT = 'wait for a running member to finish, or ask the owner to raise the parallel writers limit in Copilot settings';

interface DispatchTarget { workspace: GoalWorkspace; label: GoalWorkspace['kind'] | 'task-worktree'; taskTree: boolean }

function runningDispatches(tasks: GoalTaskRow[], exceptTaskId: string): GoalTaskRow[] {
  return tasks.filter(entry => entry.dispatch_status === 'running' && entry.id !== exceptTaskId);
}

/**
 * Where the CLI works. A task that already has a worktree always dispatches
 * there. Otherwise `parallel` forks one (git goals, verify_command required);
 * without it the shared goal tree has exactly one writer at a time. The roster's
 * maxParallelWriters caps running dispatches for every dispatch of the goal.
 */
async function resolveDispatchTarget(db: Database, userId: string, goal: GoalRow, task: GoalTaskRow, goalWorkspace: GoalWorkspace, parallel: boolean): Promise<DispatchTarget> {
  const store = workStore(db, userId, goal.id);
  const others = runningDispatches(store.listTasks(goal.id), task.id);
  const limit = copilotTeamRoster().maxParallelWriters;
  // Reviewer turns count too: one cap for every CLI turn the goal is paying for.
  const busy = others.length + runningReviews(db, userId, goal.id).length;
  if (busy >= limit)
    throw new AgentError('COPILOT_GOAL_PARALLEL_LIMIT', `${busy} dispatches${busy > others.length ? ' and reviews' : ''} are already running (limit ${limit}); ${PARALLEL_LIMIT_HINT}`);
  // The branch counts too: a task whose directory was deleted still owns (and gets restored to) its worktree.
  if (await taskWorkspaceState(db, goal, task.id) !== 'none')
    return { workspace: await ensureTaskWorkspace(db, userId, goal, task.id), label: 'task-worktree', taskTree: true };
  const sharedWriter = sharedTreeWriters(db, goal).find(entry => entry.id !== task.id);
  if (!parallel) {
    if (sharedWriter)
      throw new AgentError('COPILOT_GOAL_INPUT_INVALID', `Task '${sharedWriter.id}' is still writing in the shared goal tree; wait for it or dispatch with parallel: true (needs a verify_command)`);
    return { workspace: goalWorkspace, label: goalWorkspace.kind, taskTree: false };
  }
  if (sharedWriter)
    throw new AgentError('COPILOT_GOAL_INPUT_INVALID', `Task '${sharedWriter.id}' is still writing in the shared goal tree; a parallel fork would capture its half-done edits - wait for it to finish`);
  if (goalWorkspace.kind !== 'worktree')
    throw new AgentError('COPILOT_GOAL_TASK_WORKSPACE_UNAVAILABLE', 'parallel dispatch needs a git-backed goal workspace; this goal uses a copy workspace, so dispatch one task at a time');
  if (!task.verify_command?.trim())
    throw new AgentError('COPILOT_GOAL_INPUT_INVALID', 'parallel dispatch needs a task with a verify_command: it is the only pass signal for work done in a separate worktree');
  if (task.dispatch_status === 'running')
    throw new AgentError('COPILOT_GOAL_INPUT_INVALID', 'This task is still running in the shared goal tree; wait for it to finish before dispatching it with parallel: true');
  const forked = await ensureTaskWorkspace(db, userId, goal, task.id);
  return { workspace: forked, label: 'task-worktree', taskTree: true };
}

/** The task's previous session, when it still runs in this workspace with this adapter. */
function reusableSession(repository: SessionRepository, sessionManager: InMemorySessionManager, sessionId: string | null, aiTool: string, workspace: GoalWorkspace): Session | undefined {
  if (!sessionId) return undefined;
  const session = repository.getById(sessionId);
  if (!session || session.status !== 'running' || session.aiTool !== aiTool || session.workingDir !== workspace.path) return undefined;
  return sessionManager.getSession(session.id)?.status === 'running' ? session : undefined;
}

export function createGoalDelegateTools(): AgentTool[] {
  return [
    {
      name: 'goal_delegate',
      description: 'Delegate one goal task to a write-capable coding sub-run that works inside the goal sandbox (goal_file_*/goal_run_checks, read-only platform reads; 24 steps). The sub-run report returns as the tool result; a failed delegate does not block the goal. 把单个任务委派给沙箱内的 coding 子 run。',
      risk: 'read',
      requiresApproval: false,
      inputSchema: delegateInput,
      async execute(input, context) {
        const { goalId, store, projectId } = goalContextFor(context);
        const { taskId, instructions } = delegateInput.parse(input);
        taskOf(store, goalId, taskId);
        assertScopeTaskOpen(store, goalId, taskId);
        const runCodingDelegate = context.runCodingDelegate as
          | ((delegate: { goalId: string; projectId: string; taskId: string; instructions: string }) => Promise<CodingDelegateResult>)
          | undefined;
        if (typeof runCodingDelegate !== 'function')
          throw new AgentError('COPILOT_GOAL_CONTEXT_REQUIRED', 'goal_delegate is only available inside an orchestrated goal run');
        return runCodingDelegate({ goalId, projectId, taskId, instructions });
      }
    },
    {
      name: 'goal_dispatch_task',
      description: 'Dispatch one goal task to a real CLI session working inside the goal workspace (the same tree goal_file_*/goal_run_checks use): reuses the task\'s running goal session or starts a dedicated one, and submits the instructions with delivery confirmation. The goal waits for the CLI to report its turn finished before continuing. Requires the pm_dispatch grant (otherwise owner approval) and an enabled writer team member (pass memberId, or aiTool to pick the first writer member for that CLI; configured by the owner in Copilot settings → Team members). With parallel: true (needs a verifyCommand, git projects only) the CLI works in its own git worktree of this task so several members can write at once (at most the parallel writers limit of the team); verify it with goal_run_checks (taskId) and merge it into the goal branch with goal_integrate_task. Without it the shared goal tree has one writer at a time. Dispatch is not completion: the task still needs its verify_command to pass. 把任务派发给真实 CLI 会话执行。',
      risk: 'operate',
      requiresApproval: true,
      inputSchema: dispatchInput,
      async execute(input, context) {
        const db = context.db as Database;
        const { goalId, store, projectId } = goalContextFor(context);
        const parsed = dispatchInput.parse(input);
        const { taskId, instructions } = parsed;
        const { member, aiTool } = resolveDispatchMember(parsed.memberId, parsed.aiTool);
        if (!isAdapterId(aiTool)) throw new AgentError('COPILOT_GOAL_INPUT_INVALID', `Unknown adapter '${aiTool}'`);
        assertAdapterAutonomy(aiTool);
        const task = taskOf(store, goalId, taskId);
        // Fleet scope only: a held task waits for the owner; parallel work may not overlap a running file scope.
        const fleetTask = isFleetStore(store) ? store.getTask(goalId, taskId) : undefined;
        if (fleetTask) {
          assertFleetTaskDispatchable(fleetTask);
          if (parsed.parallel === true && isFleetStore(store)) assertNoFileScopeOverlap(store, goalId, fleetTask);
        }
        // The board's dependency graph gates CLI work exactly like PM dispatch.
        const board = linkedWorkItem(db, context.userId, store.getGoal(goalId)!, task);
        if (board) {
          try { assertTaskDependenciesResolved(board.repo, board.item); }
          catch (error) { throw new AgentError('COPILOT_GOAL_TASK_BLOCKED', error instanceof Error ? error.message : 'Task dependencies are not done'); }
        }
        const sessionManager = context.sessionManager as InMemorySessionManager | undefined;
        if (!sessionManager) throw new AgentError('SESSION_RUNTIME_UNAVAILABLE', 'Session runtime unavailable');
        const project = new ProjectRepository(db, context.userId).getById(projectId);
        if (!project) throw new AgentError('COPILOT_PROJECT_NOT_FOUND', 'Goal project no longer exists');
        const goalWorkspace = await ensureGoalWorkspace(db, context.userId, store.getGoal(goalId)!, project);
        const { workspace, label, taskTree } = await resolveDispatchTarget(db, context.userId, store.getGoal(goalId)!, task, goalWorkspace, parsed.parallel === true);
        const repository = new SessionRepository(db, context.userId);
        // Never an owner-interactive session: either this task's own goal
        // session (still running in the workspace) or a fresh dedicated one.
        let session = reusableSession(repository, sessionManager, task.dispatched_session_id, aiTool, workspace);
        const created = !session;
        if (!session) {
          const row = repository.create({
            projectId: project.id, name: member ? `${member.name}: ${taskId.slice(0, 24)}` : `Goal task: ${taskId.slice(0, 24)}`, aiTool,
            workingDir: workspace.path, credentialMode: 'host_environment'
          });
          const runtime: SessionRuntimeDeps = {
            db, userId: context.userId, masterKey: context.masterKey as string, sessionManager,
            eventBus: context.eventBus as ForgeBadgerEventBus | undefined,
            adapterCommandRunner: context.adapterCommandRunner as CommandRunner | undefined
          };
          try { session = await startSessionRuntime(runtime, row.id); }
          catch (error) { recordStartFailure(runtime, row, error); throw error; }
        }
        const adapter = normalizeAdapter(session.aiTool);
        if (!adapter) throw new AgentError('COPILOT_GOAL_INPUT_INVALID', `Unsupported session adapter '${session.aiTool}'`);
        // Mark the turn running before submitting: a fast turn-end hook must
        // find the dispatch to settle. A failed submit releases the goal.
        // Fleets record which member got the task; goals ignore it.
        store.setTaskDispatched(goalId, taskId, session.id, member?.id ?? null);
        let result: Awaited<ReturnType<typeof dispatchSessionInput>>;
        const fleetNotes = fleetTask ? fleetDispatchNotes(db, context.userId, goalId, fleetTask, member?.id) : '';
        try { result = await dispatchSessionInput(sessionManager, session.id, adapter, `${instructions}${rolePreamble(member)}${fleetNotes}${workspaceNote(workspace, taskTree)}`, {}); }
        catch (error) { store.settleDispatch(taskId, 'failed'); throw error; }
        store.appendJournal(goalId, typeof context.runId === 'string' ? context.runId : null,
          `Dispatched task '${taskId}' to CLI session ${session.id} (adapter ${aiTool}${member ? `, member ${member.name} [${member.id}]` : ''}, ${created ? 'created' : 'reused'}, ${label === 'task-worktree' ? `task worktree on ${workspace.branch}` : `${label} workspace`}).`);
        return { ...result, adapter: aiTool, ...(member ? { member: { id: member.id, name: member.name } } : {}), sessionCreated: created, workspace: label };
      }
    }
  ];
}
