import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { ApiKeyRepository } from "../src/db/repositories/api-key-repository.js";
import { AuditLogRepository } from "../src/db/repositories/audit-log-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import {
  buildLocalDiagnosticsExport,
  redactDiagnosticValue
} from "../src/services/diagnostics.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const drizzleDb = drizzle(db);
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/db/migrations"
  );
  migrate(drizzleDb, { migrationsFolder });
  return db;
}

describe("local diagnostics export", () => {
  it("redacts secrets from scalar and nested diagnostic values", () => {
    assert.equal(redactDiagnosticValue("sk-ant-secret"), "[redacted]");
    assert.deepEqual(
      redactDiagnosticValue({
        token: "abc",
        nested: { OPENFORGE_MASTER_KEY: "secret", safe: "value" }
      }),
      {
        token: "[redacted]",
        nested: { OPENFORGE_MASTER_KEY: "[redacted]", safe: "value" }
      }
    );
  });

  it("exports local health and activity counts without plaintext credentials", () => {
    const db = createTestDb();
    try {
      const user = new UserRepository(db).create("diagnostics@example.com", "hash");
      new ApiKeyRepository(db, user.id, "a".repeat(64)).create({
        provider: "openai",
        label: "test",
        plaintextKey: "sk-test-secret"
      });
      new AuditLogRepository(db, user.id).create({
        action: "diagnostics.test",
        resourceType: "diagnostics",
        details: { token: "abc" }
      });

      const report = buildLocalDiagnosticsExport({
        db,
        userId: user.id,
        masterKey: "a".repeat(64),
        appVersion: "0.0.0-test",
        now: new Date("2026-05-06T00:00:00.000Z"),
        env: {
          OPENFORGE_MASTER_KEY: "a".repeat(64),
          OPENAI_API_KEY: "sk-test-secret"
        }
      });

      assert.equal(report.generatedAt, "2026-05-06T00:00:00.000Z");
      assert.equal(report.app.version, "0.0.0-test");
      assert.equal(report.counts.apiKeys, 1);
      assert.equal(report.counts.auditLogs, 1);
      assert.equal(report.environment.OPENFORGE_MASTER_KEY, "[redacted]");
      assert.equal(report.environment.OPENAI_API_KEY, "[redacted]");
      assert.equal(JSON.stringify(report).includes("sk-test-secret"), false);
    } finally {
      db.close();
    }
  });
});
