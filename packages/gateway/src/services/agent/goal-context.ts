import type { Database } from '../../db/types.js';
import { GOAL_GRANT_TOOLS, parseGoalGrants } from './goal-grants.js';
import { CopilotGoalStore } from './goal-store.js';

/**
 * Model-facing projection of one goal's current state. Injected as a prefix
 * message for goal runs so every continuation run sees the checklist, the
 * recent handover journal, and the remaining budget without changing the
 * system prompt for non-goal conversations.
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
  const usage = store.usage(goalId);
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
      ...shownTasks.map(task => ({ seq: task.seq, description: task.description, status: task.status, evidence: clip(task.evidence, TASK_EVIDENCE_MAX_CHARS) })),
      ...(allTasks.length > shownTasks.length ? [{ seq: null, description: `… ${allTasks.length - shownTasks.length} more tasks`, status: 'summary', evidence: null }] : [])
    ],
    recentJournal: journal.map(entry => clip(entry.note, TASK_EVIDENCE_MAX_CHARS)).reverse(),
    remainingBudget: {
      tokens: Math.max(0, goal.token_budget - usage.chargedTokens),
      runs: Math.max(0, goal.max_runs - usage.runCount)
    },
    grants: grants.length
      ? `预授权可自动执行（免逐次审批）：${grants.join(', ')} → ${grantedTools.join(', ')}`
      : '无预授权：operate 类工具仍需逐次审批',
    instructions: 'If no task checklist exists, decompose the goal with goal_add_tasks first; a task may carry verifyCommand, '
      + 'which must exit 0 via goal_run_checks (pass taskId) before the task can pass. '
      + 'Edit files only inside the goal sandbox with goal_file_write / goal_file_edit (paths are sandbox-relative; the real project stays untouched). '
      + 'Verify work with goal_run_checks in the sandbox. '
      + 'Use goal_delegate to run a sandboxed coding sub-run for one task, or goal_dispatch_task (needs the pm_dispatch grant and an autonomy-listed adapter) to hand a task to a real CLI session; dispatch is not completion — the verify gate still applies. '
      + 'For owner-only decisions use goal_ask_user, which pauses the goal until the owner answers. '
      + 'The owner reviews and merges the sandbox diff from the console. '
      + 'Write a handover note with goal_write_journal at the end of every run.'
  });
}
