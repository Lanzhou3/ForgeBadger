/**
 * Usage tools for the Copilot harness — the "usage" seam. Read-only: exposes
 * the same per-user aggregates the Usage page shows (session duration and
 * estimated cost by adapter/project/model, plus token consumption by window)
 * so the Copilot can answer "how much have I spent" style questions.
 *
 * The queries live in the usage repositories, shared with the /api/v1/usage
 * routes; this seam adds no new data access pattern.
 */
import { z } from "zod";

import { TokenUsageRepository } from "../../../db/repositories/token-usage-repository.js";
import { UsageRepository } from "../../../db/repositories/usage-repository.js";
import type { Database } from "../../../db/types.js";
import type { AgentTool, AgentToolContext } from "../tool-registry.js";

const getUsageSummaryInput = z.object({
  /**
   * Optional trailing window in days for the TOKEN statistics. Session
   * duration/cost aggregates are all-time (the underlying repository has no
   * time filter); the response echoes `tokenWindowDays` so the model can
   * state the token scope precisely.
   */
  days: z.number().int().min(1).max(365).optional()
}).strict();

export function createUsageTools(): AgentTool[] {
  return [
    {
      name: "get_usage_summary",
      description:
        "Get usage statistics: session duration and estimated cost by adapter/project/model (all time), plus token consumption totals and top buckets. Optional 'days' limits the token statistics to the last N days.",
      risk: "read",
      requiresApproval: false,
      inputSchema: getUsageSummaryInput,
      async execute(input, context) {
        const { days } = getUsageSummaryInput.parse(input);
        const db = context.db as Database;
        const userId = context.userId as string;
        const to = new Date();
        const from = days !== undefined ? new Date(to.getTime() - days * 24 * 60 * 60 * 1000) : undefined;
        return {
          ...(days !== undefined ? { tokenWindowDays: days } : {}),
          sessionUsage: new UsageRepository(db, userId).getSummary(),
          tokenUsage: new TokenUsageRepository(db, userId).getSummary(from, to)
        };
      }
    }
  ];
}
