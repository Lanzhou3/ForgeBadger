import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { UserRepository } from "../src/db/repositories/user-repository.js";
import { AutomationRepository } from "../src/services/automation/automation-repository.js";

const masterKey = "abcdef0123456789abcdef0123456789";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");
  migrate(drizzle(db), { migrationsFolder });
  return db;
}

function createAutomation(repo: AutomationRepository, overrides: Partial<Parameters<AutomationRepository["create"]>[0]> = {}) {
  return repo.create({
    name: "每日简报",
    scopeType: "global",
    scopePolicy: {},
    prompt: "汇总今天进度",
    scheduleKind: "cron",
    scheduleExpression: "0 9 * * *",
    timezone: "UTC",
    deliveryPlan: { notify: true, conversation: true },
    authoritySnapshot: { readOnly: true, tools: [] },
    ...overrides
  });
}

describe("automation repository", () => {
  it("creates and lists an automation scoped to its owner", () => {
    const db = createTestDb();
    try {
      const user = new UserRepository(db).create("auto-a@example.com", "hash");
      const repo = new AutomationRepository(db, user.id, masterKey);
      const created = createAutomation(repo);
      assert.equal(created.status, "draft");
      assert.equal(repo.list().length, 1);
      assert.equal(repo.list()[0]?.name, "每日简报");
    } finally {
      db.close();
    }
  });

  it("does not leak an automation across users", () => {
    const db = createTestDb();
    try {
      const a = new UserRepository(db).create("auto-a@example.com", "hash");
      const b = new UserRepository(db).create("auto-b@example.com", "hash");
      createAutomation(new AutomationRepository(db, a.id, masterKey));
      assert.equal(new AutomationRepository(db, b.id, masterKey).list().length, 0);
    } finally {
      db.close();
    }
  });

  it("claims a slot exactly once (idempotent across ticks)", () => {
    const db = createTestDb();
    try {
      const user = new UserRepository(db).create("auto-a@example.com", "hash");
      const repo = new AutomationRepository(db, user.id, masterKey);
      const automation = createAutomation(repo);
      const now = new Date();

      const first = repo.claimSlot({ automation, scheduledSlot: "cron:0 9 * * *:1", triggerKind: "schedule", now, leaseMs: 60_000 });
      assert.ok(first, "first claim must succeed");
      assert.equal(first.status, "claimed");
      assert.ok(first.claimToken);

      const second = repo.claimSlot({ automation, scheduledSlot: "cron:0 9 * * *:1", triggerKind: "schedule", now, leaseMs: 60_000 });
      assert.equal(second, undefined, "duplicate slot claim must be a no-op");
    } finally {
      db.close();
    }
  });

  it("advances the schedule and completes a run with encrypted content", () => {
    const db = createTestDb();
    try {
      const user = new UserRepository(db).create("auto-a@example.com", "hash");
      const repo = new AutomationRepository(db, user.id, masterKey);
      const automation = createAutomation(repo);
      const now = new Date();

      const run = repo.claimSlot({ automation, scheduledSlot: "cron:0 9 * * *:1", triggerKind: "schedule", now, leaseMs: 60_000 })!;
      repo.advanceSchedule(automation.id, now, new Date(now.getTime() + 60_000));
      repo.completeRun(run.id, "secret report");

      const refreshed = repo.get(automation.id)!;
      assert.equal(refreshed.lastRunAt?.getTime(), now.getTime());
      assert.equal(repo.decryptContent(run.id), "secret report");
      assert.equal(repo.getRun(run.id)?.status, "completed");
    } finally {
      db.close();
    }
  });

  it("records a failure with a stable error code", () => {
    const db = createTestDb();
    try {
      const user = new UserRepository(db).create("auto-a@example.com", "hash");
      const repo = new AutomationRepository(db, user.id, masterKey);
      const automation = createAutomation(repo);
      const run = repo.claimSlot({ automation, scheduledSlot: "x", triggerKind: "schedule", now: new Date(), leaseMs: 60_000 })!;
      repo.failRun(run.id, "AGENT_NO_MODEL", "no model");
      const refreshed = repo.getRun(run.id)!;
      assert.equal(refreshed.status, "failed");
      assert.equal(refreshed.lastErrorCode, "AGENT_NO_MODEL");
    } finally {
      db.close();
    }
  });

  it("seeds and deduplicates suggestions, then accepts one", () => {
    const db = createTestDb();
    try {
      const user = new UserRepository(db).create("auto-a@example.com", "hash");
      const repo = new AutomationRepository(db, user.id, masterKey);
      repo.seedSuggestion({ source: "catalog", dedupKey: "k", jobSpec: { name: "s" } });
      repo.seedSuggestion({ source: "catalog", dedupKey: "k", jobSpec: { name: "s2" } });
      const pending = repo.listSuggestions();
      assert.equal(pending.length, 1);
      assert.equal(pending[0]?.jobSpec, JSON.stringify({ name: "s" }));

      const decided = repo.decideSuggestion(pending[0]!.id, "accepted");
      assert.equal(decided?.status, "accepted");
      assert.equal(repo.listSuggestions().length, 0);
    } finally {
      db.close();
    }
  });
});
