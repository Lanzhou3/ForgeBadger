-- Session status is consumed through tenant-scoped dashboard and API queries.
-- Replace the global status index with the narrower covering access path.
DROP INDEX IF EXISTS `idx_sessions_status`;
--> statement-breakpoint
CREATE INDEX `idx_sessions_user_status`
  ON `sessions` (`user_id`, `status`);
