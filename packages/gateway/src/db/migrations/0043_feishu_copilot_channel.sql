-- Feishu Copilot channel mapping.
--
-- One row per (user, Feishu chat) pointing at the chat's CURRENT Copilot
-- conversation. Feishu chats without an active Portfolio channel binding route
-- their messages into the Copilot harness; sending /new swaps the pointer to a
-- fresh conversation so each chat keeps its own isolated context while sharing
-- the same copilot_conversations table (and memory) as the web chat.

CREATE TABLE `feishu_copilot_channels` (
	`user_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY (`user_id`, `chat_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `copilot_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Widen the ingress ledger's handler_kind check so the Copilot channel can
-- share the same durable provider-retry dedup as the Portfolio channel.
CREATE TABLE `portfolio_feishu_ingress_events__copilot` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider_account_id` text NOT NULL,
	`provider_event_id` text NOT NULL,
	`transport` text NOT NULL CHECK (`transport` IN ('webhook', 'long_connection')),
	`handler_kind` text NOT NULL CHECK (`handler_kind` IN ('legacy', 'portfolio', 'copilot')),
	`event_digest` text NOT NULL,
	`state` text NOT NULL CHECK (`state` IN ('admitted', 'denied', 'processed')),
	`rejection_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`,`provider_account_id`) REFERENCES `portfolio_provider_accounts`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `portfolio_feishu_ingress_events__copilot`
SELECT `id`, `user_id`, `provider_account_id`, `provider_event_id`, `transport`, `handler_kind`, `event_digest`, `state`, `rejection_code`, `created_at`, `updated_at`
FROM `portfolio_feishu_ingress_events`;
--> statement-breakpoint
DROP TABLE `portfolio_feishu_ingress_events`;
--> statement-breakpoint
ALTER TABLE `portfolio_feishu_ingress_events__copilot` RENAME TO `portfolio_feishu_ingress_events`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_feishu_ingress_event`
ON `portfolio_feishu_ingress_events` (`provider_account_id`, `provider_event_id`);
