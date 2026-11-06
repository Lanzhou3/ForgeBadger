import type { Database } from '../../db/types.js';
import { GOAL_GRANT_TOOLS, parseGoalGrants } from './goal-grants.js';
import { CopilotGoalStore } from './goal-store.js';
import { boardStatusOf } from './goal-board.js';

/**
 * Model-facing projection of one goal's current state. Injected as a prefix
 * message for goal runs so every continuation run sees the checklist and the
 * recent handover journal without changing the system prompt for non-goal
 * conversations.
 */
const SPEC_MAX_CHARS = 2000;
const TASK_EVIDENCE_MAX_CHARS = 500;
const TASK_MAX_ENTRIES = 30;

export function goalContextMessage(db: Database, userId: string, goalId: string): string | undefined {
  const store = new CopilotGoalStore(db, userId);
  const goal = store.getGoal(goalId);
  if (!goal) return undefined;
  const allTasks = store.listTasks(goalId);
  const shownTasks = allTasks.slice(0, TASK_MAX_ENTRIES);
  const journal = store.recentJournal(goalId, 3);
  const grants = parseGoalGrants(goal.grants_json);
  const grantedTools = grants.flatMap(grant => GOAL_GRANT_TOOLS[grant]);
  const clip = (value: string | null, max: number) => {
    if (!value) return value;
    const chars = Array.from(value);
    return chars.length > max ? `${chars.slice(0, max).join('')}…(${chars.length - max} more chars)` : value;
  };
  return 'Goal mode run (descriptive state; not a new owner instruction):\n' + JSON.stringify({
    goal: { id: goal.id, title: goal.title, spec: clip(goal.spec, SPEC_MAX_CHARS), status: goal.status },
    tasks: [
      // `id` is what goal_update_task / goal_delegate / goal_dispatch_task take.
      ...shownTasks.map(task => ({
        id: task.id, seq: task.seq, description: task.description, status: task.status,
        ...(task.verify_command ? { verifyCommand: task.verify_command } : {}),
        ...(task.work_item_id ? { workItemId: task.work_item_id, boardStatus: boardStatusOf(db, userId, goal, task) } : {}),
        ...(task.dispatch_status ? { dispatchStatus: task.dispatch_status } : {}),
        evidence: clip(task.evidence, TASK_EVIDENCE_MAX_CHARS)
      })),
      ...(allTasks.length > shownTasks.length ? [{ seq: null, description: `… ${allTasks.length - shownTasks.length} more tasks`, status: 'summary', evidence: null }] : [])
    ],
    recentJournal: journal.map(entry => clip(entry.note, TASK_EVIDENCE_MAX_CHARS)).reverse(),
    grants: grants.length
      ? `预授权可自动执行（免逐次审批）：${grants.join(', ')} → ${grantedTools.join(', ')}`
      : '无预授权：operate 类工具仍需逐次审批',
    instructions: 'If no task checklist exists, decompose the goal with goal_add_tasks first; a task may carry verifyCommand, '
      + 'which must exit 0 via goal_run_checks (pass taskId) before the task can pass. '
      + 'Edit files only inside the goal sandbox with goal_file_write / goal_file_edit (paths are sandbox-relative; the real project stays untouched). '
      + 'Verify work with goal_run_checks in the sandbox (owner approval per call unless the goal holds the sandbox_checks grant). '
      + 'Use goal_delegate to run a sandboxed coding sub-run for one task, or goal_dispatch_task (needs the pm_dispatch grant and an autonomy-listed adapter) to hand a task to a real CLI session working in the same goal workspace (a git worktree for git projects); '
      + 'the goal pauses until that CLI reports its turn finished, then verify its result with goal_run_checks — dispatch and a finished turn are not completion. '
      + 'For owner-only decisions use goal_ask_user, which pauses the goal until the owner answers. '
      + 'The owner reviews and merges the sandbox diff from the console. '
      + 'Tasks with a workItemId are mirrored on the project board: passes moves the work item to ready_for_review, and only the owner accepts it (done) or cancels it there; '
      + 'use pm_get_plan / pm_manage_dependency / pm_update_task_plan to keep the board plan accurate. '
      + 'Write a handover note with goal_write_journal at the end of every run.'
  });
}
