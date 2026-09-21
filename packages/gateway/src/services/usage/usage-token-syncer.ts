/**
 * Usage token sync orchestrator.
 *
 * Runs a `UsageSource` for a given user, persists returned records
 * idempotently, and advances that (user, adapter) watermark cursor so the
 * next run only scans newer data.
 */

import type { Database } from "../../db/types.js";
import { UsageOwnershipRepository } from "../../db/repositories/usage-ownership-repository.js";
import { TokenUsageRepository } from "../../db/repositories/token-usage-repository.js";
import { ClaudeCodeSource } from "./claude-code-source.js";
import { CodexSource } from "./codex-source.js";
import { KimiSource } from "./kimi-source.js";
import { OpenCodeSource } from "./opencode-source.js";
import { PiSource } from "./pi-source.js";
import type { UsageSource, UsageTokenAdapter } from "./usage-source.js";

export interface UsageSyncResult {
  adapter: UsageTokenAdapter;
  scanned: number;
  inserted: number;
  excluded: number;
}

export interface UsageSyncSummary {
  byAdapter: UsageSyncResult[];
  totalInserted: number;
}

export function createUsageTokenSyncer(db: Database): {
  syncForUser: (userId: string, source: UsageSource) => UsageSyncResult;
  /** Run every built-in source (Claude + OpenCode + Codex + Kimi + PI) for a user and return totals. */
  syncAllForUser: (userId: string) => UsageSyncSummary;
} {
  const syncForUser = (userId: string, source: UsageSource): UsageSyncResult => {
    const repo = new TokenUsageRepository(db, userId);
    const ownership = new UsageOwnershipRepository(db, userId).snapshot();
    const lastWatermark = sourceCursor(repo.getCursor(source.adapter), ownership.fingerprint);
    const result = source.scan(lastWatermark);
    return db.transaction(() => {
      // Recheck after source I/O and commit the write + cursor as one unit.
      const current = new UsageOwnershipRepository(db, userId).snapshot();
      if (current.fingerprint !== ownership.fingerprint) throw new Error("Usage ownership changed during scan; retry sync");
      const roots = new Set(current.roots);
      const records = result.records.filter((record) => record.adapter === source.adapter && roots.has(record.projectPath));
      repo.upsertRecords(records);
      repo.setCursor(source.adapter, JSON.stringify({ version: 1, ownership: current.fingerprint, source: result.nextWatermark }));
      return { adapter: source.adapter, scanned: result.records.length, inserted: records.length, excluded: result.records.length - records.length };
    })();
  };

  return {
    syncForUser,
    syncAllForUser(userId) {
      const results = [
        syncForUser(userId, new ClaudeCodeSource()),
        syncForUser(userId, new OpenCodeSource()),
        syncForUser(userId, new CodexSource()),
        syncForUser(userId, new KimiSource()),
        syncForUser(userId, new PiSource())
      ];
      return {
        byAdapter: results,
        totalInserted: results.reduce((sum, result) => sum + result.inserted, 0)
      };
    }
  };
}

/** Older or changed-ownership cursors trigger a filtered, idempotent rebuild. */
function sourceCursor(value: string, fingerprint: string): string | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const cursor = parsed as Record<string, unknown>;
    return cursor.version === 1 && cursor.ownership === fingerprint && typeof cursor.source === "string"
      ? cursor.source : null;
  } catch {
    return null;
  }
}
