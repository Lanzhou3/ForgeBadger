ALTER TABLE `integration_feishu_configs` ADD COLUMN `app_id` text;
--> statement-breakpoint
ALTER TABLE `integration_feishu_configs` ADD COLUMN `app_secret_encrypted` text;
