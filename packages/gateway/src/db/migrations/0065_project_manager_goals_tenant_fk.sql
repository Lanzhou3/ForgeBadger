-- Refuse to rebuild goals when an existing row points at a missing project or
-- a project owned by another tenant.
CREATE TEMP TABLE `_pm_goal_owner_guard` (
  `conflict` integer NOT NULL CHECK (`conflict` = 0)
);
--> statement-breakpoint
INSERT INTO `_pm_goal_owner_guard` (`conflict`)
SELECT 1
FROM `project_manager_goals` AS `goal`
LEFT JOIN `projects` AS `project`
  ON `project`.`id` = `goal`.`project_id`
 AND `project`.`user_id` = `goal`.`user_id`
WHERE `project`.`id` IS NULL
LIMIT 1;
--> statement-breakpoint
DROP TABLE `_pm_goal_owner_guard`;
--> statement-breakpoint
CREATE TABLE `project_manager_goals_v2` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `project_id` text NOT NULL,
  `summary` text NOT NULL,
  `constraints_json` text NOT NULL DEFAULT '[]',
  `acceptance_criteria_json` text NOT NULL DEFAULT '[]',
  `details_json` text NOT NULL DEFAULT '{}',
  `status` text NOT NULL DEFAULT 'active',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`, `project_id`) REFERENCES `projects` (`user_id`, `id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `project_manager_goals_v2` (
  `id`, `user_id`, `project_id`, `summary`, `constraints_json`,
  `acceptance_criteria_json`, `details_json`, `status`, `created_at`, `updated_at`
)
SELECT
  `id`, `user_id`, `project_id`, `summary`, `constraints_json`,
  `acceptance_criteria_json`, `details_json`, `status`, `created_at`, `updated_at`
FROM `project_manager_goals`;
--> statement-breakpoint
DROP TABLE `project_manager_goals`;
--> statement-breakpoint
ALTER TABLE `project_manager_goals_v2` RENAME TO `project_manager_goals`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_manager_goals_user_project`
  ON `project_manager_goals` (`user_id`, `project_id`);
