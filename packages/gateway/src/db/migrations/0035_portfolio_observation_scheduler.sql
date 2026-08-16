-- Phase 5 adds only bounded, read-only observation scheduling. Existing
-- Workflow Wakeup claim_token columns remain legacy storage and are never
-- scheduler authority after this migration.
ALTER TABLE `portfolio_task_attempts` ADD COLUMN `tracking_enabled` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `portfolio_observation_profiles` ADD COLUMN `approved_root_path` text;
--> statement-breakpoint
ALTER TABLE `portfolio_observation_profiles` ADD COLUMN `approved_root_device` integer;
--> statement-breakpoint
ALTER TABLE `portfolio_observation_profiles` ADD COLUMN `approved_root_inode` integer;
--> statement-breakpoint
CREATE TRIGGER `portfolio_observation_profile_identity_insert`
BEFORE INSERT ON `portfolio_observation_profiles`
WHEN NEW.`status` = 'active' AND (NEW.`approved_root_path` IS NULL OR NEW.`approved_root_device` IS NULL OR NEW.`approved_root_inode` IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'PORTFOLIO_OBSERVATION_ROOT_IDENTITY_REQUIRED');
END;
--> statement-breakpoint
CREATE TRIGGER `portfolio_observation_profile_identity_update`
BEFORE UPDATE OF `status`, `approved_root_path`, `approved_root_device`, `approved_root_inode` ON `portfolio_observation_profiles`
WHEN NEW.`status` = 'active' AND (NEW.`approved_root_path` IS NULL OR NEW.`approved_root_device` IS NULL OR NEW.`approved_root_inode` IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'PORTFOLIO_OBSERVATION_ROOT_IDENTITY_REQUIRED');
END;
--> statement-breakpoint
CREATE TRIGGER `portfolio_task_attempts_tracking_immutable_update`
BEFORE UPDATE OF `tracking_enabled` ON `portfolio_task_attempts`
WHEN NEW.`tracking_enabled` IS NOT OLD.`tracking_enabled`
BEGIN
  SELECT RAISE(ABORT, 'PORTFOLIO_ATTEMPT_TRACKING_IMMUTABLE');
END;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_wakeups_user_id` ON `portfolio_workflow_wakeups` (`user_id`,`id`);
--> statement-breakpoint
CREATE TRIGGER `portfolio_observation_probe_v1_insert`
BEFORE INSERT ON `portfolio_observation_probes`
WHEN NEW.`source_category` NOT IN ('platform_lifecycle_v1', 'git_state_v1')
  OR NEW.`operation` <> NEW.`source_category`
  OR NEW.`root_ref` <> 'project_root'
  OR json_valid(NEW.`arguments_json`) = 0
  OR json(NEW.`arguments_json`) <> '{}'
  OR NEW.`timeout_ms` <> 5000
  OR NEW.`max_output_bytes` <> 16384
  OR NEW.`freshness_ms` <> CASE NEW.`source_category`
    WHEN 'platform_lifecycle_v1' THEN 300000
    WHEN 'git_state_v1' THEN 900000
  END
BEGIN
  SELECT RAISE(ABORT, 'PORTFOLIO_OBSERVATION_CONTRACT_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `portfolio_observation_probe_v1_update`
BEFORE UPDATE OF `source_category`, `operation`, `root_ref`, `arguments_json`, `timeout_ms`, `max_output_bytes`, `freshness_ms`
ON `portfolio_observation_probes`
WHEN NEW.`source_category` NOT IN ('platform_lifecycle_v1', 'git_state_v1')
  OR NEW.`operation` <> NEW.`source_category`
  OR NEW.`root_ref` <> 'project_root'
  OR json_valid(NEW.`arguments_json`) = 0
  OR json(NEW.`arguments_json`) <> '{}'
  OR NEW.`timeout_ms` <> 5000
  OR NEW.`max_output_bytes` <> 16384
  OR NEW.`freshness_ms` <> CASE NEW.`source_category`
    WHEN 'platform_lifecycle_v1' THEN 300000
    WHEN 'git_state_v1' THEN 900000
  END
BEGIN
  SELECT RAISE(ABORT, 'PORTFOLIO_OBSERVATION_CONTRACT_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `portfolio_observation_evidence_bound_insert`
BEFORE INSERT ON `portfolio_evidence`
WHEN NEW.`source_category` IN ('platform_lifecycle_v1', 'git_state_v1')
  AND (length(NEW.`redacted_summary`) > 1024
    OR NEW.`freshness` NOT IN ('fresh', 'stale', 'unknown', 'timeout', 'failed'))
BEGIN
  SELECT RAISE(ABORT, 'PORTFOLIO_OBSERVATION_EVIDENCE_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `portfolio_observation_evidence_bound_update`
BEFORE UPDATE OF `source_category`, `redacted_summary`, `freshness` ON `portfolio_evidence`
WHEN NEW.`source_category` IN ('platform_lifecycle_v1', 'git_state_v1')
  AND (length(NEW.`redacted_summary`) > 1024
    OR NEW.`freshness` NOT IN ('fresh', 'stale', 'unknown', 'timeout', 'failed'))
BEGIN
  SELECT RAISE(ABORT, 'PORTFOLIO_OBSERVATION_EVIDENCE_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `portfolio_heartbeat_cadence_insert`
BEFORE INSERT ON `portfolio_heartbeat_settings`
WHEN NEW.`enabled` NOT IN (0, 1)
  OR (NEW.`cadence_minutes` IS NOT NULL AND (NEW.`cadence_minutes` < 5 OR NEW.`cadence_minutes` > 1440))
  OR (NEW.`enabled` = 1 AND NEW.`cadence_minutes` IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'PORTFOLIO_HEARTBEAT_CADENCE_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `portfolio_heartbeat_cadence_update`
BEFORE UPDATE OF `enabled`, `cadence_minutes` ON `portfolio_heartbeat_settings`
WHEN NEW.`enabled` NOT IN (0, 1)
  OR (NEW.`cadence_minutes` IS NOT NULL AND (NEW.`cadence_minutes` < 5 OR NEW.`cadence_minutes` > 1440))
  OR (NEW.`enabled` = 1 AND NEW.`cadence_minutes` IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'PORTFOLIO_HEARTBEAT_CADENCE_INVALID');
END;
--> statement-breakpoint
CREATE INDEX `idx_portfolio_heartbeat_due` ON `portfolio_heartbeat_settings` (`enabled`,`last_reconciled_at`);
--> statement-breakpoint
CREATE TABLE `portfolio_reconciliation_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `source` text NOT NULL CHECK (`source` IN ('wakeup', 'heartbeat')),
  `source_record_id` text NOT NULL,
  `idempotency_slot` text NOT NULL,
  `state` text NOT NULL CHECK (`state` IN ('scheduled', 'claimed', 'completed', 'retry_scheduled', 'exhausted', 'cancelled', 'unknown')),
  `projection_version` integer NOT NULL DEFAULT 1,
  `claim_token_digest` text,
  `claim_lease_expires_at` integer,
  `attempt_count` integer NOT NULL DEFAULT 0,
  `retry_budget` integer NOT NULL,
  `result_digest` text,
  `error_code` text,
  `error_digest` text,
  `wakeup_id` text,
  `heartbeat_user_id` text,
  `scheduled_at` integer NOT NULL,
  `claimed_at` integer,
  `completed_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  CHECK (
    (`source` = 'wakeup' AND `wakeup_id` IS NOT NULL AND `source_record_id` = `wakeup_id` AND `heartbeat_user_id` IS NULL)
    OR (`source` = 'heartbeat' AND `heartbeat_user_id` = `user_id` AND `source_record_id` = `heartbeat_user_id` AND `wakeup_id` IS NULL)
  ),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`wakeup_id`) REFERENCES `portfolio_workflow_wakeups`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`heartbeat_user_id`) REFERENCES `portfolio_heartbeat_settings`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_reconciliation_source_slot`
ON `portfolio_reconciliation_runs` (`user_id`,`source`,`source_record_id`,`idempotency_slot`);
--> statement-breakpoint
CREATE INDEX `idx_portfolio_reconciliation_user_state_lease`
ON `portfolio_reconciliation_runs` (`user_id`,`state`,`claim_lease_expires_at`);
