CREATE TABLE `project_manager_goals` (
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
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_manager_goals_user_project` ON `project_manager_goals` (`user_id`,`project_id`);
--> statement-breakpoint
CREATE TABLE `project_manager_work_items` (
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
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_manager_work_items_user_project` ON `project_manager_work_items` (`user_id`,`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_project_manager_work_items_status` ON `project_manager_work_items` (`user_id`,`project_id`,`status`);
--> statement-breakpoint
CREATE TABLE `project_manager_ledger_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`work_item_id` text,
	`event_type` text NOT NULL,
	`status` text,
	`evidence_refs_json` text NOT NULL DEFAULT '[]',
	`feishu_refs_json` text NOT NULL DEFAULT '[]',
	`details_json` text NOT NULL DEFAULT '{}',
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`work_item_id`) REFERENCES `project_manager_work_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_project_manager_ledger_events_user_project` ON `project_manager_ledger_events` (`user_id`,`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_project_manager_ledger_events_type` ON `project_manager_ledger_events` (`user_id`,`project_id`,`event_type`);
--> statement-breakpoint
CREATE INDEX `idx_project_manager_ledger_events_created` ON `project_manager_ledger_events` (`user_id`,`project_id`,`created_at`);
