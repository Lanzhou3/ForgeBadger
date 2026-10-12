CREATE TABLE `telegram_channel_accounts` (`id` text PRIMARY KEY NOT NULL, `user_id` text NOT NULL, `bot_token_encrypted` text NOT NULL, `bot_username` text, `enabled` integer DEFAULT false NOT NULL, `connection_state` text DEFAULT 'disabled' NOT NULL, `last_connected_at` integer, `last_error_code` text, `last_error_message` text, `config_revision` integer DEFAULT 1 NOT NULL, `created_at` integer, `updated_at` integer, FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_telegram_channel_accounts_user` ON `telegram_channel_accounts` (`user_id`);
--> statement-breakpoint
CREATE TABLE `integration_telegram_configs` (`id` text PRIMARY KEY NOT NULL, `user_id` text NOT NULL, `enabled` integer DEFAULT false NOT NULL, `emergency_disabled` integer DEFAULT false NOT NULL, `allowed_chat_ids` text DEFAULT '[]' NOT NULL, `created_at` integer, `updated_at` integer, FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_integration_telegram_configs_user` ON `integration_telegram_configs` (`user_id`);
