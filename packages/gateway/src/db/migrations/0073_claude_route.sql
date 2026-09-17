-- Claude Code protocol routing (cc-switch-style local proxy, Gateway edition):
-- OpenAI-protocol providers are applied to Claude Code through the Gateway's
-- loopback Anthropic-compatible endpoint (/v1/messages on the Gateway port)
-- instead of the provider's OpenAI endpoint, so the real API key never lands
-- in ~/.claude/settings.json.
--
-- Per-user switch + encrypted route token (EncryptedSecret JSON, master key)
-- live in user_settings; claude_route_assignments records which provider and
-- credential the routed endpoint forwards to. It is written by apply and
-- read on every routed request; the credential falls back to the provider's
-- oldest active credential at request time when the assigned one was rotated
-- away, so a rotation alone does not strand the routing.

ALTER TABLE `user_settings` ADD COLUMN `claude_route_enabled` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `user_settings` ADD COLUMN `claude_route_token` text;
--> statement-breakpoint
CREATE TABLE `claude_route_assignments` (
	`user_id` text PRIMARY KEY NOT NULL,
	`provider_profile_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_profile_id`) REFERENCES `model_provider_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`credential_id`) REFERENCES `provider_credentials`(`id`) ON UPDATE no action ON DELETE cascade
);
