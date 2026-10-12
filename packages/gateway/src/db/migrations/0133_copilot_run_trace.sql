-- Durable per-run decision timeline for the Copilot ReAct loop. Every row is
-- an append-only, tenant-scoped projection of one control-flow decision
-- (admission, claim/recovery, tool gate, approval parking/decision, LLM call
-- metering, sub-run admission, follow-up promotion, terminal state). Per-run
-- seq is monotonic under UNIQUE(run_id, seq) so replay is idempotent; fence
-- carries the run-instance discriminator from copilot_runs. Metadata only:
-- message contents, tool input plaintext and secrets must never be stored here.
CREATE TABLE copilot_run_trace (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, run_id TEXT NOT NULL,
  seq INTEGER NOT NULL, fence INTEGER NOT NULL,
  step_id TEXT, event TEXT NOT NULL, detail_json TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(run_id, seq)
);
--> statement-breakpoint
CREATE INDEX idx_copilot_run_trace_run ON copilot_run_trace(user_id, run_id, created_at);
