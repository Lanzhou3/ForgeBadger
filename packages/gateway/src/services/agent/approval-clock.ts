import { createHash } from 'node:crypto';
import type { Database } from '../../db/types.js';
import { AgentError } from './types.js';

interface ApprovalClockRow {
  started_at: number | null;
  status: string;
  max_duration_ms: number;
  approval_wait_ms: number;
  approval_wait_started_at: number | null;
}

export interface RunDuration {
  remainingMs: number;
  approvalWaitMs: number;
}

/** Only a matching, still-pending action proves a current approval pause.
 * The migration can match stored evidence, but SQLite has no built-in SHA256;
 * validate its actual input here before granting any historical time credit. */
function currentWaitMs(db: Database, userId: string, runId: string, row: ApprovalClockRow, now: number): number {
  if (row.status !== 'awaiting_approval' || row.started_at === null || row.approval_wait_started_at === null) return 0;
  const actions = db.prepare(`SELECT a.created_at,a.input_json,a.input_digest FROM copilot_pending_actions a
    JOIN copilot_run_steps s ON s.user_id=a.user_id AND s.run_id=a.run_id AND s.id=a.step_id
    WHERE a.user_id=? AND a.run_id=? AND a.status='pending' AND s.status='awaiting_approval'
    AND s.kind='tool' AND a.tool=s.tool_name AND a.tool_call_id IS s.tool_call_id
    AND a.input_json=s.input_json AND a.input_digest=s.input_digest AND a.created_at>=?`)
    .all(userId, runId, row.started_at) as Array<{ created_at: number; input_json: string; input_digest: string }>;
  const starts = actions
    .filter(action => createHash('sha256').update(action.input_json).digest('hex') === action.input_digest)
    .map(action => Math.max(row.started_at!, row.approval_wait_started_at!, action.created_at));
  return starts.length ? Math.max(0, now - Math.min(...starts)) : 0;
}

/** Ordinary queued/running downtime retains the existing wall-clock semantics. */
export function runDuration(db: Database, userId: string, runId: string, now = Date.now()): RunDuration {
  const row = db.prepare('SELECT started_at,status,max_duration_ms,approval_wait_ms,approval_wait_started_at FROM copilot_runs WHERE user_id=? AND id=?')
    .get(userId, runId) as ApprovalClockRow | undefined;
  if (!row) throw new AgentError('COPILOT_NOT_FOUND', 'Run not found');
  const elapsedMs = row.started_at === null ? 0 : Math.max(0, now - row.started_at);
  const approvalWaitMs = Math.min(elapsedMs, Math.max(0, row.approval_wait_ms) + currentWaitMs(db, userId, runId, row, now));
  return { remainingMs: Math.max(0, row.max_duration_ms - (elapsedMs - approvalWaitMs)), approvalWaitMs };
}

/** Caller holds the ledger's existing immediate transaction/fence boundary. */
export function settleApprovalWait(db: Database, userId: string, runId: string, now = Date.now()): void {
  const { approvalWaitMs } = runDuration(db, userId, runId, now);
  db.prepare('UPDATE copilot_runs SET approval_wait_ms=?,approval_wait_started_at=NULL WHERE user_id=? AND id=?')
    .run(approvalWaitMs, userId, runId);
}
