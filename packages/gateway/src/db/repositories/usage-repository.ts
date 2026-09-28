import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { modelCostRates, sessions } from "../schema.js";
import type { Database } from "../types.js";
import type { Session } from "./session-repository.js";

export interface UsageRate {
  id: string;
  userId: string;
  modelId: string;
  hourlyRateUsd: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UsageBucket {
  key: string;
  sessions: number;
  durationMs: number;
  estimatedCostUsd: number;
}

export interface AdapterUsageBucket extends UsageBucket {
  adapter: string;
}

export interface UsageSummary {
  totalSessions: number;
  totalDurationMs: number;
  estimatedCostUsd: number;
  costLabel: "estimated";
  byAdapter: AdapterUsageBucket[];
  byProject: UsageBucket[];
  byModel: UsageBucket[];
}

export class UsageRepository {
  private drizzle;

  constructor(db: Database, private readonly userId: string) {
    this.drizzle = drizzle(db);
  }

  setModelRate(modelId: string, hourlyRateUsd: number): UsageRate {
    const existing = this.drizzle
      .select()
      .from(modelCostRates)
      .where(and(eq(modelCostRates.userId, this.userId), eq(modelCostRates.modelId, modelId)))
      .get() as UsageRate | undefined;
    const rate = Math.max(hourlyRateUsd, 0);
    if (existing) {
      return this.drizzle
        .update(modelCostRates)
        .set({ hourlyRateUsd: rate, updatedAt: new Date() })
        .where(eq(modelCostRates.id, existing.id))
        .returning()
        .get() as UsageRate;
    }
    return this.drizzle
      .insert(modelCostRates)
      .values({
        userId: this.userId,
        modelId,
        hourlyRateUsd: rate
      })
      .returning()
      .get() as UsageRate;
  }

  listModelRates(): UsageRate[] {
    return this.drizzle
      .select()
      .from(modelCostRates)
      .where(eq(modelCostRates.userId, this.userId))
      .all() as UsageRate[];
  }

  getSummary(now = new Date()): UsageSummary {
    const rows = this.drizzle
      .select()
      .from(sessions)
      .where(eq(sessions.userId, this.userId))
      .all() as Session[];
    const rateByModel = new Map(this.listModelRates().map((rate) => [rate.modelId, rate.hourlyRateUsd]));
    const byAdapter = new Map<string, AdapterUsageBucket>();
    const byProject = new Map<string, UsageBucket>();
    const byModel = new Map<string, UsageBucket>();
    let totalDurationMs = 0;
    let estimatedCostUsd = 0;

    for (const session of rows) {
      const durationMs = sessionDurationMs(session, now);
      const cost = estimateCost(durationMs, session.modelId, rateByModel);
      totalDurationMs += durationMs;
      estimatedCostUsd += cost;
      addAdapterBucket(byAdapter, session.aiTool, durationMs, cost);
      addBucket(byProject, session.projectId, durationMs, cost);
      addBucket(byModel, session.modelId ?? "unassigned", durationMs, cost);
    }

    return {
      totalSessions: rows.length,
      totalDurationMs,
      estimatedCostUsd,
      costLabel: "estimated",
      byAdapter: [...byAdapter.values()],
      byProject: [...byProject.values()],
      byModel: [...byModel.values()]
    };
  }
}

function sessionDurationMs(session: Session, now: Date): number {
  const end = session.lastActive ?? now;
  return Math.max(end.getTime() - session.createdAt.getTime(), 0);
}

function estimateCost(
  durationMs: number,
  modelId: string | null,
  rateByModel: Map<string, number>
): number {
  if (!modelId) return 0;
  const hourlyRate = rateByModel.get(modelId) ?? 0;
  return (durationMs / 3_600_000) * hourlyRate;
}

function addAdapterBucket(
  buckets: Map<string, AdapterUsageBucket>,
  adapter: string,
  durationMs: number,
  estimatedCostUsd: number
): void {
  const current = buckets.get(adapter) ?? {
    key: adapter,
    adapter,
    sessions: 0,
    durationMs: 0,
    estimatedCostUsd: 0
  };
  current.sessions += 1;
  current.durationMs += durationMs;
  current.estimatedCostUsd += estimatedCostUsd;
  buckets.set(adapter, current);
}

function addBucket(
  buckets: Map<string, UsageBucket>,
  key: string,
  durationMs: number,
  estimatedCostUsd: number
): void {
  const current = buckets.get(key) ?? {
    key,
    sessions: 0,
    durationMs: 0,
    estimatedCostUsd: 0
  };
  current.sessions += 1;
  current.durationMs += durationMs;
  current.estimatedCostUsd += estimatedCostUsd;
  buckets.set(key, current);
}
