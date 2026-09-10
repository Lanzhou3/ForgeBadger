-- Record the target AI CLI adapter on every template: custom templates were
-- historically rendered as Claude Code regardless of their content because
-- only the built-in ids mapped to adapters. The column is nullable so
-- pre-existing custom templates keep the legacy Claude fallback.
--
-- Introduce git-backed template sources: teams and the community share
-- templates through ordinary git repositories. template_git_sources tracks
-- each source's clone status; the scanned template content is registered
-- into catalog_items through the existing catalog install pipeline.
ALTER TABLE `templates` ADD COLUMN `adapter` text;
--> statement-breakpoint
CREATE TABLE `template_git_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source_id` text NOT NULL,
	`label` text,
	`url` text NOT NULL,
	`branch` text,
	`status` text DEFAULT 'idle' NOT NULL,
	`error` text,
	`last_pulled_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_template_git_sources_user_source` ON `template_git_sources` (`user_id`, `source_id`);
--> statement-breakpoint
CREATE INDEX `idx_template_git_sources_user` ON `template_git_sources` (`user_id`);
