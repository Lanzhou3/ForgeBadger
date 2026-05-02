ALTER TABLE `sessions` ADD `attach_token` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `credential_mode` text DEFAULT 'host_environment' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `api_key_id` text REFERENCES api_keys(id);