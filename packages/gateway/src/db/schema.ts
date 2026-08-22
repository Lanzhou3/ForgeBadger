import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
}, (table) => ({
  idx_api_keys_user_provider: index("idx_api_keys_user_provider").on(table.userId, table.provider)
}));

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
}, (table) => ({ idx_templates_user: index("idx_templates_user").on(table.userId) }));

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
}, (table) => ({ idx_projects_user_path: uniqueIndex("idx_projects_user_path").on(table.userId, table.path), idx_projects_user_id: uniqueIndex("idx_projects_user_id").on(table.userId, table.id) }));

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
    stageId: text("stage_id"),
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
    ),
    idx_project_manager_work_items_stage: index("idx_project_manager_work_items_stage").on(
      table.userId,
      table.projectId,
      table.stageId
    )
  })
);

export const projectManagerStages = sqliteTable(
  "project_manager_stages",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    position: integer("position").notNull().default(0),
    status: text("status").notNull().default("active"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
  },
  (table) => ({
    idx_project_manager_stages_user_project: index("idx_project_manager_stages_user_project").on(
      table.userId,
      table.projectId,
      table.position
    )
  })
);

export const projectManagerWorkItemLinks = sqliteTable(
  "project_manager_work_item_links",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    blockerWorkItemId: text("blocker_work_item_id")
      .notNull()
      .references(() => projectManagerWorkItems.id, { onDelete: "cascade" }),
    blockedWorkItemId: text("blocked_work_item_id")
      .notNull()
      .references(() => projectManagerWorkItems.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date())
  },
  (table) => ({
    idx_project_manager_work_item_links_pair: uniqueIndex("idx_project_manager_work_item_links_pair").on(
      table.projectId,
      table.blockerWorkItemId,
      table.blockedWorkItemId
    ),
    idx_project_manager_work_item_links_blocked: index("idx_project_manager_work_item_links_blocked").on(
      table.userId,
      table.projectId,
      table.blockedWorkItemId
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
    // Tenant owner. A project belongs to exactly one user, so the row carries
    // that user and the project FK is composite to enforce it at the DB layer.
    // skill_id stays a simple FK so a user may attach shared/admin skills that
    // belong to other users (the project's own skills are always same-user).
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    isEnabled: integer("is_enabled", { mode: "boolean" }).notNull().default(true)
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.projectId, table.skillId] }),
    projectParent: foreignKey({
      columns: [table.userId, table.projectId],
      foreignColumns: [projects.userId, projects.id]
    }).onDelete("cascade")
  })
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
    idx_notifications_user_read: index("idx_notifications_user_read").on(table.userId, table.isRead),
    idx_notifications_session: index("idx_notifications_session").on(table.sessionId)
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
    modelId: text("model_id").references(() => modelProfiles.id),
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
    idx_sessions_user_project_id: uniqueIndex("idx_sessions_user_project_id").on(table.userId, table.projectId, table.id),
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
    // Retains historical command ids without keeping a retired runtime table reference.
    approvalId: text("approval_id"),
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
      .references(() => modelProfiles.id, { onDelete: "cascade" }),
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
  modelId: text("model_id").references(() => modelProfiles.id),
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
    appId: text("app_id"),
    appSecretEncrypted: text("app_secret_encrypted"),
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

export const feishuChannelAccounts = sqliteTable(
  "feishu_channel_accounts",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    appId: text("app_id").notNull(),
    appSecretEncrypted: text("app_secret_encrypted").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    connectionState: text("connection_state").notNull().default("disabled"),
    lastConnectedAt: integer("last_connected_at", { mode: "timestamp" }),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    configRevision: integer("config_revision").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
  },
  (table) => ({
    idxFeishuChannelAccountsUser: uniqueIndex("idx_feishu_channel_accounts_user").on(table.userId),
    idxFeishuChannelAccountsApp: uniqueIndex("idx_feishu_channel_accounts_app").on(table.userId, table.appId)
  })
);

export const feishuChannelInbox = sqliteTable(
  "feishu_channel_inbox",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull().references(() => feishuChannelAccounts.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    messageId: text("message_id"),
    eventType: text("event_type").notNull(),
    laneKey: text("lane_key").notNull(),
    chatId: text("chat_id").notNull(),
    threadId: text("thread_id"),
    senderOpenId: text("sender_open_id"),
    contentEncrypted: text("content_encrypted").notNull(),
    status: text("status").notNull().default("pending"),
    notBefore: integer("not_before", { mode: "timestamp" }).notNull(),
    claimToken: text("claim_token"),
    claimExpiresAt: integer("claim_expires_at", { mode: "timestamp" }),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastErrorCode: text("last_error_code"),
    retentionUntil: integer("retention_until", { mode: "timestamp" }).notNull(),
    conversationId: text("conversation_id"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
    completedAt: integer("completed_at", { mode: "timestamp" })
  },
  (table) => ({
    idxFeishuInboxEvent: uniqueIndex("idx_feishu_channel_inbox_event").on(table.userId, table.accountId, table.eventId),
    idxFeishuInboxDue: index("idx_feishu_channel_inbox_due").on(table.userId, table.status, table.notBefore),
    idxFeishuInboxLane: index("idx_feishu_channel_inbox_lane").on(table.userId, table.accountId, table.laneKey, table.createdAt)
  })
);

export const feishuChannelLogicalClaims = sqliteTable(
  "feishu_channel_logical_claims",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull().references(() => feishuChannelAccounts.id, { onDelete: "cascade" }),
    messageId: text("message_id").notNull(),
    inboxId: text("inbox_id").notNull().references(() => feishuChannelInbox.id, { onDelete: "cascade" }),
    adoptedAt: integer("adopted_at", { mode: "timestamp" }).notNull()
  },
  (table) => ({
    idxFeishuLogicalMessage: uniqueIndex("idx_feishu_channel_logical_message").on(table.userId, table.accountId, table.messageId)
  })
);

export const feishuChannelOutbox = sqliteTable(
  "feishu_channel_outbox",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull().references(() => feishuChannelAccounts.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    chatId: text("chat_id").notNull(),
    threadId: text("thread_id"),
    payloadEncrypted: text("payload_encrypted").notNull(),
    status: text("status").notNull().default("pending"),
    nextPartIndex: integer("next_part_index").notNull().default(0),
    providerMessageIds: text("provider_message_ids").notNull().default("[]"),
    notBefore: integer("not_before", { mode: "timestamp" }).notNull(),
    claimToken: text("claim_token"),
    claimExpiresAt: integer("claim_expires_at", { mode: "timestamp" }),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastErrorCode: text("last_error_code"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
    completedAt: integer("completed_at", { mode: "timestamp" })
  },
  (table) => ({
    idxFeishuOutboxKey: uniqueIndex("idx_feishu_channel_outbox_key").on(table.userId, table.accountId, table.idempotencyKey),
    idxFeishuOutboxDue: index("idx_feishu_channel_outbox_due").on(table.userId, table.status, table.notBefore)
  })
);

export const feishuCardActions = sqliteTable(
  "feishu_card_actions",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull().references(() => feishuChannelAccounts.id, { onDelete: "cascade" }),
    chatId: text("chat_id").notNull(),
    threadId: text("thread_id"),
    operatorOpenId: text("operator_open_id").notNull(),
    actionType: text("action_type").notNull(),
    resourceId: text("resource_id").notNull(),
    payloadDigest: text("payload_digest").notNull(),
    resourceRevision: integer("resource_revision").notNull(),
    permissionSnapshot: text("permission_snapshot").notNull(),
    nonce: text("nonce").notNull(),
    cardMessageId: text("card_message_id"),
    status: text("status").notNull().default("pending"),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    claimedAt: integer("claimed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
  },
  (table) => ({
    idxFeishuCardNonce: uniqueIndex("idx_feishu_card_nonce").on(table.userId, table.nonce),
    idxFeishuCardMessage: index("idx_feishu_card_message").on(table.userId, table.accountId, table.cardMessageId),
    idxFeishuCardExpiry: index("idx_feishu_card_expiry").on(table.userId, table.status, table.expiresAt)
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

// Portfolio Operations is an isolated canonical workflow domain. These Drizzle
// declarations mirror migration 0032 and remain isolated from retired persistence.
export const portfolioProjects = sqliteTable("portfolio_projects", {
  projectId: text("project_id").primaryKey(), userId: text("user_id").notNull(), ownerUserId: text("owner_user_id").notNull(),
  enrollmentStatus: text("enrollment_status").notNull().default("pending_evidence"), createdAt: integer("created_at", { mode: "timestamp" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
}, (table) => ({ userProject: uniqueIndex("idx_portfolio_projects_user_project").on(table.userId, table.projectId), status: index("idx_portfolio_projects_user_status").on(table.userId, table.enrollmentStatus), projectParent: foreignKey({ columns: [table.userId, table.projectId], foreignColumns: [projects.userId, projects.id] }).onDelete("cascade") }));

export const portfolioOperationRecords = sqliteTable("portfolio_operation_records", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), operation: text("operation").notNull(), idempotencyKey: text("idempotency_key").notNull(), payloadDigest: text("payload_digest").notNull(), resultJson: text("result_json").notNull(), createdAt: integer("created_at", { mode: "timestamp" }).notNull()
}, (table) => ({ uniqueOperation: uniqueIndex("idx_portfolio_operations_user_operation_key").on(table.userId, table.operation, table.idempotencyKey) }));

export const portfolioProjectDossiers = sqliteTable("portfolio_project_dossiers", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), projectId: text("project_id").notNull(), objective: text("objective").notNull(), intendedOutcome: text("intended_outcome").notNull(), scopeJson: text("scope_json").notNull(), observedStateJson: text("observed_state_json").notNull(), projectionVersion: integer("projection_version").notNull().default(1), createdAt: integer("created_at", { mode: "timestamp" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
}, (table) => ({ project: uniqueIndex("idx_portfolio_dossiers_user_project").on(table.userId, table.projectId), projectParent: foreignKey({ columns: [table.userId, table.projectId], foreignColumns: [portfolioProjects.userId, portfolioProjects.projectId] }).onDelete("cascade") }));

export const portfolioRequests = sqliteTable("portfolio_requests", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), projectId: text("project_id"), requesterId: text("requester_id"), source: text("source").notNull(), sourceEventId: text("source_event_id"), requestText: text("request_text").notNull(), sourceMetadataJson: text("source_metadata_json").notNull(), state: text("state").notNull(), projectionVersion: integer("projection_version").notNull().default(1), correlationId: text("correlation_id").notNull(), idempotencyKey: text("idempotency_key").notNull(), inputDigest: text("input_digest").notNull(), receivedAt: integer("received_at", { mode: "timestamp" }).notNull(), createdAt: integer("created_at", { mode: "timestamp" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
}, (table) => ({ idempotency: uniqueIndex("idx_portfolio_requests_user_idempotency").on(table.userId, table.idempotencyKey), sourceEvent: uniqueIndex("idx_portfolio_requests_source_event").on(table.userId, table.source, table.sourceEventId).where(sql`${table.sourceEventId} IS NOT NULL`), scope: index("idx_portfolio_requests_user_project_created").on(table.userId, table.projectId, table.createdAt), userProjectRequest: uniqueIndex("idx_portfolio_requests_user_project_id").on(table.userId, table.projectId, table.id), projectParent: foreignKey({ columns: [table.userId, table.projectId], foreignColumns: [portfolioProjects.userId, portfolioProjects.projectId] }).onDelete("cascade") }));

export const portfolioIntakeDecisions = sqliteTable("portfolio_intake_decisions", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), requestId: text("request_id").notNull(), selectedProjectId: text("selected_project_id"), candidateProjectIdsJson: text("candidate_project_ids_json").notNull(), scopeAssessment: text("scope_assessment").notNull(), producer: text("producer").notNull(), evidenceIdsJson: text("evidence_ids_json").notNull(), state: text("state").notNull().default("awaiting_owner"), projectionVersion: integer("projection_version").notNull().default(1), idempotencyKey: text("idempotency_key").notNull(), inputDigest: text("input_digest").notNull(), createdAt: integer("created_at", { mode: "timestamp" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
}, (table) => ({ idempotency: uniqueIndex("idx_portfolio_intake_user_idempotency").on(table.userId, table.idempotencyKey), requestParent: foreignKey({ columns: [table.userId, table.requestId], foreignColumns: [portfolioRequests.userId, portfolioRequests.id] }).onDelete("cascade"), projectParent: foreignKey({ columns: [table.userId, table.selectedProjectId], foreignColumns: [portfolioProjects.userId, portfolioProjects.projectId] }).onDelete("cascade") }));

export const portfolioWorkItems = sqliteTable("portfolio_work_items", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), projectId: text("project_id").notNull(), requestId: text("request_id").notNull(), ownerUserId: text("owner_user_id").notNull(), title: text("title").notNull(), description: text("description"), acceptanceCriteriaJson: text("acceptance_criteria_json").notNull(), verificationRequirementsJson: text("verification_requirements_json").notNull(), state: text("state").notNull(), projectionVersion: integer("projection_version").notNull().default(1), idempotencyKey: text("idempotency_key").notNull(), inputDigest: text("input_digest").notNull(), createdAt: integer("created_at", { mode: "timestamp" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
}, (table) => ({ idempotency: uniqueIndex("idx_portfolio_work_items_user_idempotency").on(table.userId, table.idempotencyKey), scope: index("idx_portfolio_work_items_user_project_state").on(table.userId, table.projectId, table.state), scopeIdentity: uniqueIndex("idx_portfolio_work_items_user_project_id").on(table.userId, table.projectId, table.id), projectParent: foreignKey({ columns: [table.userId, table.projectId], foreignColumns: [portfolioProjects.userId, portfolioProjects.projectId] }).onDelete("cascade"), requestParent: foreignKey({ columns: [table.userId, table.projectId, table.requestId], foreignColumns: [portfolioRequests.userId, portfolioRequests.projectId, portfolioRequests.id] }).onDelete("cascade") }));

export const portfolioTaskPackets = sqliteTable("portfolio_task_packets", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), projectId: text("project_id").notNull(), workItemId: text("work_item_id").notNull(), packetVersion: integer("packet_version").notNull(), packetDigest: text("packet_digest").notNull(), skillVersion: text("skill_version").notNull(), sourceWorkItemVersion: integer("source_work_item_version").notNull(), dossierVersion: integer("dossier_version").notNull(), canonicalPacketJson: text("canonical_packet_json").notNull(), manifestVersion: text("manifest_version").notNull(), manifestDigest: text("manifest_digest").notNull(), createdBy: text("created_by").notNull(), createdAt: integer("created_at", { mode: "timestamp" }).notNull()
}, (table) => ({ userPacket: uniqueIndex("idx_portfolio_packets_user_id").on(table.userId, table.id), scopeIdentity: uniqueIndex("idx_portfolio_packets_user_project_work_item_id").on(table.userId, table.projectId, table.workItemId, table.id), version: uniqueIndex("idx_portfolio_packets_work_item_version").on(table.userId, table.workItemId, table.packetVersion), digest: uniqueIndex("idx_portfolio_packets_work_item_digest").on(table.userId, table.workItemId, table.packetDigest), projectParent: foreignKey({ columns: [table.userId, table.projectId], foreignColumns: [portfolioProjects.userId, portfolioProjects.projectId] }).onDelete("cascade"), workItemParent: foreignKey({ columns: [table.userId, table.projectId, table.workItemId], foreignColumns: [portfolioWorkItems.userId, portfolioWorkItems.projectId, portfolioWorkItems.id] }).onDelete("cascade") }));

export const portfolioTaskAttempts = sqliteTable("portfolio_task_attempts", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), projectId: text("project_id").notNull(), workItemId: text("work_item_id").notNull(), requestId: text("request_id"), packetId: text("packet_id"), attemptNumber: integer("attempt_number").notNull(), sourceWorkItemVersion: integer("source_work_item_version").notNull(), packetVersion: integer("packet_version").notNull(), packetDigest: text("packet_digest").notNull(), adapter: text("adapter").notNull(), createdBy: text("created_by").notNull(), trackingEnabled: integer("tracking_enabled", { mode: "boolean" }).notNull().default(false), state: text("state").notNull(), projectionVersion: integer("projection_version").notNull().default(1), idempotencyKey: text("idempotency_key").notNull(), inputDigest: text("input_digest").notNull(), createdAt: integer("created_at", { mode: "timestamp" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(), completedAt: integer("completed_at", { mode: "timestamp" })
}, (table) => ({ number: uniqueIndex("idx_portfolio_attempts_work_item_number").on(table.userId, table.workItemId, table.attemptNumber), idempotency: uniqueIndex("idx_portfolio_attempts_user_idempotency").on(table.userId, table.idempotencyKey), scopeIdentity: uniqueIndex("idx_portfolio_attempts_user_project_work_item_id").on(table.userId, table.projectId, table.workItemId, table.id), projectIdentity: uniqueIndex("idx_portfolio_attempts_user_project_id").on(table.userId, table.projectId, table.id), packetParent: foreignKey({ columns: [table.userId, table.projectId, table.workItemId, table.packetId], foreignColumns: [portfolioTaskPackets.userId, portfolioTaskPackets.projectId, portfolioTaskPackets.workItemId, portfolioTaskPackets.id] }).onDelete("cascade"), projectParent: foreignKey({ columns: [table.userId, table.projectId], foreignColumns: [portfolioProjects.userId, portfolioProjects.projectId] }).onDelete("cascade"), workItemParent: foreignKey({ columns: [table.userId, table.projectId, table.workItemId], foreignColumns: [portfolioWorkItems.userId, portfolioWorkItems.projectId, portfolioWorkItems.id] }).onDelete("cascade"), requestParent: foreignKey({ columns: [table.userId, table.projectId, table.requestId], foreignColumns: [portfolioRequests.userId, portfolioRequests.projectId, portfolioRequests.id] }).onDelete("cascade") }));

export const portfolioSessionAssignments = sqliteTable("portfolio_session_assignments", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), projectId: text("project_id").notNull(), workItemId: text("work_item_id").notNull(), attemptId: text("attempt_id").notNull(), sessionId: text("session_id").notNull(), adapter: text("adapter").notNull(), leaseTokenDigest: text("lease_token_digest").notNull(), leaseGeneration: integer("lease_generation").notNull(), leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp" }).notNull(), activeAttemptSlot: text("active_attempt_slot"), activeSessionSlot: text("active_session_slot"), releasedReason: text("released_reason"), projectionVersion: integer("projection_version").notNull().default(1), createdAt: integer("created_at", { mode: "timestamp" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(), releasedAt: integer("released_at", { mode: "timestamp" })
}, (table) => ({ attempt: uniqueIndex("idx_portfolio_assignment_attempt_active").on(table.userId, table.attemptId, table.activeAttemptSlot), session: uniqueIndex("idx_portfolio_assignment_session_active").on(table.userId, table.sessionId, table.activeSessionSlot), scopeIdentity: uniqueIndex("idx_portfolio_assignments_user_project_work_item_attempt_id").on(table.userId, table.projectId, table.workItemId, table.attemptId, table.id), projectParent: foreignKey({ columns: [table.userId, table.projectId], foreignColumns: [portfolioProjects.userId, portfolioProjects.projectId] }).onDelete("cascade"), workItemParent: foreignKey({ columns: [table.userId, table.projectId, table.workItemId], foreignColumns: [portfolioWorkItems.userId, portfolioWorkItems.projectId, portfolioWorkItems.id] }).onDelete("cascade"), attemptParent: foreignKey({ columns: [table.userId, table.projectId, table.workItemId, table.attemptId], foreignColumns: [portfolioTaskAttempts.userId, portfolioTaskAttempts.projectId, portfolioTaskAttempts.workItemId, portfolioTaskAttempts.id] }).onDelete("cascade"), sessionParent: foreignKey({ columns: [table.userId, table.projectId, table.sessionId], foreignColumns: [sessions.userId, sessions.projectId, sessions.id] }).onDelete("cascade") }));

export const portfolioActionIntents = sqliteTable("portfolio_action_intents", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), projectId: text("project_id").notNull(), workItemId: text("work_item_id"), attemptId: text("attempt_id"), sessionId: text("session_id"), actionClass: text("action_class").notNull(), resourceScopeJson: text("resource_scope_json").notNull(), payloadDigest: text("payload_digest").notNull(), assignmentLeaseTokenDigest: text("assignment_lease_token_digest"), policyRule: text("policy_rule"), issuedAt: integer("issued_at", { mode: "timestamp" }).notNull(), expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(), createdAt: integer("created_at", { mode: "timestamp" }).notNull()
}, (table) => ({ scopeIdentity: uniqueIndex("idx_portfolio_action_intents_user_project_work_item_attempt_id").on(table.userId, table.projectId, table.workItemId, table.attemptId, table.id), projectParent: foreignKey({ columns: [table.userId, table.projectId], foreignColumns: [portfolioProjects.userId, portfolioProjects.projectId] }).onDelete("cascade"), workItemParent: foreignKey({ columns: [table.userId, table.projectId, table.workItemId], foreignColumns: [portfolioWorkItems.userId, portfolioWorkItems.projectId, portfolioWorkItems.id] }).onDelete("cascade"), attemptParent: foreignKey({ columns: [table.userId, table.projectId, table.workItemId, table.attemptId], foreignColumns: [portfolioTaskAttempts.userId, portfolioTaskAttempts.projectId, portfolioTaskAttempts.workItemId, portfolioTaskAttempts.id] }).onDelete("cascade"), sessionParent: foreignKey({ columns: [table.userId, table.projectId, table.sessionId], foreignColumns: [sessions.userId, sessions.projectId, sessions.id] }).onDelete("cascade") }));

export const portfolioExecutionAuthorizations = sqliteTable("portfolio_execution_authorizations", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), projectId: text("project_id").notNull(), workItemId: text("work_item_id"), attemptId: text("attempt_id"), actionIntentId: text("action_intent_id").notNull(), authorizationTier: text("authorization_tier").notNull(), actionDigest: text("action_digest").notNull(), policyRule: text("policy_rule"), state: text("state").notNull(), projectionVersion: integer("projection_version").notNull().default(1), expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(), consumedAt: integer("consumed_at", { mode: "timestamp" }), idempotencyKey: text("idempotency_key").notNull(), inputDigest: text("input_digest").notNull(), createdAt: integer("created_at", { mode: "timestamp" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
}, (table) => ({ idempotency: uniqueIndex("idx_portfolio_authorization_user_idempotency").on(table.userId, table.idempotencyKey), scopeIdentity: uniqueIndex("idx_portfolio_authorizations_user_project_work_item_attempt_id").on(table.userId, table.projectId, table.workItemId, table.attemptId, table.id), projectParent: foreignKey({ columns: [table.userId, table.projectId], foreignColumns: [portfolioProjects.userId, portfolioProjects.projectId] }).onDelete("cascade"), workItemParent: foreignKey({ columns: [table.userId, table.projectId, table.workItemId], foreignColumns: [portfolioWorkItems.userId, portfolioWorkItems.projectId, portfolioWorkItems.id] }).onDelete("cascade"), attemptParent: foreignKey({ columns: [table.userId, table.projectId, table.workItemId, table.attemptId], foreignColumns: [portfolioTaskAttempts.userId, portfolioTaskAttempts.projectId, portfolioTaskAttempts.workItemId, portfolioTaskAttempts.id] }).onDelete("cascade"), actionIntentParent: foreignKey({ columns: [table.userId, table.projectId, table.workItemId, table.attemptId, table.actionIntentId], foreignColumns: [portfolioActionIntents.userId, portfolioActionIntents.projectId, portfolioActionIntents.workItemId, portfolioActionIntents.attemptId, portfolioActionIntents.id] }).onDelete("cascade") }));

export const portfolioCommands = sqliteTable("portfolio_commands", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), projectId: text("project_id").notNull(), workItemId: text("work_item_id").notNull(), attemptId: text("attempt_id").notNull(), assignmentId: text("assignment_id"), authorizationId: text("authorization_id"), actionIntentId: text("action_intent_id").notNull(), commandType: text("command_type").notNull(), payloadDigest: text("payload_digest").notNull(), state: text("state").notNull(), dispatchReceiptDigest: text("dispatch_receipt_digest"), observedAt: integer("observed_at", { mode: "timestamp" }), projectionVersion: integer("projection_version").notNull().default(1), idempotencyKey: text("idempotency_key").notNull(), inputDigest: text("input_digest").notNull(), createdAt: integer("created_at", { mode: "timestamp" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(), completedAt: integer("completed_at", { mode: "timestamp" })
}, (table) => ({ idempotency: uniqueIndex("idx_portfolio_commands_user_idempotency").on(table.userId, table.idempotencyKey), scopeIdentity: uniqueIndex("idx_portfolio_commands_user_project_work_item_attempt_id").on(table.userId, table.projectId, table.workItemId, table.attemptId, table.id), projectParent: foreignKey({ columns: [table.userId, table.projectId], foreignColumns: [portfolioProjects.userId, portfolioProjects.projectId] }).onDelete("cascade"), workItemParent: foreignKey({ columns: [table.userId, table.projectId, table.workItemId], foreignColumns: [portfolioWorkItems.userId, portfolioWorkItems.projectId, portfolioWorkItems.id] }).onDelete("cascade"), attemptParent: foreignKey({ columns: [table.userId, table.projectId, table.workItemId, table.attemptId], foreignColumns: [portfolioTaskAttempts.userId, portfolioTaskAttempts.projectId, portfolioTaskAttempts.workItemId, portfolioTaskAttempts.id] }).onDelete("cascade"), assignmentParent: foreignKey({ columns: [table.userId, table.projectId, table.workItemId, table.attemptId, table.assignmentId], foreignColumns: [portfolioSessionAssignments.userId, portfolioSessionAssignments.projectId, portfolioSessionAssignments.workItemId, portfolioSessionAssignments.attemptId, portfolioSessionAssignments.id] }).onDelete("cascade"), authorizationParent: foreignKey({ columns: [table.userId, table.projectId, table.workItemId, table.attemptId, table.authorizationId], foreignColumns: [portfolioExecutionAuthorizations.userId, portfolioExecutionAuthorizations.projectId, portfolioExecutionAuthorizations.workItemId, portfolioExecutionAuthorizations.attemptId, portfolioExecutionAuthorizations.id] }).onDelete("cascade"), actionIntentParent: foreignKey({ columns: [table.userId, table.projectId, table.workItemId, table.attemptId, table.actionIntentId], foreignColumns: [portfolioActionIntents.userId, portfolioActionIntents.projectId, portfolioActionIntents.workItemId, portfolioActionIntents.attemptId, portfolioActionIntents.id] }).onDelete("cascade") }));
export const portfolioWorkerSignals = sqliteTable("portfolio_worker_signals", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), projectId: text("project_id").notNull(), workItemId: text("work_item_id").notNull(), attemptId: text("attempt_id").notNull(), sessionId: text("session_id").notNull(), assignmentId: text("assignment_id").notNull(), commandId: text("command_id").notNull(), adapter: text("adapter").notNull(), signalType: text("signal_type").notNull(), leaseGeneration: integer("lease_generation").notNull(), packetDigest: text("packet_digest").notNull(), capabilityDigest: text("capability_digest").notNull(), state: text("state").notNull(), expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(), launchIssuedAt: integer("launch_issued_at", { mode: "timestamp" }), acknowledgedAt: integer("acknowledged_at", { mode: "timestamp" }), consumedAt: integer("consumed_at", { mode: "timestamp" }), createdAt: integer("created_at", { mode: "timestamp" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
}, (table) => ({ commandType: uniqueIndex("idx_portfolio_worker_signal_command_type").on(table.userId, table.commandId, table.signalType), binding: index("idx_portfolio_worker_signal_binding").on(table.userId, table.attemptId, table.assignmentId, table.state, table.expiresAt), projectParent: foreignKey({ columns: [table.userId, table.projectId], foreignColumns: [portfolioProjects.userId, portfolioProjects.projectId] }).onDelete("cascade"), workItemParent: foreignKey({ columns: [table.userId, table.projectId, table.workItemId], foreignColumns: [portfolioWorkItems.userId, portfolioWorkItems.projectId, portfolioWorkItems.id] }).onDelete("cascade"), attemptParent: foreignKey({ columns: [table.userId, table.projectId, table.workItemId, table.attemptId], foreignColumns: [portfolioTaskAttempts.userId, portfolioTaskAttempts.projectId, portfolioTaskAttempts.workItemId, portfolioTaskAttempts.id] }).onDelete("cascade"), sessionParent: foreignKey({ columns: [table.userId, table.projectId, table.sessionId], foreignColumns: [sessions.userId, sessions.projectId, sessions.id] }).onDelete("cascade"), assignmentParent: foreignKey({ columns: [table.userId, table.projectId, table.workItemId, table.attemptId, table.assignmentId], foreignColumns: [portfolioSessionAssignments.userId, portfolioSessionAssignments.projectId, portfolioSessionAssignments.workItemId, portfolioSessionAssignments.attemptId, portfolioSessionAssignments.id] }).onDelete("cascade"), commandParent: foreignKey({ columns: [table.userId, table.projectId, table.workItemId, table.attemptId, table.commandId], foreignColumns: [portfolioCommands.userId, portfolioCommands.projectId, portfolioCommands.workItemId, portfolioCommands.attemptId, portfolioCommands.id] }).onDelete("cascade") }));

export const portfolioObservationProfiles = sqliteTable("portfolio_observation_profiles", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), projectId: text("project_id").notNull(), status: text("status").notNull(), approvedRootPath: text("approved_root_path"), approvedRootDevice: integer("approved_root_device"), approvedRootInode: integer("approved_root_inode"), projectionVersion: integer("projection_version").notNull().default(1), createdAt: integer("created_at", { mode: "timestamp" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
}, (table) => ({ projectParent: foreignKey({ columns: [table.userId, table.projectId], foreignColumns: [portfolioProjects.userId, portfolioProjects.projectId] }).onDelete("cascade") }));
export const portfolioObservationProbes = sqliteTable("portfolio_observation_probes", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), profileId: text("profile_id").notNull(), sourceCategory: text("source_category").notNull(), operation: text("operation").notNull(), rootRef: text("root_ref"), argumentsJson: text("arguments_json").notNull(), timeoutMs: integer("timeout_ms").notNull(), maxOutputBytes: integer("max_output_bytes").notNull(), redactionPolicy: text("redaction_policy").notNull(), freshnessMs: integer("freshness_ms").notNull(), enabled: integer("enabled", { mode: "boolean" }).notNull(), createdAt: integer("created_at", { mode: "timestamp" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
}, (table) => ({ profileParent: foreignKey({ columns: [table.userId, table.profileId], foreignColumns: [portfolioObservationProfiles.userId, portfolioObservationProfiles.id] }).onDelete("cascade") }));
export const portfolioEvidence = sqliteTable("portfolio_evidence", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), projectId: text("project_id").notNull(), requestId: text("request_id"), workItemId: text("work_item_id"), attemptId: text("attempt_id"), producer: text("producer").notNull(), sourceCategory: text("source_category").notNull(), observedAt: integer("observed_at", { mode: "timestamp" }).notNull(), collectedAt: integer("collected_at", { mode: "timestamp" }).notNull(), digest: text("digest").notNull(), redactedSummary: text("redacted_summary").notNull(), confidence: text("confidence").notNull(), freshness: text("freshness").notNull(), isBlocker: integer("is_blocker", { mode: "boolean" }).notNull(), verificationKey: text("verification_key"), idempotencyKey: text("idempotency_key").notNull(), inputDigest: text("input_digest").notNull(), createdAt: integer("created_at", { mode: "timestamp" }).notNull()
}, (table) => ({
  idempotency: uniqueIndex("idx_portfolio_evidence_user_idempotency").on(table.userId, table.idempotencyKey),
  projectIdentity: uniqueIndex("idx_portfolio_evidence_user_project_id").on(table.userId, table.projectId, table.id),
  projectParent: foreignKey({ columns: [table.userId, table.projectId], foreignColumns: [portfolioProjects.userId, portfolioProjects.projectId] }).onDelete("cascade"),
  // Migration 0032 triggers bind a routed request's project to this project.
  requestParent: foreignKey({ columns: [table.userId, table.requestId], foreignColumns: [portfolioRequests.userId, portfolioRequests.id] }).onDelete("cascade"),
  workItemParent: foreignKey({ columns: [table.userId, table.projectId, table.workItemId], foreignColumns: [portfolioWorkItems.userId, portfolioWorkItems.projectId, portfolioWorkItems.id] }).onDelete("cascade"),
  attemptProjectParent: foreignKey({ columns: [table.userId, table.projectId, table.attemptId], foreignColumns: [portfolioTaskAttempts.userId, portfolioTaskAttempts.projectId, portfolioTaskAttempts.id] }).onDelete("cascade"),
  attemptParent: foreignKey({ columns: [table.userId, table.projectId, table.workItemId, table.attemptId], foreignColumns: [portfolioTaskAttempts.userId, portfolioTaskAttempts.projectId, portfolioTaskAttempts.workItemId, portfolioTaskAttempts.id] }).onDelete("cascade")
}));
export const portfolioCompletionCandidates = sqliteTable("portfolio_completion_candidates", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), projectId: text("project_id").notNull(), requestId: text("request_id").notNull(), workItemId: text("work_item_id").notNull(), attemptId: text("attempt_id").notNull(), summary: text("summary").notNull(), evidenceIdsJson: text("evidence_ids_json").notNull(), state: text("state").notNull(), verifiedAt: integer("verified_at", { mode: "timestamp" }), projectionVersion: integer("projection_version").notNull().default(1), idempotencyKey: text("idempotency_key").notNull(), inputDigest: text("input_digest").notNull(), createdAt: integer("created_at", { mode: "timestamp" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
}, (table) => ({ scopeIdentity: uniqueIndex("idx_portfolio_candidates_user_project_work_item_id").on(table.userId, table.projectId, table.workItemId, table.id), attemptIdentity: uniqueIndex("idx_portfolio_candidates_user_project_work_item_attempt_id").on(table.userId, table.projectId, table.workItemId, table.attemptId, table.id), projectParent: foreignKey({ columns: [table.userId, table.projectId], foreignColumns: [portfolioProjects.userId, portfolioProjects.projectId] }).onDelete("cascade"), requestParent: foreignKey({ columns: [table.userId, table.projectId, table.requestId], foreignColumns: [portfolioRequests.userId, portfolioRequests.projectId, portfolioRequests.id] }).onDelete("cascade"), workItemParent: foreignKey({ columns: [table.userId, table.projectId, table.workItemId], foreignColumns: [portfolioWorkItems.userId, portfolioWorkItems.projectId, portfolioWorkItems.id] }).onDelete("cascade"), attemptProjectParent: foreignKey({ columns: [table.userId, table.projectId, table.attemptId], foreignColumns: [portfolioTaskAttempts.userId, portfolioTaskAttempts.projectId, portfolioTaskAttempts.id] }).onDelete("cascade"), attemptParent: foreignKey({ columns: [table.userId, table.projectId, table.workItemId, table.attemptId], foreignColumns: [portfolioTaskAttempts.userId, portfolioTaskAttempts.projectId, portfolioTaskAttempts.workItemId, portfolioTaskAttempts.id] }).onDelete("cascade") }));
export const portfolioAcceptanceDecisions = sqliteTable("portfolio_acceptance_decisions", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), projectId: text("project_id").notNull(), requestId: text("request_id").notNull(), workItemId: text("work_item_id").notNull(), attemptId: text("attempt_id").notNull(), candidateId: text("candidate_id").notNull(), decision: text("decision").notNull(), policyRule: text("policy_rule"), evidenceIdsJson: text("evidence_ids_json").notNull(), state: text("state").notNull(), projectionVersion: integer("projection_version").notNull().default(1), idempotencyKey: text("idempotency_key").notNull(), inputDigest: text("input_digest").notNull(), createdAt: integer("created_at", { mode: "timestamp" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
}, (table) => ({ projectParent: foreignKey({ columns: [table.userId, table.projectId], foreignColumns: [portfolioProjects.userId, portfolioProjects.projectId] }).onDelete("cascade"), requestParent: foreignKey({ columns: [table.userId, table.projectId, table.requestId], foreignColumns: [portfolioRequests.userId, portfolioRequests.projectId, portfolioRequests.id] }).onDelete("cascade"), workItemParent: foreignKey({ columns: [table.userId, table.projectId, table.workItemId], foreignColumns: [portfolioWorkItems.userId, portfolioWorkItems.projectId, portfolioWorkItems.id] }).onDelete("cascade"), attemptProjectParent: foreignKey({ columns: [table.userId, table.projectId, table.attemptId], foreignColumns: [portfolioTaskAttempts.userId, portfolioTaskAttempts.projectId, portfolioTaskAttempts.id] }).onDelete("cascade"), attemptParent: foreignKey({ columns: [table.userId, table.projectId, table.workItemId, table.attemptId], foreignColumns: [portfolioTaskAttempts.userId, portfolioTaskAttempts.projectId, portfolioTaskAttempts.workItemId, portfolioTaskAttempts.id] }).onDelete("cascade"), candidateParent: foreignKey({ columns: [table.userId, table.projectId, table.workItemId, table.candidateId], foreignColumns: [portfolioCompletionCandidates.userId, portfolioCompletionCandidates.projectId, portfolioCompletionCandidates.workItemId, portfolioCompletionCandidates.id] }).onDelete("cascade"), candidateAttemptParent: foreignKey({ columns: [table.userId, table.projectId, table.workItemId, table.attemptId, table.candidateId], foreignColumns: [portfolioCompletionCandidates.userId, portfolioCompletionCandidates.projectId, portfolioCompletionCandidates.workItemId, portfolioCompletionCandidates.attemptId, portfolioCompletionCandidates.id] }).onDelete("cascade") }));
export const portfolioRiskSignals = sqliteTable("portfolio_risk_signals", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), projectId: text("project_id").notNull(), workItemId: text("work_item_id"), attemptId: text("attempt_id"), evidenceId: text("evidence_id"), severity: text("severity").notNull(), rationale: text("rationale").notNull(), state: text("state").notNull(), projectionVersion: integer("projection_version").notNull().default(1), idempotencyKey: text("idempotency_key").notNull(), inputDigest: text("input_digest").notNull(), createdAt: integer("created_at", { mode: "timestamp" }).notNull()
}, (table) => ({ projectParent: foreignKey({ columns: [table.userId, table.projectId], foreignColumns: [portfolioProjects.userId, portfolioProjects.projectId] }).onDelete("cascade"), workItemParent: foreignKey({ columns: [table.userId, table.projectId, table.workItemId], foreignColumns: [portfolioWorkItems.userId, portfolioWorkItems.projectId, portfolioWorkItems.id] }).onDelete("cascade"), attemptProjectParent: foreignKey({ columns: [table.userId, table.projectId, table.attemptId], foreignColumns: [portfolioTaskAttempts.userId, portfolioTaskAttempts.projectId, portfolioTaskAttempts.id] }).onDelete("cascade"), attemptParent: foreignKey({ columns: [table.userId, table.projectId, table.workItemId, table.attemptId], foreignColumns: [portfolioTaskAttempts.userId, portfolioTaskAttempts.projectId, portfolioTaskAttempts.workItemId, portfolioTaskAttempts.id] }).onDelete("cascade"), evidenceParent: foreignKey({ columns: [table.userId, table.projectId, table.evidenceId], foreignColumns: [portfolioEvidence.userId, portfolioEvidence.projectId, portfolioEvidence.id] }).onDelete("cascade") }));
export const portfolioWorkflowWakeups = sqliteTable("portfolio_workflow_wakeups", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), projectId: text("project_id").notNull(), workItemId: text("work_item_id").notNull(), attemptId: text("attempt_id").notNull(), reasonClass: text("reason_class").notNull(), state: text("state").notNull(), projectionVersion: integer("projection_version").notNull().default(1), dueAt: integer("due_at", { mode: "timestamp" }).notNull(), coalescingKey: text("coalescing_key").notNull(), activeSlot: text("active_slot"), claimToken: text("claim_token"), claimExpiresAt: integer("claim_expires_at", { mode: "timestamp" }), attemptCount: integer("attempt_count").notNull(), maxAttempts: integer("max_attempts").notNull(), lastErrorCode: text("last_error_code"), idempotencyKey: text("idempotency_key").notNull(), inputDigest: text("input_digest").notNull(), createdAt: integer("created_at", { mode: "timestamp" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(), completedAt: integer("completed_at", { mode: "timestamp" })
}, (table) => ({ userIdentity: uniqueIndex("idx_portfolio_wakeups_user_id").on(table.userId, table.id), projectParent: foreignKey({ columns: [table.userId, table.projectId], foreignColumns: [portfolioProjects.userId, portfolioProjects.projectId] }).onDelete("cascade"), workItemParent: foreignKey({ columns: [table.userId, table.projectId, table.workItemId], foreignColumns: [portfolioWorkItems.userId, portfolioWorkItems.projectId, portfolioWorkItems.id] }).onDelete("cascade"), attemptParent: foreignKey({ columns: [table.userId, table.projectId, table.workItemId, table.attemptId], foreignColumns: [portfolioTaskAttempts.userId, portfolioTaskAttempts.projectId, portfolioTaskAttempts.workItemId, portfolioTaskAttempts.id] }).onDelete("cascade") }));
export const portfolioHeartbeatSettings = sqliteTable("portfolio_heartbeat_settings", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }), enabled: integer("enabled", { mode: "boolean" }).notNull().default(false), cadenceMinutes: integer("cadence_minutes"), projectionVersion: integer("projection_version").notNull().default(1), lastReconciledAt: integer("last_reconciled_at", { mode: "timestamp" }), createdAt: integer("created_at", { mode: "timestamp" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
});
// Reconciliation claims are the sole Phase 5 scheduler authority. Wakeup
// claim_token fields remain legacy storage and are intentionally not projected.
export const portfolioReconciliationRuns = sqliteTable("portfolio_reconciliation_runs", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), source: text("source").notNull(), sourceRecordId: text("source_record_id").notNull(), idempotencySlot: text("idempotency_slot").notNull(), state: text("state").notNull(), projectionVersion: integer("projection_version").notNull().default(1), claimTokenDigest: text("claim_token_digest"), claimLeaseExpiresAt: integer("claim_lease_expires_at", { mode: "timestamp" }), attemptCount: integer("attempt_count").notNull().default(0), retryBudget: integer("retry_budget").notNull(), resultDigest: text("result_digest"), errorCode: text("error_code"), errorDigest: text("error_digest"), wakeupId: text("wakeup_id"), heartbeatUserId: text("heartbeat_user_id"), scheduledAt: integer("scheduled_at", { mode: "timestamp" }).notNull(), claimedAt: integer("claimed_at", { mode: "timestamp" }), completedAt: integer("completed_at", { mode: "timestamp" }), createdAt: integer("created_at", { mode: "timestamp" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
}, (table) => ({
  sourceSlot: uniqueIndex("idx_portfolio_reconciliation_source_slot").on(table.userId, table.source, table.sourceRecordId, table.idempotencySlot),
  leaseRecovery: index("idx_portfolio_reconciliation_user_state_lease").on(table.userId, table.state, table.claimLeaseExpiresAt),
  userParent: foreignKey({ columns: [table.userId], foreignColumns: [users.id] }).onDelete("cascade"),
  wakeupParent: foreignKey({ columns: [table.userId, table.wakeupId], foreignColumns: [portfolioWorkflowWakeups.userId, portfolioWorkflowWakeups.id] }).onDelete("cascade"),
  heartbeatParent: foreignKey({ columns: [table.heartbeatUserId], foreignColumns: [portfolioHeartbeatSettings.userId] }).onDelete("cascade"),
  sourceCheck: check("portfolio_reconciliation_source_shape", sql`(
    (${table.source} = 'wakeup' AND ${table.wakeupId} IS NOT NULL AND ${table.sourceRecordId} = ${table.wakeupId} AND ${table.heartbeatUserId} IS NULL)
    OR (${table.source} = 'heartbeat' AND ${table.heartbeatUserId} = ${table.userId} AND ${table.sourceRecordId} = ${table.heartbeatUserId} AND ${table.wakeupId} IS NULL)
  )`),
  stateCheck: check("portfolio_reconciliation_state", sql`${table.state} IN ('scheduled', 'claimed', 'completed', 'retry_scheduled', 'exhausted', 'cancelled', 'unknown')`),
  sourceCheckValue: check("portfolio_reconciliation_source", sql`${table.source} IN ('wakeup', 'heartbeat')`)
}));
export const portfolioProviderAccounts = sqliteTable("portfolio_provider_accounts", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), provider: text("provider").notNull(), providerAccountId: text("provider_account_id").notNull(), lifecycleState: text("lifecycle_state").notNull().default("verified"), handlerKind: text("handler_kind").notNull().default("portfolio"), auditSafeMetadataJson: text("audit_safe_metadata_json").notNull().default("{}"), createdAt: integer("created_at", { mode: "timestamp" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
}, (table) => ({ globalAccount: uniqueIndex("idx_portfolio_provider_account_global").on(table.provider, table.providerAccountId), userAccount: uniqueIndex("idx_portfolio_provider_account_user_id").on(table.userId, table.id), handler: index("idx_portfolio_provider_account_handler").on(table.provider, table.handlerKind, table.lifecycleState) }));
export const portfolioChannelBindings = sqliteTable("portfolio_channel_bindings", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), provider: text("provider").notNull(), providerAccountId: text("provider_account_id"), externalIdentity: text("external_identity").notNull(), conversationId: text("conversation_id").notNull(), projectId: text("project_id"), isOwner: integer("is_owner", { mode: "boolean" }).notNull(), status: text("status").notNull(), projectionVersion: integer("projection_version").notNull().default(1), createdAt: integer("created_at", { mode: "timestamp" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
}, (table) => ({ userIdentity: uniqueIndex("idx_portfolio_channel_bindings_user_id").on(table.userId, table.id), activeIdentity: uniqueIndex("idx_portfolio_channel_binding_active_identity").on(table.providerAccountId, table.externalIdentity, table.conversationId).where(sql`${table.status} = 'active'`), lookup: index("idx_portfolio_channel_binding_account_lookup").on(table.userId, table.providerAccountId, table.externalIdentity, table.conversationId, table.status), accountParent: foreignKey({ columns: [table.userId, table.providerAccountId], foreignColumns: [portfolioProviderAccounts.userId, portfolioProviderAccounts.id] }).onDelete("cascade"), projectParent: foreignKey({ columns: [table.userId, table.projectId], foreignColumns: [portfolioProjects.userId, portfolioProjects.projectId] }).onDelete("cascade") }));
export const portfolioChannelAllowedConversations = sqliteTable("portfolio_channel_allowed_conversations", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), providerAccountId: text("provider_account_id").notNull(), bindingId: text("binding_id").notNull(), conversationId: text("conversation_id").notNull(), status: text("status").notNull().default("active"), createdAt: integer("created_at", { mode: "timestamp" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
}, (table) => ({ active: uniqueIndex("idx_portfolio_channel_allowed_active").on(table.providerAccountId, table.bindingId, table.conversationId).where(sql`${table.status} = 'active'`), accountParent: foreignKey({ columns: [table.userId, table.providerAccountId], foreignColumns: [portfolioProviderAccounts.userId, portfolioProviderAccounts.id] }).onDelete("cascade"), bindingParent: foreignKey({ columns: [table.userId, table.bindingId], foreignColumns: [portfolioChannelBindings.userId, portfolioChannelBindings.id] }).onDelete("cascade") }));
export const portfolioFeishuIngressEvents = sqliteTable("portfolio_feishu_ingress_events", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), providerAccountId: text("provider_account_id").notNull(), providerEventId: text("provider_event_id").notNull(), transport: text("transport").notNull(), handlerKind: text("handler_kind").notNull(), eventDigest: text("event_digest").notNull(), state: text("state").notNull(), rejectionCode: text("rejection_code"), createdAt: integer("created_at", { mode: "timestamp" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
}, (table) => ({ event: uniqueIndex("idx_portfolio_feishu_ingress_event").on(table.providerAccountId, table.providerEventId), accountParent: foreignKey({ columns: [table.userId, table.providerAccountId], foreignColumns: [portfolioProviderAccounts.userId, portfolioProviderAccounts.id] }).onDelete("cascade") }));
export const portfolioChannelActions = sqliteTable("portfolio_channel_actions", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), bindingId: text("binding_id").notNull(), recordType: text("record_type").notNull(), recordId: text("record_id").notNull(), actionType: text("action_type").notNull(), payloadDigest: text("payload_digest").notNull(), recordVersion: integer("record_version"), ownerUserId: text("owner_user_id"), signatureDigest: text("signature_digest"), state: text("state").notNull(), projectionVersion: integer("projection_version").notNull().default(1), expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(), consumedAt: integer("consumed_at", { mode: "timestamp" }), idempotencyKey: text("idempotency_key").notNull(), createdAt: integer("created_at", { mode: "timestamp" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
}, (table) => ({ idempotency: uniqueIndex("idx_portfolio_channel_action_idempotency").on(table.userId, table.bindingId, table.idempotencyKey), signature: uniqueIndex("idx_portfolio_channel_action_signature").on(table.signatureDigest).where(sql`${table.signatureDigest} IS NOT NULL`), bindingParent: foreignKey({ columns: [table.userId, table.bindingId], foreignColumns: [portfolioChannelBindings.userId, portfolioChannelBindings.id] }).onDelete("cascade") }));
export const portfolioDeliveryRecords = sqliteTable("portfolio_delivery_records", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), bindingId: text("binding_id").notNull(), factId: text("fact_id"), eventType: text("event_type").notNull(), eventVersion: integer("event_version").notNull(), summaryJson: text("summary_json").notNull(), state: text("state").notNull(), projectionVersion: integer("projection_version").notNull().default(1), attemptCount: integer("attempt_count").notNull(), nextAttemptAt: integer("next_attempt_at", { mode: "timestamp" }).notNull(), claimToken: text("claim_token"), claimExpiresAt: integer("claim_expires_at", { mode: "timestamp" }), providerResultJson: text("provider_result_json"), canonicalRecordType: text("canonical_record_type"), canonicalRecordId: text("canonical_record_id"), canonicalRecordVersion: integer("canonical_record_version"), providerResultDigest: text("provider_result_digest"), providerErrorCode: text("provider_error_code"), idempotencyKey: text("idempotency_key").notNull(), createdAt: integer("created_at", { mode: "timestamp" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(), completedAt: integer("completed_at", { mode: "timestamp" })
}, (table) => ({ canonicalTarget: uniqueIndex("idx_portfolio_delivery_canonical_target").on(table.userId, table.bindingId, table.canonicalRecordType, table.canonicalRecordId, table.canonicalRecordVersion).where(sql`${table.canonicalRecordType} IS NOT NULL`), due: index("idx_portfolio_delivery_due").on(table.userId, table.state, table.nextAttemptAt), bindingParent: foreignKey({ columns: [table.userId, table.bindingId], foreignColumns: [portfolioChannelBindings.userId, portfolioChannelBindings.id] }).onDelete("cascade") }));
export const portfolioFeishuCommandIntents = sqliteTable("portfolio_feishu_command_intents", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), channelActionId: text("channel_action_id").notNull(), bindingId: text("binding_id").notNull(), canonicalRecordType: text("canonical_record_type").notNull(), canonicalRecordId: text("canonical_record_id").notNull(), canonicalRecordVersion: integer("canonical_record_version").notNull(), factId: text("fact_id"), commandType: text("command_type").notNull(), state: text("state").notNull().default("pending"), createdAt: integer("created_at", { mode: "timestamp" }).notNull()
}, (table) => ({ action: uniqueIndex("idx_portfolio_feishu_command_action").on(table.channelActionId), bindingParent: foreignKey({ columns: [table.userId, table.bindingId], foreignColumns: [portfolioChannelBindings.userId, portfolioChannelBindings.id] }).onDelete("cascade"), actionParent: foreignKey({ columns: [table.channelActionId], foreignColumns: [portfolioChannelActions.id] }).onDelete("cascade") }));
export const portfolioFacts = sqliteTable("portfolio_facts", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), projectId: text("project_id"), requestId: text("request_id"), workItemId: text("work_item_id"), attemptId: text("attempt_id"), recordType: text("record_type").notNull(), recordId: text("record_id").notNull(), factType: text("fact_type").notNull(), correlationId: text("correlation_id"), idempotencyKey: text("idempotency_key"), payloadJson: text("payload_json").notNull(), payloadDigest: text("payload_digest").notNull(), createdAt: integer("created_at", { mode: "timestamp" }).notNull()
}, (table) => ({
  // Facts are an immutable ledger; a project with recorded facts cannot be deleted.
  projectParent: foreignKey({ columns: [table.userId, table.projectId], foreignColumns: [portfolioProjects.userId, portfolioProjects.projectId] }).onDelete("restrict"),
  // Unprojected request facts retain user/request validation; project-bound facts add the exact scope FK.
  requestParent: foreignKey({ columns: [table.userId, table.requestId], foreignColumns: [portfolioRequests.userId, portfolioRequests.id] }).onDelete("cascade"),
  scopedRequestParent: foreignKey({ columns: [table.userId, table.projectId, table.requestId], foreignColumns: [portfolioRequests.userId, portfolioRequests.projectId, portfolioRequests.id] }).onDelete("cascade"),
  workItemParent: foreignKey({ columns: [table.userId, table.projectId, table.workItemId], foreignColumns: [portfolioWorkItems.userId, portfolioWorkItems.projectId, portfolioWorkItems.id] }).onDelete("cascade"),
  attemptProjectParent: foreignKey({ columns: [table.userId, table.projectId, table.attemptId], foreignColumns: [portfolioTaskAttempts.userId, portfolioTaskAttempts.projectId, portfolioTaskAttempts.id] }).onDelete("cascade"),
  attemptParent: foreignKey({ columns: [table.userId, table.projectId, table.workItemId, table.attemptId], foreignColumns: [portfolioTaskAttempts.userId, portfolioTaskAttempts.projectId, portfolioTaskAttempts.workItemId, portfolioTaskAttempts.id] }).onDelete("cascade")
}));

// ---------------------------------------------------------------------------
// Copilot agent runtime (self-hosted harness; the platform is its tool surface)
// Fresh schema — the legacy copilot_* tables were dropped by migration 0038.
// ---------------------------------------------------------------------------

export const copilotConversations = sqliteTable("copilot_conversations", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title"),
  status: text("status").notNull().default("active"),
  // Rolling context-compression summary (see migration 0042): accumulated digest
  // of messages up to summaryCoveredSequence, used to keep long chats in context.
  summary: text("summary"),
  summaryCoveredSequence: integer("summary_covered_sequence"),
  lastSummaryAt: integer("last_summary_at", { mode: "timestamp" }),
  // dsh kernel session id bound to this conversation (M2 BFF path). Null for
  // conversations that have only ever run on the in-process orchestrator.
  dshSessionId: text("dsh_session_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
}, (table) => ({ userLookup: index("idx_copilot_conversations_user_updated").on(table.userId, table.updatedAt) }));

export const copilotMessages = sqliteTable("copilot_messages", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  conversationId: text("conversation_id").notNull().references(() => copilotConversations.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // user | assistant | tool
  kind: text("kind").notNull(), // text | tool_call | tool_result | pending_action | error
  content: text("content").notNull(),
  toolName: text("tool_name"),
  toolInputJson: text("tool_input_json"),
  /** Provider-assigned tool call id; pairs tool_call with tool_result in the UI. */
  toolCallId: text("tool_call_id"),
  sequence: integer("sequence").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date())
}, (table) => ({ conversationLookup: index("idx_copilot_messages_conversation_seq").on(table.conversationId, table.sequence), userLookup: index("idx_copilot_messages_user_created").on(table.userId, table.createdAt), toolCallLookup: index("idx_copilot_messages_tool_call_id").on(table.toolCallId) }));

export const copilotRuns = sqliteTable("copilot_runs", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  conversationId: text("conversation_id").notNull().references(() => copilotConversations.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"), // pending | running | awaiting_approval | completed | cancelled | failed
  provider: text("provider"),
  model: text("model"),
  steps: integer("steps").notNull().default(0),
  error: text("error"),
  startedAt: integer("started_at", { mode: "timestamp" }),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
}, (table) => ({ conversationLookup: index("idx_copilot_runs_conversation_created").on(table.conversationId, table.createdAt), userLookup: index("idx_copilot_runs_user_created").on(table.userId, table.createdAt) }));

export const copilotPendingActions = sqliteTable("copilot_pending_actions", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  runId: text("run_id").notNull().references(() => copilotRuns.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tool: text("tool").notNull(),
  inputJson: text("input_json").notNull(),
  inputDigest: text("input_digest").notNull(),
  status: text("status").notNull().default("pending"), // pending | approved | rejected | expired
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  decidedAt: integer("decided_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
}, (table) => ({ runLookup: index("idx_copilot_pending_actions_run").on(table.runId, table.status), userLookup: index("idx_copilot_pending_actions_user_status").on(table.userId, table.status) }));

export const copilotMemory = sqliteTable("copilot_memory", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  scope: text("scope").notNull(), // global | project | session
  projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
  kind: text("kind").notNull(), // fact | preference | decision | project_note
  text: text("text").notNull(),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
}, (table) => ({ userScope: index("idx_copilot_memory_user_scope").on(table.userId, table.scope, table.createdAt), userProject: index("idx_copilot_memory_user_project").on(table.userId, table.projectId, table.createdAt) }));

export const copilotOperationLog = sqliteTable("copilot_operation_log", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  operation: text("operation").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  payloadDigest: text("payload_digest").notNull(),
  resultJson: text("result_json"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date())
}, (table) => ({ idempotency: uniqueIndex("idx_copilot_operation_user_op_key").on(table.userId, table.operation, table.idempotencyKey) }));

// M4: per-user dsh kernel configuration (visual config -> per-user cordis.yml).
// pluginsJson is keyed by the availablePlugins whitelist; defaultModelId
// overrides the system default model for dsh runs when a message names none.
export const copilotDshConfig = sqliteTable("copilot_dsh_config", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  defaultModelId: text("default_model_id"),
  pluginsJson: text("plugins_json").notNull().default("{}"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
});

// Feishu Copilot channel: one row per (user, Feishu chat) pointing at the chat's
// CURRENT Copilot conversation. Chats without a Portfolio channel binding route
// messages into the Copilot harness; /new swaps the pointer to a fresh context.
export const feishuCopilotChannels = sqliteTable("feishu_copilot_channels", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  chatId: text("chat_id").notNull(),
  conversationId: text("conversation_id").notNull().references(() => copilotConversations.id, { onDelete: "cascade" }),
  senderIdentity: text("sender_identity"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
}, (table) => ({ chatIdentity: primaryKey({ columns: [table.userId, table.chatId], name: "feishu_copilot_channel_pk" }) }));

// Auth sessions replace the long-lived bearer JWT for console sign-in. The
// token itself is opaque (random 256-bit, base64url); only its SHA-256 is
// stored. Expiry slides with activity (expiresAt) and is hard-capped by
// absoluteExpiresAt so a stolen token dies even under continuous use.
export const authSessions = sqliteTable("auth_sessions", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  absoluteExpiresAt: integer("absolute_expires_at", { mode: "timestamp" }).notNull(),
  userAgent: text("user_agent")
}, (table) => ({
  idx_auth_sessions_user: index("idx_auth_sessions_user").on(table.userId)
}));

// One-time invite codes for the invite-only registration mode. Codes are
// short-lived plain values an admin hands to a teammate; redemption is
// recorded by usedByUserId/usedAt.
export const authInvites = sqliteTable("auth_invites", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  code: text("code").notNull().unique(),
  createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  usedByUserId: text("used_by_user_id").references(() => users.id, { onDelete: "set null" }),
  usedAt: integer("used_at", { mode: "timestamp" })
}, (table) => ({
  idx_auth_invites_created_by: index("idx_auth_invites_created_by").on(table.createdByUserId)
}));
