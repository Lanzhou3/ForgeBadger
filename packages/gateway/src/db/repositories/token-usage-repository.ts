import { and, asc, eq, sql } from "drizzle-orm";
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

  constructor(db: Database, private readonly userId: string) {
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
    const andClauses = [eq(tokenUsageRecords.userId, this.userId)];
    if (fromSeconds !== null) andClauses.push(sql`${tokenUsageRecords.occurredAt} >= ${fromSeconds}`);
    if (toSeconds !== null) andClauses.push(sql`${tokenUsageRecords.occurredAt} < ${toSeconds}`);
    const where = and(...andClauses);

    const rows = this.drizzle
      .select({
        adapter: tokenUsageRecords.adapter,
        projectPath: tokenUsageRecords.projectPath,
        modelId: tokenUsageRecords.modelId,
        inputTokens: tokenUsageRecords.inputTokens,
        outputTokens: tokenUsageRecords.outputTokens,
        cacheReadTokens: tokenUsageRecords.cacheReadTokens,
        cacheWriteTokens: tokenUsageRecords.cacheWriteTokens,
        reasoningTokens: tokenUsageRecords.reasoningTokens
      })
      .from(tokenUsageRecords)
      .where(where)
      .all() as Array<{
      adapter: string;
      projectPath: string;
      modelId: string | null;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      reasoningTokens: number;
    }>;

    const byAdapter = new Map<string, TokenUsageBucket>();
    const byProject = new Map<string, TokenUsageBucket>();
    const byModel = new Map<string, TokenUsageBucket>();

    for (const row of rows) {
      merge(byAdapter, row.adapter || "unknown", row);
      merge(byProject, row.projectPath || "unknown", row);
      merge(byModel, row.modelId || "unknown", row);
    }

    const totalInputTokens = sum(rows, (r) => r.inputTokens);
    const totalOutputTokens = sum(rows, (r) => r.outputTokens);
    const totalReasoningTokens = sum(rows, (r) => r.reasoningTokens);
    const totalCacheReadTokens = sum(rows, (r) => r.cacheReadTokens);
    const totalCacheWriteTokens = sum(rows, (r) => r.cacheWriteTokens);
    return {
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadTokens,
      totalCacheWriteTokens,
      totalReasoningTokens,
      totalTokens: totalInputTokens + totalOutputTokens + totalCacheReadTokens + totalCacheWriteTokens + totalReasoningTokens,
      requestCount: rows.length,
      cacheHitRate: hitRate(totalCacheReadTokens, totalCacheWriteTokens, totalInputTokens),
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
    const andClauses = [eq(tokenUsageRecords.userId, this.userId)];
    if (options.from) andClauses.push(sql`${tokenUsageRecords.occurredAt} >= ${Math.floor(options.from.getTime() / 1000)}`);
    if (options.to) andClauses.push(sql`${tokenUsageRecords.occurredAt} < ${Math.floor(options.to.getTime() / 1000)}`);
    if (options.projectPath) andClauses.push(eq(tokenUsageRecords.projectPath, options.projectPath));

    const groupColumn = options.groupBy === "project"
      ? tokenUsageRecords.projectPath
      : tokenUsageRecords.adapter;

    const dayPrefix = sql<string>`strftime('%Y-%m-%d', ${tokenUsageRecords.occurredAt}, 'unixepoch')`;

    const rows = this.drizzle
      .select({
        day: dayPrefix,
        group: groupColumn,
        inputTokens: tokenUsageRecords.inputTokens,
        outputTokens: tokenUsageRecords.outputTokens,
        totalTokens: sql<number>`(${tokenUsageRecords.inputTokens} + ${tokenUsageRecords.outputTokens} + ${tokenUsageRecords.cacheReadTokens} + ${tokenUsageRecords.cacheWriteTokens} + ${tokenUsageRecords.reasoningTokens})`
      })
      .from(tokenUsageRecords)
      .where(and(...andClauses))
      .orderBy(asc(dayPrefix))
      .all() as Array<{
      day: string;
      group: string;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    }>;

    const byDay = new Map<string, Map<string, { inputTokens: number; outputTokens: number; totalTokens: number; count: number }>>();
    for (const row of rows) {
      const dayKey = typeof row.day === "string" ? row.day : "";
      const groupKey = row.group ?? "unknown";
      const dayMap = byDay.get(dayKey) ?? new Map();
      const current = dayMap.get(groupKey) ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0, count: 0 };
      current.inputTokens += row.inputTokens;
      current.outputTokens += row.outputTokens;
      current.totalTokens += row.totalTokens;
      current.count += 1;
      dayMap.set(groupKey, current);
      byDay.set(dayKey, dayMap);
    }

    const result: Array<{ day: string; group: string; inputTokens: number; outputTokens: number; totalTokens: number }> = [];
    for (const [day, groupMap] of [...byDay.entries()].sort()) {
      for (const [group, value] of [...groupMap.entries()].sort()) {
        result.push({ day, group, inputTokens: value.inputTokens, outputTokens: value.outputTokens, totalTokens: value.totalTokens });
      }
    }
    return result;
  }
}

type TokenRow = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
};

function merge(map: Map<string, TokenUsageBucket>, key: string, row: TokenRow): void {
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
  current.totalTokens += row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheWriteTokens + row.reasoningTokens;
  current.requestCount += 1;
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

function sum(rows: Array<{ inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; reasoningTokens: number }>, pick: (r: (typeof rows)[number]) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}