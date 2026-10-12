-- Collapse the authorization model onto the per-project Copilot autonomy
-- switch: the per-adapter CLI autonomy axis (FORGEBADGER_CLI_AUTONOMY_ADAPTERS
-- / cli_autonomy_adapters runtime setting) and the no-op project management
-- "mode" label are retired.
DELETE FROM runtime_settings WHERE key = 'cli_autonomy_adapters';
--> statement-breakpoint
ALTER TABLE project_manager_management DROP COLUMN mode;
