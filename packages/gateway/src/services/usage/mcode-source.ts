/**
 * MiniMax Code usage source (read-only SQLite).
 *
 * Opens `<dataDir>/v2/sqlite/runtime-state.sqlite` read-only via better-sqlite3
 * and joins the CLI's own token ledger against its session table:
 *
 * ```sql
 * SELECT ... FROM local_runtime_token_usage u
 * JOIN local_runtime_sessions s ON s.session_id = u.session_id
 * ```
 *
 * The join is what makes this usable: `local_runtime_sessions.workspace_dir`
 * carries the real working directory, and the syncer drops any record whose
 * `projectPath` is not a project root owned by the user, so a source without a
 * cwd would be silently filtered out. The JSONL alternative
 * (`<sessionDir>/messages.jsonl`) also carries a `usage` block but has no cwd
 * anywhere in the session, so it cannot be attributed.
 *
 * `requestId` is the table's autoincrement `id`, not `turn_id`: one turn emits
 * several ledger rows (streaming updates), so `turn_id` is not unique and
 * would collide in the repository's `(user_id, adapter, request_id)` index.
 *
 * Watermark: `ts >= watermark` on epoch milliseconds. Rows sharing a `ts` are
 * a safe superset; the unique request id makes re-inserts idempotent.
 */

import BetterSqlite3 from "better-sqlite3";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { TokenUsageRecord, UsageScanResult, UsageSource } from "./usage-source.js";

const SCAN_QUERY = `
  SELECT u.id AS usage_id,
         u.session_id,
         u.model,
         u.ts,
         u.input_tokens,
         u.output_tokens,
         u.reasoning_tokens,
         u.cache_read_tokens,
         u.cache_write_tokens,
         s.workspace_dir
  FROM local_runtime_token_usage u
  JOIN local_runtime_sessions s ON s.session_id = u.session_id
  WHERE u.ts >= ?
  ORDER BY u.ts ASC, u.id ASC
`;

/** Same precedence the CLI itself uses for its data directory. */
export function mcodeDataDir(env: NodeJS.ProcessEnv = process.env, homeDir: string = homedir()): string {
  return path.resolve(
    env.MINIMAX_DATA_DIR?.trim() || env.MAVIS_DATA_DIR?.trim() || path.join(homeDir, ".minimax")
  );
}

export function mcodeUsageDbPath(env: NodeJS.ProcessEnv = process.env, homeDir: string = homedir()): string {
  return path.join(mcodeDataDir(env, homeDir), "v2", "sqlite", "runtime-state.sqlite");
}

export class McodeSource implements UsageSource {
  readonly adapter = "mcode" as const;

  private readonly env: NodeJS.ProcessEnv;
  private readonly homeDir: string;

  constructor(options: { env?: NodeJS.ProcessEnv; homeDir?: string } = {}) {
    this.env = options.env ?? process.env;
    this.homeDir = options.homeDir ?? homedir();
  }

  scan(lastWatermark: string | null): UsageScanResult {
    const dbPath = mcodeUsageDbPath(this.env, this.homeDir);
    const watermarkMs = parseWatermark(lastWatermark);
    const records: TokenUsageRecord[] = [];
    if (!existsSync(dbPath)) {
      // No v2 runtime state yet — keep the resumed position so the first
      // database creation is still treated as a full scan.
      return { records, nextWatermark: String(watermarkMs) };
    }

    let db: BetterSqlite3.Database;
    try {
      // Read-only: the CLI owns this database and may hold it open while
      // ForgeBadger scans, which SQLite permits for readers.
      db = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true });
    } catch {
      return { records, nextWatermark: String(watermarkMs) };
    }

    try {
      const rows = db.prepare(SCAN_QUERY).all(watermarkMs) as Array<{
        usage_id: number;
        session_id: string;
        model: string | null;
        ts: number;
        input_tokens: number;
        output_tokens: number;
        reasoning_tokens: number;
        cache_read_tokens: number;
        cache_write_tokens: number;
        workspace_dir: string | null;
      }>;
      let maxMs = watermarkMs;
      for (const row of rows) {
        if (typeof row.ts === "number" && Number.isFinite(row.ts)) maxMs = Math.max(maxMs, row.ts);
        const record = rowToRecord(row, dbPath);
        if (record) records.push(record);
      }
      return { records, nextWatermark: String(maxMs) };
    } catch {
      // A pre-v2 or mid-migration database has no such tables. Surface no
      // records rather than failing the whole multi-adapter sync.
      return { records, nextWatermark: String(watermarkMs) };
    } finally {
      db.close();
    }
  }
}

function rowToRecord(
  row: {
    usage_id: number;
    session_id: string;
    model: string | null;
    ts: number;
    input_tokens: number;
    output_tokens: number;
    reasoning_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
    workspace_dir: string | null;
  },
  sourceFile: string
): TokenUsageRecord | null {
  const input = numeric(row.input_tokens);
  const output = numeric(row.output_tokens);
  // A zero-token row is a bookkeeping entry, not a billable request.
  if (input <= 0 && output <= 0) return null;
  const occurredAt = numeric(row.ts) > 0 ? new Date(row.ts) : new Date(0);
  const workspace = typeof row.workspace_dir === "string" ? row.workspace_dir : "";

  return {
    adapter: "mcode",
    sessionId: row.session_id,
    // The syncer only keeps records matching an owned project root, so an
    // unresolvable cwd is passed through as-is rather than invented.
    projectPath: workspace,
    modelId: typeof row.model === "string" && row.model !== "" ? row.model : null,
    // `id` is the only per-request unique key; `turn_id` repeats across the
    // streaming updates of a single turn.
    requestId: String(row.usage_id),
    occurredAt,
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: numeric(row.cache_read_tokens),
    cacheWriteTokens: numeric(row.cache_write_tokens),
    reasoningTokens: numeric(row.reasoning_tokens),
    sourceFile
  };
}

function parseWatermark(watermark: string | null): number {
  if (!watermark) return 0;
  const parsed = Number(watermark);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
