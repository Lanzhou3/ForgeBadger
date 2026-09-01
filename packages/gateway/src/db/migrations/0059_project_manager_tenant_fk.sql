-- Refuse to normalize a database that already contains cross-tenant work-item
-- ownership. The migration must fail before replacing the table.
CREATE TEMP TABLE `_pm_work_item_owner_guard` (
  `conflict` integer NOT NULL CHECK (`conflict` = 0)
);
--> statement-breakpoint
INSERT INTO `_pm_work_item_owner_guard` (`conflict`)
SELECT 1
FROM `project_manager_work_items` AS `work_item`
LEFT JOIN `projects` AS `project`
  ON `project`.`id` = `work_item`.`project_id`
 AND `project`.`user_id` = `work_item`.`user_id`
WHERE `project`.`id` IS NULL
LIMIT 1;
--> statement-breakpoint
DROP TABLE `_pm_work_item_owner_guard`;
--> statement-breakpoint
CREATE TABLE `project_manager_work_items_v2` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `project_id` text NOT NULL,
  `title` text NOT NULL,
  `description` text,
  `status` text NOT NULL DEFAULT 'todo',
  `priority` integer NOT NULL DEFAULT 0,
  `acceptance_criteria_json` text NOT NULL DEFAULT '[]',
  `evidence_refs_json` text NOT NULL DEFAULT '[]',
  `feishu_refs_json` text NOT NULL DEFAULT '[]',
  `details_json` text NOT NULL DEFAULT '{}',
  `stage_id` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`, `project_id`) REFERENCES `projects` (`user_id`, `id`) ON DELETE CASCADE,
  FOREIGN KEY (`stage_id`) REFERENCES `project_manager_stages` (`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `project_manager_work_items_v2` (
  `id`, `user_id`, `project_id`, `title`, `description`, `status`, `priority`,
  `acceptance_criteria_json`, `evidence_refs_json`, `feishu_refs_json`, `details_json`,
  `stage_id`, `created_at`, `updated_at`
)
SELECT
  `id`, `user_id`, `project_id`, `title`, `description`, `status`, `priority`,
  `acceptance_criteria_json`, `evidence_refs_json`, `feishu_refs_json`, `details_json`,
  `stage_id`, `created_at`, `updated_at`
FROM `project_manager_work_items`;
--> statement-breakpoint
DROP TABLE `project_manager_work_items`;
--> statement-breakpoint
ALTER TABLE `project_manager_work_items_v2` RENAME TO `project_manager_work_items`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_manager_work_items_user_project_id`
  ON `project_manager_work_items` (`user_id`, `project_id`, `id`);
--> statement-breakpoint
CREATE INDEX `idx_project_manager_work_items_updated`
  ON `project_manager_work_items` (`user_id`, `project_id`, `updated_at` DESC, `title` ASC);
--> statement-breakpoint
CREATE INDEX `idx_project_manager_work_items_status_updated`
  ON `project_manager_work_items` (`user_id`, `project_id`, `status`, `updated_at` DESC, `title` ASC);
--> statement-breakpoint
CREATE INDEX `idx_project_manager_work_items_stage`
  ON `project_manager_work_items` (`user_id`, `project_id`, `stage_id`);
