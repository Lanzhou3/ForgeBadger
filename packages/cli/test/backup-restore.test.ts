import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { loadOrCreateRuntimeConfig } from "../src/runtime/config.js";
import { createInstanceBackup, restoreInstanceBackup } from "../src/runtime/backup.js";
import { parseCliArgs, runCli } from "../src/index.js";

const migrationsDir = fileURLToPath(new URL("../../gateway/src/db/migrations", import.meta.url));
let root: string;
let stateDir: string;
let db: Database.Database;
let key: string;
let ports: number[];
async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}
function encrypt(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  return JSON.stringify({ algorithm: "aes-256-gcm", iv: iv.toString("base64url"), ciphertext: ciphertext.toString("base64url"), authTag: cipher.getAuthTag().toString("base64url") });
}
beforeEach(async () => {
  root = realpathSync(await mkdtemp(path.join(tmpdir(), "fb-backup-")));
  stateDir = path.join(root, "state");
  ports = [await freePort(), await freePort()];
  const config = await loadOrCreateRuntimeConfig({ stateDir, env: {}, gatewayPort: ports[0], webPort: ports[1] });
  config.gateway.port = ports[0]!; config.web.port = ports[1]!;
  await writeFile(path.join(stateDir, "config.json"), JSON.stringify(config));
  key = config.secrets.masterKey;
  db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  migrate(drizzle(db), { migrationsFolder: migrationsDir });
  db.prepare("INSERT INTO users (id, username, email, password_hash) VALUES ('fixture', 'fixture', 'backup@fixture.test', 'hash')").run();
  db.prepare("INSERT INTO api_keys (id,user_id,provider,key_encrypted) VALUES ('encrypted','fixture','fixture',?)").run(encrypt("recoverable-fixture-value"));
});
afterEach(async () => { if (db.open) db.close(); await rm(root, { recursive: true, force: true }); });
const backup = () => createInstanceBackup({ output: path.join(root, "backup"), stateDir, env: {}, migrationsDir });
const restore = () => restoreInstanceBackup({ from: path.join(root, "backup"), to: path.join(root, "restored"), env: {}, migrationsDir });

describe("CLI backup/restore", () => {
  it("online-backs up WAL data and restores decryptable state into a new directory", async () => {
    db.prepare("INSERT INTO users (id,username,email,password_hash) VALUES ('wal','wal','wal@fixture.test','hash')").run();
    await backup();
    const manifest = JSON.parse(await readFile(path.join(root, "backup", "manifest.json"), "utf8"));
    assert.equal(manifest.format, "forgebadger-instance-backup");
    assert.equal(manifest.tables.users, 2);
    assert.ok(!JSON.stringify(manifest).includes(key));
    assert.equal((await stat(path.join(root, "backup"))).mode & 0o777, 0o700);
    for (const file of ["config.json", "forgebadger.db", "manifest.json"]) assert.equal((await stat(path.join(root, "backup", file))).mode & 0o777, 0o600);
    await restore();
    const restoredConfig = JSON.parse(await readFile(path.join(root, "restored", "config.json"), "utf8"));
    assert.equal(restoredConfig.stateDir, path.join(root, "restored"));
    assert.equal(restoredConfig.dbPath, path.join(root, "restored", "forgebadger.db"));
    assert.equal(restoredConfig.secrets.masterKey, key);
    const originalConfig = JSON.parse(await readFile(path.join(stateDir, "config.json"), "utf8"));
    assert.notEqual(restoredConfig.secrets.jwtSecret, originalConfig.secrets.jwtSecret);
    const recovered = new Database(restoredConfig.dbPath, { readonly: true });
    assert.equal((recovered.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n, 2);
    const envelope = JSON.parse((recovered.prepare("SELECT key_encrypted FROM api_keys WHERE id='encrypted'").get() as { key_encrypted: string }).key_encrypted);
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(restoredConfig.secrets.masterKey, "hex"), Buffer.from(envelope.iv, "base64url"));
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64url"));
    assert.equal(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64url")), decipher.final()]).toString(), "recoverable-fixture-value");
    recovered.close();
    assert.deepEqual((await readdir(path.join(root, "backup"))).sort(), ["config.json", "forgebadger.db", "manifest.json"]);
  });

  it("invalidates restored opaque browser sessions while preserving source and backup", async () => {
    db.prepare("INSERT INTO auth_sessions(id,user_id,token_hash,expires_at,absolute_expires_at) VALUES ('auth','fixture','fixture-hash',9999999999,9999999999)").run();
    await backup(); await restore();
    const restored = new Database(path.join(root, "restored", "forgebadger.db"), { readonly: true });
    const saved = new Database(path.join(root, "backup", "forgebadger.db"), { readonly: true });
    try {
      assert.equal((restored.prepare("SELECT count(*) AS n FROM auth_sessions").get() as { n: number }).n, 0);
      assert.equal((saved.prepare("SELECT count(*) AS n FROM auth_sessions").get() as { n: number }).n, 1);
      assert.equal((db.prepare("SELECT count(*) AS n FROM auth_sessions").get() as { n: number }).n, 1);
    } finally { restored.close(); saved.close(); }
  });

  it("rejects preexisting output/target directories and symlink destinations", async () => {
    await backup();
    await assert.rejects(backup(), /exist/i);
    await mkdir(path.join(root, "restored"));
    await assert.rejects(restore(), /exist/i);
    await rm(path.join(root, "restored"), { recursive: true });
    await symlink(stateDir, path.join(root, "restored"), "dir");
    await assert.rejects(restore(), /exist|symlink/i);
    await symlink(path.join(root, "backup"), path.join(root, "backup-alias"), "dir");
    await assert.rejects(restoreInstanceBackup({ from: path.join(root, "backup-alias"), to: path.join(root, "other"), env: {}, migrationsDir }), /symlink|canonical/i);
  });

  it("rejects corrupted hashes and leaves no published restore", async () => {
    await backup();
    await writeFile(path.join(root, "backup", "forgebadger.db"), "corrupted");
    await assert.rejects(restore(), /hash|digest/i);
    assert.ok(!(await readdir(root)).includes("restored"));
  });

  it("rejects future schema versions even if the file hashes are recomputed", async () => {
    await backup();
    const file = path.join(root, "backup", "forgebadger.db");
    const other = new Database(file);
    other.prepare("INSERT INTO __drizzle_migrations(hash,created_at) VALUES ('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',9999999999999)").run(); other.close();
    const manifestPath = path.join(root, "backup", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.databaseSha256 = createHash("sha256").update(await readFile(file)).digest("hex");
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(restore(), /migration|schema|compatible/i);
  });

  it("refuses restore while the backed-up Gateway endpoint is active", async () => {
    await backup();
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(ports[0]!, "127.0.0.1", resolve));
    try { await assert.rejects(restore(), /running|stop|available/i); }
    finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
    assert.ok(!(await readdir(root)).includes("restored"));
  });

  it("refuses backup with a config key that cannot decrypt database content", async () => {
    const file = path.join(stateDir, "config.json");
    const config = JSON.parse(await readFile(file, "utf8"));
    config.secrets.masterKey = randomBytes(32).toString("hex");
    await writeFile(file, JSON.stringify(config));
    await assert.rejects(backup(), /decrypt|key/i);
    assert.ok(!(await readdir(root)).includes("backup"));
  });

  it("rejects foreign-key corruption even when the database hash is updated", async () => {
    await backup();
    const file = path.join(root, "backup", "forgebadger.db");
    const corrupted = new Database(file);
    corrupted.pragma("foreign_keys = OFF");
    corrupted.prepare("UPDATE api_keys SET user_id = 'missing'").run(); corrupted.close();
    const manifestPath = path.join(root, "backup", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.databaseSha256 = createHash("sha256").update(await readFile(file)).digest("hex");
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(restore(), /foreign key/i);
  });

  it("rejects SQLite integrity corruption and unsupported encrypted formats", async () => {
    await backup();
    const file = path.join(root, "backup", "forgebadger.db");
    const broken = await readFile(file); broken.fill(0, 0, 16); await writeFile(file, broken);
    const manifestPath = path.join(root, "backup", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.databaseSha256 = createHash("sha256").update(broken).digest("hex");
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(restore(), /database|integrity/i);
    await rm(path.join(root, "backup"), { recursive: true });
    db.prepare("UPDATE api_keys SET key_encrypted = 'unsupported-format'").run();
    await assert.rejects(backup(), /encrypted format|decrypt/i);
  });

  it("supports original 32-byte environment keys without creating source config", async () => {
    const legacyKey = randomBytes(16).toString("hex");
    key = Buffer.from(legacyKey).toString("hex");
    db.prepare("UPDATE api_keys SET key_encrypted = ?").run(encrypt("legacy-fixture"));
    await rm(path.join(stateDir, "config.json"));
    await createInstanceBackup({ output: path.join(root, "backup"), stateDir, migrationsDir, env: {
      FORGEBADGER_MASTER_KEY: legacyKey, FORGEBADGER_JWT_SECRET: randomBytes(32).toString("hex"),
      FORGEBADGER_PORT: String(ports[0]), FORGEBADGER_WEB_PORT: String(ports[1])
    } });
    const config = JSON.parse(await readFile(path.join(root, "backup", "config.json"), "utf8"));
    assert.equal(config.secrets.masterKey, key);
    assert.ok(!(await readdir(stateDir)).includes("config.json"));
    await restore();
  });

  it("rejects file symlinks and manifest count mismatches without publishing state", async () => {
    await backup();
    const file = path.join(root, "backup", "manifest.json");
    const manifest = JSON.parse(await readFile(file, "utf8"));
    manifest.tables.users += 1;
    await writeFile(file, JSON.stringify(manifest));
    await assert.rejects(restore(), /count|manifest/i);
    await rm(path.join(root, "backup", "config.json"));
    await symlink(path.join(stateDir, "config.json"), path.join(root, "backup", "config.json"));
    await assert.rejects(restore(), /regular|symlink/i);
    assert.ok(!(await readdir(root)).includes("restored"));
  });

  it("parses and dispatches backup and restore commands with strict required flags", async () => {
    assert.deepEqual(parseCliArgs(["backup", "--output", "/new"]), { command: "backup", output: "/new" });
    assert.deepEqual(parseCliArgs(["restore", "--from", "/backup", "--to", "/fresh"]), { command: "restore", from: "/backup", to: "/fresh" });
    assert.throws(() => parseCliArgs(["backup"]));
    assert.throws(() => parseCliArgs(["restore", "--from", "/backup"]));
    assert.throws(() => parseCliArgs(["backup", "--output", "/a", "--output", "/b"]));
    assert.equal(await runCli(["backup", "--output", "/new"], { backupRunner: async (command) => command.output === "/new" ? 0 : 1 }), 0);
  });
});

describe("historical migration compatibility", () => {
  it("backs up and restores equivalent historical schema without rewriting recorded hashes", async () => {
    const recordedHash = "a".repeat(64);
    db.prepare("UPDATE __drizzle_migrations SET hash=? WHERE created_at=(SELECT MIN(created_at) FROM __drizzle_migrations)").run(recordedHash);
    const ledger = db.prepare("SELECT hash,created_at FROM __drizzle_migrations ORDER BY created_at").all();
    await backup(); await restore();
    const restored = new Database(path.join(root, "restored", "forgebadger.db"), { readonly: true });
    try {
      assert.deepEqual(restored.prepare("SELECT hash,created_at FROM __drizzle_migrations ORDER BY created_at").all(), ledger);
      assert.deepEqual(db.prepare("SELECT hash,created_at FROM __drizzle_migrations ORDER BY created_at").all(), ledger);
      assert.equal((restored.prepare("SELECT COUNT(*) n FROM users").get() as { n:number }).n, 1);
    } finally { restored.close(); }
  });

  it("rejects a missing schema object despite equivalent known migration timestamps", async () => {
    db.prepare("UPDATE __drizzle_migrations SET hash=? WHERE created_at=(SELECT MIN(created_at) FROM __drizzle_migrations)").run("b".repeat(64));
    db.exec("DROP TRIGGER delivery_verifications_final_immutable");
    await assert.rejects(backup(), /schema|compatible/i);
    assert.ok(!(await readdir(root)).includes("backup"));
  });

  it("rejects unknown or duplicate migration timestamps even when schema is intact", async () => {
    db.prepare("UPDATE __drizzle_migrations SET created_at=1 WHERE created_at=(SELECT MIN(created_at) FROM __drizzle_migrations)").run();
    await assert.rejects(backup(), /migration|compatible/i);
  });
});

// sqlite_ is SQLite's reserved prefix; sqliteX is an ordinary business name.
it("rejects extra business schema objects resembling SQLite internal names", async () => {
  db.exec("CREATE TABLE sqliteXhidden(secret TEXT)");
  await assert.rejects(backup(), /schema|compatible/i);
  db.exec("DROP TABLE sqliteXhidden; CREATE TRIGGER sqliteXtrigger AFTER UPDATE ON users BEGIN SELECT 1; END;");
  await assert.rejects(backup(), /schema|compatible/i);
});
it("rejects reordered or duplicated historical ledger timestamps", async () => {
  const entries=db.prepare('SELECT rowid AS sequence,created_at FROM __drizzle_migrations ORDER BY rowid LIMIT 2').all() as Array<{sequence:number;created_at:number}>;
  assert.equal(db.prepare('UPDATE __drizzle_migrations SET created_at=? WHERE rowid=?').run(entries[1]!.created_at,entries[0]!.sequence).changes,1);
  assert.equal(db.prepare('UPDATE __drizzle_migrations SET created_at=? WHERE rowid=?').run(entries[0]!.created_at,entries[1]!.sequence).changes,1);
  await assert.rejects(backup(), /migration|compatible/i);
  assert.equal(db.prepare('UPDATE __drizzle_migrations SET created_at=? WHERE rowid=?').run(entries[1]!.created_at,entries[1]!.sequence).changes,1);
  await assert.rejects(backup(), /migration|compatible/i);
});
