import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import type { Database } from "./types.js";

let dbInstance: Database | null = null;

function resolveDbPath(dbPath: string): string {
  if (dbPath.startsWith("~/")) {
    return path.join(homedir(), dbPath.slice(2));
  }
  return dbPath;
}

export function initializeDatabase(dbPath: string): Database {
  const resolvedPath = resolveDbPath(dbPath);
  const dir = path.dirname(resolvedPath);
  mkdirSync(dir, { recursive: true });

  const db = new BetterSqlite3(resolvedPath);
  db.pragma("journal_mode = WAL");
  const drizzleDb = drizzle(db);
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

  db.pragma("foreign_keys = OFF");
  try {
    migrate(drizzleDb, { migrationsFolder });
  } finally {
    // Drizzle wraps migrations in a transaction, so this must happen outside it.
    db.pragma("foreign_keys = ON");
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
