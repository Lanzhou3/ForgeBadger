-- Forward repair for installations that applied an early 0057 before its
-- audit/auth index statements were finalized. Keep this migration idempotent
-- across both early-upgrade and fresh-install histories.
DROP INDEX IF EXISTS `idx_audit_logs_user`;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_audit_logs_resource`;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_audit_logs_user_created`;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_audit_logs_user_resource_created`;
--> statement-breakpoint
CREATE INDEX `idx_audit_logs_user_created`
  ON `audit_logs` (`user_id`, `created_at`, `id`);
--> statement-breakpoint
CREATE INDEX `idx_audit_logs_user_resource_created`
  ON `audit_logs` (`user_id`, `resource_type`, `resource_id`, `created_at`, `id`);
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_auth_sessions_user`;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_auth_sessions_user_last_seen`;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_auth_sessions_expires`;
--> statement-breakpoint
CREATE INDEX `idx_auth_sessions_user_last_seen`
  ON `auth_sessions` (`user_id`, `last_seen_at`);
--> statement-breakpoint
CREATE INDEX `idx_auth_sessions_expires`
  ON `auth_sessions` (`expires_at`);
