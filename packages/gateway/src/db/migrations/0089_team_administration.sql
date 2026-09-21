CREATE TABLE user_auth_epochs (
 user_id text PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 epoch integer NOT NULL DEFAULT 1 CHECK(epoch >= 1)
);
--> statement-breakpoint
CREATE TABLE user_authority_epochs (
 user_id text PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 epoch integer NOT NULL DEFAULT 1 CHECK(epoch >= 1)
);
--> statement-breakpoint
CREATE TRIGGER users_authority_generation AFTER UPDATE OF status ON users WHEN OLD.status != NEW.status
BEGIN
 INSERT INTO user_authority_epochs(user_id,epoch) VALUES(NEW.id,1) ON CONFLICT(user_id) DO UPDATE SET epoch=epoch+1;
END;
--> statement-breakpoint
ALTER TABLE delivery_runs ADD COLUMN authority_epoch text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE TABLE teams (
 id text PRIMARY KEY NOT NULL, user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 owner_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT, name text NOT NULL,
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','closed')),
 revision integer NOT NULL DEFAULT 1, created_at integer NOT NULL, updated_at integer NOT NULL,
 UNIQUE(user_id,id)
);
--> statement-breakpoint
CREATE TABLE team_members (
 user_id text NOT NULL,team_id text NOT NULL,member_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 role text NOT NULL CHECK(role IN ('admin','member')),state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','leaving','left')),
 revision integer NOT NULL DEFAULT 1,PRIMARY KEY(team_id,member_id),
 FOREIGN KEY(user_id,team_id) REFERENCES teams(user_id,id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX idx_team_members_actor ON team_members(member_id,state);
--> statement-breakpoint
CREATE TABLE team_projects (
 user_id text NOT NULL,team_id text NOT NULL,project_user_id text NOT NULL,project_id text PRIMARY KEY NOT NULL,
 logical_owner_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,revision integer NOT NULL DEFAULT 1,
 FOREIGN KEY(user_id,team_id) REFERENCES teams(user_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(project_user_id,project_id) REFERENCES projects(user_id,id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX idx_team_projects_team ON team_projects(team_id);
--> statement-breakpoint
CREATE TABLE team_invitations (
 id text PRIMARY KEY NOT NULL,user_id text NOT NULL,team_id text NOT NULL,
 token_hash text NOT NULL UNIQUE,email text NOT NULL,role text NOT NULL CHECK(role IN ('admin','member')),
 issuer_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,issuer_revision integer NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','used','revoked')),
 expires_at integer NOT NULL,created_at integer NOT NULL,used_at integer,used_by text REFERENCES users(id) ON DELETE RESTRICT,
 FOREIGN KEY(user_id,team_id) REFERENCES teams(user_id,id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX idx_team_invitations_team ON team_invitations(team_id,created_at);
--> statement-breakpoint
CREATE TABLE team_offboarding_plans (
 id text PRIMARY KEY NOT NULL,user_id text NOT NULL,team_id text NOT NULL,
 actor_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,member_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 confirmation_hash text NOT NULL,revision integer NOT NULL DEFAULT 1,plan_digest text NOT NULL,handoffs_json text NOT NULL,
 state text NOT NULL DEFAULT 'planned' CHECK(state IN ('planned','stopping','completed')),
 expires_at integer NOT NULL,created_at integer NOT NULL,pending_stops integer NOT NULL DEFAULT 0,error text,
 FOREIGN KEY(user_id,team_id) REFERENCES teams(user_id,id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_team_offboarding_active ON team_offboarding_plans(team_id,member_id) WHERE state='stopping';
--> statement-breakpoint
CREATE TABLE team_events (
 id text PRIMARY KEY NOT NULL,user_id text NOT NULL,team_id text NOT NULL,
 actor_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,kind text NOT NULL,body_json text NOT NULL,created_at integer NOT NULL,
 FOREIGN KEY(user_id,team_id) REFERENCES teams(user_id,id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TRIGGER team_owner_disable_guard BEFORE UPDATE OF status ON users
WHEN NEW.status!='active' AND EXISTS(SELECT 1 FROM teams WHERE owner_id=OLD.id AND state='active')
BEGIN SELECT RAISE(ABORT,'TEAM_OWNER_TRANSFER_REQUIRED'); END;
--> statement-breakpoint
CREATE TRIGGER team_owner_membership_guard BEFORE UPDATE OF state,role ON team_members
WHEN NEW.state!='active' AND EXISTS(SELECT 1 FROM teams WHERE id=OLD.team_id AND owner_id=OLD.member_id AND state='active')
BEGIN SELECT RAISE(ABORT,'TEAM_OWNER_TRANSFER_REQUIRED'); END;
--> statement-breakpoint
CREATE TRIGGER team_owner_membership_delete_guard BEFORE DELETE ON team_members
WHEN EXISTS(SELECT 1 FROM teams WHERE id=OLD.team_id AND owner_id=OLD.member_id AND state='active')
BEGIN SELECT RAISE(ABORT,'TEAM_OWNER_TRANSFER_REQUIRED'); END;

--> statement-breakpoint
CREATE TRIGGER delivery_apply_teams_update BEFORE UPDATE ON teams
WHEN EXISTS(SELECT 1 FROM team_projects tp JOIN delivery_operations o ON o.project_id=tp.project_id WHERE tp.team_id=OLD.id AND o.kind='integrate' AND o.phase IN ('applying','interrupted'))
BEGIN SELECT RAISE(ABORT,'DELIVERY_INTEGRATION_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER delivery_apply_teams_delete BEFORE DELETE ON teams
WHEN EXISTS(SELECT 1 FROM team_projects tp JOIN delivery_operations o ON o.project_id=tp.project_id WHERE tp.team_id=OLD.id AND o.kind='integrate' AND o.phase IN ('applying','interrupted'))
BEGIN SELECT RAISE(ABORT,'DELIVERY_INTEGRATION_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER delivery_apply_team_members_update BEFORE UPDATE ON team_members
WHEN EXISTS(SELECT 1 FROM team_projects tp JOIN delivery_operations o ON o.project_id=tp.project_id WHERE tp.team_id=OLD.team_id AND o.kind='integrate' AND o.phase IN ('applying','interrupted'))
BEGIN SELECT RAISE(ABORT,'DELIVERY_INTEGRATION_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER delivery_apply_team_members_delete BEFORE DELETE ON team_members
WHEN EXISTS(SELECT 1 FROM team_projects tp JOIN delivery_operations o ON o.project_id=tp.project_id WHERE tp.team_id=OLD.team_id AND o.kind='integrate' AND o.phase IN ('applying','interrupted'))
BEGIN SELECT RAISE(ABORT,'DELIVERY_INTEGRATION_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER delivery_apply_team_projects_update BEFORE UPDATE ON team_projects
WHEN EXISTS(SELECT 1 FROM team_projects tp JOIN delivery_operations o ON o.project_id=tp.project_id WHERE tp.team_id=OLD.team_id AND o.kind='integrate' AND o.phase IN ('applying','interrupted'))
BEGIN SELECT RAISE(ABORT,'DELIVERY_INTEGRATION_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER delivery_apply_team_projects_delete BEFORE DELETE ON team_projects
WHEN EXISTS(SELECT 1 FROM team_projects tp JOIN delivery_operations o ON o.project_id=tp.project_id WHERE tp.team_id=OLD.team_id AND o.kind='integrate' AND o.phase IN ('applying','interrupted'))
BEGIN SELECT RAISE(ABORT,'DELIVERY_INTEGRATION_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER delivery_apply_team_members_insert BEFORE INSERT ON team_members
WHEN EXISTS(SELECT 1 FROM team_projects tp JOIN delivery_operations o ON o.project_id=tp.project_id WHERE tp.team_id=NEW.team_id AND o.kind='integrate' AND o.phase IN ('applying','interrupted'))
BEGIN SELECT RAISE(ABORT,'DELIVERY_INTEGRATION_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER delivery_apply_team_projects_insert BEFORE INSERT ON team_projects
WHEN EXISTS(SELECT 1 FROM team_projects tp JOIN delivery_operations o ON o.project_id=tp.project_id WHERE tp.team_id=NEW.team_id AND o.kind='integrate' AND o.phase IN ('applying','interrupted'))
BEGIN SELECT RAISE(ABORT,'DELIVERY_INTEGRATION_IN_PROGRESS'); END;

--> statement-breakpoint
CREATE TRIGGER delivery_apply_team_users_status BEFORE UPDATE OF status ON users
WHEN OLD.status != NEW.status AND EXISTS(
 SELECT 1 FROM team_members m JOIN team_projects tp ON tp.team_id=m.team_id
 JOIN delivery_operations o ON o.project_id=tp.project_id
 WHERE m.member_id=OLD.id AND o.kind='integrate' AND o.phase IN ('applying','interrupted'))
BEGIN SELECT RAISE(ABORT,'DELIVERY_INTEGRATION_IN_PROGRESS'); END;

--> statement-breakpoint
ALTER TABLE delivery_reviews ADD COLUMN authority_epoch text NOT NULL DEFAULT '';

--> statement-breakpoint
CREATE TRIGGER team_invitation_issuer_disable AFTER UPDATE OF status ON users
WHEN OLD.status != NEW.status AND NEW.status != 'active'
BEGIN UPDATE team_invitations SET state='revoked' WHERE issuer_id=NEW.id AND state='pending'; END;
