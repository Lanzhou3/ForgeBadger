-- Align the token usage time-range index with the actual repository filters.
-- The unique (user_id, adapter, request_id) index still owns ingest idempotency;
-- no live query filters by adapter before occurred_at.
DROP INDEX IF EXISTS `idx_token_usage_user_adapter_occurred`;
--> statement-breakpoint
CREATE INDEX `idx_token_usage_user_occurred`
  ON `token_usage_records` (`user_id`, `occurred_at`);
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_project_manager_work_items_user_project`;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_project_manager_work_items_status`;
--> statement-breakpoint
CREATE INDEX `idx_project_manager_work_items_updated`
  ON `project_manager_work_items` (`user_id`, `project_id`, `updated_at` DESC, `title` ASC);
--> statement-breakpoint
CREATE INDEX `idx_project_manager_work_items_status_updated`
  ON `project_manager_work_items` (`user_id`, `project_id`, `status`, `updated_at` DESC, `title` ASC);
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_audit_logs_user`;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_audit_logs_resource`;
--> statement-breakpoint
CREATE INDEX `idx_audit_logs_user_created`
  ON `audit_logs` (`user_id`, `created_at`, `id`);
--> statement-breakpoint
CREATE INDEX `idx_audit_logs_user_resource_created`
  ON `audit_logs` (`user_id`, `resource_type`, `resource_id`, `created_at`, `id`);
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_auth_sessions_user`;
--> statement-breakpoint
CREATE INDEX `idx_auth_sessions_user_last_seen`
  ON `auth_sessions` (`user_id`, `last_seen_at`);
--> statement-breakpoint
CREATE INDEX `idx_auth_sessions_expires`
  ON `auth_sessions` (`expires_at`);
