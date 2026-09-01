import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";

import { tokenUsageRecords, usageSyncCursors } from "../schema.js";
import type { Database } from "../types.js";
import type { TokenUsageRecord } from "../../services/usage/usage-source.js";

export interface TokenUsageBucket {
  key: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  requestCount: number;
  /** Cache hit rate (read/(read+write)) as a 0-100 percentage, or null when no cache activity. */
  cacheHitRate: number | null;
}

export interface TokenUsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalReasoningTokens: number;
  totalTokens: number;
  requestCount: number;
  /** Overall cache hit rate (read/(read+write)) 0-100, or null when no cache activity. */
  cacheHitRate: number | null;
  byAdapter: TokenUsageBucket[];
  byProject: TokenUsageBucket[];
  byModel: TokenUsageBucket[];
}

export class TokenUsageRepository {
  private drizzle;

  constructor(private readonly db: Database, private readonly userId: string) {
    this.drizzle = drizzle(db);
  }

  /** Persist scanned records (idempotent via unique (user_id, adapter, request_id)). */
  upsertRecords(records: TokenUsageRecord[]): void {
    const BATCH = 200; // SQLite caps bound variables (~999); 200 rows × 12 cols fits safely.
    const build = (records: TokenUsageRecord[]) =>
      this.drizzle
        .insert(tokenUsageRecords)
        .values(
          records.map((record) => ({
            userId: this.userId,
            adapter: record.adapter,
            sessionId: record.sessionId,
            projectPath: record.projectPath,
            modelId: record.modelId,
            requestId: record.requestId,
            occurredAt: record.occurredAt,
            inputTokens: record.inputTokens,
            outputTokens: record.outputTokens,
            cacheReadTokens: record.cacheReadTokens,
            cacheWriteTokens: record.cacheWriteTokens,
            reasoningTokens: record.reasoningTokens,
            sourceFile: record.sourceFile
          }))
        )
        .onConflictDoUpdate({
          target: [tokenUsageRecords.userId, tokenUsageRecords.adapter, tokenUsageRecords.requestId],
          set: {
            occurredAt: sql`excluded.occurred_at`,
            inputTokens: sql`excluded.input_tokens`,
            outputTokens: sql`excluded.output_tokens`,
            cacheReadTokens: sql`excluded.cache_read_tokens`,
            cacheWriteTokens: sql`excluded.cache_write_tokens`,
            reasoningTokens: sql`excluded.reasoning_tokens`,
            sourceFile: sql`excluded.source_file`
          }
        });
    for (let i = 0; i < records.length; i += BATCH) {
      build(records.slice(i, i + BATCH)).run();
    }
  }

  getCursor(adapter: string): string {
    const row = this.drizzle
      .select()
      .from(usageSyncCursors)
      .where(and(eq(usageSyncCursors.userId, this.userId), eq(usageSyncCursors.adapter, adapter)))
      .get();
    return row?.watermark ?? "";
  }

  setCursor(adapter: string, watermark: string): void {
    this.drizzle
      .insert(usageSyncCursors)
      .values({
        id: randomUUID(),
        userId: this.userId,
        adapter,
        watermark
      })
      .onConflictDoUpdate({
        target: [usageSyncCursors.userId, usageSyncCursors.adapter],
        set: { watermark }
      })
      .run();
  }

  getSummary(from?: Date, to?: Date): TokenUsageSummary {
    const fromSeconds = from ? Math.floor(from.getTime() / 1000) : null;
    const toSeconds = to ? Math.floor(to.getTime() / 1000) : null;
    const { whereSql, params } = buildRangeFilter(this.userId, fromSeconds, toSeconds);
    const rows = this.db.prepare(`
      SELECT
        adapter,
        project_path AS projectPath,
        model_id AS modelId,
        SUM(input_tokens) AS inputTokens,
        SUM(output_tokens) AS outputTokens,
        SUM(cache_read_tokens) AS cacheReadTokens,
        SUM(cache_write_tokens) AS cacheWriteTokens,
        SUM(reasoning_tokens) AS reasoningTokens,
        COUNT(*) AS requestCount
      FROM token_usage_records
      ${whereSql}
      GROUP BY adapter, project_path, model_id
    `).all(...params) as TokenAggregateRow[];

    const byAdapter = new Map<string, TokenUsageBucket>();
    const byProject = new Map<string, TokenUsageBucket>();
    const byModel = new Map<string, TokenUsageBucket>();

    for (const row of rows) {
      mergeAggregate(byAdapter, row.adapter || "unknown", row);
      mergeAggregate(byProject, row.projectPath || "unknown", row);
      mergeAggregate(byModel, row.modelId || "unknown", row);
    }

    const totals = sumAggregates(rows);
    return {
      totalInputTokens: totals.inputTokens,
      totalOutputTokens: totals.outputTokens,
      totalCacheReadTokens: totals.cacheReadTokens,
      totalCacheWriteTokens: totals.cacheWriteTokens,
      totalReasoningTokens: totals.reasoningTokens,
      totalTokens: totalTokens(totals),
      requestCount: totals.requestCount,
      cacheHitRate: hitRate(totals.cacheReadTokens, totals.cacheWriteTokens, totals.inputTokens),
      byAdapter: sortBuckets(byAdapter),
      byProject: sortBuckets(byProject),
      byModel: sortBuckets(byModel)
    };
  }

  /** Per-day token series (project × day when projectPath provided; adapter × day otherwise). */
  getDailySeries(options: {
    from?: Date;
    to?: Date;
    groupBy: "project" | "adapter";
    projectPath?: string;
  }): Array<{
    day: string;
    group: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  }> {
    const fromSeconds = options.from ? Math.floor(options.from.getTime() / 1000) : null;
    const toSeconds = options.to ? Math.floor(options.to.getTime() / 1000) : null;
    const { whereSql, params } = buildRangeFilter(this.userId, fromSeconds, toSeconds, options.projectPath);
    const groupColumn = options.groupBy === "project" ? "project_path" : "adapter";

    return this.db.prepare(`
      SELECT
        strftime('%Y-%m-%d', occurred_at, 'unixepoch') AS day,
        ${groupColumn} AS "group",
        SUM(input_tokens) AS inputTokens,
        SUM(output_tokens) AS outputTokens,
        SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens) AS totalTokens
      FROM token_usage_records
      ${whereSql}
      GROUP BY day, ${groupColumn}
      ORDER BY day ASC, "group" ASC
    `).all(...params) as Array<{
      day: string;
      group: string;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    }>;
  }
}

type TokenAggregateRow = {
  adapter: string;
  projectPath: string;
  modelId: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  requestCount: number;
};

function mergeAggregate(map: Map<string, TokenUsageBucket>, key: string, row: TokenAggregateRow): void {
  const current = map.get(key) ?? {
    key,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    requestCount: 0,
    cacheHitRate: null
  };
  current.inputTokens += row.inputTokens;
  current.outputTokens += row.outputTokens;
  current.cacheReadTokens += row.cacheReadTokens;
  current.cacheWriteTokens += row.cacheWriteTokens;
  current.reasoningTokens += row.reasoningTokens;
  current.totalTokens += totalTokens(row);
  current.requestCount += row.requestCount;
  current.cacheHitRate = hitRate(current.cacheReadTokens, current.cacheWriteTokens, current.inputTokens);
  map.set(key, current);
}

/**
 * Cache coverage (industry-standard "cache hit rate"): cache read tokens as a
 * share of all input tokens (uncached input + cache write + cache read), as
 * 0-100. Matches Anthropic's own cache-hit-rate definition and OpenUsage's
 * convention. Returns null when there is no cache activity at all (read+write
 * == 0), so a quiet/non-caching window never shows a misleading 0%.
 */
function hitRate(readTokens: number, writeTokens: number, inputTokens: number): number | null {
  if (readTokens + writeTokens <= 0) return null;
  const total = inputTokens + readTokens + writeTokens;
  if (total <= 0) return null;
  return Math.round((readTokens / total) * 1000) / 10;
}

function sortBuckets(map: Map<string, TokenUsageBucket>): TokenUsageBucket[] {
  return [...map.values()].sort((a, b) => b.totalTokens - a.totalTokens);
}

function buildRangeFilter(
  userId: string,
  fromSeconds: number | null,
  toSeconds: number | null,
  projectPath?: string
): { whereSql: string; params: Array<string | number> } {
  const clauses = ["user_id = ?"];
  const params: Array<string | number> = [userId];
  if (fromSeconds !== null) {
    clauses.push("occurred_at >= ?");
    params.push(fromSeconds);
  }
  if (toSeconds !== null) {
    clauses.push("occurred_at < ?");
    params.push(toSeconds);
  }
  if (projectPath !== undefined) {
    clauses.push("project_path = ?");
    params.push(projectPath);
  }
  return { whereSql: `WHERE ${clauses.join(" AND ")}`, params };
}

function sumAggregates(rows: TokenAggregateRow[]): Omit<TokenAggregateRow, "adapter" | "projectPath" | "modelId"> {
  return rows.reduce((total, row) => ({
    inputTokens: total.inputTokens + row.inputTokens,
    outputTokens: total.outputTokens + row.outputTokens,
    cacheReadTokens: total.cacheReadTokens + row.cacheReadTokens,
    cacheWriteTokens: total.cacheWriteTokens + row.cacheWriteTokens,
    reasoningTokens: total.reasoningTokens + row.reasoningTokens,
    requestCount: total.requestCount + row.requestCount
  }), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, requestCount: 0 });
}

function totalTokens(row: Pick<TokenAggregateRow, "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens" | "reasoningTokens">): number {
  return row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheWriteTokens + row.reasoningTokens;
}
