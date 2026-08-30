ALTER TABLE `integration_feishu_user_mappings`
RENAME COLUMN `openforge_user_id` TO `forgebadger_user_id`;
--> statement-breakpoint
DROP INDEX `idx_integration_feishu_user_mappings_openforge_user`;
--> statement-breakpoint
CREATE INDEX `idx_integration_feishu_user_mappings_forgebadger_user`
ON `integration_feishu_user_mappings` (`user_id`,`forgebadger_user_id`);
--> statement-breakpoint
UPDATE `integration_feishu_configs`
SET `command_prefix` = '/forgebadger'
WHERE `command_prefix` = '/openforge';
