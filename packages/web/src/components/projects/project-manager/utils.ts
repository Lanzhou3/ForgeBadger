import {
  GatewayApiError,
  type ProjectManagerEvidenceRef,
  type ProjectManagerGoal,
  type ProjectManagerLedgerEvent,
  type ProjectManagerLedgerEventType,
  type ProjectManagerLedgerTrace,
  type ProjectManagerStage,
  type ProjectManagerTaskPacketQueueStatus,
  type ProjectManagerWorkItem,
  type ProjectManagerWorkItemInput,
  type ProjectManagerWorkItemStatus,
  type ProjectManagerWorkItemUpdateInput,
} from "@/lib/api";
import type { TranslationKey } from "@/lib/i18n";
import {
  EVIDENCE_REFERENCE_TYPE_OPTIONS,
  LEDGER_FILTER_EVENTS,
  PROJECT_MANAGER_STATUS_TRANSITIONS,
  WORK_ITEM_STATUSES,
  type EditWorkItemDraft,
  type EvidenceDraft,
  type EvidenceReferenceType,
  type GoalDraft,
  type LedgerFilter,
  type TraceMarker,
  type Translate,
  type WorkItemDraft,
  type WorkItemStatusFilter,
  type WorkItemViewMode,
} from "./types";

export function parseProjectManagerTextList(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function formatProjectManagerTextList(values: string[]): string {
  return values.join("\n");
}

export function createGoalDraft(goal: ProjectManagerGoal | null): GoalDraft {
  return {
    summary: goal?.summary ?? "",
    constraintsText: formatProjectManagerTextList(goal?.constraints ?? []),
    acceptanceCriteriaText: formatProjectManagerTextList(goal?.acceptanceCriteria ?? []),
    status: goal?.status ?? "active",
  };
}

export function filterWorkItemsForTable(workItems: ProjectManagerWorkItem[], status: WorkItemStatusFilter) {
  return status === "all" ? workItems : workItems.filter((item) => item.status === status);
}

export function createWorkItemDraft(): WorkItemDraft {
  return {
    title: "",
    description: "",
    priority: "0",
    status: "todo",
    acceptanceCriteriaText: "",
    evidenceKind: "",
    evidenceLabel: "",
    evidenceRef: "",
    evidencePath: "",
    feishuKind: "",
    feishuLabel: "",
    feishuRef: "",
    feishuMessageId: "",
  };
}

export function createEvidenceDraft(): EvidenceDraft {
  return {
    referenceType: "custom",
    kind: "",
    label: "",
    ref: "",
    path: "",
    sessionId: "",
  };
}

export function createEditWorkItemDraft(item: ProjectManagerWorkItem | null): EditWorkItemDraft {
  return {
    title: item?.title ?? "",
    description: item?.description ?? "",
    priority: String(item?.priority ?? 0),
    acceptanceCriteriaText: formatProjectManagerTextList(item?.acceptanceCriteria ?? []),
  };
}

export function createWorkItemInput(draft: WorkItemDraft, title: string): ProjectManagerWorkItemInput {
  const priority = Number.parseInt(draft.priority, 10);
  const evidenceRef = createReference({
    kind: draft.evidenceKind,
    label: draft.evidenceLabel,
    ref: draft.evidenceRef,
    path: draft.evidencePath,
  });
  const feishuRef = createReference({
    kind: draft.feishuKind,
    label: draft.feishuLabel,
    ref: draft.feishuRef,
    feishuMessageId: draft.feishuMessageId,
  });

  return {
    title,
    description: draft.description.trim() || null,
    priority: Number.isFinite(priority) ? priority : 0,
    status: draft.status,
    acceptanceCriteria: parseProjectManagerTextList(draft.acceptanceCriteriaText),
    ...(evidenceRef ? { evidenceRefs: [evidenceRef] } : {}),
    ...(feishuRef ? { feishuRefs: [feishuRef] } : {}),
  };
}

export function createWorkItemUpdateInput(draft: EditWorkItemDraft, title: string): ProjectManagerWorkItemUpdateInput {
  const priority = Number.parseInt(draft.priority, 10);
  return {
    title,
    description: draft.description.trim() || null,
    priority: Number.isFinite(priority) ? priority : 0,
    acceptanceCriteria: parseProjectManagerTextList(draft.acceptanceCriteriaText),
  };
}

export function batchStatusTargets(items: ProjectManagerWorkItem[]): ProjectManagerWorkItemStatus[] {
  if (items.length === 0) return [];
  return WORK_ITEM_STATUSES.filter((candidate) =>
    items.every((item) =>
      PROJECT_MANAGER_STATUS_TRANSITIONS[item.status].includes(candidate) &&
      (candidate !== "done" || item.evidenceRefCount > 0)
    )
  );
}

export function createSingleEvidenceReference(draft: EvidenceDraft): ProjectManagerEvidenceRef | undefined {
  const kind = draft.kind.trim();
  const label = draft.label.trim();
  const sessionId = draft.sessionId.trim();
  const ref = draft.ref.trim() || generatedEvidenceRef(draft.referenceType, sessionId);
  const path = draft.path.trim();

  if (!kind || (!ref && !path && !sessionId)) {
    return undefined;
  }

  return {
    kind,
    ...(label ? { label } : {}),
    ...(ref ? { ref } : {}),
    ...(path ? { path } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
}

export function createReference(ref: ProjectManagerEvidenceRef): ProjectManagerEvidenceRef | undefined {
  const trimmed = Object.fromEntries(
    Object.entries(ref)
      .map(([key, value]) => [key, typeof value === "string" ? value.trim() : value])
      .filter(([, value]) => typeof value === "string" && value.length > 0)
  ) as ProjectManagerEvidenceRef;

  if (!trimmed.ref && !trimmed.path && !trimmed.sessionId && !trimmed.feishuMessageId) {
    return undefined;
  }

  return trimmed;
}

export function readEvidenceReferenceType(value: string): EvidenceReferenceType {
  return EVIDENCE_REFERENCE_TYPE_OPTIONS.some((option) => option.value === value)
    ? (value as EvidenceReferenceType)
    : "custom";
}

export function applyEvidenceReferenceType(
  draft: EvidenceDraft,
  referenceType: EvidenceReferenceType,
  t: Translate
): EvidenceDraft {
  if (referenceType === "custom") {
    return { ...draft, referenceType };
  }
  if (referenceType === "file_path") {
    return {
      ...draft,
      referenceType,
      kind: "file_path",
      label: t("projects.projectManagerEvidenceTypeFilePath"),
      ref: "",
      sessionId: "",
    };
  }
  if (referenceType === "terminal_snapshot") {
    return {
      ...draft,
      referenceType,
      kind: "terminal_snapshot",
      label: t("projects.projectManagerEvidenceTypeTerminalSnapshot"),
      ref: "",
      path: "",
    };
  }
  return {
    ...draft,
    referenceType,
    kind: "session",
    label: t("projects.projectManagerEvidenceTypeSession"),
    ref: "",
    path: "",
  };
}

export function generatedEvidenceRef(referenceType: EvidenceReferenceType, sessionId: string): string {
  if (!sessionId) return "";
  if (referenceType === "terminal_snapshot") return `terminal-snapshot:${sessionId}:latest`;
  if (referenceType === "session") return `session:${sessionId}`;
  return "";
}

export const UNSAFE_EVIDENCE_REFERENCE_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{6,}\b/u,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/iu,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/iu,
  /private key/iu,
  /\b(?:FORGEBADGER|OPENFORGE)_ATTACH_TOKEN=/u,
  /\b(api[_-]?key|token|password|secret|private[_-]?key|credential|event[_-]?encrypt[_-]?key)\b\s*[:=]/iu,
  /[\r\n\x00-\x08\x0B\x0C\x0E-\x1F]/u,
  /\b(raw terminal|terminal transcript|stdout|stderr|command output)\b/iu,
  /^\s*[$>#]\s+\S+/u,
  /"?(messages|choices|provider|authorization|api_key|request|response)"?\s*:/iu,
];

export function validateEvidenceReferenceInput(draft: EvidenceDraft): boolean {
  const generatedRef = generatedEvidenceRef(draft.referenceType, draft.sessionId.trim());
  return [draft.ref, draft.path, draft.sessionId, generatedRef].some((value) =>
    UNSAFE_EVIDENCE_REFERENCE_PATTERNS.some((pattern) => pattern.test(value))
  );
}

export function filterLedgerEvents(events: ProjectManagerLedgerEvent[], filter: LedgerFilter) {
  if (filter === "all") {
    return events;
  }
  const allowedEvents = LEDGER_FILTER_EVENTS[filter];
  return events.filter((event) => allowedEvents.includes(event.eventType));
}

export function ledgerWorkItemTitle(event: ProjectManagerLedgerEvent, workItems: ProjectManagerWorkItem[]) {
  const workItem = workItems.find((item) => item.id === event.workItemId);
  return workItem?.title ?? event.workItemId ?? "-";
}

export function workItemTraceMarkers(
  item: ProjectManagerWorkItem,
  ledgerEvents: ProjectManagerLedgerEvent[]
): TraceMarker[] {
  const trustedEvidenceRefs = item.evidenceRefs.filter(isTrustedEvidenceRef);
  const evidenceTrace = item.status === "done"
    ? trustedEvidenceRefs.find(hasEvidenceTrace) ?? trustedEvidenceRefs[0]
    : item.evidenceRefs.find(hasEvidenceTrace);
  const ledgerTraceEvent = selectLedgerTraceEvent(item, ledgerEvents);
  const trace = ledgerTraceEvent?.trace;
  const markers: TraceMarker[] = [];

  if (evidenceTrace) {
    markers.push({ labelKey: "projects.projectManagerTraceEvidence", value: formatEvidenceRef(evidenceTrace) });
  }
  if (evidenceTrace?.sessionId) {
    markers.push({ labelKey: "projects.projectManagerTraceSession", value: evidenceTrace.sessionId });
  }
  if (ledgerTraceEvent) {
    markers.push({ labelKey: "projects.projectManagerTraceLedger", value: ledgerTraceEvent.eventType });
  }

  return markers;
}

export function ledgerTraceMarkers(trace: ProjectManagerLedgerTrace): TraceMarker[] {
  const markers: Array<TraceMarker | null> = [
    trace.actionType ? { labelKey: "projects.projectManagerTraceActionType", value: trace.actionType } : null,
    trace.targetId ? { labelKey: "projects.projectManagerTraceTarget", value: trace.targetId } : null,
    typeof trace.evidenceRefCount === "number"
      ? { labelKey: "projects.projectManagerTraceEvidenceRefs", value: trace.evidenceRefCount }
      : null,
    trace.approvalStatus ? { labelKey: "projects.projectManagerTraceApproval", value: trace.approvalStatus } : null,
    trace.executionStatus ? { labelKey: "projects.projectManagerTraceExecution", value: trace.executionStatus } : null,
  ];
  return markers.filter((marker): marker is TraceMarker => Boolean(marker));
}

export function selectLedgerTraceEvent(
  item: ProjectManagerWorkItem,
  ledgerEvents: ProjectManagerLedgerEvent[]
): ProjectManagerLedgerEvent | undefined {
  const itemTraceEvents = ledgerEvents.filter((event) => event.workItemId === item.id && event.trace);
  if (item.status === "done") {
    const doneTraceEvent = latestLedgerEvent(itemTraceEvents.filter((event) =>
      event.status === "done" &&
      event.trace?.actionType === "update_work_item_status" &&
      event.trace.executionStatus === "succeeded"
    ));
    if (doneTraceEvent) return doneTraceEvent;
  }
  return latestLedgerEvent(itemTraceEvents);
}

export function latestLedgerEvent(events: ProjectManagerLedgerEvent[]): ProjectManagerLedgerEvent | undefined {
  return events.reduce<ProjectManagerLedgerEvent | undefined>((latest, event) => {
    if (!latest || event.createdAt > latest.createdAt) return event;
    return latest;
  }, undefined);
}

export function isTrustedEvidenceRef(ref: ProjectManagerEvidenceRef): boolean {
  const status = ref.status?.trim().toLowerCase();
  return status === "accepted" || status === "verified";
}

export function hasEvidenceTrace(ref: ProjectManagerEvidenceRef): boolean {
  return Boolean(ref.sessionId || ref.feishuMessageId);
}

export function ledgerEventNote(eventType: ProjectManagerLedgerEventType, t: Translate) {
  if (eventType === "manual_completion_recorded") {
    return t("projects.projectManagerLedgerManualCompletionNote");
  }
  if (eventType === "blocker_recorded") {
    return t("projects.projectManagerLedgerBlockerRecordedNote");
  }
  if (eventType === "blocker_resolved") {
    return t("projects.projectManagerLedgerBlockerResolvedNote");
  }
  return null;
}

export function formatEvidenceRef(ref: ProjectManagerEvidenceRef) {
  const parts = [
    ref.kind,
    ref.label,
    ref.status,
    ref.ref,
    ref.path,
    ref.sessionId,
    ref.feishuMessageId,
  ]
    .map((part) => part?.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "-";
}

export function projectManagerMutationMessage(error: unknown, fallback: string) {
  if (error instanceof GatewayApiError && error.message) {
    return error.message;
  }
  return fallback;
}

export function statusBadgeVariant(status: ProjectManagerWorkItemStatus | string) {
  if (status === "done") return "default";
  if (status === "blocked") return "destructive";
  if (status === "in_progress" || status === "ready_for_review") return "secondary";
  return "outline";
}

// Unified status color system: todo=muted, in_progress=brand, blocked=destructive,
// ready_for_review=amber, done=emerald, cancelled=dark gray.
export function statusBadgeClassName(status: ProjectManagerWorkItemStatus | string) {
  if (status === "in_progress") return "border-brand/40 bg-brand/10 text-brand hover:bg-brand/10";
  if (status === "ready_for_review") return "border-amber-500/40 bg-amber-500/10 text-amber-500 hover:bg-amber-500/10";
  if (status === "done") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/10";
  if (status === "cancelled") return "border-border/70 bg-muted/30 text-muted-foreground hover:bg-muted/30";
  return "";
}

export function statusDotClassName(status: ProjectManagerWorkItemStatus | string) {
  if (status === "in_progress") return "bg-brand";
  if (status === "blocked") return "bg-destructive";
  if (status === "ready_for_review") return "bg-amber-500";
  if (status === "done") return "bg-emerald-500";
  if (status === "cancelled") return "bg-muted-foreground/40";
  return "bg-muted-foreground/60";
}

export type ProjectManagerPriorityLevel = "high" | "medium" | "low";

// Priority is a free-form integer; bucket it into visual tiers (>=7 high, >=4 medium).
export function priorityLevel(priority: number): ProjectManagerPriorityLevel {
  if (priority >= 7) return "high";
  if (priority >= 4) return "medium";
  return "low";
}

export function priorityLabelKey(level: ProjectManagerPriorityLevel): TranslationKey {
  const keys: Record<ProjectManagerPriorityLevel, TranslationKey> = {
    high: "projects.projectManagerPriorityHigh",
    medium: "projects.projectManagerPriorityMedium",
    low: "projects.projectManagerPriorityLow",
  };
  return keys[level];
}

export function priorityClassName(level: ProjectManagerPriorityLevel) {
  if (level === "high") return "text-destructive";
  if (level === "medium") return "text-amber-500";
  return "text-muted-foreground";
}

interface ProjectManagerViewPrefs {
  statusFilter?: WorkItemStatusFilter;
  viewMode?: WorkItemViewMode;
}

const WORK_ITEM_VIEW_MODES: WorkItemViewMode[] = ["board", "table", "queue"];

export function projectManagerViewStorageKey(projectId: string) {
  return `forgebadger:pm-view:${projectId}`;
}

export function readProjectManagerViewPrefs(storageKey: string): Required<ProjectManagerViewPrefs> {
  const defaults: Required<ProjectManagerViewPrefs> = { statusFilter: "all", viewMode: "board" };
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as ProjectManagerViewPrefs;
    return {
      statusFilter:
        parsed.statusFilter === "all" || WORK_ITEM_STATUSES.includes(parsed.statusFilter as ProjectManagerWorkItemStatus)
          ? (parsed.statusFilter as WorkItemStatusFilter)
          : "all",
      viewMode: WORK_ITEM_VIEW_MODES.includes(parsed.viewMode as WorkItemViewMode)
        ? (parsed.viewMode as WorkItemViewMode)
        : "board",
    };
  } catch {
    return defaults;
  }
}

export function writeProjectManagerViewPrefs(storageKey: string, prefs: Required<ProjectManagerViewPrefs>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(prefs));
  } catch {
    // localStorage may be unavailable (private mode); persistence is best-effort.
  }
}

export function taskPacketQueueBadgeVariant(status: ProjectManagerTaskPacketQueueStatus) {
  if (status === "completed") return "default";
  if (status === "blocked") return "destructive";
  if (status === "running" || status === "waiting_for_review") return "secondary";
  return "outline";
}

export function ledgerEventBadgeVariant(eventType: ProjectManagerLedgerEventType) {
  if (eventType === "blocker_recorded") return "destructive" as const;
  if (eventType === "evidence_attached" || eventType === "manual_completion_recorded") return "secondary" as const;
  if (eventType === "blocker_resolved") return "default" as const;
  return "outline" as const;
}

export function statusLabel(status: ProjectManagerWorkItemStatus | string, t: Translate) {
  const labels: Record<string, TranslationKey> = {
    todo: "projects.projectManagerStatusTodo",
    in_progress: "projects.projectManagerStatusInProgress",
    blocked: "projects.projectManagerStatusBlocked",
    ready_for_review: "projects.projectManagerStatusReadyForReview",
    done: "projects.projectManagerStatusDone",
    cancelled: "projects.projectManagerStatusCancelled",
    active: "projects.projectManagerStatusActive",
  };
  return t(labels[status] ?? "projects.projectManagerStatusUnknown");
}

export function stageStatusLabel(status: ProjectManagerStage["status"], t: Translate) {
  const labels: Record<ProjectManagerStage["status"], TranslationKey> = {
    active: "projects.projectManagerStageStatusActive",
    completed: "projects.projectManagerStageStatusCompleted",
    archived: "projects.projectManagerStageStatusArchived",
  };
  return t(labels[status]);
}

export function taskPacketQueueStatusLabel(status: ProjectManagerTaskPacketQueueStatus, t: Translate) {
  const labels: Record<ProjectManagerTaskPacketQueueStatus, TranslationKey> = {
    planned: "projects.projectManagerTaskQueuePlanned",
    running: "projects.projectManagerTaskQueueRunning",
    waiting_for_review: "projects.projectManagerTaskQueueWaitingForReview",
    blocked: "projects.projectManagerTaskQueueBlocked",
    completed: "projects.projectManagerTaskQueueCompleted",
    cancelled: "projects.projectManagerTaskQueueCancelled",
  };
  return t(labels[status]);
}

export function eventLabel(eventType: ProjectManagerLedgerEventType, t: Translate) {
  const labels: Record<ProjectManagerLedgerEventType, TranslationKey> = {
    goal_updated: "projects.projectManagerEventGoalUpdated",
    work_item_created: "projects.projectManagerEventWorkItemCreated",
    work_item_updated: "projects.projectManagerEventWorkItemUpdated",
    work_item_deleted: "projects.projectManagerEventWorkItemDeleted",
    work_item_status_changed: "projects.projectManagerEventWorkItemStatusChanged",
    evidence_attached: "projects.projectManagerEventEvidenceAttached",
    blocker_recorded: "projects.projectManagerEventBlockerRecorded",
    blocker_resolved: "projects.projectManagerEventBlockerResolved",
    feishu_reference_linked: "projects.projectManagerEventFeishuReferenceLinked",
    next_step_proposed: "projects.projectManagerEventNextStepProposed",
    manual_completion_recorded: "projects.projectManagerEventManualCompletionRecorded",
    stage_created: "projects.projectManagerEventStageCreated",
    stage_updated: "projects.projectManagerEventStageUpdated",
    stage_deleted: "projects.projectManagerEventStageDeleted",
    dependency_added: "projects.projectManagerEventDependencyAdded",
    dependency_removed: "projects.projectManagerEventDependencyRemoved",
  };
  return t(labels[eventType]);
}

export function formatTimestamp(value: number) {
  if (!Number.isFinite(value)) return "-";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
