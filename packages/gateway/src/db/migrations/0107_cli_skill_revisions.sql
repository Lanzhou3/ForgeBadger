CREATE TABLE `cli_skill_revisions` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `skill_id` text NOT NULL,
  `action` text NOT NULL CHECK (`action` IN ('install','update','rollback','legacy')),
  `snapshot_json` text NOT NULL,
  `package_hash` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`skill_id`,`user_id`) REFERENCES `skills`(`id`,`user_id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `idx_cli_skill_revisions_owner` ON `cli_skill_revisions` (`user_id`,`skill_id`,`created_at`);
