-- Rename the generic CLI completion notification type to its adapter-neutral
-- name. The event carries signals from every code CLI (Claude Code, OpenCode,
-- Codex, Kimi Code, PI, MiniMax Code); the legacy value named only Claude.
UPDATE notifications SET type = 'session_notification' WHERE type = 'claude_notification';
