-- Some local databases recorded 0043 before its ingress-ledger rebuild was
-- added. Repair those already-migrated databases with a forward-only rebuild;
-- fresh databases also pass through this migration and keep the same contract.
CREATE TABLE `portfolio_feishu_ingress_events__handler_v2` (
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
INSERT INTO `portfolio_feishu_ingress_events__handler_v2` (
	`id`, `user_id`, `provider_account_id`, `provider_event_id`, `transport`,
	`handler_kind`, `event_digest`, `state`, `rejection_code`, `created_at`, `updated_at`
)
SELECT
	`id`, `user_id`, `provider_account_id`, `provider_event_id`, `transport`,
	`handler_kind`, `event_digest`, `state`, `rejection_code`, `created_at`, `updated_at`
FROM `portfolio_feishu_ingress_events`;
--> statement-breakpoint
DROP TABLE `portfolio_feishu_ingress_events`;
--> statement-breakpoint
ALTER TABLE `portfolio_feishu_ingress_events__handler_v2`
RENAME TO `portfolio_feishu_ingress_events`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_feishu_ingress_event`
ON `portfolio_feishu_ingress_events` (`provider_account_id`, `provider_event_id`);
