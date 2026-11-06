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
import { CopilotGoalStore } from '../goal-store.js';
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
 *   the adapter must also be listed in FORGEBADGER_CLI_AUTONOMY_ADAPTERS.
 */

const delegateInput = z.object({
  taskId: z.string().trim().min(1).max(128),
  instructions: z.string().trim().min(1).max(8000)
}).strict();

const dispatchInput = z.object({
  taskId: z.string().trim().min(1).max(128),
  aiTool: z.string().trim().min(1).max(64),
  instructions: z.string().trim().min(1).max(4000)
}).strict();

function goalContextFor(context: AgentToolContext): { goalId: string; store: CopilotGoalStore; projectId: string } {
  const db = context.db as Database;
  const goalId = goalIdForRun(context);
  const store = new CopilotGoalStore(db, context.userId);
  const goal = store.getGoal(goalId);
  if (!goal?.project_id)
    throw new AgentError('COPILOT_GOAL_PROJECT_REQUIRED', 'This goal has no project; delegation and dispatch are unavailable');
  return { goalId, store, projectId: goal.project_id };
}

function taskOf(store: CopilotGoalStore, goalId: string, taskId: string) {
  const task = store.listTasks(goalId).find(entry => entry.id === taskId);
  if (!task) throw new AgentError('COPILOT_NOT_FOUND', 'Task not found');
  return task;
}

export interface CodingDelegateResult { runId: string; status: string; report: string }

function workspaceNote(workspace: GoalWorkspace): string {
  return workspace.kind === 'worktree'
    ? `\n\n[ForgeBadger] You are in an isolated git worktree of the project on branch ${workspace.branch}. Keep all changes in this directory; do not switch branches, rebase or push. The owner reviews and merges the result.`
    : '\n\n[ForgeBadger] You are in an isolated copy of the project. Keep all changes in this directory; the owner reviews and merges the result.';
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
      description: 'Dispatch one goal task to a real CLI session working inside the goal workspace (the same tree goal_file_*/goal_run_checks use): reuses the task\'s running goal session or starts a dedicated one, and submits the instructions with delivery confirmation. The goal waits for the CLI to report its turn finished before continuing. Requires the pm_dispatch grant (otherwise owner approval) and the adapter listed in FORGEBADGER_CLI_AUTONOMY_ADAPTERS. Dispatch is not completion: the task still needs its verify_command to pass. 把任务派发给真实 CLI 会话执行。',
      risk: 'operate',
      requiresApproval: true,
      inputSchema: dispatchInput,
      async execute(input, context) {
        const db = context.db as Database;
        const { goalId, store, projectId } = goalContextFor(context);
        const { taskId, aiTool, instructions } = dispatchInput.parse(input);
        if (!isAdapterId(aiTool)) throw new AgentError('COPILOT_GOAL_INPUT_INVALID', `Unknown adapter '${aiTool}'`);
        assertAdapterAutonomy(aiTool);
        const task = taskOf(store, goalId, taskId);
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
        const workspace = await ensureGoalWorkspace(db, context.userId, store.getGoal(goalId)!, project);
        const repository = new SessionRepository(db, context.userId);
        // Never an owner-interactive session: either this task's own goal
        // session (still running in the workspace) or a fresh dedicated one.
        let session = reusableSession(repository, sessionManager, task.dispatched_session_id, aiTool, workspace);
        const created = !session;
        if (!session) {
          const row = repository.create({
            projectId: project.id, name: `Goal task: ${taskId.slice(0, 24)}`, aiTool,
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
        store.setTaskDispatched(goalId, taskId, session.id);
        let result: Awaited<ReturnType<typeof dispatchSessionInput>>;
        try { result = await dispatchSessionInput(sessionManager, session.id, adapter, `${instructions}${workspaceNote(workspace)}`, {}); }
        catch (error) { store.settleDispatch(taskId, 'failed'); throw error; }
        store.appendJournal(goalId, typeof context.runId === 'string' ? context.runId : null,
          `Dispatched task '${taskId}' to CLI session ${session.id} (adapter ${aiTool}, ${created ? 'created' : 'reused'}, ${workspace.kind} workspace).`);
        return { ...result, adapter: aiTool, sessionCreated: created, workspace: workspace.kind };
      }
    }
  ];
}
