import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

import { McodeSource, mcodeDataDir, mcodeUsageDbPath } from "../src/services/usage/mcode-source.js";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "fb-mcode-usage-")));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

interface UsageRow {
  id?: number;
  sessionId: string;
  model?: string | null;
  ts: number;
  input: number;
  output: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/**
 * Mirrors the shape of MiniMax Code's own runtime database:
 * `local_runtime_token_usage` joined to `local_runtime_sessions` for the
 * working directory. `workspace_dir` is what makes a record attributable, so
 * the join is not optional.
 */
function writeMcodeFixture(
  dataDir: string,
  sessions: Array<{ id: string; workspaceDir: string | null }>,
  rows: UsageRow[]
): string {
  const dbDir = path.join(dataDir, "v2", "sqlite");
  mkdirSync(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, "runtime-state.sqlite");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE local_runtime_sessions (
      session_id TEXT PRIMARY KEY,
      workspace_dir TEXT
    );
    CREATE TABLE local_runtime_token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      framework_type TEXT NOT NULL,
      turn_id TEXT,
      model TEXT,
      ts INTEGER NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      reasoning_tokens INTEGER NOT NULL,
      cache_read_tokens INTEGER NOT NULL,
      cache_write_tokens INTEGER NOT NULL,
      cost_usd REAL,
      raw TEXT
    );
  `);
  const insSession = db.prepare("INSERT INTO local_runtime_sessions (session_id, workspace_dir) VALUES (?, ?)");
  for (const s of sessions) insSession.run(s.id, s.workspaceDir);
  const insUsage = db.prepare(`
    INSERT INTO local_runtime_token_usage
      (session_id, agent_name, framework_type, turn_id, model, ts,
       input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens)
    VALUES (?, 'mavis', 'pi-agent', ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const r of rows) {
    insUsage.run(r.sessionId, `turn_${r.id ?? r.ts}`, r.model ?? null, r.ts,
      r.input, r.output, r.reasoning ?? 0, r.cacheRead ?? 0, r.cacheWrite ?? 0);
  }
  db.close();
  return dbPath;
}

describe("McodeSource", () => {
  it("resolves the data directory in the CLI's own precedence order", () => {
    const home = path.resolve(path.join(path.sep, "home", "tester"));
    const at = (...segments: string[]): string => path.resolve(path.join(home, ...segments));

    assert.equal(mcodeDataDir({ MINIMAX_DATA_DIR: at("d1") }, home), at("d1"));
    assert.equal(mcodeDataDir({ MAVIS_DATA_DIR: at("d2") }, home), at("d2"));
    assert.equal(
      mcodeDataDir({ MINIMAX_DATA_DIR: at("d1"), MAVIS_DATA_DIR: at("d2") }, home),
      at("d1")
    );
    // Blank falls through, matching the CLI's trim-then-default behavior.
    assert.equal(mcodeDataDir({ MINIMAX_DATA_DIR: "   " }, home), at(".minimax"));
    assert.equal(mcodeDataDir({}, home), at(".minimax"));
    assert.equal(mcodeUsageDbPath({}, home), path.join(at(".minimax"), "v2", "sqlite", "runtime-state.sqlite"));
  });

  it("extracts ledger rows joined with the session workspace", () => {
    const dataDir = tempDir();
    writeMcodeFixture(
      dataDir,
      [{ id: "mvs_a", workspaceDir: path.join(dataDir, "workspace") }],
      [{ sessionId: "mvs_a", model: "minimax/MiniMax-M3", ts: 1_700_000_000_000, input: 120, output: 34, cacheRead: 7 }]
    );

    const result = new McodeSource({ env: { MINIMAX_DATA_DIR: dataDir } }).scan(null);

    assert.equal(result.records.length, 1);
    const record = result.records[0]!;
    assert.equal(record.adapter, "mcode");
    assert.equal(record.sessionId, "mvs_a");
    // The workspace is what the syncer's ownership filter matches against.
    assert.equal(record.projectPath, path.join(dataDir, "workspace"));
    assert.equal(record.modelId, "minimax/MiniMax-M3");
    assert.equal(record.inputTokens, 120);
    assert.equal(record.outputTokens, 34);
    assert.equal(record.cacheReadTokens, 7);
    assert.equal(record.cacheWriteTokens, 0);
    assert.equal(record.reasoningTokens, 0);
    assert.equal(record.occurredAt.getTime(), 1_700_000_000_000);
    assert.equal(result.nextWatermark, "1700000000000");
  });

  it("uses the ledger id as requestId because turn_id repeats within a turn", () => {
    const dataDir = tempDir();
    writeMcodeFixture(
      dataDir,
      [{ id: "mvs_a", workspaceDir: dataDir }],
      [
        { sessionId: "mvs_a", ts: 1, input: 1, output: 1 },
        { sessionId: "mvs_a", ts: 2, input: 1, output: 1 },
        { sessionId: "mvs_a", ts: 3, input: 1, output: 1 }
      ]
    );

    const records = new McodeSource({ env: { MINIMAX_DATA_DIR: dataDir } }).scan(null).records;

    const ids = records.map((r) => r.requestId);
    // Unique request ids are what make re-inserts idempotent in the repository.
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(ids, ["1", "2", "3"]);
  });

  it("skips zero-token bookkeeping rows and rows without a session", () => {
    const dataDir = tempDir();
    writeMcodeFixture(
      dataDir,
      [{ id: "mvs_a", workspaceDir: dataDir }],
      [
        { sessionId: "mvs_a", ts: 10, input: 11, output: 12 },   // keep
        { sessionId: "mvs_a", ts: 20, input: 0, output: 0 },      // bookkeeping, drop
        { sessionId: "mvs_missing", ts: 30, input: 5, output: 5 } // orphan session, drop
      ]
    );

    const records = new McodeSource({ env: { MINIMAX_DATA_DIR: dataDir } }).scan(null).records;

    // Only the attributable, billable row survives. The orphan is removed by
    // the join (no workspace_dir to attribute to) and the zero row by the
    // token guard, so neither reaches the repository.
    assert.deepEqual(records.map((r) => r.requestId), ["1"]);
    assert.equal(records[0]!.inputTokens, 11);
  });

  it("resumes from the watermark and keeps it when nothing is newer", () => {
    const dataDir = tempDir();
    writeMcodeFixture(
      dataDir,
      [{ id: "mvs_a", workspaceDir: dataDir }],
      [{ sessionId: "mvs_a", ts: 500, input: 3, output: 4 }]
    );
    const source = new McodeSource({ env: { MINIMAX_DATA_DIR: dataDir } });

    const first = source.scan(null);
    assert.equal(first.records.length, 1);
    assert.equal(first.nextWatermark, "500");

    // `>=` is a safe superset; the unique request id absorbs the overlap.
    const second = source.scan(first.nextWatermark);
    assert.equal(second.records.length, 1);
    assert.equal(second.nextWatermark, "500");
  });

  it("returns nothing without losing the position when the database is absent", () => {
    const dataDir = tempDir();
    const result = new McodeSource({ env: { MINIMAX_DATA_DIR: dataDir } }).scan(null);
    assert.deepEqual(result.records, []);
    assert.equal(result.nextWatermark, "0");
  });

  it("survives a database that predates the v2 layout", () => {
    const dataDir = tempDir();
    const dbDir = path.join(dataDir, "v2", "sqlite");
    mkdirSync(dbDir, { recursive: true });
    const db = new Database(path.join(dbDir, "runtime-state.sqlite"));
    db.exec("CREATE TABLE something_else (id TEXT)");
    db.close();

    const result = new McodeSource({ env: { MINIMAX_DATA_DIR: dataDir } }).scan(null);
    // A mid-migration schema must not take down the whole multi-adapter sync.
    assert.deepEqual(result.records, []);
  });
});
