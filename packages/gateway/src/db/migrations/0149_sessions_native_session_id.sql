-- The CLI's native session id (claude code / opencode / kimi / pi / codex),
-- captured from lifecycle hooks or a local-session-store probe, so a stopped
-- session can be relaunched with its conversation resumed (--resume & co).
ALTER TABLE `sessions` ADD COLUMN `native_session_id` text;
