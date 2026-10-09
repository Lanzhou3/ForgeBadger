import { randomUUID } from 'node:crypto';
import type { Database } from '../../db/types.js';

export const RUN_TRACE_EVENTS = [
  'admitted', 'claimed', 'step_started', 'step_completed', 'llm_call_completed',
  'tool_gate', 'approval_parked', 'approval_decided', 'subrun_admitted',
  'followup_promoted', 'run_finished', 'run_recovered',
] as const;
export type RunTraceEvent = (typeof RUN_TRACE_EVENTS)[number];

/** Whitelisted, scalar-only trace metadata. Never message content or tool input. */
export type RunTraceDetail = Record<string, string | number | boolean | null>;
const DETAIL_KEYS = new Set([
  'status', 'toolName', 'decision', 'reason', 'attempt', 'tokens', 'durationMs',
  'executionMode', 'phase', 'kind', 'childRunId', 'chargedTokens', 'reported',
  'source', 'parentRunId',
]);
function isScalar(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}
export function sanitizeTraceDetail(detail: RunTraceDetail): RunTraceDetail {
  const clean: RunTraceDetail = {};
  for (const [key, value] of Object.entries(detail))
    if (DETAIL_KEYS.has(key) && isScalar(value)) clean[key] = value;
  return clean;
}

/**
 * Append-only per-run decision projection. Synchronous single-statement insert
 * (plus one indexed MAX(seq) read) so it is safe inside existing transactions.
 * UNIQUE(run_id, seq) makes replay idempotent; fence carries the run instance.
 */
export function traceRunEvent(db: Database, userId: string, runId: string, fence: number,
  event: RunTraceEvent, detail?: RunTraceDetail, stepId?: string): void {
  // Fail-open: the trace projection is best-effort metadata. A missing table
  // (pre-migration DB) or a locked write must never break the run it observes.
  try {
    const seq = (db.prepare('SELECT COALESCE(MAX(seq),0)+1 AS seq FROM copilot_run_trace WHERE run_id=?').get(runId) as { seq: number }).seq;
    db.prepare('INSERT INTO copilot_run_trace(id,user_id,run_id,seq,fence,step_id,event,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(randomUUID(), userId, runId, seq, fence, stepId ?? null, event,
        detail ? JSON.stringify(sanitizeTraceDetail(detail)) : null, Date.now());
  } catch { /* Best-effort projection only. */ }
}

export interface RunTraceEntry { id: string; user_id: string; run_id: string; seq: number; fence: number; step_id: string | null; event: string; detail_json: string | null; created_at: number }

/** Tenant-scoped timeline reader ordered by creation time, then per-run sequence. */
export function listRunTrace(db: Database, userId: string, runId: string): RunTraceEntry[] {
  return db.prepare('SELECT * FROM copilot_run_trace WHERE user_id=? AND run_id=? ORDER BY created_at,seq')
    .all(userId, runId) as RunTraceEntry[];
}
