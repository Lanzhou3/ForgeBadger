-- Schema hardening:
--  1. project_skills gains a tenant `user_id` (the owning project's user) with a
--     composite FK to projects(user_id, id), closing the "every table has a
--     user_id" tenant-isolation gap. skill_id stays a simple FK so a user can
--     still attach shared/admin skills owned by other users. The table is
--     rebuilt (SQLite cannot add a NOT NULL column in place).
--  2. Add missing lookup indexes for api_keys, templates, and notifications.
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `project_skills_v2` (
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`is_enabled` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`user_id`, `project_id`, `skill_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`project_id`) REFERENCES `projects`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `project_skills_v2` (`user_id`,`project_id`,`skill_id`,`is_enabled`)
SELECT `p`.`user_id`, `ps`.`project_id`, `ps`.`skill_id`, `ps`.`is_enabled`
FROM `project_skills` AS `ps`
JOIN `projects` AS `p` ON `p`.`id` = `ps`.`project_id`;
--> statement-breakpoint
DROP TABLE `project_skills`;
--> statement-breakpoint
ALTER TABLE `project_skills_v2` RENAME TO `project_skills`;
--> statement-breakpoint
CREATE INDEX `idx_api_keys_user_provider` ON `api_keys` (`user_id`,`provider`);
--> statement-breakpoint
CREATE INDEX `idx_templates_user` ON `templates` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_notifications_session` ON `notifications` (`session_id`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
