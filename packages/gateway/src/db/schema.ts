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

export const modelProviderProfiles = sqliteTable("model_provider_profiles", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  providerKey: text("provider_key").notNull(),
  name: text("name").notNull(),
  baseUrl: text("base_url"),
  anthropicBaseUrl: text("anthropic_base_url"),
  openaiBaseUrl: text("openai_base_url"),
  region: text("region"),
  productType: text("product_type"),
  authType: text("auth_type").notNull().default("api_key"),
  apiFormat: text("api_format").notNull().default("openai-compatible"),
  supportedAdapters: text("supported_adapters").notNull().default("[]"),
  defaultHeaders: text("default_headers").notNull().default("{}"),
  opencodeNpm: text("opencode_npm"),
  status: text("status").notNull().default("active"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
}, (table) => ({
  idx_model_provider_profiles_user_key_url: uniqueIndex("idx_model_provider_profiles_user_key_url").on(table.userId, table.providerKey, table.baseUrl)
}));

export const modelProfiles = sqliteTable("model_profiles", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  providerProfileId: text("provider_profile_id")
    .notNull()
    .references(() => modelProviderProfiles.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  modelId: text("model_id").notNull(),
  capabilities: text("capabilities").notNull().default("[]"),
  contextWindow: integer("context_window"),
  status: text("status").notNull().default("active"),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
}, (table) => ({
  idx_model_profiles_user_provider_model: uniqueIndex("idx_model_profiles_user_provider_model").on(table.userId, table.providerProfileId, table.modelId)
}));

export const providerCredentials = sqliteTable("provider_credentials", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  providerProfileId: text("provider_profile_id")
    .notNull()
    .references(() => modelProviderProfiles.id, { onDelete: "cascade" }),
  label: text("label"),
  secretEncrypted: text("secret_encrypted").notNull(),
  status: text("status").notNull().default("active"),
  lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
}, (table) => ({
  idx_provider_credentials_user_provider: index("idx_provider_credentials_user_provider").on(table.userId, table.providerProfileId)
}));

export const copilotRuns = sqliteTable(
  "copilot_runs",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    providerProfileId: text("provider_profile_id").references(() => modelProviderProfiles.id, { onDelete: "set null" }),
    modelProfileId: text("model_profile_id").references(() => modelProfiles.id, { onDelete: "set null" }),
    source: text("source").notNull(),
    sourceRefId: text("source_ref_id"),
    goal: text("goal").notNull(),
    stepCount: integer("step_count").notNull().default(0),
    maxSteps: integer("max_steps").notNull().default(32),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
    completedAt: integer("completed_at", { mode: "timestamp" })
  },
  (table) => ({
    idx_copilot_runs_user_created: index("idx_copilot_runs_user_created").on(table.userId, table.createdAt)
  })
);

export const copilotRunEvents = sqliteTable(
  "copilot_run_events",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => copilotRuns.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    sequence: integer("sequence").notNull(),
    message: text("message"),
    payloadJson: text("payload_json").notNull().default("{}"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date())
  },
  (table) => ({
    idx_copilot_run_events_run_sequence: uniqueIndex("idx_copilot_run_events_run_sequence").on(table.runId, table.sequence)
  })
);

export const copilotConversations = sqliteTable(
  "copilot_conversations",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    source: text("source").notNull(),
    sourceRefId: text("source_ref_id"),
    status: text("status").notNull().default("active"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
    lastMessageAt: integer("last_message_at", { mode: "timestamp" }),
    deletedAt: integer("deleted_at", { mode: "timestamp" })
  },
  (table) => ({
    idx_copilot_conversations_user_updated: index("idx_copilot_conversations_user_updated").on(table.userId, table.updatedAt)
  })
);

export const copilotMessages = sqliteTable(
  "copilot_messages",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => copilotConversations.id, { onDelete: "cascade" }),
    runId: text("run_id").references(() => copilotRuns.id, { onDelete: "set null" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    payloadJson: text("payload_json").notNull().default("{}"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    deletedAt: integer("deleted_at", { mode: "timestamp" })
  },
  (table) => ({
    idx_copilot_messages_conversation_created: index("idx_copilot_messages_conversation_created").on(table.conversationId, table.createdAt)
  })
);

export const copilotPendingActions = sqliteTable(
  "copilot_pending_actions",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => copilotRuns.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    status: text("status").notNull(),
    inputJson: text("input_json").notNull().default("{}"),
    resultJson: text("result_json"),
    approvedBy: text("approved_by"),
    approvedAt: integer("approved_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
  },
  (table) => ({
    idx_copilot_pending_actions_run: index("idx_copilot_pending_actions_run").on(table.runId, table.status)
  })
);

export const copilotMemoryEntries = sqliteTable(
  "copilot_memory_entries",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    scope: text("scope").notNull(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    sourceRunId: text("source_run_id").references(() => copilotRuns.id, { onDelete: "set null" }),
    redactedText: text("redacted_text").notNull(),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
  },
  (table) => ({
    idx_copilot_memory_entries_user_scope: index("idx_copilot_memory_entries_user_scope").on(table.userId, table.scope, table.createdAt),
    idx_copilot_memory_entries_user_project: index("idx_copilot_memory_entries_user_project").on(table.userId, table.projectId, table.createdAt)
  })
);

export const copilotMemoryNotes = sqliteTable(
  "copilot_memory_notes",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
    sourceRunId: text("source_run_id").references(() => copilotRuns.id, { onDelete: "set null" }),
    redactedText: text("redacted_text").notNull(),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date())
  },
  (table) => ({
    idx_copilot_memory_notes_user_created: index("idx_copilot_memory_notes_user_created").on(table.userId, table.createdAt),
    idx_copilot_memory_notes_user_project: index("idx_copilot_memory_notes_user_project").on(table.userId, table.projectId, table.createdAt)
  })
);

export const copilotMemoryFts = sqliteTable("copilot_memory_fts", {
  memoryId: text("memory_id"),
  userId: text("user_id"),
  itemType: text("item_type"),
  scope: text("scope"),
  projectId: text("project_id"),
  redactedText: text("redacted_text")
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

export const projectManagerGoals = sqliteTable(
  "project_manager_goals",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    constraintsJson: text("constraints_json").notNull().default("[]"),
    acceptanceCriteriaJson: text("acceptance_criteria_json").notNull().default("[]"),
    detailsJson: text("details_json").notNull().default("{}"),
    status: text("status").notNull().default("active"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
  },
  (table) => ({
    idx_project_manager_goals_user_project: uniqueIndex("idx_project_manager_goals_user_project").on(
      table.userId,
      table.projectId
    )
  })
);

export const projectManagerWorkItems = sqliteTable(
  "project_manager_work_items",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("todo"),
    priority: integer("priority").notNull().default(0),
    acceptanceCriteriaJson: text("acceptance_criteria_json").notNull().default("[]"),
    evidenceRefsJson: text("evidence_refs_json").notNull().default("[]"),
    feishuRefsJson: text("feishu_refs_json").notNull().default("[]"),
    detailsJson: text("details_json").notNull().default("{}"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
  },
  (table) => ({
    idx_project_manager_work_items_user_project: index("idx_project_manager_work_items_user_project").on(
      table.userId,
      table.projectId
    ),
    idx_project_manager_work_items_status: index("idx_project_manager_work_items_status").on(
      table.userId,
      table.projectId,
      table.status
    )
  })
);

export const projectManagerLedgerEvents = sqliteTable(
  "project_manager_ledger_events",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    workItemId: text("work_item_id").references(() => projectManagerWorkItems.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    status: text("status"),
    evidenceRefsJson: text("evidence_refs_json").notNull().default("[]"),
    feishuRefsJson: text("feishu_refs_json").notNull().default("[]"),
    detailsJson: text("details_json").notNull().default("{}"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date())
  },
  (table) => ({
    idx_project_manager_ledger_events_user_project: index("idx_project_manager_ledger_events_user_project").on(
      table.userId,
      table.projectId
    ),
    idx_project_manager_ledger_events_type: index("idx_project_manager_ledger_events_type").on(
      table.userId,
      table.projectId,
      table.eventType
    ),
    idx_project_manager_ledger_events_created: index("idx_project_manager_ledger_events_created").on(
      table.userId,
      table.projectId,
      table.createdAt
    )
  })
);

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

// Project Manager execution state is persisted separately from chat runs and human-readable ledger events.
export const projectManagerTaskAttempts = sqliteTable(
  "project_manager_task_attempts",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    workItemId: text("work_item_id")
      .notNull()
      .references(() => projectManagerWorkItems.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    desiredState: text("desired_state").notNull().default("prepared"),
    observedState: text("observed_state").notNull().default("prepared"),
    inputVersion: integer("input_version").notNull().default(1),
    inputDigest: text("input_digest").notNull(),
    // Non-terminal attempts set a stable slot; terminal transitions clear it so history can accumulate.
    activeSlot: text("active_slot"),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    reconcileCount: integer("reconcile_count").notNull().default(0),
    decisionCount: integer("decision_count").notNull().default(0),
    followUpCount: integer("follow_up_count").notNull().default(0),
    retryCount: integer("retry_count").notNull().default(0),
    deadlineAt: integer("deadline_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
    completedAt: integer("completed_at", { mode: "timestamp" })
  },
  (table) => ({
    idx_project_manager_task_attempts_work_item_number: uniqueIndex(
      "idx_project_manager_task_attempts_work_item_number"
    ).on(table.userId, table.workItemId, table.attemptNumber),
    idx_project_manager_task_attempts_user_active: uniqueIndex(
      "idx_project_manager_task_attempts_user_active"
    ).on(table.userId, table.activeSlot)
  })
);

export const projectManagerSessionAssignments = sqliteTable(
  "project_manager_session_assignments",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    workItemId: text("work_item_id")
      .notNull()
      .references(() => projectManagerWorkItems.id, { onDelete: "cascade" }),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => projectManagerTaskAttempts.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    adapter: text("adapter").notNull(),
    capabilitiesJson: text("capabilities_json").notNull().default("{}"),
    leaseToken: text("lease_token").notNull(),
    leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp" }).notNull(),
    // Active slots enforce one project assignment and one owner per session without partial indexes.
    activeSlot: text("active_slot"),
    releasedReason: text("released_reason"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
    releasedAt: integer("released_at", { mode: "timestamp" })
  },
  (table) => ({
    idx_project_manager_session_assignments_attempt: index(
      "idx_project_manager_session_assignments_attempt"
    ).on(table.userId, table.attemptId),
    idx_project_manager_session_assignments_project_active: uniqueIndex(
      "idx_project_manager_session_assignments_project_active"
    ).on(table.userId, table.projectId, table.activeSlot),
    idx_project_manager_session_assignments_session_active: uniqueIndex(
      "idx_project_manager_session_assignments_session_active"
    ).on(table.userId, table.sessionId, table.activeSlot)
  })
);

export const projectManagerCommands = sqliteTable(
  "project_manager_commands",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    workItemId: text("work_item_id")
      .notNull()
      .references(() => projectManagerWorkItems.id, { onDelete: "cascade" }),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => projectManagerTaskAttempts.id, { onDelete: "cascade" }),
    assignmentId: text("assignment_id").references(() => projectManagerSessionAssignments.id, { onDelete: "set null" }),
    approvalId: text("approval_id").references(() => copilotPendingActions.id, { onDelete: "set null" }),
    commandType: text("command_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payloadDigest: text("payload_digest").notNull(),
    status: text("status").notNull().default("pending"),
    resultJson: text("result_json"),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
    completedAt: integer("completed_at", { mode: "timestamp" })
  },
  (table) => ({
    idx_project_manager_commands_idempotency: uniqueIndex(
      "idx_project_manager_commands_idempotency"
    ).on(table.userId, table.attemptId, table.idempotencyKey),
    idx_project_manager_commands_attempt_created: index(
      "idx_project_manager_commands_attempt_created"
    ).on(table.userId, table.attemptId, table.createdAt)
  })
);

export const projectManagerAcceptanceResults = sqliteTable(
  "project_manager_acceptance_results",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    workItemId: text("work_item_id")
      .notNull()
      .references(() => projectManagerWorkItems.id, { onDelete: "cascade" }),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => projectManagerTaskAttempts.id, { onDelete: "cascade" }),
    verdict: text("verdict").notNull(),
    criteriaJson: text("criteria_json").notNull().default("[]"),
    verificationJson: text("verification_json").notNull().default("[]"),
    evidenceRefsJson: text("evidence_refs_json").notNull().default("[]"),
    policyJson: text("policy_json").notNull().default("{}"),
    summary: text("summary"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
  },
  (table) => ({
    idx_project_manager_acceptance_attempt: index("idx_project_manager_acceptance_attempt").on(
      table.userId,
      table.attemptId,
      table.createdAt
    )
  })
);

export const projectManagerWakeups = sqliteTable(
  "project_manager_wakeups",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    workItemId: text("work_item_id")
      .notNull()
      .references(() => projectManagerWorkItems.id, { onDelete: "cascade" }),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => projectManagerTaskAttempts.id, { onDelete: "cascade" }),
    reasonClass: text("reason_class").notNull(),
    status: text("status").notNull().default("pending"),
    // Pending/claimed rows retain a slot; completion clears it so the same reason can wake again later.
    activeSlot: text("active_slot"),
    notBefore: integer("not_before", { mode: "timestamp" }).notNull(),
    claimToken: text("claim_token"),
    claimExpiresAt: integer("claim_expires_at", { mode: "timestamp" }),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
    completedAt: integer("completed_at", { mode: "timestamp" })
  },
  (table) => ({
    idx_project_manager_wakeups_pending: uniqueIndex("idx_project_manager_wakeups_pending").on(
      table.userId,
      table.attemptId,
      table.reasonClass,
      table.activeSlot
    ),
    idx_project_manager_wakeups_attempt_due: index("idx_project_manager_wakeups_attempt_due").on(
      table.userId,
      table.attemptId,
      table.status,
      table.notBefore
    )
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

export const integrationFeishuConfigs = sqliteTable(
  "integration_feishu_configs",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    emergencyDisabled: integer("emergency_disabled", { mode: "boolean" }).notNull().default(false),
    identityMode: text("identity_mode").notNull().default("unknown"),
    allowedChatIds: text("allowed_chat_ids").notNull().default("[]"),
    commandPrefix: text("command_prefix").notNull().default("/openforge"),
    publicWebhookId: text("public_webhook_id"),
    publicWebhookEnabled: integer("public_webhook_enabled", { mode: "boolean" }).notNull().default(false),
    verificationTokenEncrypted: text("verification_token_encrypted"),
    eventEncryptKeyEncrypted: text("event_encrypt_key_encrypted"),
    webhookConfiguredAt: integer("webhook_configured_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
  },
  (table) => ({
    idx_integration_feishu_configs_user: uniqueIndex("idx_integration_feishu_configs_user").on(table.userId),
    idx_integration_feishu_configs_public_webhook: uniqueIndex("idx_integration_feishu_configs_public_webhook").on(table.publicWebhookId)
  })
);

export const integrationFeishuUserMappings = sqliteTable(
  "integration_feishu_user_mappings",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    feishuUserId: text("feishu_user_id").notNull(),
    openforgeUserId: text("openforge_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
  },
  (table) => ({
    idx_integration_feishu_user_mappings_feishu_user: uniqueIndex("idx_integration_feishu_user_mappings_feishu_user").on(
      table.userId,
      table.feishuUserId
    ),
    idx_integration_feishu_user_mappings_openforge_user: index("idx_integration_feishu_user_mappings_openforge_user").on(
      table.userId,
      table.openforgeUserId
    )
  })
);

export const integrationFeishuWebhookReplayEntries = sqliteTable(
  "integration_feishu_webhook_replay_entries",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    publicWebhookId: text("public_webhook_id").notNull(),
    replayKey: text("replay_key").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date())
  },
  (table) => ({
    idx_integration_feishu_webhook_replay_unique: uniqueIndex("idx_integration_feishu_webhook_replay_unique").on(
      table.userId,
      table.publicWebhookId,
      table.replayKey
    ),
    idx_integration_feishu_webhook_replay_expiry: index("idx_integration_feishu_webhook_replay_expiry").on(table.expiresAt)
  })
);

export const integrationFeishuWebhookRateWindows = sqliteTable(
  "integration_feishu_webhook_rate_windows",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    publicWebhookId: text("public_webhook_id").notNull(),
    scope: text("scope").notNull(),
    scopeId: text("scope_id").notNull(),
    windowStartedAt: integer("window_started_at", { mode: "timestamp" }).notNull(),
    count: integer("count").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
  },
  (table) => ({
    idx_integration_feishu_webhook_rate_unique: uniqueIndex("idx_integration_feishu_webhook_rate_unique").on(
      table.userId,
      table.publicWebhookId,
      table.scope,
      table.scopeId
    )
  })
);

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

export const tokenUsageRecords = sqliteTable(
  "token_usage_records",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    adapter: text("adapter").notNull(),
    sessionId: text("session_id"),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    projectPath: text("project_path").notNull().default(""),
    modelId: text("model_id"),
    requestId: text("request_id").notNull(),
    occurredAt: integer("occurred_at", { mode: "timestamp" }).notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    reasoningTokens: integer("reasoning_tokens").notNull().default(0),
    sourceFile: text("source_file").notNull(),
    watermark: text("watermark").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date())
  },
  (table) => ({
    idx_token_usage_user_adapter_request: uniqueIndex("idx_token_usage_user_adapter_request").on(
      table.userId,
      table.adapter,
      table.requestId
    ),
    idx_token_usage_user_adapter_occurred: index("idx_token_usage_user_adapter_occurred").on(
      table.userId,
      table.adapter,
      table.occurredAt
    ),
    idx_token_usage_user_project_occurred: index("idx_token_usage_user_project_occurred").on(
      table.userId,
      table.projectPath,
      table.occurredAt
    )
  })
);

export const usageSyncCursors = sqliteTable(
  "usage_sync_cursors",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    adapter: text("adapter").notNull(),
    watermark: text("watermark").notNull().default(""),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
  },
  (table) => ({
    idx_usage_sync_cursors_user_adapter: uniqueIndex("idx_usage_sync_cursors_user_adapter").on(table.userId, table.adapter)
  })
);
