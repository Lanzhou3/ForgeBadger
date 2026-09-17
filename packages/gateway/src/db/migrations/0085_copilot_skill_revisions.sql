-- Retain complete, immutable Copilot Skill package revisions independently of CLI Skills.
CREATE UNIQUE INDEX idx_skills_id_user ON skills(id,user_id);
--> statement-breakpoint
CREATE TABLE copilot_skill_revisions (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id text NOT NULL,
  parent_revision_id text,
  action text NOT NULL CHECK(action IN ('import','update','rollback','legacy','builtin-update')),
  snapshot_json text NOT NULL,
  package_digest text NOT NULL,
  created_at integer NOT NULL,
  FOREIGN KEY(skill_id,user_id) REFERENCES skills(id,user_id) ON DELETE CASCADE,
  FOREIGN KEY(parent_revision_id,user_id,skill_id) REFERENCES copilot_skill_revisions(id,user_id,skill_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_copilot_skill_revisions_identity ON copilot_skill_revisions(id,user_id,skill_id);
--> statement-breakpoint
CREATE INDEX idx_copilot_skill_revisions_owner ON copilot_skill_revisions(user_id,skill_id,created_at);
--> statement-breakpoint
CREATE TABLE copilot_skill_heads (
  skill_id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  origin_kind text NOT NULL CHECK(origin_kind IN ('builtin','external','legacy')),
  current_revision_id text NOT NULL,
  FOREIGN KEY(skill_id,user_id) REFERENCES skills(id,user_id) ON DELETE CASCADE,
  FOREIGN KEY(current_revision_id,user_id,skill_id) REFERENCES copilot_skill_revisions(id,user_id,skill_id)
);
--> statement-breakpoint
CREATE INDEX idx_copilot_skill_heads_owner ON copilot_skill_heads(user_id);
--> statement-breakpoint
CREATE TRIGGER copilot_skill_revisions_no_update BEFORE UPDATE ON copilot_skill_revisions
BEGIN SELECT RAISE(ABORT,'Copilot Skill revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER copilot_skill_revision_target BEFORE INSERT ON copilot_skill_revisions
WHEN NOT EXISTS (SELECT 1 FROM skills WHERE id=NEW.skill_id AND user_id=NEW.user_id AND runtime_target='copilot')
BEGIN SELECT RAISE(ABORT,'Copilot Skill target required'); END;
--> statement-breakpoint
CREATE TRIGGER copilot_skill_head_origin_immutable BEFORE UPDATE OF skill_id,user_id,origin_kind ON copilot_skill_heads
BEGIN SELECT RAISE(ABORT,'Copilot Skill origin is immutable'); END;
