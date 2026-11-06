import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import Sqlite from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { listAvailableTemplates } from "../src/cli/init.js";
import { initializeDatabase } from "../src/db/client.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";

const migrationsFolder = fileURLToPath(new URL("../src/db/migrations", import.meta.url));
const migrations = readMigrationFiles({ migrationsFolder });
const target = migrations.find((migration) => migration.folderMillis === 1793620299655)!;

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "forgebadger-conversation-upgrade-"));
  const dbPath = path.join(dir, "fixture.db");
  const db = new Sqlite(dbPath);
  db.pragma("foreign_keys = OFF");
  db.exec("CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)");
  for (const migration of migrations.filter((entry) => entry.folderMillis < target.folderMillis)) {
    for (const statement of migration.sql) db.exec(statement);
    db.prepare("INSERT INTO __drizzle_migrations(hash,created_at) VALUES (?,?)")
      .run(migration.hash, migration.folderMillis);
  }
  for (const name of ["owner", "other"]) {
    const user = new UserRepository(db).create(`${name}@example.test`, "fixture");
    db.prepare(`INSERT INTO projects(id,user_id,name,path,ai_tool,status,is_imported,created_at,updated_at)
      VALUES (?,?,'project',?,'claude','active',0,1,1)`).run(name, user.id, `/tmp/${name}`);
    db.prepare(`INSERT INTO channel_identities(id,user_id,channel,account_id,account_revision,external_user_id,chat_id,created_at)
      VALUES (?,?,'feishu','account',1,'external','chat',1)`).run(name, user.id);
    for (const kind of ["direct", "thread"]) {
      db.prepare(`INSERT INTO copilot_conversations(id,user_id,title,status,channel_owned,created_at,updated_at)
        VALUES (?,?,'retained','active',1,1,1)`).run(`${name}-${kind}`, user.id);
    }
    db.prepare(`INSERT INTO channel_routes(id,user_id,identity_id,project_id,conversation_id,created_at)
      VALUES (?,?,?,?,?,1)`).run(name, user.id, name, name, `${name}-direct`);
    db.prepare(`INSERT INTO channel_messages(id,user_id,route_id,account_id,event_id,message_id,payload_encrypted,payload_digest,created_at)
      VALUES (?,?,?,'account',?,?,'encrypted-fixture','digest',1)`).run(name, user.id, name, name, name);
    for (const kind of ["direct", "thread"]) {
      db.prepare(`INSERT INTO channel_route_sessions(user_id,route_id,chat_type,chat_id,thread_id,conversation_id,model_profile_id)
        VALUES (?,?,'p2p','chat',?,?,?)`).run(user.id, name, kind, `${name}-${kind}`, `${name}-model`);
    }
  }
  const sessions = db.prepare("SELECT * FROM channel_route_sessions ORDER BY conversation_id").all();
  const messages = db.prepare("SELECT * FROM channel_messages ORDER BY id").all();
  db.close();
  return { dir, dbPath, sessions, messages };
}

it("upgrades populated channel mappings through the production initializer and reopens without data loss", () => {
  const f = fixture();
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const db = initializeDatabase(f.dbPath);
      try {
        assert.deepEqual(db.prepare("SELECT * FROM channel_route_sessions ORDER BY conversation_id").all(), f.sessions);
        assert.deepEqual(db.prepare("SELECT * FROM channel_messages ORDER BY id").all(), f.messages);
        assert.deepEqual(db.prepare("SELECT id,project_id FROM copilot_conversations ORDER BY id").all(), [
          { id: "other-direct", project_id: "other" }, { id: "other-thread", project_id: "other" },
          { id: "owner-direct", project_id: "owner" }, { id: "owner-thread", project_id: "owner" }
        ]);
        assert.deepEqual(db.pragma("foreign_key_check"), []);
        assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
        assert.equal((db.prepare("SELECT count(*) AS n FROM __drizzle_migrations WHERE hash=?").get(target.hash) as { n: number }).n, 1);
      } finally { db.close(); }
    }
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

it("upgrades a populated database when the CLI lists templates before Gateway startup", () => {
  const f = fixture();
  try {
    const env = { FORGEBADGER_DB_PATH: f.dbPath };
    assert.ok(listAvailableTemplates(env).some((template) => template.isBuiltin));
    const db = new Sqlite(f.dbPath, { readonly: true });
    try {
      assert.deepEqual(db.prepare("SELECT * FROM channel_route_sessions ORDER BY conversation_id").all(), f.sessions);
      assert.deepEqual(db.prepare("SELECT * FROM channel_messages ORDER BY id").all(), f.messages);
      assert.deepEqual(db.pragma("foreign_key_check"), []);
      assert.deepEqual(db.prepare("SELECT hash FROM __drizzle_migrations WHERE created_at = ?").all(target.folderMillis), [
        { hash: target.hash }
      ]);
    } finally { db.close(); }
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

it("rolls back mappings, project backfill, schema and ledger when the migration fails", () => {
  const f = fixture();
  try {
    const setup = new Sqlite(f.dbPath);
    setup.exec(`CREATE TRIGGER reject_project_migration BEFORE INSERT ON __drizzle_migrations
      WHEN NEW.created_at=1793620299655 BEGIN SELECT RAISE(ABORT, 'fixture-migration-rejected'); END`);
    setup.close();
    assert.throws(() => initializeDatabase(f.dbPath), (error: unknown) =>
      error instanceof Error && error.cause instanceof Error && /fixture-migration-rejected/.test(error.cause.message));
    const db = new Sqlite(f.dbPath);
    try {
      assert.deepEqual(db.prepare("SELECT * FROM channel_route_sessions ORDER BY conversation_id").all(), f.sessions);
      assert.deepEqual(db.prepare("SELECT * FROM channel_messages ORDER BY id").all(), f.messages);
      assert.ok((db.pragma("table_info(channel_routes)") as Array<{ name: string }>).some((column) => column.name === "project_id"));
      assert.ok(!(db.pragma("table_info(copilot_conversations)") as Array<{ name: string }>).some((column) => column.name === "project_id"));
      assert.equal(db.prepare("SELECT 1 FROM __drizzle_migrations WHERE hash=?").get(target.hash), undefined);
      assert.deepEqual(db.pragma("foreign_key_check"), []);
    } finally { db.close(); }
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
