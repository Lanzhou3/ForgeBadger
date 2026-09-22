import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { TokenUsageRepository } from "../src/db/repositories/token-usage-repository.js";
import { createUsageTokenSyncer } from "../src/services/usage/usage-token-syncer.js";
import type { TokenUsageRecord, UsageSource } from "../src/services/usage/usage-source.js";

const record = (projectPath: string, requestId = projectPath): TokenUsageRecord => ({
  adapter: "claude", sessionId: "fake-session", projectPath, modelId: "fixture-model", requestId,
  occurredAt: new Date("2026-09-19T00:00:00Z"), inputTokens: 10, outputTokens: 5,
  cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, sourceFile: "/fake/transcript.jsonl"
});

describe("host usage ownership", () => {
  let db: Database.Database;
  let root: string;
  let alice: string;
  let bob: string;
  let projectPath: string;
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL("../src/db/migrations", import.meta.url)) });
    root = realpathSync(mkdtempSync(path.join(tmpdir(), "fb-usage-owner-")));
    alice = new UserRepository(db).create("alice@fixture.test", "hash").id;
    bob = new UserRepository(db).create("bob@fixture.test", "hash").id;
    projectPath = path.join(root, "owned");
    mkdirSync(projectPath);
    new ProjectRepository(db, alice).create({ name: "Owned", path: projectPath, aiTool: "claude" });
  });
  afterEach(() => { db.close(); rmSync(root, { recursive: true, force: true }); });

  it("attributes a shared host scan only to the exclusive exact root owner", () => {
    const child = path.join(projectPath, "child");
    mkdirSync(child);
    const source: UsageSource = { adapter: "claude", scan: () => ({ records: [record(projectPath), record(child), record("unknown")], nextWatermark: "done" }) };
    const syncer = createUsageTokenSyncer(db);
    const a = syncer.syncForUser(alice, source);
    const b = syncer.syncForUser(bob, source);
    assert.equal(a.inserted, 1);
    assert.equal(b.inserted, 0);
    assert.equal(new TokenUsageRepository(db, alice).getSummary().requestCount, 1);
    assert.equal(new TokenUsageRepository(db, bob).getSummary().requestCount, 0);
  });

  it("hides historical contamination in every grouping without deleting stored rows", () => {
    new TokenUsageRepository(db, alice).upsertRecords([record(projectPath)]);
    new TokenUsageRepository(db, bob).upsertRecords([record(projectPath)]);
    const repo = new TokenUsageRepository(db, bob);
    assert.equal(repo.getSummary().requestCount, 0);
    assert.deepEqual(repo.getDailySeries({ groupBy: "adapter" }), []);
    assert.deepEqual(repo.getDailySeries({ groupBy: "project", projectPath }), []);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM token_usage_records").get() as { count: number }).count, 2);
  });

  it("fails closed for multiple canonical owners, symlink aliases and missing directories", () => {
    const alias = path.join(root, "alias");
    symlinkSync(projectPath, alias, "dir");
    new ProjectRepository(db, bob).create({ name: "Alias", path: alias, aiTool: "claude" });
    const repo = new TokenUsageRepository(db, alice);
    repo.upsertRecords([record(projectPath), record(alias)]);
    assert.equal(repo.getSummary().requestCount, 0);
    db.prepare("DELETE FROM projects WHERE user_id = ?").run(bob);
    assert.equal(repo.getSummary().requestCount, 1);
    rmSync(projectPath, { recursive: true });
    assert.equal(repo.getSummary().requestCount, 0);
  });

  it("rebuilds legacy and changed ownership cursors idempotently", () => {
    const repo = new TokenUsageRepository(db, alice);
    repo.setCursor("claude", "legacy-skipped-data");
    const cursors: Array<string | null> = [];
    const source: UsageSource = { adapter: "claude", scan: (cursor) => {
      cursors.push(cursor);
      return { records: cursor === null ? [record(projectPath)] : [], nextWatermark: "source-position" };
    } };
    const syncer = createUsageTokenSyncer(db);
    syncer.syncForUser(alice, source);
    syncer.syncForUser(alice, source);
    const second = path.join(root, "second");
    mkdirSync(second);
    new ProjectRepository(db, alice).create({ name: "Second", path: second, aiTool: "claude" });
    syncer.syncForUser(alice, source);
    assert.deepEqual(cursors, [null, "source-position", null]);
    assert.equal(repo.getSummary().requestCount, 1);
  });

  it("rolls back record writes when advancing the cursor fails", () => {
    db.exec("CREATE TRIGGER reject_cursor BEFORE INSERT ON usage_sync_cursors BEGIN SELECT RAISE(ABORT, 'cursor failure'); END");
    const source: UsageSource = { adapter: "claude", scan: () => ({ records: [record(projectPath)], nextWatermark: "done" }) };
    assert.throws(() => createUsageTokenSyncer(db).syncForUser(alice, source), /cursor failure/);
    assert.equal(new TokenUsageRepository(db, alice).getSummary().requestCount, 0);
  });
  it("hides records immediately after project retirement, user disabling or deletion", () => {
    const repo = new TokenUsageRepository(db, alice);
    repo.upsertRecords([record(projectPath)]);
    db.prepare("UPDATE projects SET status = 'archived' WHERE user_id = ?").run(alice);
    assert.equal(repo.getSummary().requestCount, 0);
    db.prepare("UPDATE projects SET status = 'active' WHERE user_id = ?").run(alice);
    db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(alice);
    assert.equal(repo.getSummary().requestCount, 0);
    db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(alice);
    assert.equal(repo.getSummary().requestCount, 1);
    db.prepare("DELETE FROM projects WHERE user_id = ?").run(alice);
    assert.equal(repo.getSummary().requestCount, 0);
  });

  it("does not advance a cursor or leave partial batches when record persistence fails", () => {
    const repo = new TokenUsageRepository(db, alice);
    repo.setCursor("claude", "original");
    db.exec("CREATE TRIGGER reject_record BEFORE INSERT ON token_usage_records WHEN NEW.request_id = '201' BEGIN SELECT RAISE(ABORT, 'record failure'); END");
    const source: UsageSource = { adapter: "claude", scan: () => ({
      records: Array.from({ length: 202 }, (_, index) => record(projectPath, String(index))), nextWatermark: "done"
    }) };
    assert.throws(() => createUsageTokenSyncer(db).syncForUser(alice, source), /record failure/);
    assert.equal(repo.getSummary().requestCount, 0);
    assert.equal(repo.getCursor("claude"), "original");
  });

  it("rejects a source scan if ownership changes while it is collecting", () => {
    const source: UsageSource = { adapter: "claude", scan: () => {
      new ProjectRepository(db, bob).create({ name: "Conflicting", path: projectPath, aiTool: "claude" });
      return { records: [record(projectPath)], nextWatermark: "done" };
    } };
    assert.throws(() => createUsageTokenSyncer(db).syncForUser(alice, source), /ownership changed/);
    assert.equal(new TokenUsageRepository(db, alice).getCursor("claude"), "");
  });

  it("preserves cursor and deduplication after reopening a persisted database", () => {
    const source: UsageSource = { adapter: "claude", scan: () => ({ records: [record(projectPath)], nextWatermark: "saved-position" }) };
    createUsageTokenSyncer(db).syncForUser(alice, source);
    const file = path.join(root, "reopen.db");
    writeFileSync(file, db.serialize());
    db.close();
    db = new Database(file);
    let resumed: string | null = null;
    createUsageTokenSyncer(db).syncForUser(alice, { adapter: "claude", scan: (cursor) => {
      resumed = cursor;
      return source.scan(cursor);
    } });
    assert.equal(resumed, "saved-position");
    assert.equal(new TokenUsageRepository(db, alice).getSummary().requestCount, 1);
    assert.deepEqual(db.pragma("foreign_key_check"), []);
  });

  it("rebuilds a previously misattributed request to its verified path without duplicate counts", () => {
    const repo = new TokenUsageRepository(db, alice);
    repo.upsertRecords([record("unknown", "same-request")]);
    const source: UsageSource = { adapter: "claude", scan: () => ({ records: [record(projectPath, "same-request")], nextWatermark: "done" }) };
    createUsageTokenSyncer(db).syncForUser(alice, source);
    assert.equal(repo.getSummary().requestCount, 1);
    assert.equal(repo.getSummary().byProject[0]?.key, projectPath);
  });

});
