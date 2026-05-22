"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BriefcaseBusiness, ClipboardList, Eye, History, Plus, RefreshCw } from "lucide-react";

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
  GatewayApiError,
  getProjectManagerGoal,
  listProjectManagerLedger,
  listProjectManagerWorkItems,
  createProjectManagerWorkItem,
  updateProjectManagerGoal,
  type ProjectManagerEvidenceRef,
  type ProjectManagerLedgerEvent,
  type ProjectManagerLedgerEventType,
  type ProjectManagerGoal,
  type ProjectManagerWorkItemInput,
  type ProjectManagerGoalInput,
  type ProjectManagerWorkItem,
  type ProjectManagerWorkItemStatus,
} from "@/lib/api";
import type { TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface ProjectManagerPanelProps {
  projectId: string;
  enabled: boolean;
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

const WORK_ITEM_LIMIT = 50;
const WORK_ITEM_STATUSES: ProjectManagerWorkItemStatus[] = [
  "todo",
  "in_progress",
  "blocked",
  "ready_for_review",
  "done",
  "cancelled",
];

export function ProjectManagerPanel({ projectId, enabled }: ProjectManagerPanelProps) {
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
    queryKey: ["project-manager", projectId, "ledger", { limit: 5 }],
    queryFn: () => listProjectManagerLedger(projectId, { limit: 5 }),
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

  if (!enabled) {
    return null;
  }

  const firstError = goalQuery.error ?? workItemsQuery.error ?? ledgerQuery.error;
  const isNotFoundError = firstError instanceof GatewayApiError && firstError.status === 404;
  const isLoading = goalQuery.isLoading || workItemsQuery.isLoading || ledgerQuery.isLoading;
  const isRefreshing = goalQuery.isFetching || workItemsQuery.isFetching || ledgerQuery.isFetching;
  const workItems = workItemsQuery.data?.workItems ?? [];
  const ledgerEvents = ledgerQuery.data?.events ?? [];
  const selectedWorkItem = workItems.find((item) => item.id === selectedWorkItemId) ?? null;

  const refresh = () => {
    if (!canLoad) return;
    void goalQuery.refetch();
    void workItemsQuery.refetch();
    void ledgerQuery.refetch();
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
            onViewDetails={(item) => setSelectedWorkItemId(item.id)}
            statusFilter={workItemStatusFilter}
            t={t}
            workItems={workItems}
          />
          <ProjectManagerLedgerCard events={ledgerEvents} t={t} />
        </div>
      )}
      <ProjectManagerWorkItemDetailSheet
        item={selectedWorkItem}
        onOpenChange={(open) => {
          if (!open) setSelectedWorkItemId(null);
        }}
        open={!!selectedWorkItem}
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
  isFetching,
  onCreate,
  onStatusFilterChange,
  onViewDetails,
  statusFilter,
  workItems,
  t,
}: {
  isFetching: boolean;
  onCreate: () => void;
  onStatusFilterChange: (status: WorkItemStatusFilter) => void;
  onViewDetails: (item: ProjectManagerWorkItem) => void;
  statusFilter: WorkItemStatusFilter;
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
      <CardContent>
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
                <TableRow key={item.id}>
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
                    <Button size="sm" variant="outline" onClick={() => onViewDetails(item)}>
                      <Eye className="mr-2 size-4" />
                      {t("projects.projectManagerViewDetails")}
                    </Button>
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
  item,
  onOpenChange,
  open,
  t,
}: {
  item: ProjectManagerWorkItem | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  t: Translate;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{item?.title ?? t("projects.projectManagerViewDetails")}</SheetTitle>
          <SheetDescription>{t("projects.projectManagerWorkItemDetail")}</SheetDescription>
        </SheetHeader>
        {item && (
          <div className="space-y-5 px-4 pb-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statusBadgeVariant(item.status)}>{statusLabel(item.status, t)}</Badge>
              <span className="text-xs text-muted-foreground">
                {t("projects.projectManagerUpdated")}: {formatTimestamp(item.updatedAt)}
              </span>
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

function DetailField({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="space-y-1 text-sm">
      <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
      <div className="break-words">{children}</div>
    </div>
  );
}

function ProjectManagerLedgerCard({
  events,
  t,
}: {
  events: ProjectManagerLedgerEvent[];
  t: Translate;
}) {
  return (
    <Card className="xl:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="size-4" />
          {t("projects.projectManagerLedger")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <EmptyState
            title={t("projects.projectManagerNoLedgerTitle")}
            body={t("projects.projectManagerNoLedgerBody")}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("projects.projectManagerEvent")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead>{t("projects.projectManagerEvidenceRefs")}</TableHead>
                <TableHead>{t("projects.projectManagerFeishuRefs")}</TableHead>
                <TableHead>{t("projects.projectManagerCreated")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="whitespace-normal font-medium">
                    {eventLabel(event.eventType, t)}
                  </TableCell>
                  <TableCell>
                    {event.status ? (
                      <Badge variant={statusBadgeVariant(event.status)}>
                        {statusLabel(event.status, t)}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">{event.evidenceRefCount}</TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">{event.feishuRefCount}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatTimestamp(event.createdAt)}
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

function formatEvidenceRef(ref: ProjectManagerEvidenceRef) {
  const parts = [ref.kind, ref.label, ref.status, ref.ref, ref.path, ref.sessionId, ref.copilotRunId, ref.feishuMessageId]
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
