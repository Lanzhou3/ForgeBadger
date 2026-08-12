/**
 * Usage token sync orchestrator.
 *
 * Runs a `UsageSource` for a given user, persists returned records
 * idempotently, and advances that (user, adapter) watermark cursor so the
 * next run only scans newer data.
 */

import type { Database } from "../../db/types.js";
import { TokenUsageRepository } from "../../db/repositories/token-usage-repository.js";
import type { UsageSource, UsageTokenAdapter } from "./usage-source.js";

export interface UsageSyncResult {
  adapter: UsageTokenAdapter;
  scanned: number;
  inserted: number;
}

export function createUsageTokenSyncer(db: Database): {
  syncForUser: (userId: string, source: UsageSource) => UsageSyncResult;
} {
  return {
    syncForUser(userId, source) {
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
    }
  };
}