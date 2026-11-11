-- Owner-registered local filesystem roots that the copilot's read-only
-- machine_search may traverse. Distinct from registered projects: a root is a
-- pure read-only scope grant (the platform never writes into it) and is stored
-- per user so one owner's root can never be resolved by another tenant.
CREATE TABLE `copilot_machine_roots` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `label` text NOT NULL,
  `path` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_copilot_machine_roots_user_path` ON `copilot_machine_roots` (`user_id`, `path`);
