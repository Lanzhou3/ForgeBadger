-- Phase 7 introduces a Portfolio-owned Feishu contract only. It does not
-- start a connection, mount a webhook, or alter the legacy runtime.
CREATE TABLE `portfolio_provider_accounts` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `provider` text NOT NULL,
  `provider_account_id` text NOT NULL,
  `lifecycle_state` text NOT NULL DEFAULT 'verified' CHECK (`lifecycle_state` IN ('verified', 'disabled', 'retired')),
  `handler_kind` text NOT NULL DEFAULT 'portfolio' CHECK (`handler_kind` IN ('legacy', 'portfolio')),
  `audit_safe_metadata_json` text NOT NULL DEFAULT '{}',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_provider_account_global`
ON `portfolio_provider_accounts` (`provider`, `provider_account_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_provider_account_user_id`
ON `portfolio_provider_accounts` (`user_id`, `id`);
--> statement-breakpoint
CREATE INDEX `idx_portfolio_provider_account_handler`
ON `portfolio_provider_accounts` (`provider`, `handler_kind`, `lifecycle_state`);
--> statement-breakpoint
ALTER TABLE `portfolio_channel_bindings` ADD COLUMN `provider_account_id` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_channel_binding_active_identity`
ON `portfolio_channel_bindings` (`provider_account_id`, `external_identity`, `conversation_id`)
WHERE `status` = 'active';
--> statement-breakpoint
CREATE INDEX `idx_portfolio_channel_binding_account_lookup`
ON `portfolio_channel_bindings` (`user_id`, `provider_account_id`, `external_identity`, `conversation_id`, `status`);
--> statement-breakpoint
CREATE TRIGGER `portfolio_channel_binding_account_insert`
BEFORE INSERT ON `portfolio_channel_bindings`
WHEN NEW.`provider_account_id` IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM `portfolio_provider_accounts` a
    WHERE a.`id` = NEW.`provider_account_id`
      AND a.`user_id` = NEW.`user_id`
      AND a.`provider` = NEW.`provider`
      AND (NEW.`status` <> 'active' OR a.`lifecycle_state` = 'verified')
  )
BEGIN
  SELECT RAISE(ABORT, 'PORTFOLIO_FEISHU_BINDING_ACCOUNT_OWNER_MISMATCH');
END;
--> statement-breakpoint
CREATE TRIGGER `portfolio_channel_binding_account_update`
BEFORE UPDATE OF `provider_account_id`, `user_id`, `provider`, `status` ON `portfolio_channel_bindings`
WHEN NEW.`provider_account_id` IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM `portfolio_provider_accounts` a
    WHERE a.`id` = NEW.`provider_account_id`
      AND a.`user_id` = NEW.`user_id`
      AND a.`provider` = NEW.`provider`
      AND (NEW.`status` <> 'active' OR a.`lifecycle_state` = 'verified')
  )
BEGIN
  SELECT RAISE(ABORT, 'PORTFOLIO_FEISHU_BINDING_ACCOUNT_OWNER_MISMATCH');
END;
--> statement-breakpoint
CREATE TABLE `portfolio_channel_allowed_conversations` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `provider_account_id` text NOT NULL,
  `binding_id` text NOT NULL,
  `conversation_id` text NOT NULL,
  `status` text NOT NULL DEFAULT 'active' CHECK (`status` IN ('active', 'disabled')),
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`,`provider_account_id`) REFERENCES `portfolio_provider_accounts`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`binding_id`) REFERENCES `portfolio_channel_bindings`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_channel_allowed_active`
ON `portfolio_channel_allowed_conversations` (`provider_account_id`, `binding_id`, `conversation_id`)
WHERE `status` = 'active';
--> statement-breakpoint
CREATE TRIGGER `portfolio_channel_allowed_conversation_insert`
BEFORE INSERT ON `portfolio_channel_allowed_conversations`
WHEN NOT EXISTS (
  SELECT 1 FROM `portfolio_channel_bindings` b
  WHERE b.`id` = NEW.`binding_id`
    AND b.`user_id` = NEW.`user_id`
    AND b.`provider_account_id` = NEW.`provider_account_id`
    AND b.`conversation_id` = NEW.`conversation_id`
)
BEGIN
  SELECT RAISE(ABORT, 'PORTFOLIO_FEISHU_ALLOWED_CONVERSATION_SCOPE_MISMATCH');
END;
--> statement-breakpoint
CREATE TABLE `portfolio_feishu_ingress_events` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `provider_account_id` text NOT NULL,
  `provider_event_id` text NOT NULL,
  `transport` text NOT NULL CHECK (`transport` IN ('webhook', 'long_connection')),
  `handler_kind` text NOT NULL CHECK (`handler_kind` IN ('legacy', 'portfolio')),
  `event_digest` text NOT NULL,
  `state` text NOT NULL CHECK (`state` IN ('admitted', 'denied', 'processed')),
  `rejection_code` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`,`provider_account_id`) REFERENCES `portfolio_provider_accounts`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_feishu_ingress_event`
ON `portfolio_feishu_ingress_events` (`provider_account_id`, `provider_event_id`);
--> statement-breakpoint
ALTER TABLE `portfolio_channel_actions` ADD COLUMN `record_version` integer;
--> statement-breakpoint
ALTER TABLE `portfolio_channel_actions` ADD COLUMN `owner_user_id` text;
--> statement-breakpoint
ALTER TABLE `portfolio_channel_actions` ADD COLUMN `signature_digest` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_channel_action_signature`
ON `portfolio_channel_actions` (`signature_digest`) WHERE `signature_digest` IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_channel_action_idempotency`
ON `portfolio_channel_actions` (`user_id`, `binding_id`, `idempotency_key`);
--> statement-breakpoint
CREATE TRIGGER `portfolio_channel_action_insert_contract`
BEFORE INSERT ON `portfolio_channel_actions`
WHEN NEW.`record_type` NOT IN ('authorization', 'intake_decision', 'acceptance_decision')
  OR NEW.`record_version` IS NULL OR NEW.`owner_user_id` IS NULL OR NEW.`signature_digest` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'PORTFOLIO_FEISHU_ACTION_CONTRACT_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `portfolio_channel_action_immutable_binding`
BEFORE UPDATE OF `binding_id`, `record_type`, `record_id`, `action_type`, `payload_digest`, `record_version`, `owner_user_id`, `signature_digest`, `expires_at` ON `portfolio_channel_actions`
BEGIN
  SELECT RAISE(ABORT, 'PORTFOLIO_FEISHU_ACTION_IMMUTABLE');
END;
--> statement-breakpoint
ALTER TABLE `portfolio_delivery_records` ADD COLUMN `canonical_record_type` text;
--> statement-breakpoint
ALTER TABLE `portfolio_delivery_records` ADD COLUMN `canonical_record_id` text;
--> statement-breakpoint
ALTER TABLE `portfolio_delivery_records` ADD COLUMN `canonical_record_version` integer;
--> statement-breakpoint
ALTER TABLE `portfolio_delivery_records` ADD COLUMN `provider_result_digest` text;
--> statement-breakpoint
ALTER TABLE `portfolio_delivery_records` ADD COLUMN `provider_error_code` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_delivery_canonical_target`
ON `portfolio_delivery_records` (`user_id`, `binding_id`, `canonical_record_type`, `canonical_record_id`, `canonical_record_version`)
WHERE `canonical_record_type` IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER `portfolio_delivery_record_insert_contract`
BEFORE INSERT ON `portfolio_delivery_records`
WHEN NEW.`canonical_record_type` IS NULL OR NEW.`canonical_record_id` IS NULL
  OR NEW.`canonical_record_version` IS NULL OR NEW.`provider_result_json` IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'PORTFOLIO_FEISHU_DELIVERY_CONTRACT_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `portfolio_delivery_record_no_provider_body`
BEFORE UPDATE OF `provider_result_json` ON `portfolio_delivery_records`
WHEN NEW.`provider_result_json` IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'PORTFOLIO_FEISHU_PROVIDER_BODY_FORBIDDEN');
END;
--> statement-breakpoint
-- A card can only enqueue a canonical command after its decision commits. This
-- is a durable intent, not a terminal/CLI writer and has no provider payload.
CREATE TABLE `portfolio_feishu_command_intents` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `channel_action_id` text NOT NULL,
  `binding_id` text NOT NULL,
  `canonical_record_type` text NOT NULL,
  `canonical_record_id` text NOT NULL,
  `canonical_record_version` integer NOT NULL,
  `fact_id` text,
  `command_type` text NOT NULL,
  `state` text NOT NULL DEFAULT 'pending' CHECK (`state` IN ('pending', 'queued', 'cancelled')),
  `created_at` integer NOT NULL,
  FOREIGN KEY (`user_id`,`binding_id`) REFERENCES `portfolio_channel_bindings`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`channel_action_id`) REFERENCES `portfolio_channel_actions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_feishu_command_action`
ON `portfolio_feishu_command_intents` (`channel_action_id`);
