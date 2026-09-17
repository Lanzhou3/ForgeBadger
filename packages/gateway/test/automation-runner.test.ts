import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { UserRepository } from "../src/db/repositories/user-repository.js";
import { ForgeBadgerEventBus } from "../src/services/event-bus.js";
import { AgentError } from "../src/services/agent/types.js";
import { AutomationRepository } from "../src/services/automation/automation-repository.js";
import { createReadOnlyRegistry, runAutomationTurn } from "../src/services/automation/runner.js";
import { classifyAutomationFailure } from "../src/services/automation/failure-classifier.js";

const masterKey = "abcdef0123456789abcdef0123456789";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");
  migrate(drizzle(db), { migrationsFolder });
  return db;
}

describe("automation runner read-only registry", () => {
  it("exposes only read tools", () => {
    const registry = createReadOnlyRegistry();
    const schemas = registry.toModelSchemas();
    assert.ok(schemas.length > 0);
    for (const [name, tool] of registry.tools) {
      assert.equal(tool.risk, "read", `${name} must be read-only`);
    }
    // The operate-only Project Manager dispatch tool is stripped.
    assert.ok(!registry.tools.has("pm_start_task_packet"));
  });
});

describe("automation failure classifier", () => {
  it("classifies no-model as an actionable config error", () => {
    const result = classifyAutomationFailure(new AgentError("AGENT_NO_MODEL", "No model provider configured"));
    assert.equal(result.category, "no_model");
  });

  it("falls back to generic for unknown errors", () => {
    const result = classifyAutomationFailure(new Error("boom"));
    assert.equal(result.category, "generic");
  });
});

describe("runAutomationTurn", () => {
  it("marks the run failed with AGENT_NO_MODEL when no provider is configured", async () => {
    const db = createTestDb();
    try {
      const user = new UserRepository(db).create("auto-run@example.com", "hash");
      const repo = new AutomationRepository(db, user.id, masterKey);
      const automation = repo.create({
        name: "简报",
        scopeType: "global",
        scopePolicy: {},
        prompt: "汇总",
        scheduleKind: "once",
        scheduleExpression: "2026-01-01T09:00:00.000Z",
        timezone: "UTC",
        deliveryPlan: { notify: false, conversation: false },
        authoritySnapshot: { readOnly: true, tools: [] }
      });
      const run = repo.claimSlot({ automation, scheduledSlot: "once:x", triggerKind: "manual", now: new Date(), leaseMs: 60_000 })!;

      await runAutomationTurn({ db, masterKey, eventBus: new ForgeBadgerEventBus() }, automation, run);

      const refreshed = repo.getRun(run.id)!;
      assert.equal(refreshed.status, "failed");
      assert.equal(refreshed.lastErrorCode, "AGENT_NO_MODEL");
    } finally {
      db.close();
    }
  });
});
