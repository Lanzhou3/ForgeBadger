-- Development task stages and work-item dependency links.
--
-- The Project Manager tab becomes a development-task management board:
-- stages model the SDLC lanes (backlog = stage_id IS NULL), and work-item
-- links model blocked-by dependencies with repository-side cycle detection.

CREATE TABLE `project_manager_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`position` integer NOT NULL DEFAULT 0,
	`status` text NOT NULL DEFAULT 'active' CHECK (`status` IN ('active', 'completed', 'archived')),
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_manager_stages_user_project`
ON `project_manager_stages` (`user_id`, `project_id`, `position`);
--> statement-breakpoint
ALTER TABLE `project_manager_work_items`
ADD COLUMN `stage_id` text REFERENCES `project_manager_stages`(`id`) ON UPDATE no action ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `idx_project_manager_work_items_stage`
ON `project_manager_work_items` (`user_id`, `project_id`, `stage_id`);
--> statement-breakpoint
-- (blocker_work_item_id blocks blocked_work_item_id). The unique pair index
-- makes duplicate dependency edges impossible at the storage layer.
CREATE TABLE `project_manager_work_item_links` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`blocker_work_item_id` text NOT NULL,
	`blocked_work_item_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`blocker_work_item_id`) REFERENCES `project_manager_work_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`blocked_work_item_id`) REFERENCES `project_manager_work_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_manager_work_item_links_pair`
ON `project_manager_work_item_links` (`project_id`, `blocker_work_item_id`, `blocked_work_item_id`);
--> statement-breakpoint
CREATE INDEX `idx_project_manager_work_item_links_blocked`
ON `project_manager_work_item_links` (`user_id`, `project_id`, `blocked_work_item_id`);
