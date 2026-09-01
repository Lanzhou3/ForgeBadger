import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { projectManagerWorkItems } from "../src/db/schema.js";

function createTestDb(): Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  const drizzleDb = drizzle(db);
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/db/migrations"
  );
  migrate(drizzleDb, { migrationsFolder });
  return db;
}

function runMigrationTwice(db: Database): void {
  const drizzleDb = drizzle(db);
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/db/migrations"
  );
  migrate(drizzleDb, { migrationsFolder });
}

describe("db schema", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("creates all expected tables after migration", () => {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle_%' ORDER BY name"
      )
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    assert.deepEqual(names, [
      "api_keys",
      "audit_logs",
      "auth_invites",
      "auth_sessions",
      "catalog_items",
      "catalog_sources",
      "copilot_conversations",
      "copilot_dsh_config",
      "copilot_memory",
      "copilot_memory_fts",
      "copilot_memory_fts_config",
      "copilot_memory_fts_content",
      "copilot_memory_fts_data",
      "copilot_memory_fts_docsize",
      "copilot_memory_fts_idx",
      "copilot_messages",
      "copilot_operation_log",
      "copilot_pending_actions",
      "copilot_runs",
      "copilot_tool_preferences",
      "feishu_card_actions",
      "feishu_channel_accounts",
      "feishu_channel_inbox",
      "feishu_channel_logical_claims",
      "feishu_channel_outbox",
      "feishu_conversation_bindings",
      "feishu_copilot_channels",
      "integration_feishu_configs",
      "integration_feishu_user_mappings",
      "integration_feishu_webhook_rate_windows",
      "integration_feishu_webhook_replay_entries",
      "model_cost_rates",
      "model_profiles",
      "model_provider_bindings",
      "model_provider_profiles",
      "notifications",
      "portfolio_acceptance_decisions",
      "portfolio_action_intents",
      "portfolio_channel_actions",
      "portfolio_channel_allowed_conversations",
      "portfolio_channel_bindings",
      "portfolio_commands",
      "portfolio_completion_candidates",
      "portfolio_delivery_records",
      "portfolio_evidence",
      "portfolio_execution_authorizations",
      "portfolio_facts",
      "portfolio_feishu_command_intents",
      "portfolio_feishu_ingress_events",
      "portfolio_heartbeat_settings",
      "portfolio_intake_decisions",
      "portfolio_observation_probes",
      "portfolio_observation_profiles",
      "portfolio_operation_records",
      "portfolio_project_dossiers",
      "portfolio_projects",
      "portfolio_provider_accounts",
      "portfolio_reconciliation_runs",
      "portfolio_requests",
      "portfolio_risk_signals",
      "portfolio_session_assignments",
      "portfolio_task_attempts",
      "portfolio_task_packets",
      "portfolio_work_items",
      "portfolio_worker_signals",
      "portfolio_workflow_wakeups",
      "project_manager_acceptance_results",
      "project_manager_commands",
      "project_manager_goals",
      "project_manager_ledger_events",
      "project_manager_session_assignments",
      "project_manager_stages",
      "project_manager_task_attempts",
      "project_manager_wakeups",
      "project_manager_work_item_links",
      "project_manager_work_items",
      "project_skills",
      "projects",
      "provider_credentials",
      "session_activities",
      "session_snapshots",
      "sessions",
      "skills",
      "template_files",
      "templates",
      "token_usage_records",
      "usage_sync_cursors",
      "user_settings",
      "users"
    ]);
  });

  it("rejects duplicate emails due to unique constraint", () => {
    db.prepare(
      "INSERT INTO users (id, username, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("u1", "alice", "alice@example.com", "hash", "user", "active");

    assert.throws(
      () => {
        db.prepare(
          "INSERT INTO users (id, username, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?)"
        ).run("u2", "bob", "alice@example.com", "hash", "user", "active");
      },
      /UNIQUE constraint failed/
    );
  });

  it("rejects duplicate usernames due to unique constraint", () => {
    db.prepare(
      "INSERT INTO users (id, username, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("u1", "alice", "alice@example.com", "hash", "user", "active");

    assert.throws(
      () => {
        db.prepare(
          "INSERT INTO users (id, username, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?)"
        ).run("u2", "alice", "bob@example.com", "hash", "user", "active");
      },
      /UNIQUE constraint failed/
    );
  });

  it("treats a missing and empty provider base URL as the same identity", () => {
    db.prepare(
      "INSERT INTO users (id, username, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("provider-user", "provider-user", "provider@example.com", "hash", "user", "active");
    const insert = db.prepare(`
      INSERT INTO model_provider_profiles (
        id, user_id, provider_key, name, base_url, auth_type, api_format,
        supported_adapters, default_headers, status
      ) VALUES (?, ?, ?, ?, ?, 'api_key', 'openai-compatible', '[]', '{}', 'active')
    `);
    insert.run("provider-1", "provider-user", "openai", "OpenAI", null);

    assert.throws(
      () => insert.run("provider-2", "provider-user", "openai", "OpenAI duplicate", ""),
      /UNIQUE constraint failed/u
    );
  });

  it("cascades user deletion to projects", () => {
    db.prepare(
      "INSERT INTO users (id, username, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("u1", "alice", "alice@example.com", "hash", "user", "active");

    db.prepare(
      "INSERT INTO projects (id, user_id, name, path, ai_tool, status) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("p1", "u1", "proj", "/tmp/proj", "claude", "active");

    const before = db.prepare("SELECT * FROM projects WHERE user_id = ?").all("u1") as unknown[];
    assert.equal(before.length, 1);

    db.prepare("DELETE FROM users WHERE id = ?").run("u1");

    const after = db.prepare("SELECT * FROM projects WHERE user_id = ?").all("u1") as unknown[];
    assert.equal(after.length, 0);
  });

  it("is idempotent when running migrations twice", () => {
    assert.doesNotThrow(() => runMigrationTwice(db));
  });

  it("uses the tenant time index for token usage range queries", () => {
    const plan = db
      .prepare(`
        EXPLAIN QUERY PLAN
        SELECT adapter, project_path, model_id, input_tokens, output_tokens
        FROM token_usage_records
        WHERE user_id = ? AND occurred_at >= ? AND occurred_at < ?
      `)
      .all("user-1", 0, 4_102_444_800) as Array<{ detail: string }>;

    assert.equal(
      plan.some((row) => row.detail.includes("idx_token_usage_user_occurred") && row.detail.includes("occurred_at>?")),
      true,
      `expected token usage time range index, got: ${plan.map((row) => row.detail).join(" | ")}`
    );
  });

  it("uses ordered indexes for project-manager work item lists", () => {
    const allPlan = db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT * FROM project_manager_work_items
      WHERE user_id = ? AND project_id = ?
      ORDER BY updated_at DESC, title ASC
      LIMIT 100
    `).all("user-1", "project-1") as Array<{ detail: string }>;
    const statusPlan = db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT * FROM project_manager_work_items
      WHERE user_id = ? AND project_id = ? AND status = ?
      ORDER BY updated_at DESC, title ASC
      LIMIT 100
    `).all("user-1", "project-1", "todo") as Array<{ detail: string }>;

    assert.equal(allPlan.some((row) => row.detail.includes("idx_project_manager_work_items_updated")), true);
    assert.equal(statusPlan.some((row) => row.detail.includes("idx_project_manager_work_items_status_updated")), true);
    assert.equal([...allPlan, ...statusPlan].some((row) => row.detail.includes("TEMP B-TREE")), false);
  });

  it("declares only the composite tenant project foreign key for project-manager work items", () => {
    const projectForeignKeys = getTableConfig(projectManagerWorkItems).foreignKeys
      .map((foreignKey) => foreignKey.reference())
      .filter((reference) => reference.columns.some((column) => column.name === "project_id"));

    assert.deepEqual(
      projectForeignKeys.map((reference) => ({
        columns: reference.columns.map((column) => column.name),
        foreignColumns: reference.foreignColumns.map((column) => column.name)
      })),
      [{
        columns: ["user_id", "project_id"],
        foreignColumns: ["user_id", "id"]
      }]
    );
  });

  it("uses tenant-ordered indexes for audit log lists", () => {
    const listPlan = db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT * FROM audit_logs
      WHERE user_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 50
    `).all("user-1") as Array<{ detail: string }>;
    const resourcePlan = db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT * FROM audit_logs
      WHERE user_id = ? AND resource_type = ? AND resource_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 50
    `).all("user-1", "template_version", "template-1") as Array<{ detail: string }>;

    assert.equal(listPlan.some((row) => row.detail.includes("idx_audit_logs_user_created")), true);
    assert.equal(resourcePlan.some((row) => row.detail.includes("idx_audit_logs_user_resource_created")), true);
    assert.equal([...listPlan, ...resourcePlan].some((row) => row.detail.includes("TEMP B-TREE")), false);
  });

  it("uses lifecycle indexes for auth session listing and cleanup", () => {
    const listPlan = db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT * FROM auth_sessions
      WHERE user_id = ?
      ORDER BY last_seen_at DESC
    `).all("user-1") as Array<{ detail: string }>;
    const cleanupPlan = db.prepare(`
      EXPLAIN QUERY PLAN
      DELETE FROM auth_sessions
      WHERE expires_at < ?
    `).all(0) as Array<{ detail: string }>;

    assert.equal(listPlan.some((row) => row.detail.includes("idx_auth_sessions_user_last_seen")), true);
    assert.equal(cleanupPlan.some((row) => row.detail.includes("idx_auth_sessions_expires")), true);
    assert.equal(listPlan.some((row) => row.detail.includes("TEMP B-TREE")), false);
  });

  it("uses a tenant status index for dashboard session counts", () => {
    const plan = db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT COUNT(*) FROM sessions
      WHERE user_id = ? AND status = 'running'
    `).all("user-1") as Array<{ detail: string }>;

    assert.equal(
      plan.some((row) => row.detail.includes("idx_sessions_user_status") && row.detail.includes("status=?")),
      true,
      `expected tenant session status index, got: ${plan.map((row) => row.detail).join(" | ")}`
    );
  });

  it("creates project-manager ledger tables with tenant and project indexes", () => {
    const expectedTables = [
      "project_manager_goals",
      "project_manager_work_items",
      "project_manager_stages",
      "project_manager_work_item_links",
      "project_manager_ledger_events"
    ];

    for (const tableName of expectedTables) {
      const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
      const names = columns.map((column) => column.name);
      assert.equal(names.includes("user_id"), true, `${tableName} must include user_id`);
      assert.equal(names.includes("project_id"), true, `${tableName} must include project_id`);
    }

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_project_manager_%' ORDER BY name")
      .all() as Array<{ name: string }>;

    assert.deepEqual(indexes.map((index) => index.name), [
      "idx_project_manager_acceptance_attempt",
      "idx_project_manager_commands_attempt_created",
      "idx_project_manager_commands_idempotency",
      "idx_project_manager_goals_user_project",
      "idx_project_manager_ledger_events_created",
      "idx_project_manager_ledger_events_type",
      "idx_project_manager_ledger_events_user_project",
      "idx_project_manager_session_assignments_attempt",
      "idx_project_manager_session_assignments_project_active",
      "idx_project_manager_session_assignments_session_active",
      "idx_project_manager_stages_user_project",
      "idx_project_manager_task_attempts_user_active",
      "idx_project_manager_task_attempts_work_item_number",
      "idx_project_manager_wakeups_attempt_due",
      "idx_project_manager_wakeups_pending",
      "idx_project_manager_work_item_links_blocked",
      "idx_project_manager_work_item_links_pair",
      "idx_project_manager_work_items_stage",
      "idx_project_manager_work_items_status_updated",
      "idx_project_manager_work_items_updated",
      "idx_project_manager_work_items_user_project_id"
    ]);
  });

  it("rejects a project-manager work item owned by a different project tenant", () => {
    db.pragma("foreign_keys = ON");
    const insertUser = db.prepare(
      "INSERT INTO users (id, username, email, password_hash, role, status) VALUES (?, ?, ?, ?, 'user', 'active')"
    );
    insertUser.run("tenant-a", "tenant-a", "tenant-a@example.com", "hash");
    insertUser.run("tenant-b", "tenant-b", "tenant-b@example.com", "hash");
    db.prepare(
      "INSERT INTO projects (id, user_id, name, path, ai_tool, status) VALUES (?, ?, ?, ?, 'claude', 'active')"
    ).run("project-b", "tenant-b", "Tenant B", "/tmp/tenant-b");

    assert.throws(
      () => db.prepare(`
        INSERT INTO project_manager_work_items (
          id, user_id, project_id, title, status, priority,
          acceptance_criteria_json, evidence_refs_json, feishu_refs_json, details_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'todo', 0, '[]', '[]', '[]', '{}', 1, 1)
      `).run("cross-tenant-item", "tenant-a", "project-b", "Must fail"),
      /FOREIGN KEY constraint failed/u
    );
  });

  it("rejects cross-tenant parents for session history and token usage", () => {
    db.pragma("foreign_keys = ON");
    const insertUser = db.prepare(
      "INSERT INTO users (id, username, email, password_hash, role, status) VALUES (?, ?, ?, ?, 'user', 'active')"
    );
    insertUser.run("history-a", "history-a", "history-a@example.com", "hash");
    insertUser.run("history-b", "history-b", "history-b@example.com", "hash");
    db.prepare(
      "INSERT INTO projects (id, user_id, name, path, ai_tool, status) VALUES (?, ?, ?, ?, 'claude', 'active')"
    ).run("history-project-b", "history-b", "History B", "/tmp/history-b");
    db.prepare(`
      INSERT INTO sessions (
        id, user_id, project_id, name, ai_tool, status, attach_token,
        working_dir, credential_mode, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'claude', 'idle', '', ?, 'host_environment', 1, 1)
    `).run("history-session-b", "history-b", "history-project-b", "History B", "/tmp/history-b");

    assert.throws(
      () => db.prepare(`
        INSERT INTO session_activities (
          id, user_id, session_id, project_id, type, status, message, created_at
        ) VALUES (?, ?, ?, ?, 'session_started', 'info', 'must fail', 1)
      `).run("cross-activity", "history-a", "history-session-b", "history-project-b"),
      /tenant mismatch/u
    );
    assert.throws(
      () => db.prepare(`
        INSERT INTO session_snapshots (
          id, user_id, session_id, project_id, created_at
        ) VALUES (?, ?, ?, ?, 1)
      `).run("cross-snapshot", "history-a", "history-session-b", "history-project-b"),
      /tenant mismatch/u
    );
    assert.throws(
      () => db.prepare(`
        INSERT INTO token_usage_records (
          id, user_id, adapter, project_id, request_id, occurred_at, source_file
        ) VALUES (?, ?, 'claude', ?, 'cross-request', 1, 'source')
      `).run("cross-usage", "history-a", "history-project-b"),
      /tenant mismatch/u
    );

    db.prepare(`
      INSERT INTO session_activities (
        id, user_id, session_id, project_id, type, status, message, created_at
      ) VALUES ('owned-activity', 'history-b', 'history-session-b', 'history-project-b',
        'session_started', 'info', 'owned', 1)
    `).run();
    db.prepare(`
      INSERT INTO session_snapshots (
        id, user_id, session_id, project_id, created_at
      ) VALUES ('owned-snapshot', 'history-b', 'history-session-b', 'history-project-b', 1)
    `).run();
    db.prepare(`
      INSERT INTO token_usage_records (
        id, user_id, adapter, project_id, request_id, occurred_at, source_file
      ) VALUES ('owned-usage', 'history-b', 'claude', 'history-project-b', 'owned-request', 1, 'source')
    `).run();

    assert.throws(
      () => db.prepare("UPDATE session_activities SET user_id = 'history-a' WHERE id = 'owned-activity'").run(),
      /tenant mismatch/u
    );
    assert.throws(
      () => db.prepare("UPDATE session_snapshots SET user_id = 'history-a' WHERE id = 'owned-snapshot'").run(),
      /tenant mismatch/u
    );
    assert.throws(
      () => db.prepare("UPDATE token_usage_records SET user_id = 'history-a' WHERE id = 'owned-usage'").run(),
      /tenant mismatch/u
    );

    db.prepare("DELETE FROM projects WHERE id = 'history-project-b'").run();
    const activity = db.prepare(
      "SELECT session_id AS sessionId, project_id AS projectId FROM session_activities WHERE id = 'owned-activity'"
    ).get() as { sessionId: string | null; projectId: string | null };
    const snapshot = db.prepare(
      "SELECT session_id AS sessionId, project_id AS projectId FROM session_snapshots WHERE id = 'owned-snapshot'"
    ).get() as { sessionId: string | null; projectId: string | null };
    const usage = db.prepare(
      "SELECT project_id AS projectId FROM token_usage_records WHERE id = 'owned-usage'"
    ).get() as { projectId: string | null };
    assert.deepEqual(activity, { sessionId: null, projectId: null });
    assert.deepEqual(snapshot, { sessionId: null, projectId: null });
    assert.deepEqual(usage, { projectId: null });
  });

  it("creates tenant-scoped execution ledger tables and enforces active/idempotent slots", () => {
    const executionTables = [
      "project_manager_task_attempts",
      "project_manager_session_assignments",
      "project_manager_commands",
      "project_manager_acceptance_results",
      "project_manager_wakeups"
    ];
    for (const tableName of executionTables) {
      const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
      assert.equal(columns.some((column) => column.name === "user_id"), true, `${tableName} must include user_id`);
      assert.equal(columns.some((column) => column.name === "project_id"), true, `${tableName} must include project_id`);
    }

    db.prepare(
      "INSERT INTO users (id, username, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("pm-user", "pm-user", "pm-user@example.com", "hash", "user", "active");
    db.prepare(
      "INSERT INTO projects (id, user_id, name, path, ai_tool, status) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("pm-project", "pm-user", "PM", "/tmp/pm", "claude", "active");
    db.prepare(`
      INSERT INTO project_manager_work_items (
        id, user_id, project_id, title, status, priority,
        acceptance_criteria_json, evidence_refs_json, feishu_refs_json, details_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("pm-work-1", "pm-user", "pm-project", "First", "todo", 0, "[]", "[]", "[]", "{}", 1, 1);
    db.prepare(`
      INSERT INTO project_manager_work_items (
        id, user_id, project_id, title, status, priority,
        acceptance_criteria_json, evidence_refs_json, feishu_refs_json, details_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("pm-work-2", "pm-user", "pm-project", "Second", "todo", 0, "[]", "[]", "[]", "{}", 1, 1);

    const insertAttempt = db.prepare(`
      INSERT INTO project_manager_task_attempts (
        id, user_id, project_id, work_item_id, attempt_number,
        desired_state, observed_state, input_version, input_digest, active_slot,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'running', 'dispatching', 1, ?, 'running', 1, 1)
    `);
    insertAttempt.run("attempt-1", "pm-user", "pm-project", "pm-work-1", 1, "digest-1");
    assert.throws(
      () => insertAttempt.run("attempt-2", "pm-user", "pm-project", "pm-work-2", 1, "digest-2"),
      /UNIQUE constraint failed/
    );

    db.prepare(`
      INSERT INTO project_manager_commands (
        id, user_id, project_id, work_item_id, attempt_id, command_type,
        idempotency_key, payload_digest, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("command-1", "pm-user", "pm-project", "pm-work-1", "attempt-1", "dispatch_task", "dispatch:1", "digest-1", "pending", 1, 1);
    assert.throws(
      () => db.prepare(`
        INSERT INTO project_manager_commands (
          id, user_id, project_id, work_item_id, attempt_id, command_type,
          idempotency_key, payload_digest, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("command-2", "pm-user", "pm-project", "pm-work-1", "attempt-1", "dispatch_task", "dispatch:1", "digest-1", "pending", 1, 1),
      /UNIQUE constraint failed/
    );

    db.prepare(`
      INSERT INTO project_manager_wakeups (
        id, user_id, project_id, work_item_id, attempt_id, reason_class,
        status, active_slot, not_before, attempt_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 'pending', 1, 0, 1, 1)
    `).run("wakeup-1", "pm-user", "pm-project", "pm-work-1", "attempt-1", "dispatch");
    assert.throws(
      () => db.prepare(`
        INSERT INTO project_manager_wakeups (
          id, user_id, project_id, work_item_id, attempt_id, reason_class,
          status, active_slot, not_before, attempt_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 'pending', 1, 0, 1, 1)
      `).run("wakeup-2", "pm-user", "pm-project", "pm-work-1", "attempt-1", "dispatch"),
      /UNIQUE constraint failed/
    );
  });
});
