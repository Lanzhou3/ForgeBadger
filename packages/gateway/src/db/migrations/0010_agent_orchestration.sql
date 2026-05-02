CREATE TABLE `project_agent_sequences` (
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`project_id`, `agent_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_agent_sequences_user_project` ON `project_agent_sequences` (`user_id`,`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_project_agent_sequences_project_position` ON `project_agent_sequences` (`project_id`,`position`);
