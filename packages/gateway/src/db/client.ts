import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import BetterSqlite3 from "better-sqlite3";

import type { Database } from "./types.js";
import { recoverCompanionMigrationGap } from "./companion-migration-recovery.js";
import { migrateDatabase } from "./migrate-database.js";
import { expandUserPath } from "../lib/user-path.js";

let dbInstance: Database | null = null;

function resolveDbPath(dbPath: string): string {
  return path.resolve(expandUserPath(dbPath, homedir()));
}

export function initializeDatabase(dbPath: string): Database {
  const resolvedPath = resolveDbPath(dbPath);
  const dir = path.dirname(resolvedPath);
  mkdirSync(dir, { recursive: true });

  const db = new BetterSqlite3(resolvedPath);
  db.pragma("journal_mode = WAL");
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

  db.pragma("foreign_keys = OFF");
  try {
    recoverCompanionMigrationGap(db, migrationsFolder);
    migrateDatabase(db, migrationsFolder);
  } catch (error) {
    db.close();
    throw error;
  } finally {
    // Drizzle wraps migrations in a transaction, so this must happen outside it.
    if (db.open) db.pragma("foreign_keys = ON");
  }

  const foreignKeyViolations = db.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyViolations.length > 0) {
    db.close();
    throw new Error("FORGEBADGER_FOREIGN_KEY_CHECK_FAILED");
  }
  dbInstance = db;
  return db;
}

export function getDb(): Database {
  if (!dbInstance) {
    throw new Error("Database not initialized. Call initializeDatabase() first.");
  }
  return dbInstance;
}
