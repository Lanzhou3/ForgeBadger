"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BriefcaseBusiness, ClipboardList, History, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  updateProjectManagerGoal,
  type ProjectManagerLedgerEvent,
  type ProjectManagerLedgerEventType,
  type ProjectManagerGoal,
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

export function ProjectManagerPanel({ projectId, enabled }: ProjectManagerPanelProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const canLoad = enabled && projectId.length > 0;
  const [isGoalEditing, setIsGoalEditing] = useState(false);
  const [goalDraft, setGoalDraft] = useState<GoalDraft>(() => createGoalDraft(null));
  const [goalFormError, setGoalFormError] = useState<string | null>(null);

  const goalQuery = useQuery({
    queryKey: ["project-manager", projectId, "goal"],
    queryFn: () => getProjectManagerGoal(projectId),
    enabled: canLoad,
    retry: false,
  });

  const goal = goalQuery.data?.goal ?? null;

  const workItemsQuery = useQuery({
    queryKey: ["project-manager", projectId, "work-items", { limit: 5 }],
    queryFn: () => listProjectManagerWorkItems(projectId, { limit: 5 }),
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

  if (!enabled) {
    return null;
  }

  const firstError = goalQuery.error ?? workItemsQuery.error ?? ledgerQuery.error;
  const isNotFoundError = firstError instanceof GatewayApiError && firstError.status === 404;
  const isLoading = goalQuery.isLoading || workItemsQuery.isLoading || ledgerQuery.isLoading;
  const isRefreshing = goalQuery.isFetching || workItemsQuery.isFetching || ledgerQuery.isFetching;
  const workItems = workItemsQuery.data?.workItems ?? [];
  const ledgerEvents = ledgerQuery.data?.events ?? [];

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
          <ProjectManagerWorkItemsCard workItems={workItems} t={t} />
          <ProjectManagerLedgerCard events={ledgerEvents} t={t} />
        </div>
      )}
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
  workItems,
  t,
}: {
  workItems: ProjectManagerWorkItem[];
  t: Translate;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="size-4" />
          {t("projects.projectManagerWorkItems")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {workItems.length === 0 ? (
          <EmptyState
            title={t("projects.projectManagerNoWorkItemsTitle")}
            body={t("projects.projectManagerNoWorkItemsBody")}
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
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
