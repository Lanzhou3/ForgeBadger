CREATE TABLE delivery_pull_requests (
 id text PRIMARY KEY NOT NULL,
 user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 project_id text NOT NULL, run_id text NOT NULL,
 actor_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 request_digest text NOT NULL, repository text NOT NULL,
 head_branch text NOT NULL, base_branch text NOT NULL, commit_sha text NOT NULL,
 state text NOT NULL CHECK(state IN ('checking','creating','created','unknown')),
 url text, number integer, draft integer,
 created_at integer NOT NULL, updated_at integer NOT NULL,
 FOREIGN KEY(user_id,project_id,run_id) REFERENCES delivery_runs(user_id,project_id,id) ON DELETE RESTRICT,
 UNIQUE(actor_id,run_id,request_digest)
);
--> statement-breakpoint
CREATE INDEX idx_delivery_pull_requests_run ON delivery_pull_requests(user_id,project_id,run_id,created_at);
--> statement-breakpoint
CREATE TABLE delivery_operations_next (
 run_id text PRIMARY KEY NOT NULL,
 user_id text NOT NULL, project_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('verify','review','integrate','pull_request')),
 phase text NOT NULL DEFAULT 'active' CHECK(phase IN ('active','applying','interrupted')),
 expected_commit text, created_at integer NOT NULL,
 FOREIGN KEY(user_id,project_id,run_id) REFERENCES delivery_runs(user_id,project_id,id) ON DELETE RESTRICT
);
--> statement-breakpoint
INSERT INTO delivery_operations_next SELECT * FROM delivery_operations;
--> statement-breakpoint
DROP TABLE delivery_operations;
--> statement-breakpoint
CREATE TABLE delivery_operations (
 run_id text PRIMARY KEY NOT NULL,
 user_id text NOT NULL, project_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('verify','review','integrate','pull_request')),
 phase text NOT NULL DEFAULT 'active' CHECK(phase IN ('active','applying','interrupted')),
 expected_commit text, created_at integer NOT NULL,
 FOREIGN KEY(user_id,project_id,run_id) REFERENCES delivery_runs(user_id,project_id,id) ON DELETE RESTRICT
);
--> statement-breakpoint
INSERT INTO delivery_operations SELECT * FROM delivery_operations_next;
--> statement-breakpoint
DROP TABLE delivery_operations_next;
