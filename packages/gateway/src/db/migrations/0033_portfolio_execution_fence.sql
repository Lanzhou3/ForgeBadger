-- Phase 4 stores the canonical packet and worker fence as durable records.
-- Raw worker capabilities are intentionally never persisted: only a SHA-256
-- digest may cross the durable boundary.
ALTER TABLE `portfolio_task_packets` ADD COLUMN `canonical_packet_json` text NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE `portfolio_task_packets` ADD COLUMN `manifest_version` text NOT NULL DEFAULT 'platform-tools/v1';
--> statement-breakpoint
ALTER TABLE `portfolio_task_packets` ADD COLUMN `manifest_digest` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `portfolio_session_assignments` ADD COLUMN `lease_generation` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
-- Every Task Packet is executable only with the declared, server-owned semantic skill.
CREATE TRIGGER `portfolio_task_packets_executable_manifest_insert`
BEFORE INSERT ON `portfolio_task_packets`
WHEN NEW.`skill_version` IS NOT 'portfolio-execution/v1'
  OR NEW.`manifest_version` = '' OR NEW.`manifest_digest` = ''
  OR json_extract(NEW.`canonical_packet_json`, '$.skill.version') IS NOT NEW.`skill_version`
  OR json_type(NEW.`canonical_packet_json`, '$.skill.toolIds') IS NOT 'array'
  OR json_array_length(NEW.`canonical_packet_json`, '$.skill.toolIds') IS NOT 1
  OR json_extract(NEW.`canonical_packet_json`, '$.skill.toolIds[0]') IS NOT 'portfolio.submit_canonical_task_packet'
  OR json_type(NEW.`canonical_packet_json`, '$.platformTools.tools') IS NOT 'array'
  OR json_array_length(NEW.`canonical_packet_json`, '$.platformTools.tools') IS NOT 1
  OR json_extract(NEW.`canonical_packet_json`, '$.platformTools.tools[0].id') IS NOT 'portfolio.submit_canonical_task_packet'
  OR json_extract(NEW.`canonical_packet_json`, '$.platformTools.tools[0].version') IS NOT 'v1'
  OR json_extract(NEW.`canonical_packet_json`, '$.platformTools.tools[0].actionClass') IS NOT 'packet_submit'
  OR json_extract(NEW.`canonical_packet_json`, '$.platformTools.manifestVersion') IS NOT NEW.`manifest_version`
  OR json_extract(NEW.`canonical_packet_json`, '$.platformTools.manifestDigest') IS NOT NEW.`manifest_digest`
BEGIN
  SELECT RAISE(ABORT, 'PORTFOLIO_EXECUTABLE_MANIFEST_REQUIRED');
END;
--> statement-breakpoint
CREATE TABLE `portfolio_worker_signals` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `project_id` text NOT NULL,
  `work_item_id` text NOT NULL,
  `attempt_id` text NOT NULL,
  `session_id` text NOT NULL,
  `assignment_id` text NOT NULL,
  `command_id` text NOT NULL,
  `adapter` text NOT NULL,
  `signal_type` text NOT NULL,
  `lease_generation` integer NOT NULL,
  `packet_digest` text NOT NULL,
  `capability_digest` text NOT NULL,
  `state` text NOT NULL DEFAULT 'expected',
  `expires_at` integer NOT NULL,
  -- One durable, non-secret launch claim prevents replay DTOs from relaunching a worker.
  `launch_issued_at` integer,
  `acknowledged_at` integer,
  `consumed_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`) REFERENCES `portfolio_projects`(`user_id`,`project_id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`) REFERENCES `portfolio_work_items`(`user_id`,`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`,`attempt_id`) REFERENCES `portfolio_task_attempts`(`user_id`,`project_id`,`work_item_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`session_id`) REFERENCES `sessions`(`user_id`,`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`,`attempt_id`,`assignment_id`) REFERENCES `portfolio_session_assignments`(`user_id`,`project_id`,`work_item_id`,`attempt_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`,`attempt_id`,`command_id`) REFERENCES `portfolio_commands`(`user_id`,`project_id`,`work_item_id`,`attempt_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_worker_signal_command_type` ON `portfolio_worker_signals` (`user_id`,`command_id`,`signal_type`);
--> statement-breakpoint
CREATE INDEX `idx_portfolio_worker_signal_binding` ON `portfolio_worker_signals` (`user_id`,`attempt_id`,`assignment_id`,`state`,`expires_at`);
--> statement-breakpoint
CREATE TRIGGER `portfolio_task_packets_immutable_update`
BEFORE UPDATE ON `portfolio_task_packets`
BEGIN
  SELECT RAISE(ABORT, 'PORTFOLIO_TASK_PACKET_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `portfolio_task_packets_immutable_delete`
BEFORE DELETE ON `portfolio_task_packets`
BEGIN
  SELECT RAISE(ABORT, 'PORTFOLIO_TASK_PACKET_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `portfolio_task_attempts_immutable_execution_identity`
BEFORE UPDATE ON `portfolio_task_attempts`
WHEN NEW.`user_id` IS NOT OLD.`user_id`
  OR NEW.`project_id` IS NOT OLD.`project_id`
  OR NEW.`work_item_id` IS NOT OLD.`work_item_id`
  OR NEW.`request_id` IS NOT OLD.`request_id`
  OR NEW.`packet_id` IS NOT OLD.`packet_id`
  OR NEW.`attempt_number` IS NOT OLD.`attempt_number`
  OR NEW.`source_work_item_version` IS NOT OLD.`source_work_item_version`
  OR NEW.`packet_version` IS NOT OLD.`packet_version`
  OR NEW.`packet_digest` IS NOT OLD.`packet_digest`
  OR NEW.`adapter` IS NOT OLD.`adapter`
  OR NEW.`created_by` IS NOT OLD.`created_by`
  OR NEW.`idempotency_key` IS NOT OLD.`idempotency_key`
  OR NEW.`input_digest` IS NOT OLD.`input_digest`
  OR NEW.`created_at` IS NOT OLD.`created_at`
BEGIN
  SELECT RAISE(ABORT, 'PORTFOLIO_TASK_ATTEMPT_IMMUTABLE');
END;
