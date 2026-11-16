import { z } from 'zod';
import type { Database } from '../../../db/types.js';
import { AgentError } from '../types.js';
import { notifyGoalStatus } from '../goal-notify.js';
import { CopilotGoalStore } from '../goal-store.js';
import { isFleetStore, workStore, type WorkStore } from '../work-store.js';
import { normalizeFileScope } from '../../fleet/fleet-store.js';
import { taskWorkspaceStatus } from '../goal-task-workspace.js';
import { linkGoalTasksToBoard, mirrorGoalTaskToBoard } from '../goal-board.js';
import type { AgentTool, AgentToolContext } from '../tool-registry.js';

/**
 * Goal self-management tools for the Copilot harness. They mutate only
 * Copilot-owned goal state (tasks and the handover journal), so they execute
 * without owner approval. They are meaningful only inside a run that belongs
 * to a goal: the goal id is resolved from the current run row, and calls
 * outside a goal context fail with a guidance error.
 */

/** Fleet scope only: goal scopes refuse these fields (fleetTaskFields). */
const fleetTaskFields = {
  details: z.string().trim().min(1).max(8000).optional(),
  fileScope: z.array(z.string().min(1).max(200)).min(1).max(20).optional()
};
const taskInput = z.union([
  z.string().trim().min(1).max(500),
  z.object({ description: z.string().trim().min(1).max(500), verifyCommand: z.string().trim().min(1).max(1024).optional(), ...fleetTaskFields }).strict(),
  // Adopt an existing work item from the goal's project board.
  z.object({ workItemId: z.string().trim().min(1).max(128), description: z.string().trim().min(1).max(500).optional(),
    verifyCommand: z.string().trim().min(1).max(1024).optional(), ...fleetTaskFields }).strict()
]);

const addTasksInput = z.object({
  descriptions: z.array(taskInput).min(1).max(50)
}).strict();

const updateTaskInput = z.object({
  taskId: z.string().trim().min(1).max(128),
  status: z.enum(['pending', 'in_progress', 'passes', 'failed']),
  evidence: z.string().trim().min(1).max(8000).optional()
}).strict();

const writeJournalInput = z.object({
  note: z.string().trim().min(1).max(8000)
}).strict();

const askUserInput = z.object({
  question: z.string().trim().min(1).max(4000)
}).strict();

/** A task with its own worktree (directory or kept branch) may only pass once that work is in the goal branch; otherwise the owner would merge a goal branch missing it. */
async function assertTaskIntegrated(db: Database, store: WorkStore, goalId: string, taskId: string): Promise<void> {
  const goal = store.getGoal(goalId);
  if (!goal) return;
  const state = await taskWorkspaceStatus(db, goal, taskId);
  if (!state.exists && !state.lost) return;
  if (state.integrated) return;
  throw new AgentError('COPILOT_GOAL_TASK_NOT_INTEGRATED', state.lost
    ? 'The worktree directory of this task is missing and its branch holds work that is not in the goal branch; run goal_integrate_task (it restores the worktree) or re-dispatch the task, then mark it passes'
    : `This task works in its own worktree and its changes are ${state.dirty ? 'not committed and ' : ''}not in the goal branch yet; run goal_integrate_task first, then mark it passes`);
}

export function goalIdForRun(context: AgentToolContext): string {
  const runId = context.runId;
  if (typeof runId !== 'string' || !runId)
    throw new AgentError('COPILOT_GOAL_CONTEXT_REQUIRED', 'Goal tools can only run inside a Copilot run');
  const row = (context.db as Database)
    .prepare('SELECT goal_id FROM copilot_runs WHERE user_id=? AND id=?')
    .get(context.userId, runId) as { goal_id: string | null } | undefined;
  if (!row?.goal_id)
    throw new AgentError('COPILOT_GOAL_CONTEXT_REQUIRED', 'This run is not part of a goal; goal tools are unavailable');
  return row.goal_id;
}

/** The run's scope store: a goal or a fleet (execution tools work on both). */
function scopeStore(context: AgentToolContext, scopeId: string): WorkStore {
  return workStore(context.db as Database, context.userId, scopeId);
}

/** Goal lifecycle (ask/answer): goals only; a fleet id is not found here. */
function goalStore(context: AgentToolContext): CopilotGoalStore {
  return new CopilotGoalStore(context.db as Database, context.userId);
}

export function createGoalTools(): AgentTool[] {
  return [
    {
      name: 'goal_add_tasks',
      description: 'Add tasks to the current goal checklist during initialization or replanning. Each task gets the next sequence number; a task may carry verifyCommand, which must exit 0 via goal_run_checks before the task can pass. On a personal project every task is backed by a project board work item: new tasks create one, and {workItemId} adopts an existing open item (read it with pm_get_plan). In a fleet run tasks may also carry details and fileScope (repository-relative path prefixes the task may change; parallel dispatches with overlapping scopes are refused) and no work items are created. 向当前 Goal 添加任务清单（可带校验命令；个人项目自动关联看板任务）。',
      risk: 'read',
      requiresApproval: false,
      inputSchema: addTasksInput,
      async execute(input, context) {
        const db = context.db as Database;
        const goalId = goalIdForRun(context);
        const store = scopeStore(context, goalId);
        const goal = store.getGoal(goalId);
        if (!goal) throw new AgentError('COPILOT_NOT_FOUND', 'Goal not found');
        const drafts = addTasksInput.parse(input).descriptions.map(entry => typeof entry === 'string' ? { description: entry } : entry);
        if (!isFleetStore(store) && drafts.some(draft => 'details' in draft || 'fileScope' in draft))
          throw new AgentError('COPILOT_GOAL_INPUT_INVALID', 'details and fileScope are fleet task fields; goal tasks take description, verifyCommand and workItemId');
        if (isFleetStore(store)) for (const draft of drafts) if ('fileScope' in draft) normalizeFileScope(draft.fileScope);
        // Board items and goal tasks are created together or not at all.
        const tasks = db.transaction(() => store.addTasks(goalId, linkGoalTasksToBoard(db, context.userId, goal, drafts))).immediate();
        return { tasks };
      }
    },
    {
      name: 'goal_update_task',
      description: 'Advance a task of the current goal (pending/in_progress/passes/failed). Marking a task passes requires evidence; tasks with verifyCommand additionally require a successful goal_run_checks run (exit 0) with that taskId first; a task that works in its own worktree must be integrated into the goal branch (goal_integrate_task) before it can pass. 推进当前 Goal 的任务状态。',
      risk: 'read',
      requiresApproval: false,
      inputSchema: updateTaskInput,
      async execute(input, context) {
        const goalId = goalIdForRun(context);
        const { taskId, status, evidence } = updateTaskInput.parse(input);
        if (typeof context.delegateTaskId === 'string' && context.delegateTaskId !== taskId)
          throw new AgentError('COPILOT_GOAL_TASK_SCOPE', `This delegated sub-run may only update task ${context.delegateTaskId}`);
        const store = scopeStore(context, goalId);
        if (status === 'passes') await assertTaskIntegrated(context.db as Database, store, goalId, taskId);
        const task = store.updateTask(goalId, taskId, status, evidence);
        if (task) mirrorGoalTaskToBoard(context.db as Database, context.userId, store.getGoal(goalId)!, task);
        return { task };
      }
    },
    {
      name: 'goal_write_journal',
      description: 'Write a handover journal note for the current goal so the next run can pick up context. 为当前 Goal 写交接笔记。',
      risk: 'read',
      requiresApproval: false,
      inputSchema: writeJournalInput,
      async execute(input, context) {
        const goalId = goalIdForRun(context);
        const note = writeJournalInput.parse(input).note;
        const journal = scopeStore(context, goalId).appendJournal(goalId, typeof context.runId === 'string' ? context.runId : null, note);
        return { journal };
      }
    },
    {
      name: 'goal_ask_user',
      description: 'Interrupt the goal with a decision point: the goal becomes blocked (awaiting_user), the owner is notified, and the goal resumes only after the owner answers in the console. Use for genuinely owner-only decisions (approach trade-offs, ambiguous requirements), not for questions you can resolve yourself. 向用户提问并暂停 Goal 等待答复。',
      risk: 'read',
      requiresApproval: false,
      inputSchema: askUserInput,
      async execute(input, context) {
        const goalId = goalIdForRun(context);
        const store = goalStore(context);
        const goal = store.getGoal(goalId);
        if (!goal || goal.status !== 'active')
          throw new AgentError('COPILOT_GOAL_STATE', 'goal_ask_user requires an active goal');
        const { question } = askUserInput.parse(input);
        store.setStatus(goalId, 'blocked', 'awaiting_user');
        store.setPendingQuestion(goalId, question);
        store.appendJournal(goalId, typeof context.runId === 'string' ? context.runId : null, `Decision required from owner: ${question}`);
        notifyGoalStatus(context.db as Database, context.userId, store.getGoal(goalId)!);
        return { status: 'blocked', blockedReason: 'awaiting_user', question };
      }
    }
  ];
}
