ALTER TABLE `plugins` ADD COLUMN `name` text;
--> statement-breakpoint
ALTER TABLE `plugins` ADD COLUMN `description` text;
--> statement-breakpoint
ALTER TABLE `plugins` ADD COLUMN `version` text;
--> statement-breakpoint
ALTER TABLE `plugins` ADD COLUMN `adapter` text;
--> statement-breakpoint
ALTER TABLE `plugins` ADD COLUMN `category` text;
--> statement-breakpoint
ALTER TABLE `plugins` ADD COLUMN `config_path` text;
--> statement-breakpoint
ALTER TABLE `plugins` ADD COLUMN `skills_json` text;
--> statement-breakpoint
ALTER TABLE `plugins` ADD COLUMN `install_source` text;
