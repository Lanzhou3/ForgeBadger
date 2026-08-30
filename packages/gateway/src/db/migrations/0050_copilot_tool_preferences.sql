CREATE TABLE `copilot_tool_preferences` (
	`user_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `tool_name`),
	CONSTRAINT `copilot_tool_preferences_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_copilot_tool_preferences_user` ON `copilot_tool_preferences` (`user_id`);
