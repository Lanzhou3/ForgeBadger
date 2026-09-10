/**
 * Catalog automation suggestions — ready-to-accept starter automations.
 *
 * The owner explicitly accepts a suggestion before any automation is created
 * (consent-first). Each suggestion is deduplicated by a stable key so a
 * dismissed/accepted one is never re-offered.
 */
import type { AutomationRepository } from "./automation-repository.js";

interface CatalogSuggestion {
  dedupKey: string;
  source: string;
  jobSpec: {
    name: string;
    scopeType: "global" | "project";
    scopePolicy: Record<string, unknown>;
    prompt: string;
    scheduleKind: "cron" | "interval" | "once";
    scheduleExpression: string;
    timezone: string;
    delivery: { notify: boolean; conversation: boolean };
  };
}

const CATALOG: CatalogSuggestion[] = [
  {
    dedupKey: "catalog:daily-briefing",
    source: "catalog",
    jobSpec: {
      name: "每日项目简报",
      scopeType: "global",
      scopePolicy: {},
      prompt: "汇总今天所有项目的进展：会话状态变化、新完成的工作项、以及需要我关注的事项。",
      scheduleKind: "cron",
      scheduleExpression: "0 9 * * *",
      timezone: "UTC",
      delivery: { notify: true, conversation: true }
    }
  },
  {
    dedupKey: "catalog:weekly-review",
    source: "catalog",
    jobSpec: {
      name: "每周项目回顾",
      scopeType: "global",
      scopePolicy: {},
      prompt: "回顾本周的项目活动：完成的工作项、进行中的会话、以及下周需要优先处理的事项。",
      scheduleKind: "cron",
      scheduleExpression: "0 9 * * 1",
      timezone: "UTC",
      delivery: { notify: true, conversation: true }
    }
  },
  {
    dedupKey: "catalog:session-watch",
    source: "catalog",
    jobSpec: {
      name: "进行中会话提醒",
      scopeType: "global",
      scopePolicy: {},
      prompt: "检查当前是否有长时间运行的会话，列出它们的进度和状态，提醒我是否需要介入。",
      scheduleKind: "interval",
      scheduleExpression: "60",
      timezone: "UTC",
      delivery: { notify: true, conversation: true }
    }
  }
];

export function seedCatalogSuggestions(repo: AutomationRepository): void {
  for (const item of CATALOG) {
    repo.seedSuggestion({ source: item.source, dedupKey: item.dedupKey, jobSpec: item.jobSpec });
  }
}
