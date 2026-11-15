-- Node side of team hub coordination: a member's own instance stores which
-- hub project a local project (their clone) is linked to. The node token is
-- AES-256-GCM encrypted with the instance master key and never returned.
-- hub_link_tasks is a display cache of the hub's tasks plus the optional
-- local work item created from each; the hub stays the source of truth.

CREATE TABLE hub_links (
 id text PRIMARY KEY NOT NULL,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 hub_url text NOT NULL,
 hub_project_id text NOT NULL,
 hub_project_name text NOT NULL DEFAULT '',
 hub_actor_id text NOT NULL,
 token_encrypted text NOT NULL,
 local_project_id text NOT NULL,
 last_synced_at integer,
 last_error text,
 created_at integer NOT NULL,
 FOREIGN KEY(user_id,local_project_id) REFERENCES projects(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_hub_links_local_project ON hub_links(user_id,local_project_id);
--> statement-breakpoint
CREATE TABLE hub_link_tasks (
 link_id text NOT NULL REFERENCES hub_links(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 hub_task_id text NOT NULL,
 snapshot_json text NOT NULL,
 local_work_item_id text REFERENCES project_manager_work_items(id) ON DELETE SET NULL,
 synced_at integer NOT NULL,
 PRIMARY KEY(link_id,hub_task_id)
);
