import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, afterEach } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";

import { ClaudeCodeSource } from "../src/services/usage/claude-code-source.js";
import { CodexSource } from "../src/services/usage/codex-source.js";
import { KimiSource } from "../src/services/usage/kimi-source.js";
import { OpenCodeSource } from "../src/services/usage/opencode-source.js";
import { PiSource } from "../src/services/usage/pi-source.js";
import { TokenUsageRepository, type TokenUsageSummary } from "../src/db/repositories/token-usage-repository.js";
import { UserRepository, ProjectRepository } from "../src/db/repositories/index.js";
import type { TokenUsageRecord } from "../src/services/usage/usage-source.js";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "fb-usage-")));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
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
  const projectDir = path.join(root, "projects", "-Users-lanzhou-Project-ForgeBadger");
  mkdirSync(projectDir, { recursive: true });
  const file = path.join(projectDir, `${sessionId}.jsonl`);
  writeFileSync(file, lines.join("\n"));
  return file;
}

const claudeRepeatedUsageLine = (id: string, outputTokens: number, inputTokens: number, ts: string) =>
  JSON.stringify({
    type: "assistant",
    cwd: "/Users/lanzhou/Project/ForgeBadger",
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
      assert.equal(a.projectPath, "/Users/lanzhou/Project/ForgeBadger");
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
  it("does not guess cwd from ambiguous encoded directories", () => {
    const root = tempDir();
    const entry = JSON.parse(claudeRepeatedUsageLine("unknown-cwd", 5, 10, "2026-09-19T00:00:00Z"));
    delete entry.cwd;
    writeClaudeFixture(root, "ambiguous", [JSON.stringify(entry)]);
    const original = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = root;
    try {
      assert.equal(new ClaudeCodeSource().scan(null).records[0]?.projectPath, "unknown");
    } finally {
      if (original === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = original;
    }
  });

  it("retries torn first-scan tails after non-ASCII bytes without losing records", () => {
    const root = tempDir();
    const first = claudeRepeatedUsageLine("消息一", 5, 10, "2026-09-19T00:00:00Z");
    const second = claudeRepeatedUsageLine("消息二", 5, 10, "2026-09-19T00:01:00Z");
    const file = writeClaudeFixture(root, "torn", [first, second.slice(0, 40)]);
    const original = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = root;
    try {
      const source = new ClaudeCodeSource();
      const initial = source.scan(null);
      assert.equal(initial.records.length, 1);
      writeFileSync(file, `${first}\n${second}\n`);
      assert.deepEqual(source.scan(initial.nextWatermark).records.map((r) => r.requestId), ["消息二"]);
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
      assert.equal(record.projectPath, path.resolve("/tmp/proj-a"));
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
// Codex fixture
// ---------------------------------------------------------------------------

function writeCodexFixture(root: string, lines: string[]): string {
  const dayDir = path.join(root, "sessions", "2026", "08", "01");
  mkdirSync(dayDir, { recursive: true });
  const file = path.join(dayDir, "rollout-2026-08-01T10-00-00-019efec2-ef2b-7d42-bd6d-b986f1aaed46.jsonl");
  writeFileSync(file, lines.join("\n"));
  return file;
}

const codexSessionMeta = () =>
  JSON.stringify({
    timestamp: "2026-08-01T10:00:00.000Z",
    type: "session_meta",
    payload: { id: "sess-codex-1", cwd: "/Users/lanzhou/Project/Mindspark" }
  });

const codexTurnContext = (model: string) =>
  JSON.stringify({
    timestamp: "2026-08-01T10:00:01.000Z",
    type: "turn_context",
    payload: { turn_id: "turn-1", cwd: "/Users/lanzhou/Project/Mindspark", model }
  });

const codexTokenCount = (
  ts: string,
  usage: { input: number; cached: number; output: number; reasoning: number }
) =>
  JSON.stringify({
    timestamp: ts,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {},
        last_token_usage: {
          input_tokens: usage.input,
          cached_input_tokens: usage.cached,
          output_tokens: usage.output,
          reasoning_output_tokens: usage.reasoning,
          total_tokens: usage.input + usage.output
        }
      }
    }
  });

describe("CodexSource", () => {
  it("extracts token_count deltas with session cwd and model context", () => {
    const root = tempDir();
    writeCodexFixture(root, [
      codexSessionMeta(),
      codexTurnContext("gpt-5-codex"),
      codexTokenCount("2026-08-01T10:00:05.000Z", { input: 1200, cached: 500, output: 80, reasoning: 30 }),
      codexTokenCount("2026-08-01T10:01:00.000Z", { input: 900, cached: 0, output: 40, reasoning: 0 }),
      // All-zero delta carries no usage and must be skipped.
      codexTokenCount("2026-08-01T10:01:30.000Z", { input: 0, cached: 0, output: 0, reasoning: 0 }),
      // Non-usage events must be ignored.
      JSON.stringify({ timestamp: "2026-08-01T10:02:00.000Z", type: "event_msg", payload: { type: "task_started" } })
    ]);

    const original = process.env.CODEX_HOME;
    process.env.CODEX_HOME = root;
    try {
      const source = new CodexSource();
      const result = source.scan(null);
      assert.equal(result.records.length, 2);
      const [first, second] = result.records;
      assert.equal(first.adapter, "codex");
      assert.equal(first.sessionId, "sess-codex-1");
      assert.equal(first.projectPath, "/Users/lanzhou/Project/Mindspark");
      assert.equal(first.modelId, "gpt-5-codex");
      assert.equal(first.inputTokens, 1200);
      assert.equal(first.cacheReadTokens, 500);
      assert.equal(first.outputTokens, 80);
      assert.equal(first.reasoningTokens, 30);
      assert.equal(first.cacheWriteTokens, 0);
      assert.match(first.requestId, /^rollout-.*\.jsonl@\d+$/);
      assert.equal(second.inputTokens, 900);

      // Watermark: unchanged file yields no duplicates on the next scan.
      const second2 = source.scan(result.nextWatermark);
      assert.equal(second2.records.length, 0);
    } finally {
      if (original === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = original;
    }
  });

  it("re-parses a changed file without duplicating request ids", () => {
    const root = tempDir();
    const file = writeCodexFixture(root, [
      codexSessionMeta(),
      codexTokenCount("2026-08-01T10:00:05.000Z", { input: 100, cached: 0, output: 10, reasoning: 0 })
    ]);

    const original = process.env.CODEX_HOME;
    process.env.CODEX_HOME = root;
    try {
      const source = new CodexSource();
      const first = source.scan(null);
      assert.equal(first.records.length, 1);
      const firstRequestId = first.records[0]!.requestId;

      // Append a new token_count event and force a newer mtime.
      writeFileSync(
        file,
        [
          codexSessionMeta(),
          codexTokenCount("2026-08-01T10:00:05.000Z", { input: 100, cached: 0, output: 10, reasoning: 0 }),
          codexTokenCount("2026-08-01T10:05:00.000Z", { input: 200, cached: 0, output: 20, reasoning: 0 })
        ].join("\n")
      );
      const now = Date.now();
      utimesSync(file, now / 1000, now / 1000);

      const second = source.scan(first.nextWatermark);
      // Full re-parse returns both lines, but the first keeps the same byte-offset
      // request id so the repository upsert dedupes it.
      assert.equal(second.records.length, 2);
      assert.equal(second.records[0]!.requestId, firstRequestId);
      assert.equal(second.records[1]!.inputTokens, 200);
    } finally {
      if (original === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = original;
    }
  });

  it("handles a missing sessions directory gracefully", () => {
    const root = tempDir();
    const original = process.env.CODEX_HOME;
    process.env.CODEX_HOME = root;
    try {
      const source = new CodexSource();
      const result = source.scan(null);
      assert.deepEqual(result.records, []);
    } finally {
      if (original === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = original;
    }
  });
});

// ---------------------------------------------------------------------------
// Kimi fixture
// ---------------------------------------------------------------------------

function writeKimiFixture(root: string, agent: string, lines: string[]): string {
  const agentDir = path.join(
    root,
    "sessions",
    "wd_forgebadger_abc123",
    "session_kimi-1",
    "agents",
    agent
  );
  mkdirSync(agentDir, { recursive: true });
  const file = path.join(agentDir, "wire.jsonl");
  writeFileSync(file, lines.join("\n"));
  return file;
}

function writeKimiStateJson(root: string): void {
  const sessionDir = path.join(root, "sessions", "wd_forgebadger_abc123", "session_kimi-1");
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(
    path.join(sessionDir, "state.json"),
    JSON.stringify({ id: "session_kimi-1", cwd: "/Users/lanzhou/Project/ForgeBadger" })
  );
}

const kimiUsageRecord = (
  time: number,
  usage: { inputOther: number; output: number; inputCacheRead: number; inputCacheCreation: number },
  overrides: Record<string, unknown> = {}
) =>
  JSON.stringify({
    type: "usage.record",
    agentId: "main",
    model: "kimi-code/k3",
    usage,
    usageScope: "turn",
    time,
    ...overrides
  });

describe("KimiSource", () => {
  it("extracts turn-scope usage records with state.json cwd", () => {
    const root = tempDir();
    writeKimiStateJson(root);
    writeKimiFixture(root, "main", [
      kimiUsageRecord(1788105370568, { inputOther: 15723, output: 226, inputCacheRead: 11520, inputCacheCreation: 0 }),
      kimiUsageRecord(1788105374421, { inputOther: 978, output: 97, inputCacheRead: 27179, inputCacheCreation: 40 }),
      // Cumulative session snapshots must be skipped (would double count).
      kimiUsageRecord(1788105375000, { inputOther: 2604, output: 1570, inputCacheRead: 210944, inputCacheCreation: 0 }, { usageScope: "session" }),
      // All-zero usage carries nothing and must be skipped.
      kimiUsageRecord(1788105376000, { inputOther: 0, output: 0, inputCacheRead: 0, inputCacheCreation: 0 }),
      // Non-usage events must be ignored.
      JSON.stringify({ type: "step.begin", agentId: "main", time: 1788105377000 })
    ]);

    const original = process.env.KIMI_CODE_HOME;
    process.env.KIMI_CODE_HOME = root;
    try {
      const source = new KimiSource();
      const result = source.scan(null);
      assert.equal(result.records.length, 2);
      const [first, second] = result.records;
      assert.equal(first.adapter, "kimi");
      assert.equal(first.sessionId, "session_kimi-1");
      assert.equal(first.projectPath, "/Users/lanzhou/Project/ForgeBadger");
      assert.equal(first.modelId, "kimi-code/k3");
      assert.equal(first.inputTokens, 15723);
      assert.equal(first.outputTokens, 226);
      assert.equal(first.cacheReadTokens, 11520);
      assert.equal(first.cacheWriteTokens, 0);
      assert.equal(first.reasoningTokens, 0);
      assert.equal(first.occurredAt.getTime(), 1788105370568);
      assert.match(first.requestId, /wire\.jsonl@\d+$/);
      assert.equal(second.cacheWriteTokens, 40);

      // Watermark: unchanged file yields no duplicates on the next scan.
      const again = source.scan(result.nextWatermark);
      assert.equal(again.records.length, 0);
    } finally {
      if (original === undefined) delete process.env.KIMI_CODE_HOME;
      else process.env.KIMI_CODE_HOME = original;
    }
  });

  it("collects subagent wire files from the same session", () => {
    const root = tempDir();
    writeKimiStateJson(root);
    writeKimiFixture(root, "main", [
      kimiUsageRecord(1788105370568, { inputOther: 1000, output: 100, inputCacheRead: 0, inputCacheCreation: 0 })
    ]);
    writeKimiFixture(root, "agent-0", [
      kimiUsageRecord(1788105370569, { inputOther: 7476, output: 245, inputCacheRead: 15872, inputCacheCreation: 0 }, { agentId: "agent-0" })
    ]);

    const original = process.env.KIMI_CODE_HOME;
    process.env.KIMI_CODE_HOME = root;
    try {
      const source = new KimiSource();
      const result = source.scan(null);
      assert.equal(result.records.length, 2);
      // Distinct request ids even though both files are named wire.jsonl.
      assert.notEqual(result.records[0]?.requestId, result.records[1]?.requestId);
    } finally {
      if (original === undefined) delete process.env.KIMI_CODE_HOME;
      else process.env.KIMI_CODE_HOME = original;
    }
  });

  it("re-parses a changed file without duplicating request ids", () => {
    const root = tempDir();
    writeKimiStateJson(root);
    const file = writeKimiFixture(root, "main", [
      kimiUsageRecord(1788105370568, { inputOther: 100, output: 10, inputCacheRead: 0, inputCacheCreation: 0 })
    ]);

    const original = process.env.KIMI_CODE_HOME;
    process.env.KIMI_CODE_HOME = root;
    try {
      const source = new KimiSource();
      const first = source.scan(null);
      assert.equal(first.records.length, 1);
      const firstRequestId = first.records[0]!.requestId;

      writeFileSync(
        file,
        [
          kimiUsageRecord(1788105370568, { inputOther: 100, output: 10, inputCacheRead: 0, inputCacheCreation: 0 }),
          kimiUsageRecord(1788105371000, { inputOther: 200, output: 20, inputCacheRead: 0, inputCacheCreation: 0 })
        ].join("\n")
      );
      const now = Date.now();
      utimesSync(file, now / 1000, now / 1000);

      const second = source.scan(first.nextWatermark);
      assert.equal(second.records.length, 2);
      assert.equal(second.records[0]!.requestId, firstRequestId);
      assert.equal(second.records[1]!.inputTokens, 200);
    } finally {
      if (original === undefined) delete process.env.KIMI_CODE_HOME;
      else process.env.KIMI_CODE_HOME = original;
    }
  });

  it("handles a missing sessions directory gracefully", () => {
    const root = tempDir();
    const original = process.env.KIMI_CODE_HOME;
    process.env.KIMI_CODE_HOME = root;
    try {
      const source = new KimiSource();
      const result = source.scan(null);
      assert.deepEqual(result.records, []);
    } finally {
      if (original === undefined) delete process.env.KIMI_CODE_HOME;
      else process.env.KIMI_CODE_HOME = original;
    }
  });
});

// ---------------------------------------------------------------------------
// PI fixture
// ---------------------------------------------------------------------------

/**
 * PI session file shape (pi 0.86.0, format v3) — verified against real
 * transcripts: header line, then message envelopes; assistant lines carry
 * camelCase `usage` + per-request `responseId`.
 */
const piHeaderLine = (sessionId: string, cwd: string, timestamp = "2026-09-20T07:56:53.354Z") =>
  JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp, cwd });

const piAssistantLine = (
  entryId: string,
  usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number; reasoning?: number },
  overrides: Record<string, unknown> = {}
) =>
  JSON.stringify({
    type: "message",
    id: entryId,
    parentId: null,
    timestamp: "2026-09-20T07:57:07.745Z",
    message: {
      role: "assistant",
      provider: "lingsoul",
      model: "qwen3.8-27b",
      responseId: `chatcmpl-${entryId}`,
      stopReason: "stop",
      usage: {
        input: usage.input,
        output: usage.output,
        cacheRead: usage.cacheRead ?? 0,
        cacheWrite: usage.cacheWrite ?? 0,
        reasoning: usage.reasoning ?? 0,
        totalTokens: usage.input + usage.output + (usage.cacheRead ?? 0),
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      ...overrides
    }
  });

/** Aborted line: all-zero usage, no responseId — must be skipped. */
const piAbortedAssistantLine = (entryId: string) =>
  JSON.stringify({
    type: "message",
    id: entryId,
    parentId: null,
    timestamp: "2026-09-20T07:58:00.000Z",
    message: {
      role: "assistant",
      provider: "lingsoul",
      model: "qwen3.8-27b",
      stopReason: "aborted",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
    }
  });

function writePiFixture(root: string, lines: string[]): string {
  const projectDir = path.join(root, "--C--Users-lanzhou-Project-ForgeBadger--");
  mkdirSync(projectDir, { recursive: true });
  const file = path.join(
    projectDir,
    "2026-09-20T07-56-53-354Z_01a0bdd1-6ae9-7246-8521-652e7697051d.jsonl"
  );
  writeFileSync(file, lines.join("\n"));
  return file;
}

describe("PiSource", () => {
  it("extracts assistant envelope usage with header session id + cwd", () => {
    const root = tempDir();
    writePiFixture(root, [
      piHeaderLine("01a0bdd1-6ae9-7246-8521-652e7697051d", "C:\\Users\\lanzhou\\Project\\ForgeBadger"),
      JSON.stringify({ type: "model_change", id: "mc1", timestamp: "2026-09-20T07:56:54.000Z" }),
      // One tool round-trip = two billable assistant lines with distinct responseIds.
      piAssistantLine("da4c1136", { input: 2239, output: 58 }),
      piAssistantLine("8d26414d", { input: 2314, output: 23, cacheRead: 128, cacheWrite: 4, reasoning: 7 }),
      piAbortedAssistantLine("ab0rted1"),
      JSON.stringify({ type: "message", id: "u1", timestamp: "2026-09-20T07:57:01.805Z", message: { role: "user" } })
    ]);

    const original = process.env.PI_CODING_AGENT_SESSION_DIR;
    process.env.PI_CODING_AGENT_SESSION_DIR = root;
    try {
      const source = new PiSource();
      const result = source.scan(null);
      assert.equal(result.records.length, 2);
      const [first, second] = result.records;
      assert.equal(first.adapter, "pi");
      // Session id + cwd come from the header, not the encoded directory name.
      assert.equal(first.sessionId, "01a0bdd1-6ae9-7246-8521-652e7697051d");
      assert.equal(first.projectPath, "C:\\Users\\lanzhou\\Project\\ForgeBadger");
      assert.equal(first.modelId, "lingsoul/qwen3.8-27b");
      assert.equal(first.requestId, "chatcmpl-da4c1136");
      assert.equal(first.inputTokens, 2239);
      assert.equal(first.outputTokens, 58);
      assert.equal(first.occurredAt.getTime(), Date.parse("2026-09-20T07:57:07.745Z"));
      assert.equal(second.requestId, "chatcmpl-8d26414d");
      assert.equal(second.cacheReadTokens, 128);
      assert.equal(second.cacheWriteTokens, 4);
      assert.equal(second.reasoningTokens, 7);

      // Watermark: unchanged file yields no duplicates on the next scan.
      const again = source.scan(result.nextWatermark);
      assert.equal(again.records.length, 0);
    } finally {
      if (original === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR;
      else process.env.PI_CODING_AGENT_SESSION_DIR = original;
    }
  });

  it("resumes by offset: appended assistant lines are picked up on next scan", () => {
    const root = tempDir();
    const file = writePiFixture(root, [
      piHeaderLine("01a0bdd1-6ae9-7246-8521-652e7697051d", "C:\\Users\\lanzhou\\Project\\ForgeBadger"),
      piAssistantLine("a0000001", { input: 100, output: 10 })
    ]);

    const source = new PiSource();
    const original = process.env.PI_CODING_AGENT_SESSION_DIR;
    process.env.PI_CODING_AGENT_SESSION_DIR = root;
    try {
      const first = source.scan(null);
      assert.equal(first.records.length, 1);

      const appended = piAssistantLine("b0000002", { input: 200, output: 20 });
      writeFileSync(file, `${piHeaderLine("01a0bdd1-6ae9-7246-8521-652e7697051d", "C:\\Users\\lanzhou\\Project\\ForgeBadger")}\n${piAssistantLine("a0000001", { input: 100, output: 10 })}\n${appended}\n`);
      const past = Date.now() - 10_000;
      utimesSync(file, past / 1000, past / 1000);
      utimesSync(file, Date.now() / 1000, Date.now() / 1000);

      const second = source.scan(first.nextWatermark);
      assert.equal(second.records.length, 1);
      assert.equal(second.records[0]?.requestId, "chatcmpl-b0000002");
    } finally {
      if (original === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR;
      else process.env.PI_CODING_AGENT_SESSION_DIR = original;
    }
  });

  it("skips torn trailing lines (partial JSON while CLI is writing)", () => {
    const root = tempDir();
    const file = writePiFixture(root, [
      piHeaderLine("01a0bdd1-6ae9-7246-8521-652e7697051d", "C:\\Users\\lanzhou\\Project\\ForgeBadger"),
      piAssistantLine("a0000001", { input: 100, output: 10 }),
      '{"type":"message","id":"b0000002","message":{"role":' // torn
    ]);

    const source = new PiSource();
    const original = process.env.PI_CODING_AGENT_SESSION_DIR;
    process.env.PI_CODING_AGENT_SESSION_DIR = root;
    try {
      const first = source.scan(null);
      assert.equal(first.records.length, 1);
      assert.equal(first.records[0]?.requestId, "chatcmpl-a0000001");

      // The torn tail is not consumed; completing the line on the next scan
      // (with a newer mtime) picks it up exactly once.
      const tornStart = Buffer.byteLength(
        `${piHeaderLine("01a0bdd1-6ae9-7246-8521-652e7697051d", "C:\\Users\\lanzhou\\Project\\ForgeBadger")}\n${piAssistantLine("a0000001", { input: 100, output: 10 })}\n`,
        "utf8"
      );
      const completeLine = piAssistantLine("b0000002", { input: 300, output: 30 });
      const head = readFileSync(file, "utf8").slice(0, tornStart);
      writeFileSync(file, `${head}${completeLine}\n`);
      const past = Date.now() - 10_000;
      utimesSync(file, past / 1000, past / 1000);
      utimesSync(file, Date.now() / 1000, Date.now() / 1000);

      const second = source.scan(first.nextWatermark);
      assert.equal(second.records.length, 1);
      assert.equal(second.records[0]?.requestId, "chatcmpl-b0000002");
    } finally {
      if (original === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR;
      else process.env.PI_CODING_AGENT_SESSION_DIR = original;
    }
  });

  it("falls back to the file uuid and unknown path when the header is missing", () => {
    const root = tempDir();
    writePiFixture(root, [
      piAssistantLine("a0000001", { input: 100, output: 10 }) // no session header
    ]);

    const source = new PiSource();
    const original = process.env.PI_CODING_AGENT_SESSION_DIR;
    process.env.PI_CODING_AGENT_SESSION_DIR = root;
    try {
      const result = source.scan(null);
      assert.equal(result.records.length, 1);
      assert.equal(result.records[0]?.sessionId, "01a0bdd1-6ae9-7246-8521-652e7697051d");
      assert.equal(result.records[0]?.projectPath, "unknown");
    } finally {
      if (original === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR;
      else process.env.PI_CODING_AGENT_SESSION_DIR = original;
    }
  });

  it("scans the flat layout of a custom session dir (files at root level)", () => {
    const root = tempDir();
    // No <encoded-cwd> subdirectory: --session-dir / PI_CODING_AGENT_SESSION_DIR
    // keeps files flat (verified against pi's getDefaultSessionDirPath source).
    const file = path.join(
      root,
      "2026-09-20T09-11-19-252Z_01a0be15-8fd2-7635-9341-1cc15a7088ab.jsonl"
    );
    writeFileSync(
      file,
      [
        piHeaderLine("01a0be15-8fd2-7635-9341-1cc15a7088ab", "C:\\Users\\lanzhou\\Project\\Flat"),
        piAssistantLine("a0000001", { input: 2239, output: 16 })
      ].join("\n")
    );

    const source = new PiSource();
    const original = process.env.PI_CODING_AGENT_SESSION_DIR;
    process.env.PI_CODING_AGENT_SESSION_DIR = root;
    try {
      const result = source.scan(null);
      assert.equal(result.records.length, 1);
      assert.equal(result.records[0]?.sessionId, "01a0be15-8fd2-7635-9341-1cc15a7088ab");
      assert.equal(result.records[0]?.projectPath, "C:\\Users\\lanzhou\\Project\\Flat");
      assert.equal(result.records[0]?.outputTokens, 16);
    } finally {
      if (original === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR;
      else process.env.PI_CODING_AGENT_SESSION_DIR = original;
    }
  });

  it("handles a missing sessions directory gracefully", () => {
    const root = tempDir();
    const original = process.env.PI_CODING_AGENT_SESSION_DIR;
    process.env.PI_CODING_AGENT_SESSION_DIR = root;
    try {
      const source = new PiSource();
      const result = source.scan(null);
      assert.deepEqual(result.records, []);
    } finally {
      if (original === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR;
      else process.env.PI_CODING_AGENT_SESSION_DIR = original;
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
    const projectA = tempDir();
    const projectB = tempDir();
    new ProjectRepository(db, user.id).create({ name: "A", path: projectA, aiTool: "claude" });
    new ProjectRepository(db, user.id).create({ name: "B", path: projectB, aiTool: "claude" });
    const fixtureRecord = (value: Partial<TokenUsageRecord>) => fakeRecord({ projectPath: projectA, ...value });
    const repo = new TokenUsageRepository(db, user.id);

    repo.upsertRecords([
      fixtureRecord({ requestId: "req-1" }),
      fixtureRecord({ requestId: "req-2", projectPath: projectB, inputTokens: 500, outputTokens: 50 })
    ]);
    // Re-insert req-1 with updated counts — should update, not duplicate.
    repo.upsertRecords([fixtureRecord({ requestId: "req-1", inputTokens: 2000, outputTokens: 400 })]);

    const summary: TokenUsageSummary = repo.getSummary();
    assert.equal(summary.requestCount, 2);
    assert.equal(summary.totalInputTokens, 2500);
    assert.equal(summary.totalOutputTokens, 450);
    assert.equal(summary.totalCacheReadTokens, 600);
    // cache coverage = read/(input+read+write) = 600 / (2500 + 600 + 0) = 19.4
    assert.equal(summary.cacheHitRate, 19.4);
    assert.equal(summary.byModel[0]?.cacheHitRate, 19.4);
    assert.equal(summary.byAdapter.length, 1);
    assert.equal(summary.byAdapter[0]?.key, "claude");
    assert.equal(summary.byProject[0]?.key, projectA);
    assert.equal(summary.byProject[0]?.totalTokens, 2000 + 400 + 300 + 0 + 0);
    assert.equal(summary.byModel[0]?.key, "anthropic/claude-sonnet-4-5");
  });

  it("filters by date range", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("tokens-range@example.com", "hash");
    const projectA = tempDir();
    const projectB = tempDir();
    new ProjectRepository(db, user.id).create({ name: "A", path: projectA, aiTool: "claude" });
    new ProjectRepository(db, user.id).create({ name: "B", path: projectB, aiTool: "claude" });
    const fixtureRecord = (value: Partial<TokenUsageRecord>) => fakeRecord({ projectPath: projectA, ...value });
    const repo = new TokenUsageRepository(db, user.id);

    repo.upsertRecords([
      fixtureRecord({ requestId: "old", occurredAt: new Date("2026-07-01T10:00:00.000Z") }),
      fixtureRecord({ requestId: "new", occurredAt: new Date("2026-08-02T10:00:00.000Z") })
    ]);

    const summary = repo.getSummary(new Date("2026-08-01T00:00:00.000Z"));
    assert.equal(summary.requestCount, 1);
    assert.equal(summary.byModel[0]?.key, "anthropic/claude-sonnet-4-5");
  });

  it("persists and restores per-adapter cursors", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("tokens-cursor@example.com", "hash");
    const projectA = tempDir();
    const projectB = tempDir();
    new ProjectRepository(db, user.id).create({ name: "A", path: projectA, aiTool: "claude" });
    new ProjectRepository(db, user.id).create({ name: "B", path: projectB, aiTool: "claude" });
    const fixtureRecord = (value: Partial<TokenUsageRecord>) => fakeRecord({ projectPath: projectA, ...value });
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
    const projectA = tempDir();
    const projectB = tempDir();
    new ProjectRepository(db, user.id).create({ name: "A", path: projectA, aiTool: "claude" });
    new ProjectRepository(db, user.id).create({ name: "B", path: projectB, aiTool: "claude" });
    const fixtureRecord = (value: Partial<TokenUsageRecord>) => fakeRecord({ projectPath: projectA, ...value });
    const repo = new TokenUsageRepository(db, user.id);

    repo.upsertRecords([
      fixtureRecord({ requestId: "r1", adapter: "claude", projectPath: projectA, occurredAt: new Date("2026-08-01T10:00:00.000Z") }),
      fixtureRecord({ requestId: "r2", adapter: "claude", projectPath: projectA, occurredAt: new Date("2026-08-01T14:00:00.000Z") }),
      fixtureRecord({ requestId: "r3", adapter: "opencode", projectPath: projectB, occurredAt: new Date("2026-08-02T10:00:00.000Z") })
    ]);

    const series = repo.getDailySeries({ groupBy: "project" });
    // Same day + same project aggregate into one row; /p/a on 08-01 merges r1+r2.
    assert.equal(series.length, 2);
    const dayA = series.filter((row) => row.group === projectA);
    assert.equal(dayA.length, 1);
    assert.equal(dayA[0]?.day, "2026-08-01");
    assert.equal(dayA[0]?.totalTokens, 2 * (1000 + 200 + 300));
    const dayB = series.find((row) => row.group === projectB);
    assert.equal(dayB?.day, "2026-08-02");
  });
});