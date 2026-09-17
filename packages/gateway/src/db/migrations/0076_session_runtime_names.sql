ALTER TABLE `sessions` RENAME COLUMN `tmux_session` TO `runtime_session_name`;
--> statement-breakpoint
ALTER TABLE `session_snapshots` RENAME COLUMN `tmux_session` TO `runtime_session_name`;
