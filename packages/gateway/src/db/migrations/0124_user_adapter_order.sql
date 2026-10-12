-- Per-user Code CLI display order preference (Settings → AI adapters drag
-- sort). user_settings.adapter_order stores a JSON array of canonical adapter
-- ids; null means "no preference, use gateway discovery order".
ALTER TABLE `user_settings` ADD COLUMN `adapter_order` TEXT;
