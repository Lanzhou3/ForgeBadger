ALTER TABLE `mcp_access_tokens` ADD `allowed_root` text;
--> statement-breakpoint
ALTER TABLE `mcp_access_tokens` ADD `expires_at` integer;
