import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import Sqlite from "better-sqlite3";
import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";

import { initializeDatabase } from "../src/db/client.js";
import { ModelProviderRepository } from "../src/db/repositories/model-provider-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";

const migrationsFolder = fileURLToPath(new URL("../src/db/migrations", import.meta.url));
const migrations = readMigrationFiles({ migrationsFolder });
const failover = migrations.find((entry) => entry.folderMillis === 1792700000000)!;
const foundation = migrations.find((entry) => entry.folderMillis === 1793532598338)!;
const readonly = migrations.find((entry) => entry.folderMillis === 1793546075293)!;
type History = "fresh" | "upstream" | "foundation" | "readonly";

function apply(db: Sqlite.Database, migration: MigrationMeta): void {
  for (const statement of migration.sql) db.exec(statement);
  db.prepare("INSERT INTO __drizzle_migrations(hash, created_at) VALUES (?, ?)")
    .run(migration.hash, migration.folderMillis);
}

function fixture(history: History) {
  const dir = mkdtempSync(path.join(tmpdir(), "forgebadger-branch-upgrade-"));
  const dbPath = path.join(dir, "fixture.db");
  const db = new Sqlite(dbPath);
  db.pragma("foreign_keys = OFF");
  const expectedAssignments: Array<Record<string, unknown>> = [];
  if (history !== "fresh") {
    db.exec("CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)");
    for (const migration of migrations.filter((entry) => entry.folderMillis < failover.folderMillis)) apply(db, migration);
    if (history === "upstream") apply(db, failover);
    if (history === "foundation" || history === "readonly") apply(db, foundation);
    if (history === "readonly") apply(db, readonly);
    const user = new UserRepository(db).create("branch-upgrade@example.test", "fixture-hash");
    const providers = new ModelProviderRepository(db, user.id, randomBytes(32).toString("hex"));
    for (let position = 1; position <= (history === "upstream" ? 2 : 1); position += 1) {
      const provider = providers.createProviderProfile({
        name: `Fixture ${position}`, providerKey: `fixture-${position}`, authType: "api_key",
        baseUrl: "https://api.example.test", apiFormat: "anthropic", supportedAdapters: ["claude"]
      });
      const credential = providers.createCredential({ providerProfileId: provider.id, label: "Fixture", plaintextSecret: "fixture-only-key" });
      if (history === "upstream") {
        db.prepare("INSERT INTO claude_route_assignments(user_id, provider_profile_id, credential_id, updated_at, position) VALUES (?, ?, ?, ?, ?)")
          .run(user.id, provider.id, credential.id, 123 + position, position);
      } else {
        db.prepare("INSERT INTO claude_route_assignments(user_id, provider_profile_id, credential_id, updated_at) VALUES (?, ?, ?, ?)")
          .run(user.id, provider.id, credential.id, 123 + position);
      }
      expectedAssignments.push({ user_id: user.id, provider_profile_id: provider.id,
        credential_id: credential.id, updated_at: 123 + position, position });
    }
    if (history === "foundation" || history === "readonly") {
      db.prepare(`INSERT INTO companion_host(id,host_id,relay_url,signing_public_key,encryption_public_key,
        signing_private_key_encrypted,encryption_private_key_encrypted,created_at,updated_at)
        VALUES ('fixture-host','fixture-host','wss://relay.example.test','fixture-public','fixture-public',
        'fixture-encrypted','fixture-encrypted',1,1)`).run();
    }
  }
  db.close();
  return { dir, dbPath, expectedAssignments };
}

function assertUpgraded(db: Sqlite.Database, expectedAssignments: Array<Record<string, unknown>>) {
  assert.deepEqual(db.prepare("SELECT * FROM claude_route_assignments ORDER BY position").all(), expectedAssignments);
  const ledger = db.prepare("SELECT COUNT(*) AS count FROM __drizzle_migrations WHERE hash=?").get(failover.hash) as { count: number };
  assert.equal(ledger.count, 1);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='companion_outbox'").get());
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
}

for (const history of ["fresh", "upstream", "foundation", "readonly"] as const) {
  it(`upgrades ${history} history without losing assignments or reapplying Companion migrations`, () => {
    const f = fixture(history);
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const db = initializeDatabase(f.dbPath);
        try {
          assertUpgraded(db, f.expectedAssignments);
          if (history === "foundation" || history === "readonly") {
            assert.deepEqual(db.prepare("SELECT id, host_id, relay_url FROM companion_host").all(), [{
              id: "fixture-host", host_id: "fixture-host", relay_url: "wss://relay.example.test"
            }]);
          }
        } finally { db.close(); }
      }
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  });
}

it("rolls back the schema and assignment data when recording the recovered migration fails", () => {
  const f = fixture("foundation");
  try {
    const setup = new Sqlite(f.dbPath);
    setup.exec(`CREATE TRIGGER reject_recovery BEFORE INSERT ON __drizzle_migrations
      WHEN NEW.created_at=1792700000000 BEGIN SELECT RAISE(ABORT, 'fixture-recovery-rejected'); END`);
    setup.close();
    assert.throws(() => initializeDatabase(f.dbPath), /fixture-recovery-rejected/);
    const check = new Sqlite(f.dbPath);
    try {
      const columns = check.pragma("table_info(claude_route_assignments)") as Array<{ name: string }>;
      assert.equal(columns.some((column) => column.name === "position"), false);
      const { position: _position, ...legacy } = f.expectedAssignments[0]!;
      assert.deepEqual(check.prepare("SELECT * FROM claude_route_assignments").all(), [legacy]);
      assert.equal(check.prepare("SELECT 1 FROM __drizzle_migrations WHERE hash=?").get(failover.hash), undefined);
      assert.equal(check.prepare("SELECT 1 FROM sqlite_master WHERE name='claude_route_assignments_new'").get(), undefined);
    } finally { check.close(); }
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

it("refuses an unrecognized assignment schema instead of rebuilding it", () => {
  const f = fixture("foundation");
  try {
    const setup = new Sqlite(f.dbPath);
    setup.exec("ALTER TABLE claude_route_assignments ADD COLUMN position INTEGER NOT NULL DEFAULT 1");
    setup.close();
    assert.throws(() => initializeDatabase(f.dbPath), /FORGEBADGER_BRANCH_MIGRATION_HISTORY_CONFLICT/);
    const check = new Sqlite(f.dbPath);
    try {
      assert.deepEqual(check.prepare("SELECT * FROM claude_route_assignments").all(), f.expectedAssignments);
      assert.equal(check.prepare("SELECT 1 FROM __drizzle_migrations WHERE hash=?").get(failover.hash), undefined);
    } finally { check.close(); }
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
