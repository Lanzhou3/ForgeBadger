-- Per-user dsh kernel configuration for the Copilot (M4).
--
-- One row per user: which optional runtime plugins the per-user cordis.yml
-- mounts at spawn (plugins_json, keyed by the availablePlugins whitelist) and
-- which model profile overrides the system default when a message does not
-- name one (default_model_id; null = follow the system default). Resolution
-- order: message-level modelId > copilot_dsh_config.default_model_id > system
-- isDefault. default_model_id has no FK on purpose: a deleted/inactivated
-- profile fails model resolution loudly instead of blocking config cleanup.

CREATE TABLE `copilot_dsh_config` (
	`user_id` text PRIMARY KEY NOT NULL,
	`default_model_id` text,
	`plugins_json` text NOT NULL DEFAULT '{}',
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
