-- Existing local databases may have applied an early Portfolio migration in
-- which facts required a project. Request intake is deliberately allowed to
-- begin before routing, so rebuild this immutable ledger with project_id nullable.
-- Older databases also predate the composite Request parent key used by the
-- scoped fact relationship below.
CREATE UNIQUE INDEX IF NOT EXISTS `idx_portfolio_requests_user_project_id`
ON `portfolio_requests` (`user_id`,`project_id`,`id`);
--> statement-breakpoint
DROP TRIGGER IF EXISTS `portfolio_facts_immutable_update`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `portfolio_facts_immutable_delete`;
--> statement-breakpoint
ALTER TABLE `portfolio_facts` RENAME TO `portfolio_facts__project_required`;
--> statement-breakpoint
CREATE TABLE `portfolio_facts` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `project_id` text,
  `request_id` text,
  `work_item_id` text,
  `attempt_id` text,
  `record_type` text NOT NULL,
  `record_id` text NOT NULL,
  `fact_type` text NOT NULL,
  `correlation_id` text,
  `idempotency_key` text,
  `payload_json` text NOT NULL,
  `payload_digest` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  -- A request-only fact stays tenant-scoped until Intake routes it to a project.
  FOREIGN KEY (`user_id`,`project_id`) REFERENCES `portfolio_projects`(`user_id`,`project_id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`user_id`,`request_id`) REFERENCES `portfolio_requests`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`request_id`) REFERENCES `portfolio_requests`(`user_id`,`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`) REFERENCES `portfolio_work_items`(`user_id`,`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`attempt_id`) REFERENCES `portfolio_task_attempts`(`user_id`,`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`,`attempt_id`) REFERENCES `portfolio_task_attempts`(`user_id`,`project_id`,`work_item_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `portfolio_facts` (
  `id`, `user_id`, `project_id`, `request_id`, `work_item_id`, `attempt_id`,
  `record_type`, `record_id`, `fact_type`, `correlation_id`, `idempotency_key`,
  `payload_json`, `payload_digest`, `created_at`
) SELECT
  `id`, `user_id`, `project_id`, `request_id`, `work_item_id`, `attempt_id`,
  `record_type`, `record_id`, `fact_type`, `correlation_id`, `idempotency_key`,
  `payload_json`, `payload_digest`, `created_at`
FROM `portfolio_facts__project_required`;
--> statement-breakpoint
DROP TABLE `portfolio_facts__project_required`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_facts_user_idempotency`
ON `portfolio_facts` (`user_id`,`idempotency_key`) WHERE `idempotency_key` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_portfolio_facts_timeline`
ON `portfolio_facts` (`user_id`,`project_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `idx_portfolio_facts_record`
ON `portfolio_facts` (`user_id`,`record_type`,`record_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER `portfolio_facts_immutable_update`
BEFORE UPDATE ON `portfolio_facts`
BEGIN
  SELECT RAISE(ABORT, 'PORTFOLIO_FACT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `portfolio_facts_immutable_delete`
BEFORE DELETE ON `portfolio_facts`
BEGIN
  SELECT RAISE(ABORT, 'PORTFOLIO_FACT_IMMUTABLE');
END;
