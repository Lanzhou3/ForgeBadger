import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
      "idx_project_manager_work_items_status",
      "idx_project_manager_work_items_user_project"
    ]);
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
