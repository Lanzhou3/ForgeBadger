-- Server-side persistence of the Copilot model + thinking-strength
-- preferences. user_settings.model_id (previously unused) is reused as the
-- preferred Copilot model; copilot_thinking_effort stores off|low|medium|high.
ALTER TABLE `user_settings` ADD COLUMN `copilot_thinking_effort` TEXT;
