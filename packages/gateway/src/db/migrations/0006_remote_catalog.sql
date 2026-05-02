CREATE TABLE `catalog_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source_id` text NOT NULL,
	`type` text NOT NULL,
	`label` text NOT NULL,
	`url` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_refreshed_at` integer,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_catalog_sources_user_source` ON `catalog_sources` (`user_id`,`type`,`source_id`);
--> statement-breakpoint
CREATE TABLE `catalog_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source_id` text NOT NULL,
	`item_type` text NOT NULL,
	`external_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`version` text,
	`metadata` text,
	`fetched_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_catalog_items_user_source` ON `catalog_items` (`user_id`,`source_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_catalog_items_unique` ON `catalog_items` (`user_id`,`item_type`,`source_id`,`external_id`);
