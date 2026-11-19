import type { ProjectManagerWorkItemStatus } from "@/lib/api";
import type { TranslationKey } from "@/lib/i18n";

export type Translate = (key: TranslationKey) => string;

export type WorkItemStatusFilter = ProjectManagerWorkItemStatus | "active" | "all";

export const WORK_ITEM_LIMIT = 50;
export const LEDGER_PAGE_SIZE = 25;

export const WORK_ITEM_STATUSES: ProjectManagerWorkItemStatus[] = [
  "todo",
  "in_progress",
  "blocked",
  "ready_for_review",
  "done",
  "cancelled",
];

export const PROJECT_MANAGER_STATUS_TRANSITIONS: Record<
  ProjectManagerWorkItemStatus,
  ProjectManagerWorkItemStatus[]
> = {
  todo: ["in_progress", "blocked", "cancelled"],
  in_progress: ["blocked", "ready_for_review", "done", "cancelled"],
  blocked: ["todo", "in_progress", "cancelled"],
  ready_for_review: ["in_progress", "done", "cancelled"],
  done: [],
  cancelled: [],
};

export interface TraceMarker {
  labelKey: TranslationKey;
  value: string | number;
}
