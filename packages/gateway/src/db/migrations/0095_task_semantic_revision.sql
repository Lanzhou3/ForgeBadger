ALTER TABLE collaboration_tasks ADD COLUMN semantic_revision integer NOT NULL DEFAULT 1 CHECK(semantic_revision >= 1);
--> statement-breakpoint
CREATE TRIGGER task_content_semantic_revision
AFTER UPDATE OF title,description,acceptance_criteria_json ON project_manager_work_items
WHEN OLD.title IS NOT NEW.title OR OLD.description IS NOT NEW.description OR OLD.acceptance_criteria_json IS NOT NEW.acceptance_criteria_json
BEGIN
 INSERT OR IGNORE INTO collaboration_tasks(user_id,project_id,work_item_id) VALUES(NEW.user_id,NEW.project_id,NEW.id);
 UPDATE collaboration_tasks SET semantic_revision=semantic_revision+1 WHERE user_id=NEW.user_id AND project_id=NEW.project_id AND work_item_id=NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER task_assignment_semantic_revision
AFTER UPDATE OF assignee_id,reviewer_id ON collaboration_tasks
WHEN OLD.assignee_id IS NOT NEW.assignee_id OR OLD.reviewer_id IS NOT NEW.reviewer_id
BEGIN
 UPDATE collaboration_tasks SET semantic_revision=semantic_revision+1 WHERE user_id=NEW.user_id AND project_id=NEW.project_id AND work_item_id=NEW.work_item_id;
END;
