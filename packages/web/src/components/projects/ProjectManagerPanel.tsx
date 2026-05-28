"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRightCircle,
  BriefcaseBusiness,
  ClipboardList,
  Eye,
  History,
  Plus,
  RefreshCw,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "@/hooks/use-language";
import {
  attachProjectManagerWorkItemEvidence,
  GatewayApiError,
  getProjectManagerGoal,
  listProjectManagerLedger,
  listProjectManagerWorkItems,
  createProjectManagerWorkItem,
  updateProjectManagerGoal,
  updateProjectManagerWorkItemStatus,
  type ProjectManagerEvidenceRef,
  type ProjectManagerLedgerEvent,
  type ProjectManagerLedgerTrace,
  type ProjectManagerLedgerEventType,
  type ProjectManagerGoal,
  type ProjectManagerWorkItemInput,
  type ProjectManagerGoalInput,
  type ProjectManagerWorkItem,
  type ProjectManagerWorkItemStatusInput,
  type ProjectManagerWorkItemStatus,
} from "@/lib/api";
import type { TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface ProjectManagerPanelProps {
  projectId: string;
  enabled: boolean;
  selectedWorkItemId?: string | null;
}

type Translate = (key: TranslationKey) => string;

interface GoalDraft {
  summary: string;
  constraintsText: string;
  acceptanceCriteriaText: string;
  status: string;
}

type WorkItemStatusFilter = ProjectManagerWorkItemStatus | "all";

interface WorkItemDraft {
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

interface EvidenceDraft {
  kind: string;
  label: string;
  ref: string;
  path: string;
}

const WORK_ITEM_LIMIT = 50;
const LEDGER_PAGE_SIZE = 25;
const WORK_ITEM_STATUSES: ProjectManagerWorkItemStatus[] = [
  "todo",
  "in_progress",
  "blocked",
  "ready_for_review",
  "done",
  "cancelled",
];

type LedgerFilter = "all" | "status_changes" | "evidence" | "manual_completion" | "blockers";

const LEDGER_FILTER_OPTIONS: Array<{ labelKey: TranslationKey; value: LedgerFilter }> = [
  { value: "all", labelKey: "projects.projectManagerLedgerFilterAll" },
  { value: "status_changes", labelKey: "projects.projectManagerLedgerFilterStatusChanges" },
  { value: "evidence", labelKey: "projects.projectManagerLedgerFilterEvidence" },
  { value: "manual_completion", labelKey: "projects.projectManagerLedgerFilterManualCompletion" },
  { value: "blockers", labelKey: "projects.projectManagerLedgerFilterBlockers" },
];

const LEDGER_FILTER_EVENTS: Record<Exclude<LedgerFilter, "all">, ProjectManagerLedgerEventType[]> = {
  status_changes: ["work_item_status_changed"],
  evidence: ["evidence_attached"],
  manual_completion: ["manual_completion_recorded"],
  blockers: ["blocker_recorded", "blocker_resolved"],
};

const PROJECT_MANAGER_STATUS_TRANSITIONS: Record<ProjectManagerWorkItemStatus, ProjectManagerWorkItemStatus[]> = {
  todo: ["in_progress", "blocked", "cancelled"],
  in_progress: ["blocked", "ready_for_review", "done", "cancelled"],
  blocked: ["todo", "in_progress", "cancelled"],
  ready_for_review: ["in_progress", "done", "cancelled"],
  done: [],
  cancelled: [],
};

export function ProjectManagerPanel({
  projectId,
  enabled,
  selectedWorkItemId: requestedWorkItemId = null,
}: ProjectManagerPanelProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const canLoad = enabled && projectId.length > 0;
  const [isGoalEditing, setIsGoalEditing] = useState(false);
  const [goalDraft, setGoalDraft] = useState<GoalDraft>(() => createGoalDraft(null));
  const [goalFormError, setGoalFormError] = useState<string | null>(null);
  const [workItemStatusFilter, setWorkItemStatusFilter] = useState<WorkItemStatusFilter>("all");
  const [selectedWorkItemId, setSelectedWorkItemId] = useState<string | null>(null);
  const [isCreateWorkItemOpen, setIsCreateWorkItemOpen] = useState(false);
  const [workItemDraft, setWorkItemDraft] = useState<WorkItemDraft>(() => createWorkItemDraft());
  const [createWorkItemError, setCreateWorkItemError] = useState<string | null>(null);
  const [evidenceDraft, setEvidenceDraft] = useState<EvidenceDraft>(() => createEvidenceDraft());
  const [evidenceAttachError, setEvidenceAttachError] = useState<string | null>(null);
  const [ledgerFilter, setLedgerFilter] = useState<LedgerFilter>("all");
  const [ledgerLimit, setLedgerLimit] = useState(LEDGER_PAGE_SIZE);
  const [statusMutationError, setStatusMutationError] = useState<string | null>(null);
  const [pendingDoneWorkItemId, setPendingDoneWorkItemId] = useState<string | null>(null);
  const [doneReason, setDoneReason] = useState("");
  const [doneReasonError, setDoneReasonError] = useState<string | null>(null);
  const doneReasonRef = useRef<HTMLTextAreaElement | null>(null);
  const appliedRequestedWorkItemIdRef = useRef<string | null>(null);

  const goalQuery = useQuery({
    queryKey: ["project-manager", projectId, "goal"],
    queryFn: () => getProjectManagerGoal(projectId),
    enabled: canLoad,
    retry: false,
  });

  const goal = goalQuery.data?.goal ?? null;

  const workItemsQuery = useQuery({
    queryKey: ["project-manager", projectId, "work-items", { status: workItemStatusFilter, limit: WORK_ITEM_LIMIT }],
    queryFn: () => listProjectManagerWorkItems(projectId, createWorkItemQueryParams(workItemStatusFilter)),
    enabled: canLoad,
    retry: false,
  });

  const ledgerQuery = useQuery({
    queryKey: ["project-manager", projectId, "ledger", { limit: ledgerLimit }],
    queryFn: () => listProjectManagerLedger(projectId, { limit: ledgerLimit }),
    enabled: canLoad,
    retry: false,
  });

  useEffect(() => {
    if (!isGoalEditing) {
      setGoalDraft(createGoalDraft(goal));
    }
  }, [goal, isGoalEditing]);

  const invalidateProjectManagerQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "goal"] }),
      queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "work-items"] }),
      queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "ledger"] }),
    ]);
  };

  const goalMutation = useMutation({
    mutationFn: (input: ProjectManagerGoalInput) => updateProjectManagerGoal(projectId, input),
    onSuccess: async ({ goal: updatedGoal }) => {
      setGoalFormError(null);
      setGoalDraft(createGoalDraft(updatedGoal));
      setIsGoalEditing(false);
      await invalidateProjectManagerQueries();
    },
    onError: (error) => {
      setGoalFormError(projectManagerMutationMessage(error, t("projects.projectManagerGoalMutationError")));
    },
  });

  const createWorkItemMutation = useMutation({
    mutationFn: (input: ProjectManagerWorkItemInput) => createProjectManagerWorkItem(projectId, input),
    onSuccess: async () => {
      setCreateWorkItemError(null);
      setWorkItemDraft(createWorkItemDraft());
      setIsCreateWorkItemOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "work-items"] }),
        queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "ledger"] }),
      ]);
    },
    onError: (error) => {
      setCreateWorkItemError(projectManagerMutationMessage(error, t("projects.projectManagerCreateWorkItemError")));
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ input, workItemId }: { input: ProjectManagerWorkItemStatusInput; workItemId: string }) =>
      updateProjectManagerWorkItemStatus(projectId, workItemId, input),
    onSuccess: async () => {
      setStatusMutationError(null);
      setPendingDoneWorkItemId(null);
      setDoneReason("");
      setDoneReasonError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "work-items"] }),
        queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "ledger"] }),
      ]);
    },
    onError: (error) => {
      setStatusMutationError(projectManagerMutationMessage(error, t("projects.projectManagerStatusMutationError")));
    },
  });

  const evidenceMutation = useMutation({
    mutationFn: ({ reference, workItemId }: { reference: ProjectManagerEvidenceRef; workItemId: string }) =>
      attachProjectManagerWorkItemEvidence(projectId, workItemId, { evidenceRefs: [reference] }),
    onSuccess: async () => {
      setEvidenceAttachError(null);
      setEvidenceDraft(createEvidenceDraft());
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "work-items"] }),
        queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "ledger"] }),
      ]);
    },
    onError: (error) => {
      setEvidenceAttachError(projectManagerMutationMessage(error, t("projects.projectManagerEvidenceAttachError")));
    },
  });

  const firstError = goalQuery.error ?? workItemsQuery.error;
  const isNotFoundError = firstError instanceof GatewayApiError && firstError.status === 404;
  const isLoading = goalQuery.isLoading || workItemsQuery.isLoading;
  const isRefreshing = goalQuery.isFetching || workItemsQuery.isFetching || ledgerQuery.isFetching;
  const workItems = workItemsQuery.data?.workItems ?? [];
  const ledgerEvents = ledgerQuery.data?.events ?? [];
  const filteredLedgerEvents = filterLedgerEvents(ledgerEvents, ledgerFilter);
  const selectedWorkItem = workItems.find((item) => item.id === selectedWorkItemId) ?? null;
  const pendingDoneWorkItem = workItems.find((item) => item.id === pendingDoneWorkItemId) ?? null;

  useEffect(() => {
    const requested = requestedWorkItemId?.trim() ?? "";
    if (!requested) {
      appliedRequestedWorkItemIdRef.current = null;
      return;
    }
    if (appliedRequestedWorkItemIdRef.current === requested) return;
    if (!workItems.some((item) => item.id === requested)) return;
    setSelectedWorkItemId(requested);
    appliedRequestedWorkItemIdRef.current = requested;
  }, [requestedWorkItemId, workItems]);

  useEffect(() => {
    setEvidenceAttachError(null);
    setEvidenceDraft(createEvidenceDraft());
  }, [selectedWorkItemId]);

  useEffect(() => {
    if (pendingDoneWorkItemId) {
      doneReasonRef.current?.focus();
    }
  }, [pendingDoneWorkItemId]);

  if (!enabled) {
    return null;
  }

  const refresh = () => {
    if (!canLoad) return;
    void goalQuery.refetch();
    void workItemsQuery.refetch();
    void ledgerQuery.refetch();
  };

  const refreshLedger = () => {
    if (!canLoad) return;
    void ledgerQuery.refetch();
  };

  const loadMoreLedger = () => {
    setLedgerLimit((limit) => limit + LEDGER_PAGE_SIZE);
  };

  const startGoalEdit = () => {
    setGoalFormError(null);
    setGoalDraft(createGoalDraft(goal));
    setIsGoalEditing(true);
  };

  const cancelGoalEdit = () => {
    setGoalFormError(null);
    setGoalDraft(createGoalDraft(goal));
    setIsGoalEditing(false);
  };

  const saveGoal = () => {
    const summary = goalDraft.summary.trim();
    if (!summary) {
      setGoalFormError(t("projects.projectManagerGoalSummaryRequired"));
      return;
    }
    setGoalFormError(null);
    goalMutation.mutate({
      summary,
      constraints: parseProjectManagerTextList(goalDraft.constraintsText),
      acceptanceCriteria: parseProjectManagerTextList(goalDraft.acceptanceCriteriaText),
      status: goalDraft.status.trim() || "active",
    });
  };

  const openCreateWorkItemDialog = () => {
    setCreateWorkItemError(null);
    setWorkItemDraft(createWorkItemDraft());
    setIsCreateWorkItemOpen(true);
  };

  const saveWorkItem = () => {
    const title = workItemDraft.title.trim();
    if (!title) {
      setCreateWorkItemError(t("projects.projectManagerWorkItemTitleRequired"));
      return;
    }

    setCreateWorkItemError(null);
    createWorkItemMutation.mutate(createWorkItemInput(workItemDraft, title));
  };

  const attachEvidence = () => {
    if (!selectedWorkItem) return;
    if (evidenceDraft.kind.trim().length === 0) {
      setEvidenceAttachError(t("projects.projectManagerEvidenceKindRequired"));
      return;
    }
    if (evidenceDraft.ref.trim().length === 0 && evidenceDraft.path.trim().length === 0) {
      setEvidenceAttachError(t("projects.projectManagerEvidenceReferenceRequired"));
      return;
    }
    if (validateEvidenceReferenceInput(evidenceDraft)) {
      setEvidenceAttachError(t("projects.projectManagerEvidenceUnsafeValue"));
      return;
    }

    const reference = createSingleEvidenceReference(evidenceDraft);
    if (!reference) {
      setEvidenceAttachError(t("projects.projectManagerEvidenceReferenceRequired"));
      return;
    }

    setEvidenceAttachError(null);
    evidenceMutation.mutate({ workItemId: selectedWorkItem.id, reference });
  };

  const requestStatusChange = (item: ProjectManagerWorkItem, nextStatus: ProjectManagerWorkItemStatus) => {
    setStatusMutationError(null);
    if (nextStatus === "done" && item.evidenceRefCount === 0) {
      setPendingDoneWorkItemId(item.id);
      setDoneReason("");
      setDoneReasonError(null);
      return;
    }

    statusMutation.mutate({ workItemId: item.id, input: { status: nextStatus } });
  };

  const confirmDoneWithReason = () => {
    if (!pendingDoneWorkItem) return;
    const manualCompletionReason = doneReason.trim();
    if (!manualCompletionReason) {
      setDoneReasonError(t("projects.projectManagerDoneReasonRequired"));
      return;
    }

    setDoneReasonError(null);
    statusMutation.mutate({
      workItemId: pendingDoneWorkItem.id,
      input: { status: "done", manualCompletionReason },
    });
  };

  return (
    <div className="space-y-4" data-testid="project-manager-panel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-base font-semibold leading-tight">{t("projects.projectManager")}</h2>
          <p className="text-xs text-muted-foreground">{t("projects.projectManagerDisabledActionHint")}</p>
        </div>
        <Button size="sm" onClick={refresh} disabled={isRefreshing || !canLoad}>
          <RefreshCw className={cn("mr-2 size-4", isRefreshing && "animate-spin")} />
          {t("projects.projectManagerRefresh")}
        </Button>
      </div>

      {firstError ? (
        <ProjectManagerError
          message={isNotFoundError
            ? t("projects.projectManagerNotFound")
            : t("projects.projectManagerLoadFailed")}
          onRefresh={refresh}
          refreshing={isRefreshing}
        />
      ) : isLoading ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t("projects.projectManagerLoading")}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <ProjectManagerGoalCard
            goal={goal}
            t={t}
            draft={goalDraft}
            error={goalFormError}
            isEditing={isGoalEditing}
            isSaving={goalMutation.isPending}
            onCancel={cancelGoalEdit}
            onDraftChange={setGoalDraft}
            onEdit={startGoalEdit}
            onSave={saveGoal}
          />
          <ProjectManagerWorkItemsCard
            isFetching={workItemsQuery.isFetching}
            onCreate={openCreateWorkItemDialog}
            onStatusFilterChange={setWorkItemStatusFilter}
            onStatusChange={requestStatusChange}
            onViewDetails={(item) => setSelectedWorkItemId(item.id)}
            statusError={statusMutationError}
            statusFilter={workItemStatusFilter}
            statusMutationPending={statusMutation.isPending}
            highlightedWorkItemId={requestedWorkItemId}
            t={t}
            workItems={workItems}
          />
          <ProjectManagerLedgerCard
            error={ledgerQuery.error}
            events={filteredLedgerEvents}
            filter={ledgerFilter}
            hasLoadedEvents={ledgerEvents.length > 0}
            isFetching={ledgerQuery.isFetching}
            onFilterChange={setLedgerFilter}
            onLoadMore={loadMoreLedger}
            onRefresh={refreshLedger}
            refreshing={ledgerQuery.isFetching}
            t={t}
            workItems={workItems}
          />
        </div>
      )}
      <ProjectManagerWorkItemDetailSheet
        evidenceDraft={evidenceDraft}
        evidenceError={evidenceAttachError}
        isEvidenceSaving={evidenceMutation.isPending}
        item={selectedWorkItem}
        ledgerEvents={ledgerEvents}
        onAttachEvidence={attachEvidence}
        onEvidenceDraftChange={setEvidenceDraft}
        onOpenChange={(open) => {
          if (!open) setSelectedWorkItemId(null);
        }}
        onStatusChange={requestStatusChange}
        open={!!selectedWorkItem}
        statusMutationPending={statusMutation.isPending}
        t={t}
      />
      <CreateWorkItemDialog
        draft={workItemDraft}
        error={createWorkItemError}
        isSaving={createWorkItemMutation.isPending}
        onDraftChange={setWorkItemDraft}
        onOpenChange={setIsCreateWorkItemOpen}
        onSave={saveWorkItem}
        open={isCreateWorkItemOpen}
        t={t}
      />
      <DoneReasonDialog
        error={doneReasonError}
        isSaving={statusMutation.isPending}
        onConfirm={confirmDoneWithReason}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDoneWorkItemId(null);
            setDoneReason("");
            setDoneReasonError(null);
          }
        }}
        open={!!pendingDoneWorkItem}
        reason={doneReason}
        reasonRef={doneReasonRef}
        setReason={setDoneReason}
        t={t}
        workItemTitle={pendingDoneWorkItem?.title ?? ""}
      />
    </div>
  );
}

function ProjectManagerError({
  message,
  onRefresh,
  refreshing,
}: {
  message: string;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const { t } = useLanguage();

  return (
    <Card className="border-destructive/50 bg-destructive/10">
      <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="size-4" />
          {message}
        </p>
        <Button size="sm" variant="outline" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw className={cn("mr-2 size-4", refreshing && "animate-spin")} />
          {t("projects.projectManagerRefresh")}
        </Button>
      </CardContent>
    </Card>
  );
}

function ProjectManagerGoalCard({
  goal,
  t,
  draft,
  error,
  isEditing,
  isSaving,
  onCancel,
  onDraftChange,
  onEdit,
  onSave,
}: {
  goal: ProjectManagerGoal | null;
  t: Translate;
  draft: GoalDraft;
  error: string | null;
  isEditing: boolean;
  isSaving: boolean;
  onCancel: () => void;
  onDraftChange: (draft: GoalDraft) => void;
  onEdit: () => void;
  onSave: () => void;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <BriefcaseBusiness className="size-4" />
          {t("projects.projectManagerGoal")}
        </CardTitle>
        {!isEditing && (
          <Button size="sm" variant="outline" onClick={onEdit}>
            {t("projects.projectManagerEditGoal")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {isEditing ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="project-manager-goal-summary">{t("projects.projectManagerGoalSummary")}</Label>
              <Input
                id="project-manager-goal-summary"
                value={draft.summary}
                aria-invalid={!!error && draft.summary.trim().length === 0}
                disabled={isSaving}
                onChange={(event) => onDraftChange({ ...draft, summary: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-manager-goal-constraints">
                {t("projects.projectManagerConstraints")}
              </Label>
              <Textarea
                id="project-manager-goal-constraints"
                value={draft.constraintsText}
                disabled={isSaving}
                placeholder={t("projects.projectManagerTextListHint")}
                onChange={(event) => onDraftChange({ ...draft, constraintsText: event.target.value })}
              />
              <p className="text-xs text-muted-foreground">{t("projects.projectManagerTextListHint")}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-manager-goal-acceptance">
                {t("projects.projectManagerAcceptanceCriteria")}
              </Label>
              <Textarea
                id="project-manager-goal-acceptance"
                value={draft.acceptanceCriteriaText}
                disabled={isSaving}
                placeholder={t("projects.projectManagerTextListHint")}
                onChange={(event) => onDraftChange({ ...draft, acceptanceCriteriaText: event.target.value })}
              />
              <p className="text-xs text-muted-foreground">{t("projects.projectManagerTextListHint")}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-manager-goal-status">{t("projects.projectManagerGoalStatus")}</Label>
              <Input
                id="project-manager-goal-status"
                value={draft.status}
                disabled={isSaving}
                onChange={(event) => onDraftChange({ ...draft, status: event.target.value })}
              />
            </div>
            {error && (
              <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={onCancel} disabled={isSaving}>
                {t("projects.projectManagerCancel")}
              </Button>
              <Button onClick={onSave} disabled={isSaving}>
                {t("projects.projectManagerSaveGoal")}
              </Button>
            </div>
          </div>
        ) : !goal ? (
          <EmptyState
            title={t("projects.projectManagerNoGoalTitle")}
            body={t("projects.projectManagerNoGoalBody")}
          />
        ) : (
          <>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{statusLabel(goal.status, t)}</Badge>
                <span className="text-xs text-muted-foreground">
                  {t("projects.projectManagerUpdated")}: {formatTimestamp(goal.updatedAt)}
                </span>
              </div>
              <p className="break-words text-sm font-medium leading-6">{goal.summary}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <SummaryMetric label={t("projects.projectManagerConstraints")} value={goal.constraints.length} />
              <SummaryMetric
                label={t("projects.projectManagerAcceptanceCriteria")}
                value={goal.acceptanceCriteria.length}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ProjectManagerWorkItemsCard({
  highlightedWorkItemId,
  isFetching,
  onCreate,
  onStatusFilterChange,
  onStatusChange,
  onViewDetails,
  statusError,
  statusFilter,
  statusMutationPending,
  workItems,
  t,
}: {
  highlightedWorkItemId?: string | null;
  isFetching: boolean;
  onCreate: () => void;
  onStatusFilterChange: (status: WorkItemStatusFilter) => void;
  onStatusChange: (item: ProjectManagerWorkItem, nextStatus: ProjectManagerWorkItemStatus) => void;
  onViewDetails: (item: ProjectManagerWorkItem) => void;
  statusError: string | null;
  statusFilter: WorkItemStatusFilter;
  statusMutationPending: boolean;
  workItems: ProjectManagerWorkItem[];
  t: Translate;
}) {
  const isFilterEmpty = statusFilter !== "all" && workItems.length === 0;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="size-4" />
          {t("projects.projectManagerWorkItems")}
        </CardTitle>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <Label htmlFor="project-manager-work-item-filter" className="text-xs text-muted-foreground">
              {t("projects.projectManagerFilterByStatus")}
            </Label>
            <select
              id="project-manager-work-item-filter"
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
              value={statusFilter}
              disabled={isFetching}
              onChange={(event) => onStatusFilterChange(event.target.value as WorkItemStatusFilter)}
            >
              <option value="all">{t("projects.projectManagerAllStatuses")}</option>
              {WORK_ITEM_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status, t)}
                </option>
              ))}
            </select>
          </div>
          <Button size="sm" onClick={onCreate}>
            <Plus className="mr-2 size-4" />
            {t("projects.projectManagerCreateWorkItem")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {statusError && (
          <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {statusError}
          </p>
        )}
        {workItems.length === 0 ? (
          <EmptyState
            title={isFilterEmpty
              ? t("projects.projectManagerFilterEmptyTitle")
              : t("projects.projectManagerNoWorkItemsTitle")}
            body={isFilterEmpty
              ? t("projects.projectManagerFilterEmptyBody")
              : t("projects.projectManagerNoWorkItemsBody")}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead>{t("projects.projectManagerPriority")}</TableHead>
                <TableHead>{t("projects.projectManagerEvidenceRefs")}</TableHead>
                <TableHead>{t("projects.projectManagerUpdated")}</TableHead>
                <TableHead className="text-right">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workItems.map((item) => (
                <TableRow
                  key={item.id}
                  className={cn(
                    item.id === highlightedWorkItemId && "border-primary/60 bg-primary/5"
                  )}
                >
                  <TableCell className="max-w-[240px] whitespace-normal break-words font-medium">
                    {item.title}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(item.status)}>
                      {statusLabel(item.status, t)}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{item.priority}</TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">{item.evidenceRefCount}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatTimestamp(item.updatedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-col justify-end gap-2 sm:flex-row">
                      <Button size="sm" variant="outline" onClick={() => onViewDetails(item)}>
                        <Eye className="mr-2 size-4" />
                        {t("projects.projectManagerViewDetails")}
                      </Button>
                      <ProjectManagerStatusActions
                        disabled={statusMutationPending}
                        item={item}
                        onStatusChange={onStatusChange}
                        t={t}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function ProjectManagerWorkItemDetailSheet({
  evidenceDraft,
  evidenceError,
  isEvidenceSaving,
  item,
  ledgerEvents,
  onAttachEvidence,
  onEvidenceDraftChange,
  onOpenChange,
  onStatusChange,
  open,
  statusMutationPending,
  t,
}: {
  evidenceDraft: EvidenceDraft;
  evidenceError: string | null;
  isEvidenceSaving: boolean;
  item: ProjectManagerWorkItem | null;
  ledgerEvents: ProjectManagerLedgerEvent[];
  onAttachEvidence: () => void;
  onEvidenceDraftChange: (draft: EvidenceDraft) => void;
  onOpenChange: (open: boolean) => void;
  onStatusChange: (item: ProjectManagerWorkItem, nextStatus: ProjectManagerWorkItemStatus) => void;
  open: boolean;
  statusMutationPending: boolean;
  t: Translate;
}) {
  const traceMarkers = item ? workItemCopilotTraceMarkers(item, ledgerEvents) : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{item?.title ?? t("projects.projectManagerViewDetails")}</SheetTitle>
          <SheetDescription>{t("projects.projectManagerWorkItemDetail")}</SheetDescription>
        </SheetHeader>
        {item && (
          <div className="space-y-5 px-4 pb-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={statusBadgeVariant(item.status)}>{statusLabel(item.status, t)}</Badge>
                <span className="text-xs text-muted-foreground">
                  {t("projects.projectManagerUpdated")}: {formatTimestamp(item.updatedAt)}
                </span>
              </div>
              <ProjectManagerStatusActions
                disabled={statusMutationPending}
                item={item}
                onStatusChange={onStatusChange}
                t={t}
              />
            </div>
            <DetailField label={t("projects.projectManagerWorkItemDescription")}>
              {item.description ? (
                <p className="whitespace-pre-wrap break-words">{item.description}</p>
              ) : (
                <span className="text-muted-foreground">-</span>
              )}
            </DetailField>
            <div className="grid gap-2 sm:grid-cols-3">
              <SummaryMetric label={t("projects.projectManagerPriority")} value={item.priority} />
              <SummaryMetric label={t("projects.projectManagerEvidenceRefs")} value={item.evidenceRefCount} />
              <SummaryMetric label={t("projects.projectManagerFeishuRefs")} value={item.feishuRefCount} />
            </div>
            <DetailField label={t("projects.projectManagerAcceptanceCriteria")}>
              {item.acceptanceCriteria.length > 0 ? (
                <ul className="list-disc space-y-1 pl-5">
                  {item.acceptanceCriteria.map((criterion) => (
                    <li key={criterion} className="break-words">{criterion}</li>
                  ))}
                </ul>
              ) : (
                <span className="text-muted-foreground">-</span>
              )}
            </DetailField>
            <DetailField label={t("projects.projectManagerEvidenceRefs")}>
              {item.evidenceRefs.length > 0 ? (
                <ul className="space-y-2">
                  {item.evidenceRefs.map((ref, index) => (
                    <li key={`${ref.ref ?? ref.path ?? index}`} className="rounded-md border border-border/70 px-3 py-2 text-xs">
                      {formatEvidenceRef(ref)}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-muted-foreground">-</span>
              )}
            </DetailField>
            {traceMarkers.length > 0 && (
              <DetailField label={t("projects.projectManagerCopilotTrace")}>
                <div className="grid gap-2 sm:grid-cols-2">
                  {traceMarkers.map((marker) => (
                    <LedgerDatum
                      key={`${marker.labelKey}-${marker.value}`}
                      label={t(marker.labelKey)}
                      value={marker.value}
                    />
                  ))}
                </div>
              </DetailField>
            )}
            <fieldset className="space-y-3 rounded-md border border-border/70 p-3">
              <legend className="px-1 text-sm font-medium">{t("projects.projectManagerAttachEvidence")}</legend>
              <p className="text-xs leading-5 text-muted-foreground">
                {t("projects.projectManagerEvidenceReferenceHint")}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="project-manager-evidence-kind">{t("projects.projectManagerRefKind")}</Label>
                  <Input
                    id="project-manager-evidence-kind"
                    value={evidenceDraft.kind}
                    aria-invalid={!!evidenceError && evidenceDraft.kind.trim().length === 0}
                    disabled={isEvidenceSaving}
                    onChange={(event) => onEvidenceDraftChange({ ...evidenceDraft, kind: event.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="project-manager-evidence-label">{t("projects.projectManagerRefLabel")}</Label>
                  <Input
                    id="project-manager-evidence-label"
                    value={evidenceDraft.label}
                    disabled={isEvidenceSaving}
                    onChange={(event) => onEvidenceDraftChange({ ...evidenceDraft, label: event.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="project-manager-evidence-ref">{t("projects.projectManagerRefId")}</Label>
                  <Input
                    id="project-manager-evidence-ref"
                    value={evidenceDraft.ref}
                    aria-invalid={!!evidenceError && evidenceDraft.ref.trim().length === 0 && evidenceDraft.path.trim().length === 0}
                    disabled={isEvidenceSaving}
                    onChange={(event) => onEvidenceDraftChange({ ...evidenceDraft, ref: event.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="project-manager-evidence-path">{t("common.path")}</Label>
                  <Input
                    id="project-manager-evidence-path"
                    value={evidenceDraft.path}
                    aria-invalid={!!evidenceError && evidenceDraft.ref.trim().length === 0 && evidenceDraft.path.trim().length === 0}
                    disabled={isEvidenceSaving}
                    onChange={(event) => onEvidenceDraftChange({ ...evidenceDraft, path: event.target.value })}
                  />
                </div>
              </div>
              {evidenceError && (
                <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {evidenceError}
                </p>
              )}
              <div className="flex justify-end">
                <Button size="sm" onClick={onAttachEvidence} disabled={isEvidenceSaving}>
                  <Plus className="mr-2 size-4" />
                  {t("projects.projectManagerAttachEvidence")}
                </Button>
              </div>
            </fieldset>
            <div className="grid gap-2 sm:grid-cols-2">
              <DetailField label={t("projects.projectManagerCreated")}>
                {formatTimestamp(item.createdAt)}
              </DetailField>
              <DetailField label={t("projects.projectManagerUpdated")}>
                {formatTimestamp(item.updatedAt)}
              </DetailField>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function CreateWorkItemDialog({
  draft,
  error,
  isSaving,
  onDraftChange,
  onOpenChange,
  onSave,
  open,
  t,
}: {
  draft: WorkItemDraft;
  error: string | null;
  isSaving: boolean;
  onDraftChange: (draft: WorkItemDraft) => void;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  open: boolean;
  t: Translate;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(900px,calc(100vh-2rem))] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("projects.projectManagerCreateWorkItem")}</DialogTitle>
          <DialogDescription>{t("projects.projectManagerCreateWorkItemBody")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_120px]">
            <div className="space-y-2">
              <Label htmlFor="project-manager-work-item-title">
                {t("projects.projectManagerWorkItemTitle")}
              </Label>
              <Input
                id="project-manager-work-item-title"
                value={draft.title}
                aria-invalid={!!error && draft.title.trim().length === 0}
                disabled={isSaving}
                onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-manager-work-item-priority">
                {t("projects.projectManagerPriority")}
              </Label>
              <Input
                id="project-manager-work-item-priority"
                inputMode="numeric"
                value={draft.priority}
                disabled={isSaving}
                onChange={(event) => onDraftChange({ ...draft, priority: event.target.value })}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_190px]">
            <div className="space-y-2">
              <Label htmlFor="project-manager-work-item-description">
                {t("projects.projectManagerWorkItemDescription")}
              </Label>
              <Textarea
                id="project-manager-work-item-description"
                value={draft.description}
                disabled={isSaving}
                onChange={(event) => onDraftChange({ ...draft, description: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-manager-work-item-status">{t("common.status")}</Label>
              <select
                id="project-manager-work-item-status"
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
                value={draft.status}
                disabled={isSaving}
                onChange={(event) => onDraftChange({ ...draft, status: event.target.value as ProjectManagerWorkItemStatus })}
              >
                {WORK_ITEM_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(status, t)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-manager-work-item-acceptance">
              {t("projects.projectManagerAcceptanceCriteria")}
            </Label>
            <Textarea
              id="project-manager-work-item-acceptance"
              value={draft.acceptanceCriteriaText}
              disabled={isSaving}
              placeholder={t("projects.projectManagerTextListHint")}
              onChange={(event) => onDraftChange({ ...draft, acceptanceCriteriaText: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">{t("projects.projectManagerTextListHint")}</p>
          </div>
          <ReferenceDraftFields
            disabled={isSaving}
            draft={draft}
            onDraftChange={onDraftChange}
            prefix="evidence"
            title={t("projects.projectManagerInitialEvidenceRefs")}
            t={t}
          />
          <ReferenceDraftFields
            disabled={isSaving}
            draft={draft}
            onDraftChange={onDraftChange}
            prefix="feishu"
            title={t("projects.projectManagerInitialFeishuRefs")}
            t={t}
          />
          {error && (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t("projects.projectManagerCancel")}
          </Button>
          <Button onClick={onSave} disabled={isSaving}>
            {t("projects.projectManagerCreateWorkItem")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReferenceDraftFields({
  disabled,
  draft,
  onDraftChange,
  prefix,
  title,
  t,
}: {
  disabled: boolean;
  draft: WorkItemDraft;
  onDraftChange: (draft: WorkItemDraft) => void;
  prefix: "evidence" | "feishu";
  title: string;
  t: Translate;
}) {
  const isEvidence = prefix === "evidence";
  const fieldId = `project-manager-${prefix}-ref`;
  const kindKey = isEvidence ? "evidenceKind" : "feishuKind";
  const labelKey = isEvidence ? "evidenceLabel" : "feishuLabel";
  const refKey = isEvidence ? "evidenceRef" : "feishuRef";
  const finalKey = isEvidence ? "evidencePath" : "feishuMessageId";

  return (
    <fieldset className="space-y-3 rounded-md border border-border/70 p-3">
      <legend className="px-1 text-sm font-medium">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-kind`}>{t("projects.projectManagerRefKind")}</Label>
          <Input
            id={`${fieldId}-kind`}
            value={draft[kindKey]}
            disabled={disabled}
            onChange={(event) => onDraftChange({ ...draft, [kindKey]: event.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-label`}>{t("projects.projectManagerRefLabel")}</Label>
          <Input
            id={`${fieldId}-label`}
            value={draft[labelKey]}
            disabled={disabled}
            onChange={(event) => onDraftChange({ ...draft, [labelKey]: event.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-ref`}>{t("projects.projectManagerRefId")}</Label>
          <Input
            id={`${fieldId}-ref`}
            value={draft[refKey]}
            disabled={disabled}
            onChange={(event) => onDraftChange({ ...draft, [refKey]: event.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-final`}>
            {isEvidence ? t("common.path") : t("projects.projectManagerFeishuMessageId")}
          </Label>
          <Input
            id={`${fieldId}-final`}
            value={draft[finalKey]}
            disabled={disabled}
            onChange={(event) => onDraftChange({ ...draft, [finalKey]: event.target.value })}
          />
        </div>
      </div>
    </fieldset>
  );
}

function ProjectManagerStatusActions({
  disabled,
  item,
  onStatusChange,
  t,
}: {
  disabled: boolean;
  item: ProjectManagerWorkItem;
  onStatusChange: (item: ProjectManagerWorkItem, nextStatus: ProjectManagerWorkItemStatus) => void;
  t: Translate;
}) {
  const nextStatuses = PROJECT_MANAGER_STATUS_TRANSITIONS[item.status];
  if (nextStatuses.length === 0) {
    return <span className="inline-flex h-9 items-center text-xs text-muted-foreground">-</span>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}>
          <ArrowRightCircle className="mr-2 size-4" />
          {t("projects.projectManagerChangeStatus")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {nextStatuses.map((nextStatus) => (
          <DropdownMenuItem
            key={nextStatus}
            onSelect={() => onStatusChange(item, nextStatus)}
          >
            {statusLabel(nextStatus, t)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DoneReasonDialog({
  error,
  isSaving,
  onConfirm,
  onOpenChange,
  open,
  reason,
  reasonRef,
  setReason,
  t,
  workItemTitle,
}: {
  error: string | null;
  isSaving: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  reason: string;
  reasonRef: RefObject<HTMLTextAreaElement | null>;
  setReason: (reason: string) => void;
  t: Translate;
  workItemTitle: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("projects.projectManagerDoneReasonTitle")}</DialogTitle>
          <DialogDescription>{t("projects.projectManagerDoneReasonBody")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="project-manager-done-reason">{t("projects.projectManagerDoneReasonLabel")}</Label>
          <Textarea
            id="project-manager-done-reason"
            ref={reasonRef}
            value={reason}
            aria-invalid={!!error}
            disabled={isSaving}
            onChange={(event) => setReason(event.target.value)}
          />
          {workItemTitle && <p className="text-xs text-muted-foreground">{workItemTitle}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t("projects.projectManagerCancel")}
          </Button>
          <Button onClick={onConfirm} disabled={isSaving}>
            {t("projects.projectManagerConfirmStatusChange")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailField({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="space-y-1 text-sm">
      <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
      <div className="break-words">{children}</div>
    </div>
  );
}

function ProjectManagerLedgerCard({
  error,
  events,
  filter,
  hasLoadedEvents,
  isFetching,
  onFilterChange,
  onLoadMore,
  onRefresh,
  refreshing,
  t,
  workItems,
}: {
  error: unknown;
  events: ProjectManagerLedgerEvent[];
  filter: LedgerFilter;
  hasLoadedEvents: boolean;
  isFetching: boolean;
  onFilterChange: (filter: LedgerFilter) => void;
  onLoadMore: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  t: Translate;
  workItems: ProjectManagerWorkItem[];
}) {
  return (
    <Card className="xl:col-span-2" data-testid="project-manager-ledger">
      <CardHeader className="space-y-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="size-4" />
          {t("projects.projectManagerLedger")}
        </CardTitle>
        <div className="flex flex-wrap gap-2">
          {LEDGER_FILTER_OPTIONS.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={filter === option.value ? "default" : "outline"}
              onClick={() => onFilterChange(option.value)}
            >
              {t(option.labelKey)}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="size-4" />
                {t("projects.projectManagerLedgerLoadFailed")}
              </p>
              <Button size="sm" variant="outline" onClick={onRefresh} disabled={refreshing}>
                <RefreshCw className={cn("mr-2 size-4", refreshing && "animate-spin")} />
                {t("projects.projectManagerRefresh")}
              </Button>
            </div>
          </div>
        ) : isFetching && !hasLoadedEvents ? (
          <div className="py-4 text-center text-sm text-muted-foreground">
            {t("projects.projectManagerLoading")}
          </div>
        ) : !hasLoadedEvents ? (
          <EmptyState
            title={t("projects.projectManagerNoLedgerTitle")}
            body={t("projects.projectManagerNoLedgerBody")}
          />
        ) : events.length === 0 ? (
          <EmptyState
            title={t("projects.projectManagerLedgerFilteredEmptyTitle")}
            body={t("projects.projectManagerLedgerFilteredEmptyBody")}
          />
        ) : (
          <div className="space-y-3">
            {events.map((event) => (
              <ProjectManagerLedgerRow
                key={event.id}
                event={event}
                t={t}
                workItemTitle={ledgerWorkItemTitle(event, workItems)}
              />
            ))}
          </div>
        )}
        {!error && (
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={onLoadMore} disabled={isFetching}>
              {t("projects.projectManagerLoadMoreLedger")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProjectManagerLedgerRow({
  event,
  t,
  workItemTitle,
}: {
  event: ProjectManagerLedgerEvent;
  t: Translate;
  workItemTitle: string;
}) {
  const note = ledgerEventNote(event.eventType, t);

  return (
    <div className="rounded-md border border-border/70 bg-muted/10 px-3 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={ledgerEventBadgeVariant(event.eventType)}>
              {eventLabel(event.eventType, t)}
            </Badge>
            {event.status ? (
              <Badge variant={statusBadgeVariant(event.status)}>
                {statusLabel(event.status, t)}
              </Badge>
            ) : (
              <span className="text-xs text-muted-foreground">-</span>
            )}
          </div>
          <p className="break-words text-sm font-medium">{workItemTitle}</p>
          {note && <p className="text-xs leading-5 text-muted-foreground">{note}</p>}
        </div>
        <div className="text-xs text-muted-foreground">{formatTimestamp(event.createdAt)}</div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <LedgerDatum label={t("projects.projectManagerEvidenceRefs")} value={event.evidenceRefCount} />
        <LedgerDatum label={t("projects.projectManagerFeishuRefs")} value={event.feishuRefCount} />
      </div>
      {event.trace && <LedgerTraceGrid trace={event.trace} t={t} />}
    </div>
  );
}

function LedgerTraceGrid({ trace, t }: { trace: ProjectManagerLedgerTrace; t: Translate }) {
  const markers = ledgerTraceMarkers(trace);
  if (markers.length === 0) return null;

  return (
    <div className="mt-3 rounded-md border border-border/70 bg-background/40 p-3">
      <div className="text-xs font-medium uppercase text-muted-foreground">
        {t("projects.projectManagerCopilotTrace")}
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {markers.map((marker) => (
          <LedgerDatum
            key={`${marker.labelKey}-${marker.value}`}
            label={t(marker.labelKey)}
            value={marker.value}
          />
        ))}
      </div>
    </div>
  );
}

function LedgerDatum({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-border/50 bg-background/40 px-2 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-all font-mono text-xs tabular-nums">{value}</div>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="py-4 text-center">
      <div className="text-sm font-medium">{title}</div>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-sm tabular-nums">{value}</div>
    </div>
  );
}

function parseProjectManagerTextList(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function formatProjectManagerTextList(values: string[]): string {
  return values.join("\n");
}

function createGoalDraft(goal: ProjectManagerGoal | null): GoalDraft {
  return {
    summary: goal?.summary ?? "",
    constraintsText: formatProjectManagerTextList(goal?.constraints ?? []),
    acceptanceCriteriaText: formatProjectManagerTextList(goal?.acceptanceCriteria ?? []),
    status: goal?.status ?? "active",
  };
}

function createWorkItemQueryParams(status: WorkItemStatusFilter) {
  return status === "all"
    ? { limit: WORK_ITEM_LIMIT }
    : { status, limit: WORK_ITEM_LIMIT };
}

function createWorkItemDraft(): WorkItemDraft {
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

function createEvidenceDraft(): EvidenceDraft {
  return {
    kind: "",
    label: "",
    ref: "",
    path: "",
  };
}

function createWorkItemInput(draft: WorkItemDraft, title: string): ProjectManagerWorkItemInput {
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

function createSingleEvidenceReference(draft: EvidenceDraft): ProjectManagerEvidenceRef | undefined {
  const kind = draft.kind.trim();
  const label = draft.label.trim();
  const ref = draft.ref.trim();
  const path = draft.path.trim();

  if (!kind || (!ref && !path)) {
    return undefined;
  }

  return {
    kind,
    ...(label ? { label } : {}),
    ...(ref ? { ref } : {}),
    ...(path ? { path } : {}),
  };
}

function createReference(ref: ProjectManagerEvidenceRef): ProjectManagerEvidenceRef | undefined {
  const trimmed = Object.fromEntries(
    Object.entries(ref)
      .map(([key, value]) => [key, typeof value === "string" ? value.trim() : value])
      .filter(([, value]) => typeof value === "string" && value.length > 0)
  ) as ProjectManagerEvidenceRef;

  if (!trimmed.ref && !trimmed.path && !trimmed.feishuMessageId) {
    return undefined;
  }

  return trimmed;
}

const UNSAFE_EVIDENCE_REFERENCE_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{6,}\b/u,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/iu,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/iu,
  /private key/iu,
  /\bOPENFORGE_ATTACH_TOKEN=/u,
  /\b(api[_-]?key|token|password|secret|private[_-]?key|credential|event[_-]?encrypt[_-]?key)\b\s*[:=]/iu,
  /[\r\n\x00-\x08\x0B\x0C\x0E-\x1F]/u,
  /\b(raw terminal|terminal transcript|stdout|stderr|command output)\b/iu,
  /^\s*[$>#]\s+\S+/u,
  /"?(messages|choices|provider|authorization|api_key|request|response)"?\s*:/iu,
];

function validateEvidenceReferenceInput(draft: EvidenceDraft): boolean {
  return [draft.ref, draft.path].some((value) =>
    UNSAFE_EVIDENCE_REFERENCE_PATTERNS.some((pattern) => pattern.test(value))
  );
}

function filterLedgerEvents(events: ProjectManagerLedgerEvent[], filter: LedgerFilter) {
  if (filter === "all") {
    return events;
  }
  const allowedEvents = LEDGER_FILTER_EVENTS[filter];
  return events.filter((event) => allowedEvents.includes(event.eventType));
}

function ledgerWorkItemTitle(event: ProjectManagerLedgerEvent, workItems: ProjectManagerWorkItem[]) {
  const workItem = workItems.find((item) => item.id === event.workItemId);
  return workItem?.title ?? event.workItemId ?? "-";
}

interface TraceMarker {
  labelKey: TranslationKey;
  value: string | number;
}

function workItemCopilotTraceMarkers(
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

  const runId = trace?.copilotRunId ?? evidenceTrace?.copilotRunId;
  const actionId = trace?.pendingActionId ?? evidenceTrace?.pendingActionId;
  if (runId) markers.push({ labelKey: "projects.projectManagerTraceRun", value: runId });
  if (actionId) markers.push({ labelKey: "projects.projectManagerTraceAction", value: actionId });
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

function ledgerTraceMarkers(trace: ProjectManagerLedgerTrace): TraceMarker[] {
  const markers: Array<TraceMarker | null> = [
    trace.copilotRunId ? { labelKey: "projects.projectManagerTraceRun", value: trace.copilotRunId } : null,
    trace.pendingActionId ? { labelKey: "projects.projectManagerTraceAction", value: trace.pendingActionId } : null,
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

function selectLedgerTraceEvent(
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

function latestLedgerEvent(events: ProjectManagerLedgerEvent[]): ProjectManagerLedgerEvent | undefined {
  return events.reduce<ProjectManagerLedgerEvent | undefined>((latest, event) => {
    if (!latest || event.createdAt > latest.createdAt) return event;
    return latest;
  }, undefined);
}

function isTrustedEvidenceRef(ref: ProjectManagerEvidenceRef): boolean {
  const status = ref.status?.trim().toLowerCase();
  return status === "accepted" || status === "verified";
}

function hasEvidenceTrace(ref: ProjectManagerEvidenceRef): boolean {
  return Boolean(ref.copilotRunId || ref.pendingActionId || ref.sessionId);
}

function ledgerEventNote(eventType: ProjectManagerLedgerEventType, t: Translate) {
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

function formatEvidenceRef(ref: ProjectManagerEvidenceRef) {
  const parts = [
    ref.kind,
    ref.label,
    ref.status,
    ref.ref,
    ref.path,
    ref.sessionId,
    ref.copilotRunId,
    ref.pendingActionId,
    ref.feishuMessageId,
  ]
    .map((part) => part?.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "-";
}

function projectManagerMutationMessage(error: unknown, fallback: string) {
  if (error instanceof GatewayApiError && error.message) {
    return error.message;
  }
  return fallback;
}

function statusBadgeVariant(status: ProjectManagerWorkItemStatus | string) {
  if (status === "done") return "default";
  if (status === "blocked") return "destructive";
  if (status === "in_progress" || status === "ready_for_review") return "secondary";
  return "outline";
}

function ledgerEventBadgeVariant(eventType: ProjectManagerLedgerEventType) {
  if (eventType === "blocker_recorded") return "destructive" as const;
  if (eventType === "evidence_attached" || eventType === "manual_completion_recorded") return "secondary" as const;
  if (eventType === "blocker_resolved") return "default" as const;
  return "outline" as const;
}

function statusLabel(status: ProjectManagerWorkItemStatus | string, t: Translate) {
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

function eventLabel(eventType: ProjectManagerLedgerEventType, t: Translate) {
  const labels: Record<ProjectManagerLedgerEventType, TranslationKey> = {
    goal_updated: "projects.projectManagerEventGoalUpdated",
    work_item_created: "projects.projectManagerEventWorkItemCreated",
    work_item_updated: "projects.projectManagerEventWorkItemUpdated",
    work_item_deleted: "projects.projectManagerEventWorkItemDeleted",
    work_item_status_changed: "projects.projectManagerEventWorkItemStatusChanged",
    evidence_attached: "projects.projectManagerEventEvidenceAttached",
    blocker_recorded: "projects.projectManagerEventBlockerRecorded",
    blocker_resolved: "projects.projectManagerEventBlockerResolved",
    copilot_observation_recorded: "projects.projectManagerEventCopilotObservationRecorded",
    feishu_reference_linked: "projects.projectManagerEventFeishuReferenceLinked",
    next_step_proposed: "projects.projectManagerEventNextStepProposed",
    manual_completion_recorded: "projects.projectManagerEventManualCompletionRecorded",
  };
  return t(labels[eventType]);
}

function formatTimestamp(value: number) {
  if (!Number.isFinite(value)) return "-";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
