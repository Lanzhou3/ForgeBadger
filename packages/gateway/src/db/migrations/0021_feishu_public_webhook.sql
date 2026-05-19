ALTER TABLE `integration_feishu_configs` ADD COLUMN `public_webhook_id` text;
--> statement-breakpoint
ALTER TABLE `integration_feishu_configs` ADD COLUMN `public_webhook_enabled` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `integration_feishu_configs` ADD COLUMN `verification_token_encrypted` text;
--> statement-breakpoint
ALTER TABLE `integration_feishu_configs` ADD COLUMN `event_encrypt_key_encrypted` text;
--> statement-breakpoint
ALTER TABLE `integration_feishu_configs` ADD COLUMN `webhook_configured_at` integer;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_integration_feishu_configs_public_webhook` ON `integration_feishu_configs` (`public_webhook_id`) WHERE `public_webhook_id` IS NOT NULL;
--> statement-breakpoint
CREATE TABLE `integration_feishu_webhook_replay_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`public_webhook_id` text NOT NULL,
	`replay_key` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_integration_feishu_webhook_replay_unique` ON `integration_feishu_webhook_replay_entries` (`user_id`,`public_webhook_id`,`replay_key`);
--> statement-breakpoint
CREATE INDEX `idx_integration_feishu_webhook_replay_expiry` ON `integration_feishu_webhook_replay_entries` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `integration_feishu_webhook_rate_windows` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`public_webhook_id` text NOT NULL,
	`scope` text NOT NULL,
	`scope_id` text NOT NULL,
	`window_started_at` integer NOT NULL,
	`count` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_integration_feishu_webhook_rate_unique` ON `integration_feishu_webhook_rate_windows` (`user_id`,`public_webhook_id`,`scope`,`scope_id`);
