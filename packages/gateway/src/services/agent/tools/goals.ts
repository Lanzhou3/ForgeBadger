import { z } from 'zod';
import type { Database } from '../../../db/types.js';
import { AgentError } from '../types.js';
import { notifyGoalStatus } from '../goal-notify.js';
import { CopilotGoalStore } from '../goal-store.js';
import type { AgentTool, AgentToolContext } from '../tool-registry.js';

/**
 * Goal self-management tools for the Copilot harness. They mutate only
 * Copilot-owned goal state (tasks and the handover journal), so they execute
 * without owner approval. They are meaningful only inside a run that belongs
 * to a goal: the goal id is resolved from the current run row, and calls
 * outside a goal context fail with a guidance error.
 */

const taskInput = z.union([
  z.string().trim().min(1).max(500),
  z.object({ description: z.string().trim().min(1).max(500), verifyCommand: z.string().trim().min(1).max(1024).optional() }).strict()
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

function goalStore(context: AgentToolContext): CopilotGoalStore {
  return new CopilotGoalStore(context.db as Database, context.userId);
}

export function createGoalTools(): AgentTool[] {
  return [
    {
      name: 'goal_add_tasks',
      description: 'Add tasks to the current goal checklist during initialization or replanning. Each task gets the next sequence number; a task may carry verifyCommand, which must exit 0 via goal_run_checks before the task can pass. 向当前 Goal 添加任务清单（可带校验命令）。',
      risk: 'read',
      requiresApproval: false,
      inputSchema: addTasksInput,
      async execute(input, context) {
        const goalId = goalIdForRun(context);
        const tasks = goalStore(context).addTasks(goalId, addTasksInput.parse(input).descriptions);
        return { tasks };
      }
    },
    {
      name: 'goal_update_task',
      description: 'Advance a task of the current goal (pending/in_progress/passes/failed). Marking a task passes requires evidence; tasks with verifyCommand additionally require a successful goal_run_checks run (exit 0) with that taskId first. 推进当前 Goal 的任务状态。',
      risk: 'read',
      requiresApproval: false,
      inputSchema: updateTaskInput,
      async execute(input, context) {
        const goalId = goalIdForRun(context);
        const { taskId, status, evidence } = updateTaskInput.parse(input);
        if (typeof context.delegateTaskId === 'string' && context.delegateTaskId !== taskId)
          throw new AgentError('COPILOT_GOAL_TASK_SCOPE', `This delegated sub-run may only update task ${context.delegateTaskId}`);
        const task = goalStore(context).updateTask(goalId, taskId, status, evidence);
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
        const journal = goalStore(context).appendJournal(goalId, typeof context.runId === 'string' ? context.runId : null, note);
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
