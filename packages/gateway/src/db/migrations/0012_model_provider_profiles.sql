CREATE TABLE `model_provider_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider_key` text NOT NULL,
	`name` text NOT NULL,
	`base_url` text,
	`auth_type` text DEFAULT 'api_key' NOT NULL,
	`api_format` text DEFAULT 'openai-compatible' NOT NULL,
	`supported_adapters` text DEFAULT '[]' NOT NULL,
	`default_headers` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_model_provider_profiles_user_key_url` ON `model_provider_profiles` (`user_id`,`provider_key`,`base_url`);
--> statement-breakpoint
CREATE TABLE `model_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider_profile_id` text NOT NULL,
	`name` text NOT NULL,
	`model_id` text NOT NULL,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`context_window` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_profile_id`) REFERENCES `model_provider_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_model_profiles_user_provider_model` ON `model_profiles` (`user_id`,`provider_profile_id`,`model_id`);
--> statement-breakpoint
CREATE TABLE `provider_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider_profile_id` text NOT NULL,
	`label` text,
	`secret_encrypted` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_used_at` integer,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_profile_id`) REFERENCES `model_provider_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_provider_credentials_user_provider` ON `provider_credentials` (`user_id`,`provider_profile_id`);
--> statement-breakpoint
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
	'legacy-' || `user_id` || '-' || lower(replace(`provider`, ' ', '-')) || '-' || ifnull(hex(`endpoint`), 'default'),
	`user_id`,
	lower(`provider`),
	`provider`,
	`endpoint`,
	'api_key',
	CASE WHEN lower(`provider`) = 'anthropic' THEN 'anthropic' WHEN lower(`provider`) = 'openai' THEN 'openai' ELSE 'openai-compatible' END,
	CASE WHEN lower(`provider`) = 'anthropic' THEN '["claude"]' ELSE '["opencode"]' END,
	'{}',
	'active',
	`created_at`,
	`updated_at`
FROM `models`;
--> statement-breakpoint
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
	AND ifnull(`model_provider_profiles`.`base_url`, '') = ifnull(`models`.`endpoint`, '');
