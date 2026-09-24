-- 0105_remove_copilot_grants.sql
-- 删除 Copilot grant 体系：copilot_grants / copilot_conversation_grants（0069 建）；
-- platform_action_intents 重建去掉 grant 两列（grant_id 被原表 FK 命名，不能 DROP COLUMN，数据保留）；
-- channel_routes 重建改为绑定项目 project_id（存量路由引用已删除的 grant，丢弃，需重新配对）。
-- 路由被整体丢弃，挂在路由上的渠道收件/投递记录随之清除（外键链：
-- channel_deliveries / channel_message_events → channel_messages → channel_routes），
-- 否则重建后的空 channel_routes 会让存量 channel_messages 成为悬挂外键，
-- 启动时的 PRAGMA foreign_key_check 将拒绝启动。
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
DELETE FROM channel_deliveries;
--> statement-breakpoint
DELETE FROM channel_message_events;
--> statement-breakpoint
DELETE FROM channel_messages;
--> statement-breakpoint
DROP TABLE channel_routes;
--> statement-breakpoint
CREATE TABLE channel_routes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  identity_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(user_id,identity_id) REFERENCES channel_identities(user_id,id) ON DELETE CASCADE,
  FOREIGN KEY(user_id,project_id) REFERENCES projects(user_id,id) ON DELETE CASCADE,
  FOREIGN KEY(user_id,conversation_id) REFERENCES copilot_conversations(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_channel_route_tenant ON channel_routes(user_id,id);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_channel_route_active ON channel_routes(user_id,identity_id) WHERE status='active';
--> statement-breakpoint
CREATE UNIQUE INDEX idx_channel_route_conversation ON channel_routes(user_id,conversation_id);
--> statement-breakpoint
CREATE TABLE platform_action_intents_next (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  authority TEXT NOT NULL,
  command_id TEXT NOT NULL,
  input_json TEXT NOT NULL,
  digest TEXT NOT NULL,
  resources_json TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  execution_owner TEXT,
  execution_lease_expires_at INTEGER,
  channel_conversation_id TEXT,
  origin_kind TEXT NOT NULL DEFAULT 'legacy',
  origin_run_id TEXT,
  origin_step_id TEXT,
  UNIQUE(user_id,idempotency_key),
  UNIQUE(user_id,id)
);
--> statement-breakpoint
INSERT INTO platform_action_intents_next (id,user_id,actor_user_id,authority,command_id,input_json,digest,resources_json,policy_version,expires_at,idempotency_key,status,created_at,execution_owner,execution_lease_expires_at,channel_conversation_id,origin_kind,origin_run_id,origin_step_id)
SELECT id,user_id,actor_user_id,authority,command_id,input_json,digest,resources_json,policy_version,expires_at,idempotency_key,status,created_at,execution_owner,execution_lease_expires_at,channel_conversation_id,origin_kind,origin_run_id,origin_step_id FROM platform_action_intents;
--> statement-breakpoint
DROP TABLE platform_action_intents;
--> statement-breakpoint
ALTER TABLE platform_action_intents_next RENAME TO platform_action_intents;
--> statement-breakpoint
CREATE INDEX idx_platform_action_execution_lease ON platform_action_intents(user_id,status,execution_lease_expires_at);
--> statement-breakpoint
-- 最后删 grant 两表：旧 platform_action_intents（含 grant_id FK）已在上方重建移除，
-- 避免 DROP 父表时被子表外键阻断。
DROP TABLE copilot_conversation_grants;
--> statement-breakpoint
DROP TABLE copilot_grants;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
