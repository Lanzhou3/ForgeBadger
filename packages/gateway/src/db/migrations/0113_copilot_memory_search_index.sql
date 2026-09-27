CREATE UNIQUE INDEX idx_copilot_memory_tenant_id ON copilot_memory(user_id,id);
--> statement-breakpoint
CREATE TABLE copilot_memory_search_index (
 user_id text NOT NULL,
 memory_id text NOT NULL,
 version text NOT NULL,
 PRIMARY KEY(user_id,memory_id),
 FOREIGN KEY(user_id,memory_id) REFERENCES copilot_memory(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TRIGGER copilot_memory_search_delete AFTER DELETE ON copilot_memory BEGIN
 DELETE FROM copilot_memory_fts WHERE user_id=OLD.user_id AND memory_id=OLD.id;
 DELETE FROM copilot_memory_search_index WHERE user_id=OLD.user_id AND memory_id=OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER copilot_memory_search_invalidate AFTER UPDATE OF text,scope,project_id,conversation_id ON copilot_memory BEGIN
 DELETE FROM copilot_memory_fts WHERE user_id=OLD.user_id AND memory_id=OLD.id;
 DELETE FROM copilot_memory_search_index WHERE user_id=OLD.user_id AND memory_id=OLD.id;
END;
