import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/db/migrations"
);
const migration0050CreatedAt = 1_787_788_800_000;

const ingressColumns = [
  "id",
  "user_id",
  "provider_account_id",
  "provider_event_id",
  "transport",
  "handler_kind",
  "event_digest",
  "state",
  "rejection_code",
  "created_at",
  "updated_at"
];

describe("Feishu Copilot ingress migration", () => {
  it("registers 0051 after 0050 in the Drizzle journal", () => {
    const journal = JSON.parse(readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf8")) as {
      entries: Array<{ idx: number; when: number; tag: string }>;
    };
    const migration0050 = journal.entries.find((entry) => entry.tag === "0050_copilot_tool_preferences");
    const migration0051 = journal.entries.find((entry) => entry.tag === "0051_feishu_copilot_ingress_handler");

    assert.deepEqual(migration0051 && { idx: migration0051.idx, tag: migration0051.tag }, {
      idx: 50,
      tag: "0051_feishu_copilot_ingress_handler"
    });
    assert.ok(migration0050 && migration0051 && migration0051.when > migration0050.when);
  });

  it("repairs an already-migrated stale ledger without losing rows or constraints", () => {
    // Arrange
    const db = createStaleDatabase();
    const before = readIngressRows(db);

    // Act
    migrate(drizzle(db), { migrationsFolder });

    // Assert
    assertLedgerContract(db);
    assert.deepEqual(readIngressRows(db), before);
    assert.doesNotThrow(() => insertIngress(db, "ingress-copilot", "event-copilot", "copilot"));
    assert.throws(
      () => db.prepare(
        "UPDATE portfolio_feishu_ingress_events SET transport = 'socket' WHERE id = 'ingress-copilot'"
      ).run(),
      /CHECK constraint failed/u
    );
    assert.throws(
      () => db.prepare(
        "UPDATE portfolio_feishu_ingress_events SET state = 'running' WHERE id = 'ingress-copilot'"
      ).run(),
      /CHECK constraint failed/u
    );
    assert.throws(
      () => insertIngress(db, "ingress-invalid", "event-invalid", "unknown"),
      /CHECK constraint failed/u
    );
    assert.throws(
      () => insertIngress(db, "ingress-duplicate", "event-copilot", "copilot"),
      /UNIQUE constraint failed/u
    );
    assert.throws(
      () => insertIngress(db, "ingress-orphan", "event-orphan", "copilot", "account-missing"),
      /FOREIGN KEY constraint failed/u
    );
    assert.doesNotThrow(() => migrate(drizzle(db), { migrationsFolder }));
  });

  it("keeps the ledger contract on a fresh database", () => {
    // Arrange
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");

    // Act
    migrate(drizzle(db), { migrationsFolder });

    // Assert
    assertLedgerContract(db);
    const userId = "user-fresh";
    const accountId = "account-fresh";
    db.prepare(
      "INSERT INTO users (id, username, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(userId, "fresh", "fresh@example.com", "hash", "user", "active");
    db.prepare(`
      INSERT INTO portfolio_provider_accounts (
        id, user_id, provider, provider_account_id, lifecycle_state, handler_kind,
        audit_safe_metadata_json, created_at, updated_at
      ) VALUES (?, ?, 'feishu', ?, 'verified', 'portfolio', '{}', 1, 1)
    `).run(accountId, userId, "cli_fresh");
    assert.doesNotThrow(() => insertIngress(db, "ingress-fresh", "event-fresh", "copilot", accountId, userId));
    assert.doesNotThrow(() => migrate(drizzle(db), { migrationsFolder }));
  });
});

function createStaleDatabase(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (id text PRIMARY KEY NOT NULL);
    CREATE TABLE portfolio_provider_accounts (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      UNIQUE (user_id, id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE portfolio_feishu_ingress_events (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      provider_account_id text NOT NULL,
      provider_event_id text NOT NULL,
      transport text NOT NULL CHECK (transport IN ('webhook', 'long_connection')),
      handler_kind text NOT NULL CHECK (handler_kind IN ('legacy', 'portfolio')),
      event_digest text NOT NULL,
      state text NOT NULL CHECK (state IN ('admitted', 'denied', 'processed')),
      rejection_code text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      FOREIGN KEY (user_id, provider_account_id)
        REFERENCES portfolio_provider_accounts(user_id, id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX idx_portfolio_feishu_ingress_event
      ON portfolio_feishu_ingress_events (provider_account_id, provider_event_id);
    CREATE TABLE integration_feishu_configs (
      user_id text PRIMARY KEY NOT NULL,
      command_prefix text NOT NULL DEFAULT '/openforge'
    );
    CREATE TABLE integration_feishu_user_mappings (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      feishu_user_id text NOT NULL,
      openforge_user_id text NOT NULL
    );
    CREATE INDEX idx_integration_feishu_user_mappings_openforge_user
      ON integration_feishu_user_mappings (user_id, openforge_user_id);
    CREATE TABLE __drizzle_migrations (
      id integer PRIMARY KEY AUTOINCREMENT,
      hash text NOT NULL,
      created_at numeric
    );
    INSERT INTO users (id) VALUES ('user-stale');
    INSERT INTO portfolio_provider_accounts (id, user_id) VALUES ('account-stale', 'user-stale');
    INSERT INTO __drizzle_migrations (hash, created_at)
      VALUES ('stale-0050-hash', ${migration0050CreatedAt});
  `);
  insertIngress(db, "ingress-legacy", "event-legacy", "legacy");
  insertIngress(db, "ingress-portfolio", "event-portfolio", "portfolio");
  db.prepare(`
    UPDATE portfolio_feishu_ingress_events
    SET transport = 'webhook', state = 'denied', rejection_code = 'STALE_DENIAL',
        created_at = 2, updated_at = 3
    WHERE id = 'ingress-legacy'
  `).run();
  return db;
}

function readIngressRows(db: Database.Database): unknown[] {
  return db.prepare(`
    SELECT id, user_id, provider_account_id, provider_event_id, transport,
           handler_kind, event_digest, state, rejection_code, created_at, updated_at
    FROM portfolio_feishu_ingress_events
    ORDER BY id
  `).all();
}

function insertIngress(
  db: Database.Database,
  id: string,
  eventId: string,
  handlerKind: string,
  accountId = "account-stale",
  userId = "user-stale"
): void {
  db.prepare(`
    INSERT INTO portfolio_feishu_ingress_events (
      id, user_id, provider_account_id, provider_event_id, transport,
      handler_kind, event_digest, state, rejection_code, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'long_connection', ?, ?, 'admitted', NULL, 1, 1)
  `).run(id, userId, accountId, eventId, handlerKind, `digest-${id}`);
}

function assertLedgerContract(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(portfolio_feishu_ingress_events)")
    .all() as Array<{ name: string; notnull: number; pk: number }>;
  assert.deepEqual(columns.map((column) => column.name), ingressColumns);
  assert.deepEqual(
    columns.map(({ name, notnull, pk }) => ({ name, notnull, pk })),
    ingressColumns.map((name) => ({
      name,
      notnull: name === "rejection_code" ? 0 : 1,
      pk: name === "id" ? 1 : 0
    }))
  );

  const indexes = db.prepare("PRAGMA index_list(portfolio_feishu_ingress_events)")
    .all() as Array<{ name: string; unique: number }>;
  assert.equal(
    indexes.some((index) => index.name === "idx_portfolio_feishu_ingress_event" && index.unique === 1),
    true
  );

  const foreignKeys = db.prepare("PRAGMA foreign_key_list(portfolio_feishu_ingress_events)")
    .all() as Array<{ table: string; from: string; to: string; on_delete: string; on_update: string }>;
  assert.deepEqual(
    foreignKeys
      .filter((foreignKey) => foreignKey.table === "portfolio_provider_accounts")
      .map(({ from, to, on_delete, on_update }) => ({ from, to, on_delete, on_update }))
      .sort((left, right) => left.from.localeCompare(right.from)),
    [
      { from: "provider_account_id", to: "id", on_delete: "CASCADE", on_update: "NO ACTION" },
      { from: "user_id", to: "user_id", on_delete: "CASCADE", on_update: "NO ACTION" }
    ]
  );
}
