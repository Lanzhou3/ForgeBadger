import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, afterEach } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";

import { ClaudeCodeSource } from "../src/services/usage/claude-code-source.js";
import { OpenCodeSource } from "../src/services/usage/opencode-source.js";
import { TokenUsageRepository, type TokenUsageSummary } from "../src/db/repositories/token-usage-repository.js";
import { UserRepository } from "../src/db/repositories/index.js";
import type { TokenUsageRecord } from "../src/services/usage/usage-source.js";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "of-usage-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) tempDirs.pop();
});

function createTestDb(): Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  const drizzleDb = drizzle(db);
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/db/migrations"
  );
  migrate(drizzleDb, { migrationsFolder });
  return db;
}

// ---------------------------------------------------------------------------
// Claude fixture
// ---------------------------------------------------------------------------

function writeClaudeFixture(root: string, sessionId: string, lines: string[]): string {
  const projectDir = path.join(root, "projects", "-Users-lanzhou-Project-OpenForge");
  mkdirSync(projectDir, { recursive: true });
  const file = path.join(projectDir, `${sessionId}.jsonl`);
  writeFileSync(file, lines.join("\n"));
  return file;
}

const claudeRepeatedUsageLine = (id: string, outputTokens: number, inputTokens: number, ts: string) =>
  JSON.stringify({
    type: "assistant",
    sessionId: "a1b2c3",
    timestamp: ts,
    message: {
      id,
      model: "anthropic/claude-sonnet-4-5",
      role: "assistant",
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_input_tokens: 500,
        cache_creation_input_tokens: 100
      }
    }
  });

describe("ClaudeCodeSource", () => {
  it("extracts usage records and dedupes repeated message.id lines", () => {
    const root = tempDir();
    writeClaudeFixture(root, "sess-1", [
      // Same message id repeated (content block streaming): line 1 has placeholder
      // zero tokens, later line has the completed values. Dedupe keeps the max output.
      claudeRepeatedUsageLine("msg-a", 0, 0, "2026-08-01T00:00:01.000Z"),
      claudeRepeatedUsageLine("msg-a", 53, 1200, "2026-08-01T00:00:05.000Z"),
      claudeRepeatedUsageLine("msg-b", 30, 900, "2026-08-01T00:00:09.000Z"),
      // Non-assistant lines must be ignored.
      JSON.stringify({ type: "user", message: { id: "msg-c", role: "user", content: [] } })
    ]);

    const source = new ClaudeCodeSource();
    // Point at fixture via env (CLAUDE_CONFIG_DIR convention).
    const original = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = root;
    try {
      const result = source.scan(null);
      assert.equal(result.records.length, 2);
      const [a, b] = result.records;
      assert.equal(a.requestId, "msg-a");
      assert.equal(a.outputTokens, 53);
      assert.equal(a.inputTokens, 1200);
      assert.equal(a.cacheReadTokens, 500);
      assert.equal(a.cacheWriteTokens, 100);
      assert.equal(a.projectPath, "/Users/lanzhou/Project/OpenForge");
      assert.equal(a.adapter, "claude");
      assert.equal(b.requestId, "msg-b");
      assert.equal(b.outputTokens, 30);

      // Watermark: second scan with same mtime yields no duplicates.
      const second = source.scan(result.nextWatermark);
      assert.equal(second.records.length, 0);
    } finally {
      if (original === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = original;
    }
  });

  it("resumes by mtime: appended lines are picked up on next scan", () => {
    const root = tempDir();
    const file = writeClaudeFixture(root, "sess-2", [
      claudeRepeatedUsageLine("msg-a", 10, 100, "2026-08-01T00:00:00.000Z")
    ]);

    const source = new ClaudeCodeSource();
    const original = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = root;
    try {
      const first = source.scan(null);
      assert.equal(first.records.length, 1);
      const nextWatermark = first.nextWatermark;

      // Append a new line; force a distinct mtime so the watermark scan resumes.
      writeFileSync(file, `${claudeRepeatedUsageLine("msg-a", 10, 100, "2026-08-01T00:00:00.000Z")}\n${claudeRepeatedUsageLine("msg-b", 20, 200, "2026-08-01T00:01:00.000Z")}\n`);
      const past = Date.now() - 10_000;
      utimesSync(file, past / 1000, past / 1000);
      utimesSync(file, Date.now() / 1000, Date.now() / 1000);

      const second = source.scan(nextWatermark);
      assert.equal(second.records.length, 1);
      assert.equal(second.records[0]?.requestId, "msg-b");
    } finally {
      if (original === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = original;
    }
  });

  it("skips torn trailing lines (partial JSON while CLI is writing)", () => {
    const root = tempDir();
    writeClaudeFixture(root, "sess-3", [
      claudeRepeatedUsageLine("msg-a", 10, 100, "2026-08-01T00:00:00.000Z"),
      '{"type":"assistant","message":{"id":"msg-b",' // torn
    ]);
    const source = new ClaudeCodeSource();
    const original = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = root;
    try {
      const result = source.scan(null);
      assert.equal(result.records.length, 1);
      assert.equal(result.records[0]?.requestId, "msg-a");
    } finally {
      if (original === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = original;
    }
  });
});

// ---------------------------------------------------------------------------
// OpenCode fixture
// ---------------------------------------------------------------------------

function writeOpenCodeFixture(dbPath: string, sessions: Array<{
  id: string;
  directory: string;
  timeCreated: number;
}>, messages: Array<{
  id: string;
  sessionId: string;
  timeCreated: number;
  data: Record<string, unknown>;
}>): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      directory TEXT,
      time_created INTEGER
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      time_created INTEGER,
      data TEXT
    );
  `);
  const insS = db.prepare("INSERT INTO session (id, directory, time_created) VALUES (?, ?, ?)");
  for (const s of sessions) insS.run(s.id, s.directory, s.timeCreated);
  const insM = db.prepare("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)");
  for (const m of messages) insM.run(m.id, m.sessionId, m.timeCreated, JSON.stringify(m.data));
  db.close();
}

const openCodeAssistant = (overrides: Record<string, unknown> = {}) => ({
  role: "assistant",
  modelID: "deepseek-v4-flash-free",
  tokens: {
    total: 1000,
    input: 800,
    output: 200,
    reasoning: 50,
    cache: { write: 0, read: 700 }
  },
  time: { created: 1785549091000, completed: 1785549092000 },
  ...overrides
});

describe("OpenCodeSource", () => {
  it("extracts assistant message tokens joined with session directory", () => {
    const dir = tempDir();
    const dbPath = path.join(dir, "opencode.db");
    writeOpenCodeFixture(dbPath, [
      { id: "ses-1", directory: "/tmp/proj-a", timeCreated: 1785549091000 }
    ], [
      { id: "msg-1", sessionId: "ses-1", timeCreated: 1785549091000, data: openCodeAssistant() },
      { id: "msg-2", sessionId: "ses-1", timeCreated: 1785549092000, data: { role: "user", content: [] } }
    ]);

    const original = process.env.OPENCODE_DB;
    process.env.OPENCODE_DB = dir;
    try {
      const source = new OpenCodeSource();
      const result = source.scan(null);
      assert.equal(result.records.length, 1);
      const record = result.records[0]!;
      assert.equal(record.adapter, "opencode");
      assert.equal(record.requestId, "msg-1");
      assert.equal(record.sessionId, "ses-1");
      assert.equal(record.projectPath, "/tmp/proj-a");
      assert.equal(record.inputTokens, 800);
      assert.equal(record.outputTokens, 200);
      assert.equal(record.cacheReadTokens, 700);
      assert.equal(record.reasoningTokens, 50);
      assert.equal(record.modelId, "deepseek-v4-flash-free");

      // Watermark resume: nothing new.
      const second = source.scan(result.nextWatermark);
      assert.equal(second.records.length, 0);
    } finally {
      if (original === undefined) delete process.env.OPENCODE_DB;
      else process.env.OPENCODE_DB = original;
    }
  });

  it("handles missing db gracefully", () => {
    const dir = tempDir();
    const original = process.env.OPENCODE_DB;
    process.env.OPENCODE_DB = dir;
    try {
      const source = new OpenCodeSource();
      const result = source.scan("100");
      assert.deepEqual(result.records, []);
      assert.equal(result.nextWatermark, "100");
    } finally {
      if (original === undefined) delete process.env.OPENCODE_DB;
      else process.env.OPENCODE_DB = original;
    }
  });
});

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

const fakeRecord = (overrides: Partial<TokenUsageRecord>): TokenUsageRecord => ({
  adapter: "claude",
  sessionId: "sess-1",
  projectPath: "/tmp/proj-a",
  modelId: "anthropic/claude-sonnet-4-5",
  requestId: "req-1",
  occurredAt: new Date("2026-08-01T10:00:00.000Z"),
  inputTokens: 1000,
  outputTokens: 200,
  cacheReadTokens: 300,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  sourceFile: "/tmp/opencode.db",
  ...overrides
});

describe("TokenUsageRepository", () => {
  it("upserts idempotently and aggregates summary", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("tokens@example.com", "hash");
    const repo = new TokenUsageRepository(db, user.id);

    repo.upsertRecords([
      fakeRecord({ requestId: "req-1" }),
      fakeRecord({ requestId: "req-2", projectPath: "/tmp/proj-b", inputTokens: 500, outputTokens: 50 })
    ]);
    // Re-insert req-1 with updated counts — should update, not duplicate.
    repo.upsertRecords([fakeRecord({ requestId: "req-1", inputTokens: 2000, outputTokens: 400 })]);

    const summary: TokenUsageSummary = repo.getSummary();
    assert.equal(summary.requestCount, 2);
    assert.equal(summary.totalInputTokens, 2500);
    assert.equal(summary.totalOutputTokens, 450);
    assert.equal(summary.totalCacheReadTokens, 600);
    assert.equal(summary.byAdapter.length, 1);
    assert.equal(summary.byAdapter[0]?.key, "claude");
    assert.equal(summary.byProject[0]?.key, "/tmp/proj-a");
    assert.equal(summary.byProject[0]?.totalTokens, 2000 + 400 + 300 + 0 + 0);
    assert.equal(summary.byModel[0]?.key, "anthropic/claude-sonnet-4-5");
  });

  it("filters by date range", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("tokens-range@example.com", "hash");
    const repo = new TokenUsageRepository(db, user.id);

    repo.upsertRecords([
      fakeRecord({ requestId: "old", occurredAt: new Date("2026-07-01T10:00:00.000Z") }),
      fakeRecord({ requestId: "new", occurredAt: new Date("2026-08-02T10:00:00.000Z") })
    ]);

    const summary = repo.getSummary(new Date("2026-08-01T00:00:00.000Z"));
    assert.equal(summary.requestCount, 1);
    assert.equal(summary.byModel[0]?.key, "anthropic/claude-sonnet-4-5");
  });

  it("persists and restores per-adapter cursors", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("tokens-cursor@example.com", "hash");
    const repo = new TokenUsageRepository(db, user.id);

    assert.equal(repo.getCursor("claude"), "");
    repo.setCursor("claude", JSON.stringify({"~/.claude/projects/s.jsonl": 1234}));
    assert.equal(repo.getCursor("claude"), JSON.stringify({"~/.claude/projects/s.jsonl": 1234}));
    repo.setCursor("claude", JSON.stringify({"~/.claude/projects/s.jsonl": 9999}));
    assert.equal(repo.getCursor("claude"), JSON.stringify({"~/.claude/projects/s.jsonl": 9999}));
  });

  it("builds daily series grouped by project and adapter", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("tokens-series@example.com", "hash");
    const repo = new TokenUsageRepository(db, user.id);

    repo.upsertRecords([
      fakeRecord({ requestId: "r1", adapter: "claude", projectPath: "/p/a", occurredAt: new Date("2026-08-01T10:00:00.000Z") }),
      fakeRecord({ requestId: "r2", adapter: "claude", projectPath: "/p/a", occurredAt: new Date("2026-08-01T14:00:00.000Z") }),
      fakeRecord({ requestId: "r3", adapter: "opencode", projectPath: "/p/b", occurredAt: new Date("2026-08-02T10:00:00.000Z") })
    ]);

    const series = repo.getDailySeries({ groupBy: "project" });
    // Same day + same project aggregate into one row; /p/a on 08-01 merges r1+r2.
    assert.equal(series.length, 2);
    const dayA = series.filter((row) => row.group === "/p/a");
    assert.equal(dayA.length, 1);
    assert.equal(dayA[0]?.day, "2026-08-01");
    assert.equal(dayA[0]?.totalTokens, 2 * (1000 + 200 + 300));
    const dayB = series.find((row) => row.group === "/p/b");
    assert.equal(dayB?.day, "2026-08-02");
  });
});