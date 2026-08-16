-- Unify the two model systems onto model_profiles as the single source of
-- truth, and normalize every FK target column to `model_id`.
--
-- Background: model_provider_profiles / model_profiles / provider_credentials
-- are the source-of-truth provider system. The legacy flat `models` table was
-- kept in sync as a mirror (0012 backfilled model_profiles using models.id, so
-- mirrored rows share ids). This migration retires `models`: the FKs from
-- sessions.model_id, model_cost_rates.model_id, and user_settings
-- (renamed default_model_id -> model_id) are repointed to model_profiles(id),
-- and any legacy-only `models` rows are defensively backfilled into
-- model_profiles first so no FK target orphans.
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
-- Defensive backfill 1: materialize a provider profile for every `models` row
-- that still lacks a model_profiles entry, using the same deterministic id
-- scheme 0012 used so existing profiles are matched, not duplicated.
INSERT OR IGNORE INTO `model_provider_profiles` (
	`id`,
	`user_id`,
	`provider_key`,
	`name`,
	`base_url`,
	`auth_type`,
	`api_format`,
	`supported_adapters`,
	`default_headers`,
	`status`,
	`created_at`,
	`updated_at`
)
SELECT
	'legacy-' || `models`.`user_id` || '-' || lower(replace(`models`.`provider`, ' ', '-')) || '-' || ifnull(hex(`models`.`endpoint`), 'default'),
	`models`.`user_id`,
	lower(`models`.`provider`),
	`models`.`provider`,
	`models`.`endpoint`,
	'api_key',
	CASE WHEN lower(`models`.`provider`) = 'anthropic' THEN 'anthropic' WHEN lower(`models`.`provider`) = 'openai' THEN 'openai' ELSE 'openai-compatible' END,
	CASE WHEN lower(`models`.`provider`) = 'anthropic' THEN '["claude"]' ELSE '["opencode"]' END,
	'{}',
	'active',
	`models`.`created_at`,
	`models`.`updated_at`
FROM `models`
WHERE NOT EXISTS (
	SELECT 1 FROM `model_profiles` AS `mp` WHERE `mp`.`id` = `models`.`id`
);
--> statement-breakpoint
-- Defensive backfill 2: copy any legacy-only models row into model_profiles
-- preserving its id, so existing sessions/cost-rates/user-settings references
-- remain valid after `models` drops.
INSERT OR IGNORE INTO `model_profiles` (
	`id`,
	`user_id`,
	`provider_profile_id`,
	`name`,
	`model_id`,
	`capabilities`,
	`status`,
	`is_default`,
	`sort_order`,
	`created_at`,
	`updated_at`
)
SELECT
	`models`.`id`,
	`models`.`user_id`,
	`model_provider_profiles`.`id`,
	`models`.`name`,
	`models`.`model_id`,
	'["chat","code"]',
	`models`.`status`,
	`models`.`is_default`,
	`models`.`sort_order`,
	`models`.`created_at`,
	`models`.`updated_at`
FROM `models`
INNER JOIN `model_provider_profiles`
	ON `model_provider_profiles`.`user_id` = `models`.`user_id`
	AND `model_provider_profiles`.`provider_key` = lower(`models`.`provider`)
	AND ifnull(`model_provider_profiles`.`base_url`, '') = ifnull(`models`.`endpoint`, '')
WHERE NOT EXISTS (
	SELECT 1 FROM `model_profiles` AS `mp` WHERE `mp`.`id` = `models`.`id`
);
--> statement-breakpoint
-- Rebuild sessions: repoint model_id FK -> model_profiles(id), same columns.
CREATE TABLE `sessions_v2` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`ai_tool` text NOT NULL,
	`model_id` text,
	`status` text DEFAULT 'idle' NOT NULL,
	`attach_token` text DEFAULT '' NOT NULL,
	`tmux_session` text,
	`working_dir` text NOT NULL,
	`credential_mode` text DEFAULT 'host_environment' NOT NULL,
	`api_key_id` text,
	`last_active` integer,
	`error_message` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_id`) REFERENCES `model_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `sessions_v2` (`id`,`user_id`,`project_id`,`name`,`ai_tool`,`model_id`,`status`,`attach_token`,`tmux_session`,`working_dir`,`credential_mode`,`api_key_id`,`last_active`,`error_message`,`created_at`,`updated_at`)
SELECT `id`,`user_id`,`project_id`,`name`,`ai_tool`,`model_id`,`status`,`attach_token`,`tmux_session`,`working_dir`,`credential_mode`,`api_key_id`,`last_active`,`error_message`,`created_at`,`updated_at` FROM `sessions`;
--> statement-breakpoint
DROP TABLE `sessions`;
--> statement-breakpoint
ALTER TABLE `sessions_v2` RENAME TO `sessions`;
--> statement-breakpoint
CREATE INDEX `idx_sessions_user_project` ON `sessions` (`user_id`,`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_sessions_status` ON `sessions` (`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_sessions_user_project_id` ON `sessions` (`user_id`,`project_id`,`id`);
--> statement-breakpoint
-- Rebuild model_cost_rates: repoint model_id FK -> model_profiles(id).
CREATE TABLE `model_cost_rates_v2` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`model_id` text NOT NULL,
	`hourly_rate_usd` real DEFAULT 0 NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_id`) REFERENCES `model_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `model_cost_rates_v2` (`id`,`user_id`,`model_id`,`hourly_rate_usd`,`created_at`,`updated_at`)
SELECT `id`,`user_id`,`model_id`,`hourly_rate_usd`,`created_at`,`updated_at` FROM `model_cost_rates`;
--> statement-breakpoint
DROP TABLE `model_cost_rates`;
--> statement-breakpoint
ALTER TABLE `model_cost_rates_v2` RENAME TO `model_cost_rates`;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_model_cost_rates_user_model` ON `model_cost_rates` (`user_id`,`model_id`);
--> statement-breakpoint
-- Rebuild user_settings: rename default_model_id -> model_id, FK -> model_profiles(id).
CREATE TABLE `user_settings_v2` (
	`user_id` text PRIMARY KEY NOT NULL,
	`theme` text DEFAULT 'light' NOT NULL,
	`language` text DEFAULT 'zh-CN' NOT NULL,
	`model_id` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_id`) REFERENCES `model_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `user_settings_v2` (`user_id`,`theme`,`language`,`model_id`,`created_at`,`updated_at`)
SELECT `user_id`,`theme`,`language`,`default_model_id`,`created_at`,`updated_at` FROM `user_settings`;
--> statement-breakpoint
DROP TABLE `user_settings`;
--> statement-breakpoint
ALTER TABLE `user_settings_v2` RENAME TO `user_settings`;
--> statement-breakpoint
-- Drop the legacy mirror table and its unique index.
DROP INDEX IF EXISTS `idx_models_user_name`;
--> statement-breakpoint
DROP TABLE IF EXISTS `models`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
