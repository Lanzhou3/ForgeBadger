import { AgentError } from './types.js';
import type { CopilotGoalStore, GoalRow } from './goal-store.js';

export function applyGoalTransition(store: CopilotGoalStore, goal: GoalRow, action: 'pause' | 'resume' | 'cancel'): GoalRow {
  const current = goal.status;
  const allowed = action === 'pause' ? current === 'active'
    : action === 'resume' ? current === 'paused'
    : current === 'active' || current === 'paused' || current === 'blocked' || current === 'cancelled';
  if (!allowed) throw new AgentError('COPILOT_GOAL_STATE', `Cannot ${action} a goal in status '${current}'`);
  if (action === 'cancel' && current === 'cancelled') return goal;
  const next = action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'cancelled';
  return store.setStatus(goal.id, next)!;
}
