-- Binds a copilot conversation to its dsh (deepseek-harness) kernel session.
-- Null for conversations that have only ever run on the in-process
-- orchestrator; the M2 BFF path fills it on the first dsh-backed message and
-- reuses it for resume after runtime reaps/crashes.
ALTER TABLE `copilot_conversations` ADD COLUMN `dsh_session_id` text;
