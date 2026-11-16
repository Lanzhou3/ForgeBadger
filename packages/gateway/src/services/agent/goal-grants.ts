import type { Database } from '../../db/types.js';
import { AgentError } from './types.js';
import { PROGRAMMATIC_SUBMIT_ADAPTERS } from '../programmatic-terminal-submit.js';
import { writerMemberFor } from './team-roster.js';

/**
 * Goal authorization grants (M3). A grant is created once with the goal and
 * covers a fixed, auditable set of operate-class tools; covered tools skip
 * per-call owner approval inside goal runs only. Tools outside every granted
 * set keep the per-call pending-action flow, and scheduled/reactive sources
 * keep their existing write restrictions.
 */

export const GOAL_GRANTS = ['operate_sessions', 'terminal_run', 'pm_dispatch', 'sandbox_checks'] as const;
export type GoalGrant = (typeof GOAL_GRANTS)[number];

/** The single grant → tool mapping table. Audit changes here deliberately. */
export const GOAL_GRANT_TOOLS: Record<GoalGrant, readonly string[]> = {
  operate_sessions: ['start_session', 'stop_session', 'takeover_session'],
  terminal_run: ['terminal_run', 'terminal_open', 'terminal_close'],
  pm_dispatch: ['dispatch_task_to_session', 'pm_execute_task_packet', 'pm_prepare_task_packet', 'goal_dispatch_task', 'goal_review_task'],
  // Host shell inside the goal sandbox copy (no OS-level isolation).
  sandbox_checks: ['goal_run_checks']
};

export function parseGoalGrants(value: string | null | undefined): GoalGrant[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is GoalGrant => (GOAL_GRANTS as readonly string[]).includes(entry as string));
  } catch {
    return [];
  }
}

/** First grant of the scope (goal or fleet) that covers the tool, or null (approval required). Active scopes only. */
export function goalGrantForTool(db: Database, userId: string, goalId: string, toolName: string): GoalGrant | null {
  const row = (db.prepare("SELECT grants_json FROM copilot_goals WHERE user_id=? AND id=? AND status='active'").get(userId, goalId)
    ?? db.prepare("SELECT grants_json FROM fleets WHERE user_id=? AND id=? AND status='active'").get(userId, goalId)) as { grants_json: string } | undefined;
  if (!row) return null;
  for (const grant of parseGoalGrants(row.grants_json))
    if ((GOAL_GRANT_TOOLS[grant] as readonly string[]).includes(toolName)) return grant;
  return null;
}

/**
 * Gate for programmatic CLI dispatch: the CLI must support programmatic
 * submit, and the owner must have an enabled writer team member for it
 * (Copilot settings → Team members).
 */
export function assertAdapterAutonomy(aiTool: string): void {
  if (!(PROGRAMMATIC_SUBMIT_ADAPTERS as readonly string[]).includes(aiTool))
    throw new AgentError('COPILOT_ADAPTER_AUTONOMY_DENIED',
      `Adapter '${aiTool}' cannot be driven programmatically yet (manual only).`);
  if (!writerMemberFor(aiTool))
    throw new AgentError('COPILOT_ADAPTER_AUTONOMY_DENIED',
      `No enabled team member with the writer role uses '${aiTool}'; ask the owner to add or enable a team member for that CLI in Copilot settings → Team members.`);
}
