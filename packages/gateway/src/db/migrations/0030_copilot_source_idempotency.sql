ALTER TABLE `copilot_runs` ADD `source_idempotency_key` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_copilot_runs_source_idempotency`
ON `copilot_runs` (`user_id`,`source`,`source_idempotency_key`)
WHERE `source_idempotency_key` IS NOT NULL;
