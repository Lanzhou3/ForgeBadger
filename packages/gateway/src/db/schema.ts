import { randomUUID } from "node:crypto";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name"),
  role: text("role").notNull().default("user"),
  status: text("status").notNull().default("active"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
});

export const models = sqliteTable("models", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  provider: text("provider").notNull(),
  modelId: text("model_id").notNull(),
  endpoint: text("endpoint"),
  status: text("status").notNull().default("active"),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
}, (table) => ({ idx_models_user_name: uniqueIndex("idx_models_user_name").on(table.userId, table.name) }));

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  keyEncrypted: text("key_encrypted").notNull(),
  label: text("label"),
  status: text("status").notNull().default("active"),
  lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
});

export const templates = sqliteTable("templates", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  version: text("version").notNull().default("1.0.0"),
  isBuiltin: integer("is_builtin", { mode: "boolean" }).notNull().default(false),
  visibility: text("visibility").notNull().default("private"),
  usageCount: integer("usage_count").notNull().default(0),
  status: text("status").notNull().default("active"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
});

export const templateFiles = sqliteTable(
  "template_files",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    templateId: text("template_id")
      .notNull()
      .references(() => templates.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    content: text("content").notNull(),
    fileType: text("file_type").notNull()
  },
  (table) => ({
    idx_template_files_template_path: uniqueIndex("idx_template_files_template_path").on(table.templateId, table.filePath),
    idx_template_files_template: index("idx_template_files_template").on(table.templateId)
  })
);

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  path: text("path").notNull(),
  description: text("description"),
  techStack: text("tech_stack"),
  aiTool: text("ai_tool").notNull(),
  status: text("status").notNull().default("active"),
  isImported: integer("is_imported", { mode: "boolean" }).notNull().default(false),
  templateId: text("template_id").references(() => templates.id),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
}, (table) => ({ idx_projects_user_path: uniqueIndex("idx_projects_user_path").on(table.userId, table.path) }));

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  modelId: text("model_id").references(() => models.id),
  tools: text("tools"),
  allowedDirs: text("allowed_dirs"),
  customPrompt: text("custom_prompt"),
  status: text("status").notNull().default("active"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
});

export const projectAgentSequences = sqliteTable(
  "project_agent_sequences",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    position: integer("position").notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.projectId, table.agentId] }),
    idx_project_agent_sequences_user_project: index("idx_project_agent_sequences_user_project").on(table.userId, table.projectId),
    idx_project_agent_sequences_project_position: index("idx_project_agent_sequences_project_position").on(table.projectId, table.position)
  })
);

export const skills = sqliteTable("skills", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  source: text("source").notNull().default("local"),
  content: text("content").notNull(),
  version: text("version").notNull().default("1.0.0"),
  visibility: text("visibility").notNull().default("private"),
  isEnabled: integer("is_enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
}, (table) => ({ idx_skills_user_name: uniqueIndex("idx_skills_user_name").on(table.userId, table.name) }));

export const projectSkills = sqliteTable(
  "project_skills",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    isEnabled: integer("is_enabled", { mode: "boolean" }).notNull().default(true)
  },
  (table) => ({ pk: primaryKey({ columns: [table.projectId, table.skillId] }) })
);

export const catalogSources = sqliteTable(
  "catalog_sources",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceId: text("source_id").notNull(),
    type: text("type").notNull(),
    label: text("label").notNull(),
    url: text("url").notNull(),
    status: text("status").notNull().default("active"),
    lastRefreshedAt: integer("last_refreshed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
  },
  (table) => ({
    idx_catalog_sources_user_source: uniqueIndex("idx_catalog_sources_user_source").on(table.userId, table.type, table.sourceId)
  })
);

export const catalogItems = sqliteTable(
  "catalog_items",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceId: text("source_id").notNull(),
    itemType: text("item_type").notNull(),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    version: text("version"),
    metadata: text("metadata"),
    fetchedAt: integer("fetched_at", { mode: "timestamp" }).$defaultFn(() => new Date())
  },
  (table) => ({
    idx_catalog_items_user_source: index("idx_catalog_items_user_source").on(table.userId, table.sourceId),
    idx_catalog_items_unique: uniqueIndex("idx_catalog_items_unique").on(table.userId, table.itemType, table.sourceId, table.externalId)
  })
);

export const plugins = sqliteTable(
  "plugins",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pluginId: text("plugin_id").notNull(),
    status: text("status").notNull().default("disabled"),
    name: text("name"),
    description: text("description"),
    version: text("version"),
    adapter: text("adapter"),
    category: text("category"),
    configPath: text("config_path"),
    skillsJson: text("skills_json"),
    installSource: text("install_source"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
  },
  (table) => ({
    idx_plugins_user_plugin: uniqueIndex("idx_plugins_user_plugin").on(table.userId, table.pluginId)
  })
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    titleKey: text("title_key").notNull(),
    message: text("message").notNull(),
    href: text("href").notNull(),
    sessionId: text("session_id"),
    payload: text("payload"),
    isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
  },
  (table) => ({
    idx_notifications_user_created: index("idx_notifications_user_created").on(table.userId, table.createdAt),
    idx_notifications_user_read: index("idx_notifications_user_read").on(table.userId, table.isRead)
  })
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    aiTool: text("ai_tool").notNull(),
    modelId: text("model_id").references(() => models.id),
    agentId: text("agent_id").references(() => agents.id),
    status: text("status").notNull().default("idle"),
    attachToken: text("attach_token").notNull().default(""),
    tmuxSession: text("tmux_session"),
    workingDir: text("working_dir").notNull(),
    credentialMode: text("credential_mode").notNull().default("host_environment"),
    apiKeyId: text("api_key_id").references(() => apiKeys.id),
    lastActive: integer("last_active", { mode: "timestamp" }),
    errorMessage: text("error_message"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
  },
  (table) => ({
    idx_sessions_user_project: index("idx_sessions_user_project").on(table.userId, table.projectId),
    idx_sessions_status: index("idx_sessions_status").on(table.status)
  })
);

export const sessionActivities = sqliteTable(
  "session_activities",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    status: text("status").notNull().default("info"),
    message: text("message").notNull(),
    metadata: text("metadata"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date())
  },
  (table) => ({
    idx_session_activities_user_created: index("idx_session_activities_user_created").on(table.userId, table.createdAt),
    idx_session_activities_session: index("idx_session_activities_session").on(table.userId, table.sessionId),
    idx_session_activities_project: index("idx_session_activities_project").on(table.userId, table.projectId)
  })
);

export const sessionSnapshots = sqliteTable(
  "session_snapshots",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    tmuxSession: text("tmux_session"),
    modelId: text("model_id"),
    agentId: text("agent_id"),
    configVersion: text("config_version"),
    metadata: text("metadata"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date())
  },
  (table) => ({
    idx_session_snapshots_user_created: index("idx_session_snapshots_user_created").on(table.userId, table.createdAt),
    idx_session_snapshots_session: index("idx_session_snapshots_session").on(table.userId, table.sessionId),
    idx_session_snapshots_project: index("idx_session_snapshots_project").on(table.userId, table.projectId)
  })
);

export const modelCostRates = sqliteTable(
  "model_cost_rates",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    modelId: text("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "cascade" }),
    hourlyRateUsd: real("hourly_rate_usd").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
  },
  (table) => ({
    idx_model_cost_rates_user_model: uniqueIndex("idx_model_cost_rates_user_model").on(table.userId, table.modelId)
  })
);

export const userSettings = sqliteTable("user_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  theme: text("theme").notNull().default("light"),
  language: text("language").notNull().default("zh-CN"),
  defaultModelId: text("default_model_id").references(() => models.id),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
});

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    details: text("details"),
    ipAddress: text("ip_address"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date())
  },
  (table) => ({
    idx_audit_logs_user: index("idx_audit_logs_user").on(table.userId),
    idx_audit_logs_resource: index("idx_audit_logs_resource").on(table.resourceType, table.resourceId)
  })
);
