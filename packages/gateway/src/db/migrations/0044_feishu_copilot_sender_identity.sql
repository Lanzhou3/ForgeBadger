-- Feishu Copilot channel sender ownership.
--
-- The Copilot conversation a chat maps to belongs to the first Feishu sender
-- who opened it. Later messages from a different sender (including /new,
-- /approve, /reject) are rejected so a group-chat member cannot run turns or
-- approve pending actions as the OpenForge account owner.

ALTER TABLE `feishu_copilot_channels` ADD COLUMN `sender_identity` text;
