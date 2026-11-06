-- Claude Code routing failover: claude_route_assignments becomes an ordered
-- candidate list per user instead of a single assignment. Position 1 is the
-- primary target (what apply pins); later positions are failover candidates
-- the data plane walks through in order when the primary's circuit breaker is
-- open or its attempts exhaust. The existing single-assignment row carries
-- over as position 1 so routing keeps working unchanged across the upgrade.
CREATE TABLE `claude_route_assignments_new` (
	`user_id` text NOT NULL,
	`provider_profile_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`position` integer NOT NULL DEFAULT 1,
	`updated_at` integer NOT NULL,
	PRIMARY KEY (`user_id`, `provider_profile_id`),
	UNIQUE (`user_id`, `position`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_profile_id`) REFERENCES `model_provider_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`credential_id`) REFERENCES `provider_credentials`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `claude_route_assignments_new` (`user_id`, `provider_profile_id`, `credential_id`, `position`, `updated_at`)
SELECT `user_id`, `provider_profile_id`, `credential_id`, 1, `updated_at`
FROM `claude_route_assignments`;
--> statement-breakpoint
DROP TABLE `claude_route_assignments`;
--> statement-breakpoint
ALTER TABLE `claude_route_assignments_new` RENAME TO `claude_route_assignments`;
