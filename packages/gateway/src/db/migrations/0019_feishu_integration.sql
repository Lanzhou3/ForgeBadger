CREATE TABLE `integration_feishu_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`enabled` integer NOT NULL DEFAULT 0,
	`emergency_disabled` integer NOT NULL DEFAULT 0,
	`identity_mode` text NOT NULL DEFAULT 'unknown',
	`allowed_chat_ids` text NOT NULL DEFAULT '[]',
	`command_prefix` text NOT NULL DEFAULT '/openforge',
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_integration_feishu_configs_user` ON `integration_feishu_configs` (`user_id`);
--> statement-breakpoint
CREATE TABLE `integration_feishu_user_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`feishu_user_id` text NOT NULL,
	`openforge_user_id` text NOT NULL,
	`display_name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`openforge_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_integration_feishu_user_mappings_feishu_user` ON `integration_feishu_user_mappings` (`user_id`,`feishu_user_id`);
--> statement-breakpoint
CREATE INDEX `idx_integration_feishu_user_mappings_openforge_user` ON `integration_feishu_user_mappings` (`user_id`,`openforge_user_id`);
