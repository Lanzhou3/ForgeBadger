"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Target,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/hooks/use-language";
import {
  createProjectManagerWorkItem,
  deleteProjectManagerWorkItem,
  GatewayApiError,
  getProjectManagerGoal,
  getProjectManagerTaskPacket,
  listProjectManagerLedger,
  listProjectManagerStages,
  listProjectManagerTaskPackets,
  listProjectManagerWorkItemLinks,
  listProjectManagerWorkItems,
  startProjectManagerTaskPacket,
  updateProjectManagerWorkItemStatus,
  type ProjectManagerTaskPacket,
  type ProjectManagerWorkItem,
  type ProjectManagerWorkItemStatus,
  type RuntimeAdapterId,
} from "@/lib/api";
import { getGoal, listGoals } from "@/lib/copilot-api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { TaskAuthorityContext, useTaskAuthority, type TaskAuthority } from "./TaskAuthority";
import { ProjectManagerWorkItemDetailSheet } from "./WorkItemDetailSheet";
import { QuickStartSessionDialog } from "./QuickStartSessionDialog";
import { EmptyState } from "./shared";
import {
  LEDGER_PAGE_SIZE,
  PROJECT_MANAGER_STATUS_TRANSITIONS,
  WORK_ITEM_LIMIT,
  type WorkItemStatusFilter,
} from "./types";
import {
  projectManagerMutationMessage,
  projectManagerViewStorageKey,
  readProjectManagerViewPrefs,
  statusDotClassName,
  statusLabel,
  writeProjectManagerViewPrefs,
} from "./utils";

interface ProjectManagerPanelProps {
  projectId: string;
  enabled: boolean;
  selectedWorkItemId?: string | null;
  authority: TaskAuthority;
  /**
   * Rendered under a tab/breadcrumb that already names this panel: the internal
   * heading becomes sr-only while keeping semantic outline intact.
   */
  embedded?: boolean;
  onNavigateToSession?: (href: string) => void;
  onOpenFile?: (path: string) => void;
}

export function ProjectManagerPanel(props: ProjectManagerPanelProps) {
  return (
    <TaskAuthorityContext.Provider value={props.authority}>
      <ProjectManagerPanelContent {...props} />
    </TaskAuthorityContext.Provider>
  );
}

function ProjectManagerPanelContent({
  projectId,
  enabled,
  selectedWorkItemId: requestedWorkItemId = null,
  embedded = false,
  onNavigateToSession,
  onOpenFile,
}: ProjectManagerPanelProps) {
  const { t } = useLanguage();
  const { canEdit, legacySessions, collaboration, actorId } = useTaskAuthority();
  const queryClient = useQueryClient();
  const canLoad = enabled && projectId.length > 0;

  const viewStorageKey = projectManagerViewStorageKey(projectId);
  const [statusFilter, setStatusFilter] = useState<WorkItemStatusFilter>(
    () => readProjectManagerViewPrefs(viewStorageKey).statusFilter,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");
  const [selectedWorkItemId, setSelectedWorkItemId] = useState<string | null>(null);
  const [deletingItem, setDeletingItem] = useState<ProjectManagerWorkItem | null>(null);
  const [quickStartItem, setQuickStartItem] = useState<ProjectManagerWorkItem | null>(null);
  const [quickStartError, setQuickStartError] = useState<string | null>(null);
  const [taskPacketStartError, setTaskPacketStartError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [hasConflict, setHasConflict] = useState(false);
  const appliedRequestedIdRef = useRef<string | null>(null);

  useEffect(() => {
    writeProjectManagerViewPrefs(viewStorageKey, { statusFilter });
  }, [statusFilter, viewStorageKey]);

  const goalQuery = useQuery({
    queryKey: ["project-manager", projectId, "goal", actorId],
    queryFn: () => getProjectManagerGoal(projectId),
    enabled: canLoad,
    retry: false,
  });

  const workItemsQuery = useQuery({
    queryKey: ["project-manager", projectId, "work-items", { limit: WORK_ITEM_LIMIT }, actorId],
    queryFn: () => listProjectManagerWorkItems(projectId, { limit: WORK_ITEM_LIMIT }),
    enabled: canLoad,
    retry: false,
  });

  const stagesQuery = useQuery({
    queryKey: ["project-manager", projectId, "stages", actorId],
    queryFn: () => listProjectManagerStages(projectId),
    enabled: canLoad,
    retry: false,
  });

  const linksQuery = useQuery({
    queryKey: ["project-manager", projectId, "work-item-links", actorId],
    queryFn: () => listProjectManagerWorkItemLinks(projectId),
    enabled: canLoad,
    retry: false,
  });

  const ledgerQuery = useQuery({
    queryKey: ["project-manager", projectId, "ledger", { limit: LEDGER_PAGE_SIZE }, actorId],
    queryFn: () => listProjectManagerLedger(projectId, { limit: LEDGER_PAGE_SIZE }),
    enabled: canLoad && Boolean(selectedWorkItemId),
    retry: false,
  });

  const taskPacketsQuery = useQuery({
    queryKey: ["project-manager", projectId, "task-packets", { limit: WORK_ITEM_LIMIT }, actorId],
    queryFn: () => listProjectManagerTaskPackets(projectId, { limit: WORK_ITEM_LIMIT }),
    enabled: canLoad && legacySessions,
    retry: false,
  });

  const taskPacketQuery = useQuery({
    queryKey: ["project-manager", projectId, "work-item", selectedWorkItemId, "task-packet", actorId],
    queryFn: () => getProjectManagerTaskPacket(projectId, selectedWorkItemId ?? ""),
    enabled: canLoad && legacySessions && Boolean(selectedWorkItemId),
    retry: false,
  });

  const copilotGoalsQuery = useQuery({
    queryKey: ["copilot-goals"],
    queryFn: () => listGoals(),
    enabled: canLoad && legacySessions,
    retry: false,
    staleTime: 30_000,
  });

  const activeProjectGoal = (copilotGoalsQuery.data?.goals ?? []).find(
    (g) => g.projectId === projectId && (g.status === "active" || g.status === "blocked"),
  );

  const activeGoalDetailQuery = useQuery({
    queryKey: ["copilot-goal", activeProjectGoal?.id],
    queryFn: () => getGoal(activeProjectGoal!.id),
    enabled: canLoad && legacySessions && Boolean(activeProjectGoal?.id),
    retry: false,
    staleTime: 30_000,
  });

  const workItems = workItemsQuery.data?.workItems ?? [];
  const stages = stagesQuery.data?.stages ?? [];
  const links = linksQuery.data?.links ?? [];
  const ledgerEvents = ledgerQuery.data?.events ?? [];
  const taskPackets = taskPacketsQuery.data?.taskPackets ?? [];
  const goal = goalQuery.data?.goal ?? null;

  useEffect(() => {
    if (!requestedWorkItemId || appliedRequestedIdRef.current === requestedWorkItemId) return;
    if (workItems.some((item) => item.id === requestedWorkItemId)) {
      appliedRequestedIdRef.current = requestedWorkItemId;
      setSelectedWorkItemId(requestedWorkItemId);
    }
  }, [requestedWorkItemId, workItems]);

  const stageNameById = useMemo(
    () => new Map(stages.map((stage) => [stage.id, stage.name])),
    [stages],
  );

  const taskPacketByWorkItemId = useMemo(
    () => new Map(taskPackets.map((packet) => [packet.workItemId, packet])),
    [taskPackets],
  );

  const goalTaskLinksByWorkItemId = useMemo(() => {
    const map = new Map<string, { goalId: string; goalTitle: string; taskStatus: string }>();
    const detail = activeGoalDetailQuery.data;
    if (!detail) return map;
    for (const task of detail.tasks ?? []) {
      if (task.workItemId) {
        map.set(task.workItemId, {
          goalId: detail.goal.id,
          goalTitle: detail.goal.title,
          taskStatus: task.status,
        });
      }
    }
    return map;
  }, [activeGoalDetailQuery.data]);

  const unresolvedBlockersByItemId = useMemo(() => {
    const itemById = new Map(workItems.map((item) => [item.id, item]));
    const counts = new Map<string, number>();
    for (const link of links) {
      const blocker = itemById.get(link.blockerWorkItemId);
      if (blocker && blocker.status !== "done" && blocker.status !== "cancelled") {
        counts.set(link.blockedWorkItemId, (counts.get(link.blockedWorkItemId) ?? 0) + 1);
      }
    }
    return counts;
  }, [links, workItems]);

  const memberEmailById = useMemo(
    () => new Map((collaboration?.members ?? []).map((member) => [member.userId, member.email])),
    [collaboration?.members],
  );

  async function invalidateAll() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["project-manager", projectId] }),
      ...(legacySessions
        ? [
            queryClient.invalidateQueries({ queryKey: ["copilot-goals"] }),
            queryClient.invalidateQueries({ queryKey: ["sessions", { projectId }] }),
          ]
        : []),
    ]);
  }

  const createMutation = useMutation({
    mutationFn: (title: string) => createProjectManagerWorkItem(projectId, { title }),
    onSuccess: async () => {
      setQuickTitle("");
      await queryClient.invalidateQueries({
        queryKey: ["project-manager", projectId, "work-items"],
      });
      if (legacySessions) {
        await queryClient.invalidateQueries({
          queryKey: ["project-manager", projectId, "task-packets"],
        });
      }
    },
    onError: (err) => {
      toast.error(
        projectManagerMutationMessage(err, t("projects.projectManagerCreateWorkItemError"), t),
      );
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({
      workItemId,
      status,
      expectedRevision,
      manualCompletionReason,
    }: {
      workItemId: string;
      status: ProjectManagerWorkItemStatus;
      expectedRevision?: number;
      manualCompletionReason?: string;
    }) =>
      updateProjectManagerWorkItemStatus(projectId, workItemId, {
        status,
        expectedRevision,
        ...(manualCompletionReason ? { manualCompletionReason } : {}),
      }),
    onSuccess: async () => {
      setHasConflict(false);
      setStatusError(null);
      await invalidateAll();
    },
    onError: (err) => {
      if (err instanceof GatewayApiError && err.status === 409) {
        setHasConflict(true);
      }
      const msg = projectManagerMutationMessage(
        err,
        t("projects.projectManagerStatusMutationError"),
        t,
      );
      setStatusError(msg);
      toast.error(msg);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (item: ProjectManagerWorkItem) =>
      deleteProjectManagerWorkItem(projectId, item.id, {
        confirm: true,
        ...(typeof item.revision === "number" ? { expectedRevision: item.revision } : {}),
      }),
    onSuccess: async (_, deletedItem) => {
      setDeletingItem(null);
      if (selectedWorkItemId === deletedItem.id) setSelectedWorkItemId(null);
      await invalidateAll();
    },
    onError: (err) => {
      toast.error(
        projectManagerMutationMessage(err, t("projects.projectManagerDeleteWorkItemError"), t),
      );
    },
  });

  const startSessionMutation = useMutation({
    mutationFn: ({ workItemId, aiTool }: { workItemId: string; aiTool?: RuntimeAdapterId }) =>
      startProjectManagerTaskPacket(projectId, workItemId, aiTool ? { aiTool } : undefined),
    onSuccess: async ({ session }) => {
      setQuickStartItem(null);
      setQuickStartError(null);
      setTaskPacketStartError(null);
      await invalidateAll();
      if (onNavigateToSession) {
        onNavigateToSession(`/sessions/${encodeURIComponent(session.id)}`);
      }
    },
    onError: (err) => {
      const msg = projectManagerMutationMessage(
        err,
        t("projects.projectManagerTaskPacketStartError"),
        t,
      );
      setQuickStartError(msg);
      setTaskPacketStartError(msg);
    },
  });

  function changeWorkItemStatus(
    item: ProjectManagerWorkItem,
    nextStatus: ProjectManagerWorkItemStatus,
    manualCompletionReason?: string,
  ) {
    const resolvedReason =
      manualCompletionReason?.trim() ||
      (legacySessions && nextStatus === "done" && item.evidenceRefCount === 0
        ? t("projects.tasksOwnerManualDoneReason")
        : undefined);
    statusMutation.mutate({
      workItemId: item.id,
      status: nextStatus,
      expectedRevision: item.revision,
      manualCompletionReason: resolvedReason,
    });
  }

  function handleQuickAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = quickTitle.trim();
    if (!trimmed || !canEdit || createMutation.isPending) return;
    createMutation.mutate(trimmed);
  }

  function openCopilotPlanner() {
    window.dispatchEvent(
      new CustomEvent("forgebadger:open-copilot", {
        detail: { projectId },
      }),
    );
  }

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredItems = useMemo(() => {
    return workItems.filter((item) => {
      if (statusFilter === "active" && (item.status === "done" || item.status === "cancelled")) {
        return false;
      }
      if (statusFilter !== "active" && statusFilter !== "all" && item.status !== statusFilter) {
        return false;
      }
      if (normalizedQuery) {
        const matchTitle = item.title.toLowerCase().includes(normalizedQuery);
        const matchDesc = item.description?.toLowerCase().includes(normalizedQuery) ?? false;
        if (!matchTitle && !matchDesc) return false;
      }
      return true;
    });
  }, [normalizedQuery, statusFilter, workItems]);

  const completedItems = useMemo(
    () =>
      workItems.filter((item) => {
        if (item.status !== "done" && item.status !== "cancelled") return false;
        if (!normalizedQuery) return true;
        return (
          item.title.toLowerCase().includes(normalizedQuery) ||
          (item.description?.toLowerCase().includes(normalizedQuery) ?? false)
        );
      }),
    [normalizedQuery, workItems],
  );

  const grouped = useMemo(() => {
    const attention: ProjectManagerWorkItem[] = [];
    const active: ProjectManagerWorkItem[] = [];
    const queued: ProjectManagerWorkItem[] = [];
    const done: ProjectManagerWorkItem[] = [];

    for (const item of filteredItems) {
      if (item.status === "ready_for_review" || item.status === "blocked") {
        attention.push(item);
      } else if (item.status === "in_progress") {
        active.push(item);
      } else if (item.status === "todo") {
        queued.push(item);
      } else {
        done.push(item);
      }
    }
    return { attention, active, queued, done };
  }, [filteredItems]);

  const selectedWorkItem = workItems.find((item) => item.id === selectedWorkItemId) ?? null;
  const selectedTaskPacket =
    taskPacketQuery.data?.taskPacket ??
    (selectedWorkItem ? (taskPacketByWorkItemId.get(selectedWorkItem.id) ?? null) : null);

  const firstError = goalQuery.error ?? workItemsQuery.error;
  const isLoading = goalQuery.isLoading || workItemsQuery.isLoading;
  const isRefreshing =
    goalQuery.isFetching ||
    workItemsQuery.isFetching ||
    (legacySessions && taskPacketsQuery.isFetching);

  const renderTaskRow = (item: ProjectManagerWorkItem) => {
    const packet = legacySessions ? (taskPacketByWorkItemId.get(item.id) ?? null) : null;
    const stageName = item.stageId ? (stageNameById.get(item.stageId) ?? null) : null;
    const goalLink = goalTaskLinksByWorkItemId.get(item.id) ?? null;
    const blockerCount = unresolvedBlockersByItemId.get(item.id) ?? 0;
    const assigneeEmail = item.assigneeId ? memberEmailById.get(item.assigneeId) : null;
    const canQuickDone =
      canEdit && legacySessions && PROJECT_MANAGER_STATUS_TRANSITIONS[item.status].includes("done");
    const canStartCli =
      legacySessions &&
      canEdit &&
      !packet?.sessionLink &&
      blockerCount === 0 &&
      (item.status === "todo" || item.status === "in_progress");

    return (
      <div
        key={item.id}
        data-testid={`project-manager-item-${item.id}`}
        aria-disabled={!canEdit ? true : undefined}
        className={cn(
          "flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between",
          item.id === requestedWorkItemId && "bg-brand/5",
        )}
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start gap-2.5">
            <span
              className={cn(
                "mt-1.5 size-2 shrink-0 rounded-full",
                statusDotClassName(item.status),
              )}
              aria-hidden="true"
            />
            <button
              type="button"
              onClick={() => setSelectedWorkItemId(item.id)}
              className="min-w-0 flex-1 break-words text-left text-sm font-medium leading-5 hover:text-brand hover:underline"
            >
              {item.title}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 pl-4.5">
            <Badge variant="outline" className="rounded-full text-[10px] font-normal">
              {statusLabel(item.status, t)}
            </Badge>
            {stageName && (
              <Badge variant="secondary" className="rounded-full text-[10px] font-normal">
                {stageName}
              </Badge>
            )}
            {goalLink && (
              <Link
                href={`/copilot/goals/${encodeURIComponent(goalLink.goalId)}`}
                className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-secondary/40 px-2 py-0.5 text-[10px] text-foreground hover:bg-secondary"
              >
                <Sparkles className="size-2.5 text-brand" />
                {t("projects.projectManagerViewCopilotGoal")}
              </Link>
            )}
            {blockerCount > 0 && (
              <Badge variant="destructive" className="rounded-full text-[10px] font-normal">
                {t("projects.tasksBlockedByCount").replace("{count}", String(blockerCount))}
              </Badge>
            )}
            {item.evidenceRefCount > 0 && (
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {t("projects.projectManagerEvidenceRefs")}: {item.evidenceRefCount}
              </span>
            )}
            {assigneeEmail && (
              <span className="truncate text-[11px] text-muted-foreground">
                {assigneeEmail}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5 pl-4.5 sm:pl-0">
          {packet?.sessionLink && (
            <Button asChild size="sm" variant="outline" className="h-7 px-2.5 text-xs">
              <Link href={packet.sessionLink.href}>
                <ExternalLink className="size-3" />
                {t("projects.projectManagerOpenSession")}
              </Link>
            </Button>
          )}
          {canStartCli && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-xs"
              disabled={startSessionMutation.isPending}
              onClick={() => {
                setQuickStartError(null);
                setQuickStartItem(item);
              }}
            >
              <Play className="size-3" />
              {t("projects.tasksStartCli")}
            </Button>
          )}
          {canQuickDone && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-600 dark:text-emerald-400"
              disabled={statusMutation.isPending}
              onClick={() => changeWorkItemStatus(item, "done")}
            >
              <CheckCircle2 className="size-3.5" />
              {t("projects.tasksMarkDone")}
            </Button>
          )}
        </div>
      </div>
    );
  };

  const renderGroup = (title: string, items: ProjectManagerWorkItem[], accentClass?: string) => {
    if (items.length === 0) return null;
    return (
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
        <div className="flex items-center justify-between border-b border-border/70 bg-muted/25 px-4 py-2">
          <span className={cn("text-xs font-semibold", accentClass ?? "text-foreground")}>
            {title}
          </span>
          <span className="rounded-full bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">
            {items.length}
          </span>
        </div>
        <div className="divide-y divide-border/70">{items.map(renderTaskRow)}</div>
      </div>
    );
  };

  return (
    <div className="space-y-4" data-testid="project-manager-panel">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <h2 className={embedded ? "sr-only" : "text-sm font-semibold"}>
            {t("projects.devTasks")}
          </h2>
          <p className="text-xs text-muted-foreground">{t("projects.tasksCopilotHint")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {activeProjectGoal && (
            <Button asChild size="sm" variant="secondary">
              <Link href={`/copilot/goals/${encodeURIComponent(activeProjectGoal.id)}`}>
                <Sparkles className="size-3.5 text-brand" />
                {t("projects.activeGoalBadge")
                  .replace("{passes}", String(activeProjectGoal.taskPasses))
                  .replace("{total}", String(activeProjectGoal.taskTotal))}
              </Link>
            </Button>
          )}
          {legacySessions && (
            <Button type="button" size="sm" variant="brand" onClick={openCopilotPlanner}>
              <Sparkles className="size-3.5" />
              {t("projects.tasksAskCopilotPlan")}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void invalidateAll()}
            disabled={isRefreshing || !canLoad}
            aria-label={t("projects.devTasksRefresh")}
          >
            <RefreshCw className={cn("size-3.5", isRefreshing && "animate-spin")} />
            {t("projects.devTasksRefresh")}
          </Button>
        </div>
      </div>

      {firstError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <AlertTriangle className="size-6 text-destructive" />
            <p className="text-sm text-muted-foreground">
              {firstError instanceof GatewayApiError && firstError.status === 404
                ? t("projects.projectManagerNotFound")
                : t("projects.projectManagerLoadFailed")}
            </p>
            <Button size="sm" variant="outline" onClick={() => void invalidateAll()}>
              {t("projects.devTasksRefresh")}
            </Button>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t("projects.projectManagerLoading")}
          </CardContent>
        </Card>
      ) : (
        <>
          {hasConflict && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm">
              <span>{t("projects.projectManagerConflictBanner")}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setHasConflict(false);
                  void invalidateAll();
                }}
              >
                {t("projects.projectManagerConflictRefresh")}
              </Button>
            </div>
          )}

          {statusError && (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {statusError}
            </p>
          )}

          {/* Read-only Copilot Goal Plan Strip */}
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border/80 bg-card px-4 py-3">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Target className="size-3.5 text-brand" />
                <span>{t("projects.projectManagerGoal")}</span>
                {goal?.status && (
                  <Badge variant="outline" className="rounded-full text-[10px] font-normal">
                    {statusLabel(goal.status, t)}
                  </Badge>
                )}
              </div>
              {goal?.summary ? (
                <p className="text-sm leading-relaxed text-foreground">{goal.summary}</p>
              ) : (
                <p className="text-xs text-muted-foreground">{t("projects.tasksNoGoalYet")}</p>
              )}
              {goal && (goal.constraints.length > 0 || goal.acceptanceCriteria.length > 0) && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {goal.constraints.length > 0 && (
                    <Badge variant="secondary" className="rounded-full text-[10px] font-normal">
                      {t("projects.projectManagerConstraints")}: {goal.constraints.length}
                    </Badge>
                  )}
                  {goal.acceptanceCriteria.length > 0 && (
                    <Badge variant="secondary" className="rounded-full text-[10px] font-normal">
                      {t("projects.projectManagerAcceptanceCriteria")}:{" "}
                      {goal.acceptanceCriteria.length}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Minimal 1-line Quick-Add + Search & Status Filter */}
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
            {canEdit && (
              <form
                onSubmit={handleQuickAdd}
                className="flex min-w-0 flex-1 items-center gap-2"
              >
                <Input
                  value={quickTitle}
                  onChange={(event) => setQuickTitle(event.target.value)}
                  placeholder={t("projects.tasksQuickAddPlaceholder")}
                  disabled={createMutation.isPending}
                  className="h-9 flex-1 text-sm"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  disabled={!quickTitle.trim() || createMutation.isPending}
                >
                  <Plus className="size-4" />
                  {t("projects.tasksQuickAddAction")}
                </Button>
              </form>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-48">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={t("projects.projectManagerSearchPlaceholder")}
                  className="h-9 pl-8 text-xs"
                />
              </div>

              <div className="flex flex-wrap items-center gap-1 rounded-md border border-border/70 bg-muted/20 p-1">
                {(
                  [
                    ["active", t("projects.tasksFilterActive")],
                    ["all", t("projects.filterAll")],
                    ["ready_for_review", statusLabel("ready_for_review", t)],
                    ["blocked", statusLabel("blocked", t)],
                    ["in_progress", statusLabel("in_progress", t)],
                    ["todo", statusLabel("todo", t)],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setStatusFilter(value)}
                    className={cn(
                      "rounded px-2 py-1 text-xs transition-colors",
                      statusFilter === value
                        ? "bg-card font-medium text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Status-Grouped Supervision List */}
          {workItems.length === 0 ? (
            <Card>
              <CardContent className="py-4">
                <EmptyState
                  title={t("projects.projectManagerNoWorkItemsTitle")}
                  body={t("projects.tasksNoGoalYet")}
                  icon={ClipboardList}
                />
              </CardContent>
            </Card>
          ) : filteredItems.length === 0 &&
            (statusFilter !== "active" || completedItems.length === 0) ? (
            <Card>
              <CardContent className="py-4">
                <EmptyState
                  title={t("projects.projectManagerFilterEmptyTitle")}
                  body={t("projects.projectManagerFilterEmptyBody")}
                  icon={ClipboardList}
                />
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3" data-testid="project-manager-task-list">
              {renderGroup(
                t("projects.tasksGroupAttention"),
                grouped.attention,
                "text-amber-600 dark:text-amber-400",
              )}
              {renderGroup(t("projects.tasksGroupActive"), grouped.active, "text-brand")}
              {renderGroup(t("projects.tasksGroupQueued"), grouped.queued)}
              {statusFilter !== "active" &&
                renderGroup(
                  t("projects.tasksGroupCompleted"),
                  grouped.done,
                  "text-muted-foreground",
                )}

              {statusFilter === "active" && completedItems.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-border/70 bg-card/60">
                  <button
                    type="button"
                    onClick={() => setShowCompleted((prev) => !prev)}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-xs font-medium text-muted-foreground hover:bg-muted/30 hover:text-foreground"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {showCompleted ? (
                        <ChevronDown className="size-3.5" />
                      ) : (
                        <ChevronRight className="size-3.5" />
                      )}
                      {t("projects.tasksGroupCompleted")} ({completedItems.length})
                    </span>
                  </button>
                  {showCompleted && (
                    <div className="divide-y divide-border/70 border-t border-border/70">
                      {completedItems.map(renderTaskRow)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <ProjectManagerWorkItemDetailSheet
        goalLink={
          selectedWorkItem ? (goalTaskLinksByWorkItemId.get(selectedWorkItem.id) ?? null) : null
        }
        isTaskPacketLoading={taskPacketQuery.isLoading}
        isTaskPacketStarting={startSessionMutation.isPending}
        item={selectedWorkItem}
        ledgerEvents={ledgerEvents}
        links={links}
        onDelete={(item) => setDeletingItem(item)}
        onNavigateToSession={onNavigateToSession}
        onOpenFile={onOpenFile}
        onOpenChange={(open) => {
          if (!open) setSelectedWorkItemId(null);
        }}
        onSelectWorkItem={(workItemId) => setSelectedWorkItemId(workItemId)}
        onStatusChange={(item, nextStatus, manualCompletionReason) =>
          changeWorkItemStatus(item, nextStatus, manualCompletionReason)
        }
        onTaskPacketStart={() => {
          if (!selectedWorkItem) return;
          setTaskPacketStartError(null);
          setQuickStartItem(selectedWorkItem);
        }}
        open={Boolean(selectedWorkItem)}
        projectId={projectId}
        stages={stages}
        statusMutationPending={!canEdit || statusMutation.isPending}
        t={t}
        taskPacket={selectedTaskPacket}
        taskPacketError={taskPacketQuery.error}
        taskPacketStartError={taskPacketStartError}
        workItems={workItems}
      />

      <QuickStartSessionDialog
        error={quickStartError}
        isStarting={startSessionMutation.isPending}
        item={quickStartItem}
        onConfirm={(aiTool) => {
          if (!quickStartItem) return;
          startSessionMutation.mutate({ workItemId: quickStartItem.id, aiTool });
        }}
        onOpenChange={(open) => {
          if (!open) {
            setQuickStartItem(null);
            setQuickStartError(null);
          }
        }}
        t={t}
        taskPacket={
          quickStartItem ? (taskPacketByWorkItemId.get(quickStartItem.id) ?? null) : null
        }
      />

      <ConfirmDialog
        open={deletingItem !== null}
        destructive
        pending={deleteMutation.isPending}
        title={t("projects.projectManagerDeleteWorkItem")}
        description={
          deletingItem
            ? `${t("projects.projectManagerDeleteWorkItemBody")} (${deletingItem.title})`
            : ""
        }
        confirmLabel={t("common.delete")}
        onOpenChange={(open) => {
          if (!open) setDeletingItem(null);
        }}
        onConfirm={() => {
          if (deletingItem) deleteMutation.mutate(deletingItem);
        }}
      />
    </div>
  );
}
