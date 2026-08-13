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
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle_%' AND name NOT GLOB 'copilot_memory_fts_*' ORDER BY name"
      )
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    assert.deepEqual(names, [
      "agents",
      "api_keys",
      "audit_logs",
      "catalog_items",
      "catalog_sources",
      "copilot_automation_run_projects",
      "copilot_automation_runs",
      "copilot_automations",
      "copilot_conversations",
      "copilot_memory_entries",
      "copilot_memory_fts",
      "copilot_memory_notes",
      "copilot_messages",
      "copilot_pending_actions",
      "copilot_run_events",
      "copilot_runs",
      "feishu_card_actions",
      "feishu_channel_accounts",
      "feishu_channel_inbox",
      "feishu_channel_logical_claims",
      "feishu_channel_outbox",
      "feishu_conversation_bindings",
      "integration_feishu_configs",
      "integration_feishu_user_mappings",
      "integration_feishu_webhook_rate_windows",
      "integration_feishu_webhook_replay_entries",
      "model_cost_rates",
      "model_profiles",
      "model_provider_profiles",
      "models",
      "notifications",
      "project_agent_sequences",
      "project_manager_acceptance_results",
      "project_manager_commands",
      "project_manager_goals",
      "project_manager_ledger_events",
      "project_manager_session_assignments",
      "project_manager_task_attempts",
      "project_manager_wakeups",
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

  it("enforces one live Copilot run per user", () => {
    db.prepare(
      "INSERT INTO users (id, username, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("u1", "alice", "alice@example.com", "hash", "user", "active");

    db.prepare(
      "INSERT INTO copilot_runs (id, user_id, status, source, goal, step_count, max_steps) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("run-live-1", "u1", "running", "copilot", "First live run", 0, 8);

    assert.throws(
      () => {
        db.prepare(
          "INSERT INTO copilot_runs (id, user_id, status, source, goal, step_count, max_steps) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).run("run-live-2", "u1", "queued", "copilot", "Second live run", 0, 8);
      },
      /UNIQUE constraint failed/
    );

    db.prepare(
      "INSERT INTO copilot_runs (id, user_id, status, source, goal, step_count, max_steps) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("run-completed", "u1", "completed", "copilot", "Completed run", 0, 8);
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
      "idx_project_manager_task_attempts_user_active",
      "idx_project_manager_task_attempts_work_item_number",
      "idx_project_manager_wakeups_attempt_due",
      "idx_project_manager_wakeups_pending",
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
