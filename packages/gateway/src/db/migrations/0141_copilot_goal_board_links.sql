-- Copilot goal tasks link to project board work items (personal projects):
-- the board is the shared plan, goal tasks are their execution state. A work
-- item is linked at most once per goal. Board-cancelled tasks settle as
-- goal task status 'cancelled'.
ALTER TABLE `copilot_goal_tasks` ADD COLUMN `work_item_id` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_copilot_goal_tasks_work_item` ON `copilot_goal_tasks` (`user_id`,`goal_id`,`work_item_id`) WHERE `work_item_id` IS NOT NULL;
