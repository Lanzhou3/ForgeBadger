import { createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { inspectRuntimeConfig, type LoadRuntimeConfigOptions, type RuntimeConfig } from "./config.js";
import { resolveInstalledPaths } from "./paths.js";
import { assertPortAvailable } from "./ports.js";

interface Statement {
  run(...args: Array<string | number>): unknown;
  all(...args: Array<string | number>): unknown[];
  iterate(...args: Array<string | number>): Iterable<unknown>;
}
interface SqliteDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): Statement;
  pragma(sql: string): unknown;
  backup(destination: string): Promise<unknown>;
  close(): void;
}
const Sqlite = createRequire(import.meta.url)("better-sqlite3") as new (file: string, options?: { readonly: boolean; fileMustExist: boolean }) => SqliteDatabase;
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const migrationSchema = z.object({ hash: hashSchema, createdAt: z.number().int().positive() }).strict();
const manifestSchema = z.object({
  format: z.literal("forgebadger-instance-backup"), version: z.literal(1),
  applicationVersion: z.string().min(1), createdAt: z.string().datetime(),
  databaseSha256: hashSchema, configSha256: hashSchema, schemaSha256: hashSchema,
  migrations: z.array(migrationSchema), tables: z.record(z.number().int().nonnegative()),
  containsRuntimeSecrets: z.literal(true)
}).strict();
type Manifest = z.infer<typeof manifestSchema>;
interface BackupOptions extends LoadRuntimeConfigOptions { output: string; migrationsDir?: string }
interface RestoreOptions { from: string; to: string; env?: NodeJS.ProcessEnv; migrationsDir?: string }

async function directory(value: string): Promise<string> {
  const absolute = path.resolve(value);
  const canonical = await realpath(absolute);
  if (absolute !== canonical || !(await lstat(absolute)).isDirectory()) throw new Error("Backup paths must be canonical directories without symlinks");
  return canonical;
}

async function regularFile(file: string): Promise<void> {
  const info = await lstat(file);
  if (!info.isFile() || await realpath(file) !== path.resolve(file)) throw new Error("Backup contents must be regular files without symlinks");
}

async function digest(file: string): Promise<string> {
  await regularFile(file);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function readJson(file: string): Promise<unknown> {
  await regularFile(file);
  if ((await lstat(file)).size > 4 * 1024 * 1024) throw new Error("Backup metadata exceeds its size limit");
  try { return JSON.parse(await readFile(file, "utf8")) as unknown; }
  catch { throw new Error("Backup metadata is not valid JSON"); }
}

async function privateJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  await chmod(file, 0o600);
}

/** Reserve a new name exclusively, then publish the completed sibling staging
 * directory over only our own unchanged empty reservation. Never remove a
 * destination supplied by the operator or another process. */
async function publishNewDirectory<T>(destination: string, write: (staging: string) => Promise<T>): Promise<T> {
  const target = path.resolve(destination);
  const parent = await directory(path.dirname(target));
  if (path.basename(target) === "." || path.basename(target) === "..") throw new Error("Invalid backup destination");
  try { await mkdir(target, { mode: 0o700 }); }
  catch { throw new Error("Destination already exists or cannot be exclusively created"); }
  const reserved = await lstat(target);
  const staging = await mkdtemp(path.join(parent, ".forgebadger-backup-staging-"));
  await chmod(staging, 0o700);
  let published = false;
  try {
    const result = await write(staging);
    const current = await lstat(target);
    if (!current.isDirectory() || current.ino !== reserved.ino || current.dev !== reserved.dev) throw new Error("Destination changed during backup/restore");
    await directory(parent);
    await rename(staging, target);
    published = true;
    return result;
  } finally {
    if (!published) {
      await rm(staging, { recursive: true, force: true });
      const current = await lstat(target).catch(() => null);
      if (current?.isDirectory() && current.ino === reserved.ino && current.dev === reserved.dev) await rmdir(target).catch(() => undefined);
    }
  }
}

function quoteIdentifier(value: string): string { return `"${value.replaceAll('"', '""')}"`; }

function databaseMetadata(db: SqliteDatabase): Pick<Manifest, "schemaSha256" | "tables" | "migrations"> {
  const integrity = db.pragma("integrity_check") as Array<{ integrity_check: string }>;
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") throw new Error("Database integrity check failed");
  if ((db.pragma("foreign_key_check") as unknown[]).length) throw new Error("Database foreign key check failed");
  const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all() as Array<{ type: string; name: string; tbl_name: string; sql: string | null }>;
  const tables: Record<string, number> = {};
  for (const table of schema.filter((row) => row.type === "table")) {
    const rows = db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table.name)}`).all() as Array<{ count: number }>;
    tables[table.name] = rows[0]!.count;
  }
  const migrations = db.prepare("SELECT hash, created_at AS createdAt FROM __drizzle_migrations ORDER BY rowid").all();
  const parsed = z.array(migrationSchema).safeParse(migrations);
  if (!parsed.success) throw new Error("Database migration schema contains invalid records");
  return { schemaSha256: createHash("sha256").update(JSON.stringify(schema)).digest("hex"), tables, migrations: parsed.data };
}

async function supportedMigrations(override?: string): Promise<Array<z.infer<typeof migrationSchema> & { sql: string }>> {
  const bundled = path.join(path.dirname(resolveInstalledPaths().gatewayEntry), "db", "migrations");
  const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../gateway/src/db/migrations");
  const inSourceTree = path.basename(path.dirname(path.dirname(fileURLToPath(import.meta.url)))) === "src";
  const root = await directory(override ?? (inSourceTree ? source : bundled));
  const journal = z.object({ entries: z.array(z.object({ tag: z.string().regex(/^\d{4}_[a-z0-9_]+$/), when: z.number().int().positive() })) }).parse(await readJson(path.join(root, "meta", "_journal.json")));
  return Promise.all(journal.entries.map(async (entry) => {
    const file = path.join(root, `${entry.tag}.sql`);
    await regularFile(file);
    const sql = await readFile(file, "utf8");
    return { createdAt: entry.when, hash: createHash("sha256").update(sql).digest("hex"), sql };
  }));
}

async function assertCompatible(applied: Manifest["migrations"], db: SqliteDatabase, migrationsDir?: string): Promise<void> {
  const supported = await supportedMigrations(migrationsDir);
  if (!applied.length || applied.length > supported.length || applied.some((entry, index) => entry.createdAt !== supported[index]?.createdAt)) {
    throw new Error("Database migration schema is incompatible with this ForgeBadger package");
  }
  // Historical SQL hashes are provenance, not a writable compatibility flag.
  // Rebuild the exact known prefix and prove its resulting structure instead.
  // This proves schema compatibility, not historical data migration semantics.
  const reference = new Sqlite(":memory:");
  try {
    reference.pragma("foreign_keys = OFF");
    for (const migration of supported.slice(0, applied.length)) reference.exec(migration.sql);
    if (businessSchema(reference) !== businessSchema(db)) {
      throw new Error("Database schema is incompatible with its known migration prefix");
    }
  } finally { reference.close(); }
}

function businessSchema(db: SqliteDatabase): string {
  return JSON.stringify(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' AND name != '__drizzle_migrations' ORDER BY type,name").all());
}

/** Every encrypted DB cell uses the shared AES-GCM JSON envelope. Unknown or
 * legacy unsupported formats fail closed instead of claiming a usable restore. */
function verifyEncryptionKey(db: SqliteDatabase, masterKey: string): void {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*'").all() as Array<{ name: string }>;
  for (const { name } of names) {
    const columns = db.prepare("SELECT name FROM pragma_table_info(?)").all(name) as Array<{ name: string }>;
    for (const column of columns.filter((entry) => entry.name.endsWith("_encrypted"))) {
      const identifier = quoteIdentifier(column.name);
      const rows = db.prepare(`SELECT ${identifier} AS value FROM ${quoteIdentifier(name)} WHERE ${identifier} IS NOT NULL`).iterate();
      for (const row of rows) verifyEncryptedCell((row as { value: unknown }).value, masterKey);
    }
  }
}

function verifyEncryptedCell(value: unknown, masterKey: string): void {
  try {
    if (typeof value !== "string") throw new Error();
    const envelope = z.object({ algorithm: z.literal("aes-256-gcm"), iv: z.string(), ciphertext: z.string(), authTag: z.string() }).parse(JSON.parse(value));
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(masterKey, "hex"), Buffer.from(envelope.iv, "base64url"));
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64url"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64url")), decipher.final()]);
    plaintext.fill(0);
  } catch { throw new Error("Runtime master key cannot decrypt database content, or an unsupported encrypted format is present"); }
}

async function sourceConfig(options: BackupOptions): Promise<RuntimeConfig> {
  const env = options.env ?? process.env;
  const inspection = await inspectRuntimeConfig(options);
  await directory(inspection.stateDir);
  if (inspection.config) {
    const masterOverride = env.FORGEBADGER_MASTER_KEY;
    if (masterOverride && normalizeMasterKey(masterOverride) !== inspection.config.secrets.masterKey) throw new Error("Environment master key conflicts with the saved runtime config");
    return inspection.config;
  }
  const masterKey = normalizeMasterKey(env.FORGEBADGER_MASTER_KEY ?? "");
  const jwtSecret = env.FORGEBADGER_JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32) throw new Error("An existing config or original FORGEBADGER_MASTER_KEY and FORGEBADGER_JWT_SECRET is required for a recoverable backup");
  return { version: 1, stateDir: inspection.stateDir, dbPath: path.resolve(env.FORGEBADGER_DB_PATH ?? path.join(inspection.stateDir, "forgebadger.db")), gateway: { host: env.FORGEBADGER_HOST ?? inspection.gateway.host, port: environmentPort(env.FORGEBADGER_PORT, inspection.gateway.port) }, web: { host: env.FORGEBADGER_WEB_HOST ?? inspection.web.host, port: environmentPort(env.FORGEBADGER_WEB_PORT, inspection.web.port) }, secrets: { masterKey, jwtSecret } };
}

function environmentPort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) throw new Error("Runtime port must be an integer between 1 and 65535");
  return z.number().int().min(1).max(65535).parse(Number(value));
}

async function assertSelectedRuntimeStopped(env: NodeJS.ProcessEnv): Promise<void> {
  if (env.FORGEBADGER_STATE_DIR) {
    const current = await inspectRuntimeConfig({ env });
    if (current.config) {
      await assertPortAvailable(current.gateway.host, current.gateway.port);
      await assertPortAvailable(current.web.host, current.web.port);
    }
  } else if (env.FORGEBADGER_PORT) {
    await assertPortAvailable(env.FORGEBADGER_HOST ?? "127.0.0.1", environmentPort(env.FORGEBADGER_PORT, 48731));
  }
}

function normalizeMasterKey(value: string): string {
  if (/^[a-f0-9]{64}$/i.test(value)) return value.toLowerCase();
  if (Buffer.byteLength(value) === 32) return Buffer.from(value).toString("hex");
  throw new Error("Original runtime master key is required and must contain 32 bytes or 64 hexadecimal characters");
}

export async function createInstanceBackup(options: BackupOptions): Promise<{ output: string }> {
  const config = await sourceConfig(options);
  await regularFile(config.dbPath);
  await supportedMigrations(options.migrationsDir);
  const application = z.object({ version: z.string() }).parse(await readJson(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../package.json")));
  await publishNewDirectory(options.output, async (staging) => {
    const databaseFile = path.join(staging, "forgebadger.db");
    const source = new Sqlite(config.dbPath, { readonly: true, fileMustExist: true });
    try { await source.backup(databaseFile); } finally { source.close(); }
    await chmod(databaseFile, 0o600);
    const snapshot = new Sqlite(databaseFile, { readonly: false, fileMustExist: true });
    let metadata: ReturnType<typeof databaseMetadata>;
    try {
      snapshot.pragma("journal_mode = DELETE"); metadata = databaseMetadata(snapshot);
      verifyEncryptionKey(snapshot, config.secrets.masterKey);
      await assertCompatible(metadata.migrations, snapshot, options.migrationsDir);
    }
    finally { snapshot.close(); }
    await privateJson(path.join(staging, "config.json"), config);
    await privateJson(path.join(staging, "manifest.json"), {
      format: "forgebadger-instance-backup", version: 1, applicationVersion: application.version,
      createdAt: new Date().toISOString(), containsRuntimeSecrets: true, ...metadata,
      databaseSha256: await digest(databaseFile), configSha256: await digest(path.join(staging, "config.json"))
    } satisfies Manifest);
  });
  return { output: path.resolve(options.output) };
}

function invalidateRestoredBrowserSessions(databaseFile: string): void {
  const restored = new Sqlite(databaseFile, { readonly: false, fileMustExist: true });
  try {
    const hasSessions = restored.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_sessions'").all().length > 0;
    if (hasSessions) restored.prepare("DELETE FROM auth_sessions").run();
    databaseMetadata(restored);
  } finally { restored.close(); }
}

export async function restoreInstanceBackup(options: RestoreOptions): Promise<{ stateDir: string }> {
  await assertSelectedRuntimeStopped(options.env ?? process.env);
  const from = await directory(options.from);
  if (JSON.stringify((await readdir(from)).sort()) !== JSON.stringify(["config.json", "forgebadger.db", "manifest.json"])) {
    throw new Error("Backup must contain exactly its database, config and manifest, without active WAL files");
  }
  const manifest = manifestSchema.parse(await readJson(path.join(from, "manifest.json")));
  const databaseFile = path.join(from, "forgebadger.db");
  if (await digest(databaseFile) !== manifest.databaseSha256 || await digest(path.join(from, "config.json")) !== manifest.configSha256) throw new Error("Backup file hash verification failed");
  const inspection = await inspectRuntimeConfig({ stateDir: from, env: {} });
  if (!inspection.config) throw new Error("Backup runtime config is missing");
  const config = inspection.config;
  await assertPortAvailable(config.gateway.host, config.gateway.port);
  await assertPortAvailable(config.web.host, config.web.port);
  const source = new Sqlite(databaseFile, { readonly: true, fileMustExist: true });
  try {
    const metadata = databaseMetadata(source);
    await assertCompatible(metadata.migrations, source, options.migrationsDir);
    if (JSON.stringify(metadata) !== JSON.stringify({ schemaSha256: manifest.schemaSha256, tables: manifest.tables, migrations: manifest.migrations })) throw new Error("Backup schema, migration or table-count manifest does not match database");
    verifyEncryptionKey(source, config.secrets.masterKey);
    await publishNewDirectory(options.to, async (staging) => {
      await source.backup(path.join(staging, "forgebadger.db"));
      await chmod(path.join(staging, "forgebadger.db"), 0o600);
      if (await digest(databaseFile) !== manifest.databaseSha256 || await digest(path.join(from, "config.json")) !== manifest.configSha256) {
        throw new Error("Backup changed during restore; hash verification failed");
      }
      if ((await readdir(from)).length !== 3) throw new Error("Backup became active during restore");
      await assertPortAvailable(config.gateway.host, config.gateway.port);
      await assertPortAvailable(config.web.host, config.web.port);
      invalidateRestoredBrowserSessions(path.join(staging, "forgebadger.db"));
      const target = path.resolve(options.to);
      await privateJson(path.join(staging, "config.json"), { ...config, stateDir: target, dbPath: path.join(target, "forgebadger.db"), secrets: { masterKey: config.secrets.masterKey, jwtSecret: randomBytes(48).toString("base64url") } });
    });
  } finally { source.close(); }
  return { stateDir: path.resolve(options.to) };
}
