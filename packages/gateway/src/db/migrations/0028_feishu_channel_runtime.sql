CREATE TABLE `feishu_channel_accounts` (`id` text PRIMARY KEY NOT NULL, `user_id` text NOT NULL, `app_id` text NOT NULL, `app_secret_encrypted` text NOT NULL, `enabled` integer DEFAULT false NOT NULL, `connection_state` text DEFAULT 'disabled' NOT NULL, `last_connected_at` integer, `last_error_code` text, `last_error_message` text, `config_revision` integer DEFAULT 1 NOT NULL, `created_at` integer, `updated_at` integer, FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_feishu_channel_accounts_user` ON `feishu_channel_accounts` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_feishu_channel_accounts_app` ON `feishu_channel_accounts` (`user_id`,`app_id`);
--> statement-breakpoint
INSERT INTO `feishu_channel_accounts` (
  `id`, `user_id`, `app_id`, `app_secret_encrypted`, `enabled`, `connection_state`,
  `config_revision`, `created_at`, `updated_at`
)
SELECT
  lower(hex(randomblob(16))), `user_id`, `app_id`, `app_secret_encrypted`, `enabled`,
  CASE WHEN `enabled` = 1 THEN 'pending' ELSE 'disabled' END,
  1, CAST(strftime('%s','now') AS integer) * 1000, CAST(strftime('%s','now') AS integer) * 1000
FROM `integration_feishu_configs`
WHERE `app_id` IS NOT NULL AND `app_secret_encrypted` IS NOT NULL;
--> statement-breakpoint
CREATE TABLE `feishu_channel_inbox` (`id` text PRIMARY KEY NOT NULL, `user_id` text NOT NULL, `account_id` text NOT NULL, `event_id` text NOT NULL, `message_id` text, `event_type` text NOT NULL, `lane_key` text NOT NULL, `chat_id` text NOT NULL, `thread_id` text, `sender_open_id` text, `content_encrypted` text NOT NULL, `status` text DEFAULT 'pending' NOT NULL, `not_before` integer NOT NULL, `claim_token` text, `claim_expires_at` integer, `attempt_count` integer DEFAULT 0 NOT NULL, `last_error_code` text, `retention_until` integer NOT NULL, `conversation_id` text, `created_at` integer, `updated_at` integer, `completed_at` integer, FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade, FOREIGN KEY (`account_id`) REFERENCES `feishu_channel_accounts`(`id`) ON UPDATE no action ON DELETE cascade);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_feishu_channel_inbox_event` ON `feishu_channel_inbox` (`user_id`,`account_id`,`event_id`);
--> statement-breakpoint
CREATE INDEX `idx_feishu_channel_inbox_due` ON `feishu_channel_inbox` (`user_id`,`status`,`not_before`);
--> statement-breakpoint
CREATE INDEX `idx_feishu_channel_inbox_lane` ON `feishu_channel_inbox` (`user_id`,`account_id`,`lane_key`,`created_at`);
--> statement-breakpoint
CREATE TABLE `feishu_channel_logical_claims` (`id` text PRIMARY KEY NOT NULL, `user_id` text NOT NULL, `account_id` text NOT NULL, `message_id` text NOT NULL, `inbox_id` text NOT NULL, `adopted_at` integer NOT NULL, FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade, FOREIGN KEY (`account_id`) REFERENCES `feishu_channel_accounts`(`id`) ON UPDATE no action ON DELETE cascade, FOREIGN KEY (`inbox_id`) REFERENCES `feishu_channel_inbox`(`id`) ON UPDATE no action ON DELETE cascade);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_feishu_channel_logical_message` ON `feishu_channel_logical_claims` (`user_id`,`account_id`,`message_id`);
--> statement-breakpoint
CREATE TABLE `feishu_conversation_bindings` (`id` text PRIMARY KEY NOT NULL, `user_id` text NOT NULL, `account_id` text NOT NULL, `chat_id` text NOT NULL, `thread_key` text DEFAULT 'root' NOT NULL, `conversation_id` text NOT NULL, `scope_type` text DEFAULT 'unbound' NOT NULL, `scope_id` text, `created_at` integer, `updated_at` integer, FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade, FOREIGN KEY (`account_id`) REFERENCES `feishu_channel_accounts`(`id`) ON UPDATE no action ON DELETE cascade);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_feishu_conversation_binding` ON `feishu_conversation_bindings` (`user_id`,`account_id`,`chat_id`,`thread_key`);
--> statement-breakpoint
CREATE TABLE `feishu_channel_outbox` (`id` text PRIMARY KEY NOT NULL, `user_id` text NOT NULL, `account_id` text NOT NULL, `idempotency_key` text NOT NULL, `chat_id` text NOT NULL, `thread_id` text, `payload_encrypted` text NOT NULL, `status` text DEFAULT 'pending' NOT NULL, `next_part_index` integer DEFAULT 0 NOT NULL, `provider_message_ids` text DEFAULT '[]' NOT NULL, `not_before` integer NOT NULL, `claim_token` text, `claim_expires_at` integer, `attempt_count` integer DEFAULT 0 NOT NULL, `last_error_code` text, `created_at` integer, `updated_at` integer, `completed_at` integer, FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade, FOREIGN KEY (`account_id`) REFERENCES `feishu_channel_accounts`(`id`) ON UPDATE no action ON DELETE cascade);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_feishu_channel_outbox_key` ON `feishu_channel_outbox` (`user_id`,`account_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `idx_feishu_channel_outbox_due` ON `feishu_channel_outbox` (`user_id`,`status`,`not_before`);
--> statement-breakpoint
CREATE TABLE `feishu_card_actions` (`id` text PRIMARY KEY NOT NULL, `user_id` text NOT NULL, `account_id` text NOT NULL, `chat_id` text NOT NULL, `thread_id` text, `operator_open_id` text NOT NULL, `action_type` text NOT NULL, `resource_id` text NOT NULL, `payload_digest` text NOT NULL, `resource_revision` integer NOT NULL, `permission_snapshot` text NOT NULL, `nonce` text NOT NULL, `status` text DEFAULT 'pending' NOT NULL, `expires_at` integer NOT NULL, `claimed_at` integer, `created_at` integer, `updated_at` integer, FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade, FOREIGN KEY (`account_id`) REFERENCES `feishu_channel_accounts`(`id`) ON UPDATE no action ON DELETE cascade);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_feishu_card_nonce` ON `feishu_card_actions` (`user_id`,`nonce`);
--> statement-breakpoint
CREATE INDEX `idx_feishu_card_expiry` ON `feishu_card_actions` (`user_id`,`status`,`expires_at`);
