import type {
  ProjectManagerLedgerEventType,
  ProjectManagerWorkItemStatus,
} from "@/lib/api";
import type { TranslationKey } from "@/lib/i18n";

export type Translate = (key: TranslationKey) => string;

export interface GoalDraft {
  summary: string;
  constraintsText: string;
  acceptanceCriteriaText: string;
  status: string;
}

export type WorkItemStatusFilter = ProjectManagerWorkItemStatus | "all";
export type WorkItemViewMode = "board" | "table" | "queue";
export type EvidenceReferenceType = "custom" | "file_path" | "terminal_snapshot" | "session";

export interface WorkItemDraft {
  title: string;
  description: string;
  priority: string;
  status: ProjectManagerWorkItemStatus;
  acceptanceCriteriaText: string;
  evidenceKind: string;
  evidenceLabel: string;
  evidenceRef: string;
  evidencePath: string;
  feishuKind: string;
  feishuLabel: string;
  feishuRef: string;
  feishuMessageId: string;
}

export interface EvidenceDraft {
  referenceType: EvidenceReferenceType;
  kind: string;
  label: string;
  ref: string;
  path: string;
  sessionId: string;
}

export interface EditWorkItemDraft {
  title: string;
  description: string;
  priority: string;
  acceptanceCriteriaText: string;
}

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

export type LedgerFilter = "all" | "status_changes" | "evidence" | "manual_completion" | "blockers";

export const LEDGER_FILTER_OPTIONS: Array<{ labelKey: TranslationKey; value: LedgerFilter }> = [
  { value: "all", labelKey: "projects.projectManagerLedgerFilterAll" },
  { value: "status_changes", labelKey: "projects.projectManagerLedgerFilterStatusChanges" },
  { value: "evidence", labelKey: "projects.projectManagerLedgerFilterEvidence" },
  { value: "manual_completion", labelKey: "projects.projectManagerLedgerFilterManualCompletion" },
  { value: "blockers", labelKey: "projects.projectManagerLedgerFilterBlockers" },
];

export const EVIDENCE_REFERENCE_TYPE_OPTIONS: Array<{ labelKey: TranslationKey; value: EvidenceReferenceType }> = [
  { value: "custom", labelKey: "projects.projectManagerEvidenceTypeCustom" },
  { value: "file_path", labelKey: "projects.projectManagerEvidenceTypeFilePath" },
  { value: "terminal_snapshot", labelKey: "projects.projectManagerEvidenceTypeTerminalSnapshot" },
  { value: "session", labelKey: "projects.projectManagerEvidenceTypeSession" },
];

export const LEDGER_FILTER_EVENTS: Record<Exclude<LedgerFilter, "all">, ProjectManagerLedgerEventType[]> = {
  status_changes: ["work_item_status_changed"],
  evidence: ["evidence_attached"],
  manual_completion: ["manual_completion_recorded"],
  blockers: ["blocker_recorded", "blocker_resolved"],
};

export const PROJECT_MANAGER_STATUS_TRANSITIONS: Record<ProjectManagerWorkItemStatus, ProjectManagerWorkItemStatus[]> = {
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
