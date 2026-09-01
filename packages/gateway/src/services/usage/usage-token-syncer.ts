/**
 * Usage token sync orchestrator.
 *
 * Runs a `UsageSource` for a given user, persists returned records
 * idempotently, and advances that (user, adapter) watermark cursor so the
 * next run only scans newer data.
 */

import type { Database } from "../../db/types.js";
import { TokenUsageRepository } from "../../db/repositories/token-usage-repository.js";
import { ClaudeCodeSource } from "./claude-code-source.js";
import { CodexSource } from "./codex-source.js";
import { KimiSource } from "./kimi-source.js";
import { OpenCodeSource } from "./opencode-source.js";
import type { UsageSource, UsageTokenAdapter } from "./usage-source.js";

export interface UsageSyncResult {
  adapter: UsageTokenAdapter;
  scanned: number;
  inserted: number;
}

export interface UsageSyncSummary {
  byAdapter: UsageSyncResult[];
  totalInserted: number;
}

export function createUsageTokenSyncer(db: Database): {
  syncForUser: (userId: string, source: UsageSource) => UsageSyncResult;
  /** Run every built-in source (Claude + OpenCode + Codex + Kimi) for a user and return totals. */
  syncAllForUser: (userId: string) => UsageSyncSummary;
} {
  const syncForUser = (userId: string, source: UsageSource): UsageSyncResult => {
    const repo = new TokenUsageRepository(db, userId);
    const lastWatermark = repo.getCursor(source.adapter);
    const result = source.scan(lastWatermark || null);
    repo.upsertRecords(result.records);
    repo.setCursor(source.adapter, result.nextWatermark);
    return {
      adapter: source.adapter,
      scanned: result.records.length,
      inserted: result.records.length
    };
  };

  return {
    syncForUser,
    syncAllForUser(userId) {
      const results = [
        syncForUser(userId, new ClaudeCodeSource()),
        syncForUser(userId, new OpenCodeSource()),
        syncForUser(userId, new CodexSource()),
        syncForUser(userId, new KimiSource())
      ];
      return {
        byAdapter: results,
        totalInserted: results.reduce((sum, result) => sum + result.inserted, 0)
      };
    }
  };
}