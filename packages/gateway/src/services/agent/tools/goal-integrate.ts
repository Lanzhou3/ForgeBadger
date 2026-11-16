import { z } from 'zod';
import type { Database } from '../../../db/types.js';
import { ProjectRepository } from '../../../db/repositories/project-repository.js';
import { AgentError } from '../types.js';
import type { GoalRow, GoalTaskRow } from '../goal-store.js';
import { workStore } from '../work-store.js';
import { assertScopeTaskOpen } from '../../fleet/fleet-dispatch.js';
import { ensureGoalWorkspace } from '../goal-workspace.js';
import { ensureTaskWorkspace, integrateTaskWorkspace, sharedTreeWriters, taskWorkspaceIdentity, taskWorkspaceState } from '../goal-task-workspace.js';
import { goalIdForRun } from './goals.js';
import type { AgentTool } from '../tool-registry.js';

/**
 * `goal_integrate_task`: merge one task's worktree branch into the goal
 * branch. It mutates only the Copilot-owned goal branch (never the project
 * branch or working tree, which stay behind the owner's HTTP merge), so like
 * goal_file_write it runs without per-call approval and needs no grant.
 * Goal runs only: it is not on the coding sub-run surface.
 */

const MAX_REPORTED_FILES = 50;

const integrateInput = z.object({ taskId: z.string().trim().min(1).max(128) }).strict();

export function createGoalIntegrateTools(): AgentTool[] {
  return [{
    name: 'goal_integrate_task',
    description: 'Merge a task\'s own worktree (a task dispatched with parallel: true) into the goal branch after its verify_command passed there (goal_run_checks with taskId). Integration is serialized and never overwrites: on a conflict nothing changes and the error names the conflicting files — then re-dispatch the same member to merge the goal branch into its task branch and re-verify, or integrate tasks in another order. Tasks with a worktree cannot be marked passes until integrated. The project itself is untouched until the owner merges. 把任务 worktree 并入 Goal 分支（需先在任务 worktree 里验证通过）。',
    risk: 'read',
    requiresApproval: false,
    inputSchema: integrateInput,
    async execute(input, context) {
      const db = context.db as Database;
      const goalId = goalIdForRun(context);
      const { taskId } = integrateInput.parse(input);
      const store = workStore(db, context.userId, goalId);
      const goal = store.getGoal(goalId);
      if (!goal?.project_id) throw new AgentError('COPILOT_GOAL_PROJECT_REQUIRED', 'This goal has no project; task integration is unavailable');
      const task = store.listTasks(goalId).find(entry => entry.id === taskId);
      if (!task) throw new AgentError('COPILOT_NOT_FOUND', 'Task not found');
      assertScopeTaskOpen(store, goalId, taskId);
      const project = new ProjectRepository(db, context.userId).getById(goal.project_id);
      if (!project) throw new AgentError('COPILOT_PROJECT_NOT_FOUND', 'Goal project no longer exists');
      await ensureGoalWorkspace(db, context.userId, goal, project);
      const fresh = store.getGoal(goalId)!;
      await assertReady(db, context.userId, fresh, task);
      const { commit, changes } = await integrateTaskWorkspace(db, context.userId, fresh, taskId);
      const changedFiles = changes.map(change => `${change.status}: ${change.path}`);
      store.appendJournal(goalId, typeof context.runId === 'string' ? context.runId : null,
        `Integrated task '${taskId}' into the goal branch at ${commit.slice(0, 12)} (${changes.length ? `${changes.length} files` : 'nothing new'}).`);
      return {
        integrated: true, commit, changedFiles: changedFiles.slice(0, MAX_REPORTED_FILES),
        changedFileCount: changedFiles.length, conflicts: [],
        note: 'Tasks were verified separately: re-run the relevant checks on the goal tree (goal_run_checks without taskId) before relying on the combined result.'
      };
    }
  }];
}

/** The last `verified-tree:` fingerprint recorded in the task evidence by a goal_run_checks run in the task worktree. */
function verifiedTree(evidence: string | null): string | undefined {
  const matches = [...(evidence ?? '').matchAll(/verified-tree: ([a-f0-9]{40,64})/g)];
  return matches.at(-1)?.[1];
}

async function assertReady(db: Database, userId: string, goal: GoalRow, task: GoalTaskRow): Promise<void> {
  const notReady = (message: string) => new AgentError('COPILOT_GOAL_TASK_NOT_READY', message);
  if (task.status === 'cancelled') throw new AgentError('COPILOT_GOAL_TASK_CANCELLED', `Task '${task.description}' was cancelled; it cannot be integrated`);
  if (await taskWorkspaceState(db, goal, task.id) === 'none')
    throw new AgentError('COPILOT_GOAL_TASK_WORKSPACE_UNAVAILABLE', 'This task has no worktree (it was not dispatched with parallel: true); nothing to integrate');
  if (task.dispatch_status === 'running') throw notReady('The task\'s CLI turn is still running; wait for it to finish');
  const sharedWriter = sharedTreeWriters(db, goal)[0];
  if (sharedWriter) throw notReady(`Task '${sharedWriter.id}' is still writing in the shared goal tree; wait for it before integrating`);
  // Dispatch clears the verify record, so a reworked task must be verified again; the fingerprint catches edits after verification.
  if (task.verified_at === null || task.verify_exit_code !== 0)
    throw notReady('Run the task verify_command in its worktree first (goal_run_checks with taskId) and get exit code 0');
  const verified = verifiedTree(task.evidence);
  if (!verified) throw notReady('The verification of this task was not recorded against its worktree; re-run goal_run_checks with taskId');
  if (await taskWorkspaceState(db, goal, task.id) === 'lost') await ensureTaskWorkspace(db, userId, goal, task.id);
  if (await taskWorkspaceIdentity(db, goal, task.id) !== verified)
    throw notReady('The task worktree changed after its verification; re-run goal_run_checks with taskId before integrating');
}
