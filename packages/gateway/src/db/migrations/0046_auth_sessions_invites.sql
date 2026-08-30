-- Auth sessions and one-time invite codes.
--
-- Auth sessions replace the long-lived bearer JWT for console sign-in: only a
-- SHA-256 of the opaque token is stored, expiry slides with activity and is
-- hard-capped by absolute_expires_at. Invite codes gate registration in the
-- invite-only mode; redemption is recorded by used_by_user_id/used_at.

CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer DEFAULT current_timestamp NOT NULL,
	`last_seen_at` integer DEFAULT current_timestamp NOT NULL,
	`expires_at` integer NOT NULL,
	`absolute_expires_at` integer NOT NULL,
	`user_agent` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_sessions_token_hash_unique` ON `auth_sessions` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `idx_auth_sessions_user` ON `auth_sessions` (`user_id`);
--> statement-breakpoint
CREATE TABLE `auth_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`created_by_user_id` text,
	`created_at` integer DEFAULT current_timestamp NOT NULL,
	`expires_at` integer NOT NULL,
	`used_by_user_id` text,
	`used_at` integer,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`used_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_invites_code_unique` ON `auth_invites` (`code`);
--> statement-breakpoint
CREATE INDEX `idx_auth_invites_created_by` ON `auth_invites` (`created_by_user_id`);
