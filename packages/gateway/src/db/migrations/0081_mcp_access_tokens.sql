CREATE TABLE `mcp_access_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`scopes` text DEFAULT '["read"]' NOT NULL,
	`created_at` integer DEFAULT current_timestamp NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_access_tokens_token_hash_unique` ON `mcp_access_tokens` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `idx_mcp_access_tokens_user` ON `mcp_access_tokens` (`user_id`,`created_at`);
