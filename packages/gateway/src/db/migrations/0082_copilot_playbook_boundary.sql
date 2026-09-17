-- Separate executable CLI skill packages from Copilot procedural playbooks.
-- Existing rows and inert project associations are preserved for operator review.
ALTER TABLE skills ADD COLUMN runtime_target text NOT NULL DEFAULT 'cli' CHECK(runtime_target IN ('cli','copilot'));
--> statement-breakpoint
ALTER TABLE skills ADD COLUMN resource_manifest text;
--> statement-breakpoint
UPDATE skills SET runtime_target = 'copilot' WHERE source = 'builtin' AND name IN ('autonomous-work-item-loop','session-dispatch','project-insights','memory-playbook','usage-analysis','safety-and-approvals');
--> statement-breakpoint
DROP INDEX idx_skills_user_name;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_skills_user_target_name ON skills(user_id,runtime_target,name);
--> statement-breakpoint
INSERT INTO copilot_tool_preferences(user_id,tool_name,enabled,updated_at)
SELECT user_id,CASE tool_name WHEN 'list_skills' THEN 'list_playbooks' WHEN 'load_skill' THEN 'load_playbook' ELSE 'pm_prepare_task_packet' END,0,updated_at
FROM copilot_tool_preferences WHERE enabled = 0 AND tool_name IN ('list_skills','load_skill','pm_start_task_packet')
ON CONFLICT(user_id,tool_name) DO UPDATE SET enabled = 0;
