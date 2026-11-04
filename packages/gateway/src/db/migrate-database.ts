import { BetterSQLiteSession } from "drizzle-orm/better-sqlite3/session";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import type { Database } from "./types.js";

const PROJECT_CONTEXT_HASH = "df023e46d5129710c9d72dd9f5d691551f28e6db54300494d81396a5cbdb683f";
const RESTORE_SESSIONS = "INSERT INTO channel_route_sessions SELECT * FROM channel_route_sessions_saved;";
const RESTORE_MISSING_SESSIONS = `INSERT INTO channel_route_sessions
SELECT saved.* FROM channel_route_sessions_saved AS saved
WHERE NOT EXISTS (
  SELECT 1 FROM channel_route_sessions AS current
  WHERE current.user_id = saved.user_id AND current.route_id = saved.route_id
    AND current.chat_type = saved.chat_type AND current.chat_id = saved.chat_id
    AND current.thread_id = saved.thread_id
);`;

/** Keep published SQL and ledger hashes intact. With foreign keys disabled during
 * startup, rebuilding channel_routes does not cascade-delete its session rows.
 * Only 0147's redundant restoration needs compatibility handling. Drizzle still
 * owns the transaction, migration ordering, rollback and ledger writes. */
export function migrateDatabase(db: Database, migrationsFolder: string): void {
  const migrations = readMigrationFiles({ migrationsFolder }).map((migration) => {
    if (migration.hash !== PROJECT_CONTEXT_HASH) return migration;
    if (migration.sql.filter((statement) => statement.trim() === RESTORE_SESSIONS).length !== 1) {
      throw new Error("FORGEBADGER_PROJECT_CONTEXT_MIGRATION_SOURCE_CONFLICT");
    }
    return {
      ...migration,
      sql: migration.sql.map((statement) => statement.trim() === RESTORE_SESSIONS
        ? RESTORE_MISSING_SESSIONS : statement)
    };
  });
  const dialect = new SQLiteSyncDialect();
  const session = new BetterSQLiteSession(db, dialect, undefined);
  dialect.migrate(migrations, session, { migrationsFolder });
}
