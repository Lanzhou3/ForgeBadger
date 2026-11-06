import { readMigrationFiles } from "drizzle-orm/migrator";

import type { Database } from "./types.js";

const FOUNDATION_HASH = "6035fd7d2a5544a54389c9d8b6e5eebda78cdf4b298f617de330021fa78fd9ca";
const FAILOVER_HASH = "bdddf1fc4003a0d72717320fb70eb0578f75de506e9fedbce271cf7b40c581ed";
const LEGACY_COLUMNS = ["credential_id", "provider_profile_id", "updated_at", "user_id"];

/** A local Companion branch applied a newer timestamp before upstream 0143
 * arrived. Drizzle's timestamp cursor would skip that upstream migration.
 * Repair only this verified history; published migration bytes stay intact. */
export function recoverCompanionMigrationGap(db: Database, migrationsFolder: string): void {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'").get()) return;
  const applied = db.prepare("SELECT 1 FROM __drizzle_migrations WHERE hash=?");
  if (!applied.get(FOUNDATION_HASH) || applied.get(FAILOVER_HASH)) return;

  const columns = db.pragma("table_info(claude_route_assignments)") as Array<{ name: string }>;
  const names = columns.map((column) => column.name).sort();
  if (names.join(",") !== LEGACY_COLUMNS.join(",")) {
    throw new Error("FORGEBADGER_BRANCH_MIGRATION_HISTORY_CONFLICT");
  }
  const migration = readMigrationFiles({ migrationsFolder }).find((entry) => entry.hash === FAILOVER_HASH);
  if (!migration) throw new Error("FORGEBADGER_BRANCH_MIGRATION_SOURCE_MISSING");

  db.transaction(() => {
    for (const statement of migration.sql) db.exec(statement);
    db.prepare("INSERT INTO __drizzle_migrations(hash, created_at) VALUES (?, ?)")
      .run(migration.hash, migration.folderMillis);
  })();
}
