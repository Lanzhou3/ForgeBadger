import { randomUUID } from 'node:crypto';
import type { Database } from '../../db/types.js';
import { AgentError } from './types.js';
import { parseGoalGrants } from './goal-grants.js';

/**
 * Copilot Goal mode persistence. Goal rows bind a conversation to a durable,
 * budget-capped objective; tasks are the model-maintained checklist; the
 * journal is the run-to-run handover log. All statements are parameterized and
 * tenant scoped by user_id, mirroring CopilotFollowups conventions.
 */

export const GOAL_STATUSES = ['active', 'paused', 'completed', 'blocked', 'cancelled'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];
export const GOAL_TASK_STATUSES = ['pending', 'in_progress', 'passes', 'failed'] as const;
export type GoalTaskStatus = (typeof GOAL_TASK_STATUSES)[number];

export interface GoalRow {
  id: string; user_id: string; conversation_id: string; project_id: string | null;
  title: string; spec: string; status: GoalStatus;
  token_budget: number; max_duration_ms: number; max_runs: number;
  blocked_reason: string | null; pending_question: string | null;
  grants_json: string;
  created_at: number; updated_at: number; completed_at: number | null;
}
export interface GoalTaskRow {
  id: string; user_id: string; goal_id: string; seq: number; description: string;
  status: GoalTaskStatus; evidence: string | null;
  verify_command: string | null; verified_at: number | null; verify_exit_code: number | null;
  dispatched_session_id: string | null;
  created_at: number; updated_at: number;
}
export interface GoalTaskInput { description: string; verifyCommand?: string | undefined }
export interface GoalUsage { chargedTokens: number; runCount: number; startedAt: number | null; elapsedMs: number; costUsd: number | null }
export interface GoalJournalRow { id: string; user_id: string; goal_id: string; run_id: string | null; note: string; created_at: number }
export interface GoalListRow extends GoalRow { task_total: number; task_passes: number }
export interface GoalBudgets { tokenBudget?: number | undefined; maxDurationMs?: number | undefined; maxRuns?: number | undefined }

/** Triple goal-level ceiling: charged tokens, wall-clock lifetime, run count. */
export function goalBudgetExhausted(goal: GoalRow, usage: GoalUsage, now = Date.now()): boolean {
  if (usage.chargedTokens >= goal.token_budget) return true;
  if (usage.startedAt !== null && now - usage.startedAt >= goal.max_duration_ms) return true;
  if (usage.runCount >= goal.max_runs) return true;
  return false;
}

/** blocked_reason recorded on goals stopped by any of the three ceilings. */
export const GOAL_BUDGET_EXHAUSTED_REASON = 'goal_budget_exhausted';

const TERMINAL_STATUSES: readonly GoalStatus[] = ['completed', 'blocked', 'cancelled'];
const MAX_TASKS_PER_CALL = 50;
const MAX_TASK_DESCRIPTION = 500;
const MAX_VERIFY_COMMAND = 1024;

/** Accepts the M1 plain-string form and the M2 {description, verifyCommand} form. */
export function normalizeTaskInputs(tasks: ReadonlyArray<string | GoalTaskInput>): GoalTaskInput[] {
  if (!tasks.length || tasks.length > MAX_TASKS_PER_CALL)
    throw new AgentError('COPILOT_GOAL_INPUT_INVALID', `Between 1 and ${MAX_TASKS_PER_CALL} task descriptions are required`);
  return tasks.map(task => {
    const value: GoalTaskInput = typeof task === 'string' ? { description: task } : task;
    if (!value.description.trim() || value.description.length > MAX_TASK_DESCRIPTION)
      throw new AgentError('COPILOT_GOAL_INPUT_INVALID', `Task descriptions must be 1-${MAX_TASK_DESCRIPTION} characters`);
    if (value.verifyCommand !== undefined && (typeof value.verifyCommand !== 'string' || !value.verifyCommand.trim() || value.verifyCommand.length > MAX_VERIFY_COMMAND))
      throw new AgentError('COPILOT_GOAL_INPUT_INVALID', `verifyCommand must be 1-${MAX_VERIFY_COMMAND} characters`);
    return value;
  });
}

export class CopilotGoalStore {
  constructor(private db: Database, private userId: string) {}

  createGoal(input: { conversationId: string; projectId?: string | null; title: string; spec: string; budgets?: GoalBudgets | undefined; grants?: readonly string[] | undefined }): GoalRow {
    const conversation = this.db.prepare("SELECT id FROM copilot_conversations WHERE user_id=? AND id=?").get(this.userId, input.conversationId);
    if (!conversation) throw new AgentError('COPILOT_NOT_FOUND', 'Conversation not found');
    if (input.projectId && !this.db.prepare('SELECT id FROM projects WHERE user_id=? AND id=?').get(this.userId, input.projectId))
      throw new AgentError('COPILOT_PROJECT_NOT_FOUND', 'Project not found');
    const grants = parseGoalGrants(JSON.stringify(input.grants ?? []));
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`INSERT INTO copilot_goals(id,user_id,conversation_id,project_id,title,spec,status,token_budget,max_duration_ms,max_runs,grants_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'active',?,?,?,?,?,?)`)
      .run(id, this.userId, input.conversationId, input.projectId ?? null, input.title, input.spec,
        input.budgets?.tokenBudget ?? 5_000_000, input.budgets?.maxDurationMs ?? 28_800_000, input.budgets?.maxRuns ?? 50,
        JSON.stringify(grants), now, now);
    return this.getGoal(id)!;
  }

  getGoal(id: string): GoalRow | undefined {
    return this.db.prepare('SELECT * FROM copilot_goals WHERE user_id=? AND id=?').get(this.userId, id) as GoalRow | undefined;
  }

  listGoals(conversationId?: string): GoalListRow[] {
    const rows = conversationId
      ? this.db.prepare(`SELECT g.*,
          (SELECT count(*) FROM copilot_goal_tasks t WHERE t.goal_id=g.id) AS task_total,
          (SELECT count(*) FROM copilot_goal_tasks t WHERE t.goal_id=g.id AND t.status='passes') AS task_passes
        FROM copilot_goals g WHERE g.user_id=? AND g.conversation_id=? ORDER BY g.created_at DESC, g.id`).all(this.userId, conversationId)
      : this.db.prepare(`SELECT g.*,
          (SELECT count(*) FROM copilot_goal_tasks t WHERE t.goal_id=g.id) AS task_total,
          (SELECT count(*) FROM copilot_goal_tasks t WHERE t.goal_id=g.id AND t.status='passes') AS task_passes
        FROM copilot_goals g WHERE g.user_id=? ORDER BY g.created_at DESC, g.id`).all(this.userId);
    return rows as GoalListRow[];
  }

  setStatus(id: string, status: GoalStatus, blockedReason?: string): GoalRow | undefined {
    if (!GOAL_STATUSES.includes(status)) throw new AgentError('COPILOT_GOAL_STATE', `Unknown goal status: ${status}`);
    const now = Date.now();
    this.db.prepare(`UPDATE copilot_goals SET status=?, blocked_reason=?, completed_at=CASE WHEN ? THEN ? ELSE completed_at END, updated_at=?
      WHERE user_id=? AND id=?`)
      .run(status, blockedReason ?? null, TERMINAL_STATUSES.includes(status) ? 1 : 0, now, now, this.userId, id);
    return this.getGoal(id);
  }

  addTasks(goalId: string, tasks: ReadonlyArray<string | GoalTaskInput>): GoalTaskRow[] {
    const inputs = normalizeTaskInputs(tasks);
    if (!this.getGoal(goalId)) throw new AgentError('COPILOT_NOT_FOUND', 'Goal not found');
    return this.db.transaction(() => {
      const start = (this.db.prepare('SELECT COALESCE(MAX(seq),0) AS max_seq FROM copilot_goal_tasks WHERE goal_id=?').get(goalId) as { max_seq: number }).max_seq;
      const created: GoalTaskRow[] = [];
      const now = Date.now();
      inputs.forEach((task, index) => {
        const id = randomUUID();
        this.db.prepare(`INSERT INTO copilot_goal_tasks(id,user_id,goal_id,seq,description,status,verify_command,created_at,updated_at) VALUES(?,?,?,?,?,'pending',?,?,?)`)
          .run(id, this.userId, goalId, start + index + 1, task.description, task.verifyCommand ?? null, now, now);
        created.push(this.db.prepare('SELECT * FROM copilot_goal_tasks WHERE user_id=? AND id=?').get(this.userId, id) as GoalTaskRow);
      });
      return created;
    }).immediate();
  }

  updateTask(goalId: string, taskId: string, status: GoalTaskStatus, evidence?: string): GoalTaskRow | undefined {
    if (!GOAL_TASK_STATUSES.includes(status)) throw new AgentError('COPILOT_GOAL_INPUT_INVALID', `Unknown task status: ${status}`);
    const existing = this.db.prepare('SELECT * FROM copilot_goal_tasks WHERE user_id=? AND id=? AND goal_id=?').get(this.userId, taskId, goalId) as GoalTaskRow | undefined;
    if (!existing) throw new AgentError('COPILOT_NOT_FOUND', 'Task not found');
    if (status === 'passes') {
      if (existing.verify_command) {
        // Machine-gated tasks require a recorded exit-code-0 verify run; the
        // check output summary stored as evidence is the machine evidence.
        if (existing.verified_at === null || existing.verify_exit_code !== 0)
          throw new AgentError('COPILOT_GOAL_VERIFY_REQUIRED', `Task '${existing.description}' requires its verify_command to exit 0 (goal_run_checks with taskId) before it can pass`);
      } else if (!evidence?.trim() && !existing.evidence?.trim()) {
        throw new AgentError('COPILOT_GOAL_EVIDENCE_REQUIRED', 'A passes task must carry evidence');
      }
    }
    const mergedEvidence = evidence?.trim() && existing.evidence?.trim() && existing.evidence !== evidence
      ? `${existing.evidence}\n${evidence}`
      : (evidence ?? null);
    this.db.prepare(`UPDATE copilot_goal_tasks SET status=?, evidence=COALESCE(?,evidence), updated_at=?
      WHERE user_id=? AND id=? AND goal_id=?`)
      .run(status, mergedEvidence, Date.now(), this.userId, taskId, goalId);
    return this.db.prepare('SELECT * FROM copilot_goal_tasks WHERE user_id=? AND id=?').get(this.userId, taskId) as GoalTaskRow;
  }

  /** Records a successful machine verification (called by goal_run_checks on exit 0). */
  markTaskVerified(goalId: string, taskId: string, exitCode: number, evidenceSummary: string): GoalTaskRow {
    const existing = this.db.prepare('SELECT evidence FROM copilot_goal_tasks WHERE user_id=? AND id=? AND goal_id=?')
      .get(this.userId, taskId, goalId) as { evidence: string | null } | undefined;
    if (!existing) throw new AgentError('COPILOT_NOT_FOUND', 'Task not found');
    const evidence = existing.evidence?.trim() ? `${existing.evidence}\n${evidenceSummary}` : evidenceSummary;
    this.db.prepare(`UPDATE copilot_goal_tasks SET verified_at=?, verify_exit_code=?, evidence=?, updated_at=?
      WHERE user_id=? AND id=? AND goal_id=?`)
      .run(Date.now(), exitCode, evidence, Date.now(), this.userId, taskId, goalId);
    return this.db.prepare('SELECT * FROM copilot_goal_tasks WHERE user_id=? AND id=?').get(this.userId, taskId) as GoalTaskRow;
  }

  /** Owner answer to an awaiting_user goal: journal + clear question + resume, atomically. */
  applyAnswer(id: string, answer: string, runId: string | null): GoalRow {
    return this.db.transaction(() => {
      const goal = this.getGoal(id);
      if (!goal) throw new AgentError('COPILOT_NOT_FOUND', 'Goal not found');
      this.appendJournal(id, runId, `Owner answer: ${answer}`);
      this.setPendingQuestion(id, null);
      return this.setStatus(id, 'active')!;
    }).immediate();
  }

  setPendingQuestion(id: string, question: string | null): void {
    this.db.prepare('UPDATE copilot_goals SET pending_question=?, updated_at=? WHERE user_id=? AND id=?')
      .run(question, Date.now(), this.userId, id);
  }

  /** Links a task to the CLI session that received its instructions (goal_dispatch_task). */
  setTaskDispatched(goalId: string, taskId: string, sessionId: string): GoalTaskRow {
    const changed = this.db.prepare('UPDATE copilot_goal_tasks SET dispatched_session_id=?, updated_at=? WHERE user_id=? AND id=? AND goal_id=?')
      .run(sessionId, Date.now(), this.userId, taskId, goalId).changes;
    if (!changed) throw new AgentError('COPILOT_NOT_FOUND', 'Task not found');
    return this.db.prepare('SELECT * FROM copilot_goal_tasks WHERE user_id=? AND id=?').get(this.userId, taskId) as GoalTaskRow;
  }

  listTasks(goalId: string): GoalTaskRow[] {
    return this.db.prepare('SELECT * FROM copilot_goal_tasks WHERE user_id=? AND goal_id=? ORDER BY seq').all(this.userId, goalId) as GoalTaskRow[];
  }

  appendJournal(goalId: string, runId: string | null, note: string): GoalJournalRow {
    if (!this.getGoal(goalId)) throw new AgentError('COPILOT_NOT_FOUND', 'Goal not found');
    const id = randomUUID();
    this.db.prepare('INSERT INTO copilot_goal_journal(id,user_id,goal_id,run_id,note,created_at) VALUES(?,?,?,?,?,?)')
      .run(id, this.userId, goalId, runId, note, Date.now());
    return this.db.prepare('SELECT * FROM copilot_goal_journal WHERE user_id=? AND id=?').get(this.userId, id) as GoalJournalRow;
  }

  recentJournal(goalId: string, limit = 5): GoalJournalRow[] {
    return this.db.prepare('SELECT * FROM copilot_goal_journal WHERE user_id=? AND goal_id=? ORDER BY created_at DESC, rowid DESC LIMIT ?')
      .all(this.userId, goalId, Math.max(1, Math.min(100, limit))) as GoalJournalRow[];
  }

  /** Aggregated across every run of the goal; missing usage never counts as zero progress. */
  usage(goalId: string, now = Date.now()): GoalUsage {
    const row = this.db.prepare(`SELECT COUNT(DISTINCT r.id) AS run_count, MIN(COALESCE(r.started_at, r.created_at)) AS started_at,
        COALESCE((SELECT SUM(c.charged_tokens) FROM copilot_model_calls c
          JOIN copilot_runs r2 ON r2.id=c.run_id AND r2.user_id=c.user_id
          WHERE c.user_id=? AND r2.goal_id=?), 0) AS charged_tokens,
        (SELECT COUNT(*) FROM copilot_model_calls c
          JOIN copilot_runs r3 ON r3.id=c.run_id AND r3.user_id=c.user_id
          WHERE c.user_id=? AND r3.goal_id=? AND c.cost_nanousd IS NULL) AS unpriced_calls,
        COALESCE((SELECT SUM(c.cost_nanousd) FROM copilot_model_calls c
          JOIN copilot_runs r4 ON r4.id=c.run_id AND r4.user_id=c.user_id
          WHERE c.user_id=? AND r4.goal_id=? AND c.cost_nanousd IS NOT NULL), 0) AS cost_nanousd
      FROM copilot_runs r WHERE r.user_id=? AND r.goal_id=?`)
      .get(this.userId, goalId, this.userId, goalId, this.userId, goalId, this.userId, goalId) as {
        run_count: number; started_at: number | null; charged_tokens: number; unpriced_calls: number; cost_nanousd: number;
      };
    return {
      chargedTokens: row.charged_tokens, runCount: row.run_count, startedAt: row.started_at,
      elapsedMs: row.started_at === null ? 0 : Math.max(0, now - row.started_at),
      costUsd: row.unpriced_calls > 0 ? null : row.cost_nanousd / 1_000_000_000
    };
  }

  /** Runs in any settled state since the last task-status change; the GoalDriver's stagnation signal. Sub-runs (delegates/research children) never count. */
  countRunsWithoutTaskChange(goalId: string): number {
    const lastChange = (this.db.prepare('SELECT MAX(updated_at) AS ts FROM copilot_goal_tasks WHERE user_id=? AND goal_id=?').get(this.userId, goalId) as { ts: number | null }).ts;
    return (this.db.prepare(`SELECT count(*) AS count FROM copilot_runs WHERE user_id=? AND goal_id=? AND status IN ('completed','stopped','failed') AND created_at > ?
        AND json_extract(CASE WHEN json_valid(input_json) THEN input_json ELSE '{}' END,'$.parentRunId') IS NULL
        AND json_extract(CASE WHEN json_valid(input_json) THEN input_json ELSE '{}' END,'$.executionMode') IS NULL`)
      .get(this.userId, goalId, lastChange ?? 0) as { count: number }).count;
  }

  /** Any active run bound to the goal (parent conversation or a delegate child's). */
  hasActiveGoalRun(goalId: string): boolean {
    return !!this.db.prepare(`SELECT 1 FROM copilot_runs WHERE user_id=? AND goal_id=? AND status IN ('pending','running','awaiting_approval') LIMIT 1`)
      .get(this.userId, goalId);
  }

  /** Most recent settled run of the goal (failure classification for the driver). */
  latestSettledRun(goalId: string): { id: string; status: string; stop_reason: string | null } | undefined {
    return this.db.prepare(`SELECT id,status,stop_reason FROM copilot_runs WHERE user_id=? AND goal_id=?
        AND status IN ('completed','stopped','failed','cancelled') ORDER BY created_at DESC, rowid DESC LIMIT 1`)
      .get(this.userId, goalId) as { id: string; status: string; stop_reason: string | null } | undefined;
  }

  hasActiveRun(conversationId: string): boolean {
    return !!this.db.prepare(`SELECT 1 FROM copilot_runs WHERE user_id=? AND conversation_id=? AND status IN ('pending','running','awaiting_approval') LIMIT 1`)
      .get(this.userId, conversationId);
  }
}
