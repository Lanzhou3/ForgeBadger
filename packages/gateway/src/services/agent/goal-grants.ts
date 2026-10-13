import type { Database } from '../../db/types.js';
import { AgentError } from './types.js';

/**
 * Goal authorization grants (M3). A grant is created once with the goal and
 * covers a fixed, auditable set of operate-class tools; covered tools skip
 * per-call owner approval inside goal runs only. Tools outside every granted
 * set keep the per-call pending-action flow, and scheduled/reactive sources
 * keep their existing write restrictions.
 */

export const GOAL_GRANTS = ['operate_sessions', 'terminal_run', 'pm_dispatch'] as const;
export type GoalGrant = (typeof GOAL_GRANTS)[number];

/** The single grant → tool mapping table. Audit changes here deliberately. */
export const GOAL_GRANT_TOOLS: Record<GoalGrant, readonly string[]> = {
  operate_sessions: ['start_session', 'stop_session', 'takeover_session'],
  terminal_run: ['terminal_run', 'terminal_open', 'terminal_close'],
  pm_dispatch: ['dispatch_task_to_session', 'pm_execute_task_packet', 'pm_prepare_task_packet', 'goal_dispatch_task']
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

/** First grant of the goal that covers the tool, or null (approval required). Active goals only. */
export function goalGrantForTool(db: Database, userId: string, goalId: string, toolName: string): GoalGrant | null {
  const row = db.prepare("SELECT grants_json FROM copilot_goals WHERE user_id=? AND id=? AND status='active'").get(userId, goalId) as { grants_json: string } | undefined;
  if (!row) return null;
  for (const grant of parseGoalGrants(row.grants_json))
    if ((GOAL_GRANT_TOOLS[grant] as readonly string[]).includes(toolName)) return grant;
  return null;
}

/** FORGEBADGER_CLI_AUTONOMY_ADAPTERS gate for programmatic CLI dispatch. */
export function assertAdapterAutonomy(aiTool: string): void {
  const allowed = (process.env.FORGEBADGER_CLI_AUTONOMY_ADAPTERS ?? '')
    .split(',').map(entry => entry.trim()).filter(Boolean);
  if (!allowed.includes(aiTool))
    throw new AgentError('COPILOT_ADAPTER_AUTONOMY_DENIED',
      `Adapter '${aiTool}' is not listed in FORGEBADGER_CLI_AUTONOMY_ADAPTERS; add it there (and restart the gateway) to enable programmatic CLI dispatch.`);
}
