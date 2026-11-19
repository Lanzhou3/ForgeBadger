import {
  GatewayApiError,
  type ProjectManagerEvidenceRef,
  type ProjectManagerLedgerEvent,
  type ProjectManagerLedgerTrace,
  type ProjectManagerWorkItem,
  type ProjectManagerWorkItemStatus,
} from "@/lib/api";
import type { TranslationKey } from "@/lib/i18n";
import {
  WORK_ITEM_STATUSES,
  type TraceMarker,
  type Translate,
  type WorkItemStatusFilter,
} from "./types";

export function workItemTraceMarkers(
  item: ProjectManagerWorkItem,
  ledgerEvents: ProjectManagerLedgerEvent[],
): TraceMarker[] {
  const trustedEvidenceRefs = item.evidenceRefs.filter(isTrustedEvidenceRef);
  const evidenceTrace =
    item.status === "done"
      ? (trustedEvidenceRefs.find(hasEvidenceTrace) ?? trustedEvidenceRefs[0])
      : item.evidenceRefs.find(hasEvidenceTrace);
  const ledgerTraceEvent = selectLedgerTraceEvent(item, ledgerEvents);
  const trace = ledgerTraceEvent?.trace;
  const markers: TraceMarker[] = [];

  if (evidenceTrace) {
    markers.push({
      labelKey: "projects.projectManagerTraceEvidence",
      value: formatEvidenceRef(evidenceTrace),
    });
  }
  if (evidenceTrace?.sessionId) {
    markers.push({
      labelKey: "projects.projectManagerTraceSession",
      value: evidenceTrace.sessionId,
    });
  }
  if (ledgerTraceEvent) {
    markers.push({
      labelKey: "projects.projectManagerTraceLedger",
      value: ledgerTraceEvent.eventType,
    });
  }
  if (trace) {
    markers.push(...ledgerTraceMarkers(trace));
  }

  return markers;
}

export function ledgerTraceMarkers(trace: ProjectManagerLedgerTrace): TraceMarker[] {
  const markers: Array<TraceMarker | null> = [
    trace.actionType
      ? { labelKey: "projects.projectManagerTraceActionType", value: trace.actionType }
      : null,
    trace.targetId
      ? { labelKey: "projects.projectManagerTraceTarget", value: trace.targetId }
      : null,
    typeof trace.evidenceRefCount === "number"
      ? { labelKey: "projects.projectManagerTraceEvidenceRefs", value: trace.evidenceRefCount }
      : null,
    trace.approvalStatus
      ? { labelKey: "projects.projectManagerTraceApproval", value: trace.approvalStatus }
      : null,
    trace.executionStatus
      ? { labelKey: "projects.projectManagerTraceExecution", value: trace.executionStatus }
      : null,
  ];
  return markers.filter((marker): marker is TraceMarker => Boolean(marker));
}

export function selectLedgerTraceEvent(
  item: ProjectManagerWorkItem,
  ledgerEvents: ProjectManagerLedgerEvent[],
): ProjectManagerLedgerEvent | undefined {
  const itemTraceEvents = ledgerEvents.filter(
    (event) => event.workItemId === item.id && event.trace,
  );
  if (item.status === "done") {
    const doneTraceEvent = latestLedgerEvent(
      itemTraceEvents.filter(
        (event) =>
          event.status === "done" &&
          event.trace?.actionType === "update_work_item_status" &&
          event.trace.executionStatus === "succeeded",
      ),
    );
    if (doneTraceEvent) return doneTraceEvent;
  }
  return latestLedgerEvent(itemTraceEvents);
}

export function latestLedgerEvent(
  events: ProjectManagerLedgerEvent[],
): ProjectManagerLedgerEvent | undefined {
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

const KNOWN_PM_ERROR_TRANSLATIONS: Array<{ match: (msg: string) => boolean; key: TranslationKey }> = [
  {
    match: (msg) =>
      msg === "MANUAL_COMPLETION_REASON_REQUIRED" ||
      msg.includes("Marking done requires evidence references or a manual completion reason"),
    key: "projects.pmErrorDoneRequiresEvidenceOrReason",
  },
  {
    match: (msg) =>
      msg === "STALE_TASK_REVISION" || msg === "EXPECTED_TASK_REVISION_REQUIRED",
    key: "projects.projectManagerConflictBanner",
  },
  {
    match: (msg) => msg === "DELIVERY_HISTORY_REQUIRES_ARCHIVE",
    key: "projects.pmErrorDeliveryHistoryDeleteBlocked",
  },
  {
    match: (msg) => msg === "SHARED_TASK_REQUIRES_DELIVERY",
    key: "projects.pmErrorSharedTaskRequiresDelivery",
  },
  {
    match: (msg) => msg.startsWith("Invalid project-manager status transition"),
    key: "projects.pmErrorInvalidTransition",
  },
  {
    match: (msg) => msg === "Project-manager work item not found",
    key: "projects.pmErrorWorkItemNotFound",
  },
  {
    match: (msg) => msg.includes("Runtime CLI selection is required"),
    key: "projects.projectManagerTaskPacketNoCliAvailable",
  },
];

export function projectManagerMutationMessage(
  error: unknown,
  fallback: string,
  t?: Translate,
) {
  if (error instanceof GatewayApiError && error.message) {
    if (t) {
      const mapped = KNOWN_PM_ERROR_TRANSLATIONS.find((entry) => entry.match(error.message));
      if (mapped) return t(mapped.key);
    }
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

export function statusBadgeClassName(status: ProjectManagerWorkItemStatus | string) {
  if (status === "in_progress") return "border-brand/40 bg-brand/10 text-brand hover:bg-brand/10";
  if (status === "ready_for_review")
    return "border-amber-500/40 bg-amber-500/10 text-amber-500 hover:bg-amber-500/10";
  if (status === "done")
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/10";
  if (status === "cancelled")
    return "border-border/70 bg-muted/30 text-muted-foreground hover:bg-muted/30";
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

interface ProjectManagerViewPrefs {
  statusFilter?: WorkItemStatusFilter;
}

export function projectManagerViewStorageKey(projectId: string) {
  return `forgebadger:pm-view:${projectId}`;
}

export function readProjectManagerViewPrefs(
  storageKey: string,
): Required<ProjectManagerViewPrefs> {
  const defaults: Required<ProjectManagerViewPrefs> = { statusFilter: "active" };
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as ProjectManagerViewPrefs;
    const valid =
      parsed.statusFilter === "active" ||
      parsed.statusFilter === "all" ||
      WORK_ITEM_STATUSES.includes(parsed.statusFilter as ProjectManagerWorkItemStatus);
    return {
      statusFilter: valid ? (parsed.statusFilter as WorkItemStatusFilter) : "active",
    };
  } catch {
    return defaults;
  }
}

export function writeProjectManagerViewPrefs(
  storageKey: string,
  prefs: Required<ProjectManagerViewPrefs>,
) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(prefs));
  } catch {
    // localStorage may be unavailable in restricted contexts.
  }
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

export function formatTimestamp(value: number) {
  if (!Number.isFinite(value)) return "-";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
