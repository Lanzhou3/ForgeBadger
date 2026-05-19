UPDATE copilot_runs
SET status = 'failed',
  error_code = 'copilot_duplicate_live_run_recovered',
  error_message = 'Recovered duplicate live Copilot run before enforcing single live run per user',
  completed_at = coalesce(completed_at, updated_at, created_at, unixepoch() * 1000),
  updated_at = unixepoch() * 1000
WHERE status IN ('queued', 'running', 'waiting_for_approval')
  AND EXISTS (
    SELECT 1
    FROM copilot_runs AS newer
    WHERE newer.user_id = copilot_runs.user_id
      AND newer.status IN ('queued', 'running', 'waiting_for_approval')
      AND (
        coalesce(newer.created_at, 0) > coalesce(copilot_runs.created_at, 0)
        OR (
          coalesce(newer.created_at, 0) = coalesce(copilot_runs.created_at, 0)
          AND newer.id > copilot_runs.id
        )
      )
  );
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_copilot_runs_user_live`
ON `copilot_runs` (`user_id`)
WHERE `status` IN ('queued', 'running', 'waiting_for_approval');
