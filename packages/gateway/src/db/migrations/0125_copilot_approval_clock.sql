ALTER TABLE copilot_runs ADD COLUMN approval_wait_ms integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE copilot_runs ADD COLUMN approval_wait_started_at integer;
--> statement-breakpoint
-- Backfill only a candidate backed by matching pending/awaiting evidence.
-- Runtime additionally verifies SHA256(input_json) before granting time credit.
-- Preserve all prior state, fences, started_at values, and completed waits.
UPDATE copilot_runs AS r SET approval_wait_started_at = (
  SELECT MIN(a.created_at) FROM copilot_pending_actions a
  JOIN copilot_run_steps s ON s.user_id=a.user_id AND s.run_id=a.run_id AND s.id=a.step_id
  WHERE a.user_id=r.user_id AND a.run_id=r.id AND a.status='pending'
    AND s.status='awaiting_approval' AND s.kind='tool' AND a.tool=s.tool_name
    AND a.tool_call_id IS s.tool_call_id AND a.input_json=s.input_json
    AND a.input_digest=s.input_digest AND a.created_at>=r.started_at
) WHERE r.runtime_version=1 AND r.status='awaiting_approval' AND r.started_at IS NOT NULL;
