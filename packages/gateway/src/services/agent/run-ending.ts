/**
 * Deterministic closing projection for runs that end in a stall-class stop
 * reason. No LLM call: the run already has the facts (step histogram, the
 * user's request), so the closing message projects them back into the
 * conversation instead of ending in a silent `stopped`.
 *
 * The repeat guard never stops a run (DSH semantics: it only reminds), so
 * the repeat stall reason is not a closing trigger. Lifecycle stops (goal
 * paused/cancelled, context recovery interrupted) keep their existing
 * semantics and get no synthesized text.
 */
import type { Database } from '../../db/types.js';
import { redactAgentText } from './redaction.js';

export const CLOSING_STOP_REASONS = new Set(['step_budget_exhausted', 'COPILOT_NO_PROGRESS']);

const REASON_LABELS: Record<string, string> = {
  step_budget_exhausted: '步数预算用尽',
  COPILOT_NO_PROGRESS: '重复观察相同结果',
};

const MAX_GOAL_CHARS = 200;

/**
 * Build the closing assistant text for a stalled run, or undefined when the
 * run needs none. The step histogram comes from the durable run steps; the
 * goal is the admitted user text (already redacted at admission).
 */
export function renderRunEnding(db: Database, userId: string, runId: string, stopReason: string | null): string | undefined {
  if (!stopReason || !CLOSING_STOP_REASONS.has(stopReason)) return undefined;
  const label = REASON_LABELS[stopReason] ?? stopReason;
  const steps = db.prepare('SELECT tool_name FROM copilot_run_steps WHERE user_id=? AND run_id=? AND kind=\'tool\'')
    .all(userId, runId) as Array<{ tool_name: string | null }>;
  const counts = new Map<string, number>();
  for (const step of steps) {
    const name = step.tool_name ?? 'unknown';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const histogram = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, n]) => `${name}×${n}`).join('、');
  const run = db.prepare('SELECT input_json FROM copilot_runs WHERE user_id=? AND id=?').get(userId, runId) as { input_json: string } | undefined;
  let goal = '';
  try {
    goal = String((JSON.parse(run?.input_json ?? '{}') as { userText?: unknown }).userText ?? '').slice(0, MAX_GOAL_CHARS);
  } catch { /* A malformed admitted input still ends with the histogram only. */ }
  const parts = [`本次运行以「${label}」结束，目标未完全达成。`];
  if (histogram) parts.push(`工具调用：${histogram}。`);
  if (goal) parts.push(`你的请求：${redactAgentText(goal)}。`);
  parts.push('如需继续，请基于以上结果直接给出下一步指示。');
  return parts.join('');
}
