/**
 * OpenCode usage source (read-only SQLite).
 *
 * Opens `~/.local/share/opencode/opencode.db` (or `OPENCODE_DB` override)
 * read-only via better-sqlite3 and queries `message` rows joined with
 * `session` for the working directory. Token shape per message.data:
 *
 * ```json
 * {"role":"assistant","modelID":"...","providerID":"...",
 *  "tokens":{"total":14753,"input":14558,"output":131,"reasoning":64,
 *            "cache":{"write":0,"read":0}},
 *  "time":{"created":...,"completed":...}}
 * ```
 *
 * Watermark: ms-based `message.time_created` lower bound. Appends are
 * chronological, so `time_created >= watermark` is a safe superset; the
 * repository's unique `(user_id, adapter, request_id)` constraint makes
 * re-inserts idempotent.
 */

import BetterSqlite3 from "better-sqlite3";
import { existsSync } from "node:fs";
import path from "node:path";

import { opencodeDbPath, type TokenUsageRecord, type UsageScanResult, type UsageSource } from "./usage-source.js";

const SCAN_QUERY = `
  SELECT m.id AS message_id,
         m.session_id,
         m.time_created AS message_time_created,
         s.directory AS directory,
         m.data
  FROM message m
  JOIN session s ON s.id = m.session_id
  WHERE m.time_created >= ?
  ORDER BY m.time_created ASC, m.id ASC
`;

export class OpenCodeSource implements UsageSource {
  readonly adapter = "opencode" as const;

  scan(lastWatermark: string | null): UsageScanResult {
    const root = opencodeDbPath();
    const watermarkMs = parseWatermark(lastWatermark);
    const records: TokenUsageRecord[] = [];
    if (!existsSync(root)) {
      // No db yet — keep the resumed position so first db creation is a full scan.
      return { records, nextWatermark: String(watermarkMs) };
    }

    let db: BetterSqlite3.Database;
    try {
      db = new BetterSqlite3(root, { readonly: true });
    } catch {
      return { records, nextWatermark: String(watermarkMs) };
    }

    try {
      const rows = db
        .prepare(SCAN_QUERY)
        .all(watermarkMs) as Array<{
        message_id: string;
        session_id: string;
        message_time_created: number;
        directory: string | null;
        data: string;
      }>;
      let maxMs = watermarkMs;
      for (const row of rows) {
        if (typeof row.message_time_created === "number") {
          maxMs = Math.max(maxMs, row.message_time_created);
        }
        const record = rowToRecord(row);
        if (record) records.push(record);
      }
      return { records, nextWatermark: String(maxMs) };
    } finally {
      db.close();
    }
  }
}

function rowToRecord(row: {
  message_id: string;
  session_id: string;
  message_time_created: number;
  directory: string | null;
  data: string;
}): TokenUsageRecord | null {
  let data: unknown;
  try {
    data = JSON.parse(row.data ?? "null") as unknown;
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  if (data.role !== "assistant") return null;
  const tokens = data.tokens;
  if (!isRecord(tokens)) return null;
  const time = isRecord(data.time) ? data.time : {};
  const occurredAt =
    typeof time.completed === "number" && time.completed > 0
      ? new Date(time.completed)
      : typeof time.created === "number" && time.created > 0
        ? new Date(time.created)
        : typeof row.message_time_created === "number"
          ? new Date(row.message_time_created)
          : new Date(0);
  const input = numeric(tokens.input);
  const output = numeric(tokens.output);
  const reasoning = numeric(tokens.reasoning);
  if (input <= 0 && output <= 0) return null;
  const cache = isRecord(tokens.cache) ? tokens.cache : {};
  const projectPath =
    typeof row.directory === "string" && row.directory.length > 0
      ? path.resolve(row.directory)
      : "";

  return {
    adapter: "opencode",
    sessionId: row.session_id,
    projectPath,
    modelId: typeof data.modelID === "string" ? data.modelID : null,
    requestId: row.message_id,
    occurredAt,
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: numeric(cache.read),
    cacheWriteTokens: numeric(cache.write),
    reasoningTokens: reasoning,
    sourceFile: opencodeDbPath()
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}