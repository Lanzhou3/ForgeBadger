"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ExternalLink,
  FileText,
  Play,
  Sparkles,
  Terminal,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { TaskAssignments } from "./TaskAssignments";
import { useTaskAuthority } from "./TaskAuthority";
import { TaskExecutionPanel } from "@/components/workspaces/TaskExecutionPanel";
import {
  executeProjectManagerTaskPacket,
  updateProjectManagerWorkItem,
  type ProjectManagerLedgerEvent,
  type ProjectManagerStage,
  type ProjectManagerTaskPacket,
  type ProjectManagerWorkItem,
  type ProjectManagerWorkItemLink,
  type ProjectManagerWorkItemStatus,
} from "@/lib/api";
import {
  taskPacketBlockedReasonKey,
  taskPacketCanStart,
} from "@/components/projects/project-manager-task-packet";
import { toast } from "@/lib/toast";
import { PROJECT_MANAGER_STATUS_TRANSITIONS, type Translate } from "./types";
import {
  formatEvidenceRef,
  formatTimestamp,
  projectManagerMutationMessage,
  statusBadgeClassName,
  statusBadgeVariant,
  statusLabel,
  workItemTraceMarkers,
} from "./utils";
import { LedgerDatum } from "./shared";

interface ProjectManagerWorkItemDetailSheetProps {
  goalLink?: { goalId: string; goalTitle: string; taskStatus: string } | null;
  isTaskPacketLoading: boolean;
  isTaskPacketStarting: boolean;
  item: ProjectManagerWorkItem | null;
  ledgerEvents: ProjectManagerLedgerEvent[];
  links: ProjectManagerWorkItemLink[];
  onDelete: (item: ProjectManagerWorkItem) => void;
  onNavigateToSession?: (href: string) => void;
  onOpenFile?: (path: string) => void;
  onOpenChange: (open: boolean) => void;
  onSelectWorkItem?: (workItemId: string) => void;
  onStatusChange: (
    item: ProjectManagerWorkItem,
    nextStatus: ProjectManagerWorkItemStatus,
    manualCompletionReason?: string,
  ) => void;
  onTaskPacketStart: () => void;
  open: boolean;
  projectId: string;
  stages: ProjectManagerStage[];
  statusMutationPending: boolean;
  t: Translate;
  taskPacket: ProjectManagerTaskPacket | null;
  taskPacketError: unknown;
  taskPacketStartError: string | null;
  workItems: ProjectManagerWorkItem[];
}

/**
 * Lightweight, Copilot-first supervision sheet for a single work item.
 * Keeps read-only context, Copilot/CLI execution handoff, evidence links,
 * and minimal owner sign-off actions without heavy manual Jira forms.
 */
export function ProjectManagerWorkItemDetailSheet({
  goalLink = null,
  isTaskPacketLoading,
  isTaskPacketStarting,
  item,
  ledgerEvents,
  links,
  onDelete,
  onNavigateToSession,
  onOpenFile,
  onOpenChange,
  onSelectWorkItem,
  onStatusChange,
  onTaskPacketStart,
  open,
  projectId,
  stages,
  statusMutationPending,
  t,
  taskPacket,
  taskPacketError,
  taskPacketStartError,
  workItems,
}: ProjectManagerWorkItemDetailSheetProps) {
  const { canEdit, legacySessions, collaboration, actorId } = useTaskAuthority();
  const queryClient = useQueryClient();

  const [doneConfirmOpen, setDoneConfirmOpen] = useState(false);
  const [doneReason, setDoneReason] = useState("");
  const [assigneeDraft, setAssigneeDraft] = useState<{
    assigneeId: string | null;
    reviewerId: string | null;
    capturedRevision?: number;
  }>({ assigneeId: null, reviewerId: null });
  const [assignmentError, setAssignmentError] = useState<string | null>(null);

  useEffect(() => {
    setDoneConfirmOpen(false);
    setDoneReason("");
    setAssignmentError(null);
    if (item) {
      setAssigneeDraft({
        assigneeId: item.assigneeId ?? null,
        reviewerId: item.reviewerId ?? null,
        capturedRevision: item.revision,
      });
    }
  }, [item?.id, open]);

  const assignmentMutation = useMutation({
    mutationFn: () => {
      if (!item) throw new Error("Missing work item");
      return updateProjectManagerWorkItem(projectId, item.id, {
        expectedRevision: assigneeDraft.capturedRevision,
        title: item.title,
        description: item.description ?? null,
        priority: item.priority,
        acceptanceCriteria: item.acceptanceCriteria,
        assigneeId: assigneeDraft.assigneeId,
        reviewerId: assigneeDraft.reviewerId,
      });
    },
    onSuccess: async (res) => {
      setAssignmentError(null);
      if (typeof res.workItem.revision === "number") {
        setAssigneeDraft((prev) => ({
          ...prev,
          capturedRevision: res.workItem.revision,
        }));
      }
      toast.success(t("projects.tasksAssignmentsSaved"));
      await queryClient.invalidateQueries({
        queryKey: ["project-manager", projectId, "work-items"],
      });
    },
    onError: (error) => {
      setAssignmentError(
        projectManagerMutationMessage(error, t("projects.projectManagerUpdateWorkItemError"), t),
      );
    },
  });

  const stageName = item?.stageId
    ? (stages.find((stage) => stage.id === item.stageId)?.name ?? null)
    : null;
  const traceMarkers = item ? workItemTraceMarkers(item, ledgerEvents) : [];

  const blockers = item
    ? links
        .filter((link) => link.blockedWorkItemId === item.id)
        .map((link) => workItems.find((candidate) => candidate.id === link.blockerWorkItemId))
        .filter((candidate): candidate is ProjectManagerWorkItem => Boolean(candidate))
    : [];
  const blocking = item
    ? links
        .filter((link) => link.blockerWorkItemId === item.id)
        .map((link) => workItems.find((candidate) => candidate.id === link.blockedWorkItemId))
        .filter((candidate): candidate is ProjectManagerWorkItem => Boolean(candidate))
    : [];

  const sharedCollaboration = !legacySessions ? collaboration : undefined;
  const validTransitions = item ? PROJECT_MANAGER_STATUS_TRANSITIONS[item.status] : [];
  const assignmentsDirty =
    Boolean(item && sharedCollaboration) &&
    (assigneeDraft.assigneeId !== (item?.assigneeId ?? null) ||
      assigneeDraft.reviewerId !== (item?.reviewerId ?? null));

  function handleStatusClick(nextStatus: ProjectManagerWorkItemStatus) {
    if (!item || !canEdit || statusMutationPending) return;
    if (nextStatus === "done" && !legacySessions) {
      setDoneConfirmOpen(true);
      return;
    }
    onStatusChange(item, nextStatus);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2 pr-6">
            <SheetTitle>{item?.title ?? t("projects.projectManagerViewDetails")}</SheetTitle>
            {stageName && (
              <Badge variant="secondary" className="rounded-full text-[11px] font-normal">
                {stageName}
              </Badge>
            )}
            {goalLink && (
              <Link
                href={`/copilot/goals/${encodeURIComponent(goalLink.goalId)}`}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/60 px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-secondary"
              >
                <Sparkles className="size-3 text-brand" />
                {t("projects.projectManagerViewCopilotGoal")}
              </Link>
            )}
          </div>
          <SheetDescription>{t("projects.projectManagerWorkItemDetail")}</SheetDescription>
        </SheetHeader>

        {item && (
          <div className="space-y-4 px-4 pb-6">
            {/* Status & minimal owner sign-off actions */}
            <div className="space-y-2.5 rounded-lg border border-border/70 bg-muted/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={statusBadgeVariant(item.status)}
                    className={statusBadgeClassName(item.status)}
                  >
                    {statusLabel(item.status, t)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatTimestamp(item.updatedAt)}
                  </span>
                </div>

                {canEdit && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {validTransitions.includes("done") && (
                      <Button
                        type="button"
                        size="sm"
                        variant="brand"
                        disabled={statusMutationPending}
                        onClick={() => handleStatusClick("done")}
                      >
                        <CheckCircle2 className="size-3.5" />
                        {t("projects.tasksMarkDone")}
                      </Button>
                    )}
                    {validTransitions.includes("in_progress") && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={statusMutationPending}
                        onClick={() => handleStatusClick("in_progress")}
                      >
                        {item.status === "ready_for_review" || item.status === "blocked"
                          ? t("projects.tasksReopen")
                          : statusLabel("in_progress", t)}
                      </Button>
                    )}
                    {validTransitions.includes("blocked") && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={statusMutationPending}
                        onClick={() => handleStatusClick("blocked")}
                      >
                        {statusLabel("blocked", t)}
                      </Button>
                    )}
                    {validTransitions.includes("cancelled") && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground"
                        disabled={statusMutationPending}
                        onClick={() => handleStatusClick("cancelled")}
                      >
                        {statusLabel("cancelled", t)}
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-8 text-muted-foreground hover:text-destructive"
                      aria-label={t("projects.projectManagerDeleteWorkItem")}
                      title={t("projects.projectManagerDeleteWorkItem")}
                      disabled={statusMutationPending}
                      onClick={() => onDelete(item)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )}
              </div>

              {doneConfirmOpen && !legacySessions && (
                <form
                  className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2.5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const note = doneReason.trim();
                    if (!note) return;
                    onStatusChange(item, "done", note);
                    setDoneConfirmOpen(false);
                    setDoneReason("");
                  }}
                >
                  <Input
                    value={doneReason}
                    onChange={(event) => setDoneReason(event.target.value)}
                    placeholder={t("projects.tasksDoneNotePlaceholder")}
                    className="h-8 min-w-[200px] flex-1 text-xs"
                    autoFocus
                  />
                  <Button
                    type="submit"
                    size="sm"
                    variant="brand"
                    disabled={!doneReason.trim() || statusMutationPending}
                  >
                    {t("common.confirm")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setDoneConfirmOpen(false)}
                  >
                    {t("common.cancel")}
                  </Button>
                </form>
              )}
            </div>

            {/* Description & Acceptance Criteria (read-only) */}
            {item.description && (
              <DetailSection label={t("projects.projectManagerWorkItemDescription")}>
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {item.description}
                </p>
              </DetailSection>
            )}

            {item.acceptanceCriteria.length > 0 && (
              <DetailSection label={t("projects.projectManagerAcceptanceCriteria")}>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {item.acceptanceCriteria.map((criterion) => (
                    <li key={criterion} className="break-words">
                      {criterion}
                    </li>
                  ))}
                </ul>
              </DetailSection>
            )}

            {/* Read-only Dependencies (maintained by Copilot) */}
            {(blockers.length > 0 || blocking.length > 0) && (
              <DetailSection label={t("projects.projectManagerDependencies")}>
                <div className="space-y-2 text-xs">
                  {blockers.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-muted-foreground">
                        {t("projects.projectManagerDependencyBlockedBy")}:
                      </span>
                      {blockers.map((blocker) => (
                        <button
                          key={blocker.id}
                          type="button"
                          onClick={() => onSelectWorkItem?.(blocker.id)}
                          className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-2 py-0.5 hover:border-primary/40"
                        >
                          <span className="max-w-[200px] truncate">{blocker.title}</span>
                          <span className="text-[10px] text-muted-foreground">
                            ({statusLabel(blocker.status, t)})
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {blocking.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-muted-foreground">
                        {t("projects.projectManagerDependencyBlocking")}:
                      </span>
                      {blocking.map((target) => (
                        <button
                          key={target.id}
                          type="button"
                          onClick={() => onSelectWorkItem?.(target.id)}
                          className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-2 py-0.5 hover:border-primary/40"
                        >
                          <span className="max-w-[200px] truncate">{target.title}</span>
                          <span className="text-[10px] text-muted-foreground">
                            ({statusLabel(target.status, t)})
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </DetailSection>
            )}

            {/* Shared project inline assignments */}
            {sharedCollaboration && sharedCollaboration.members.length > 0 && (
              <div className="space-y-2.5 rounded-md border border-border/70 p-3">
                <TaskAssignments
                  assigneeId={assigneeDraft.assigneeId}
                  reviewerId={assigneeDraft.reviewerId}
                  disabled={!canEdit || assignmentMutation.isPending}
                  onChange={(patch) =>
                    setAssigneeDraft((prev) => ({
                      ...prev,
                      ...patch,
                    }))
                  }
                />
                {assignmentError && (
                  <p className="text-xs text-destructive">{assignmentError}</p>
                )}
                {canEdit && assignmentsDirty && (
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={assignmentMutation.isPending}
                      onClick={() => assignmentMutation.mutate()}
                    >
                      {assignmentMutation.isPending
                        ? t("common.saving")
                        : t("projects.tasksSaveAssignments")}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Copilot & CLI Execution */}
            {legacySessions && (
              <TaskExecutionCard
                projectId={projectId}
                workItemId={item.id}
                error={taskPacketError}
                isLoading={isTaskPacketLoading}
                isStarting={isTaskPacketStarting}
                startError={taskPacketStartError}
                taskPacket={taskPacket}
                onStart={onTaskPacketStart}
                onNavigateToSession={onNavigateToSession}
                t={t}
              />
            )}

            {sharedCollaboration && (
              <TaskExecutionPanel
                key={`execution:${actorId}:${projectId}:${item.id}`}
                detail={sharedCollaboration}
                taskId={item.id}
                actorId={actorId}
              />
            )}

            {/* Read-only Evidence & Copilot Trace */}
            <DetailSection label={t("projects.projectManagerEvidenceRefs")}>
              {item.evidenceRefs.length > 0 ? (
                <ul className="space-y-1.5">
                  {item.evidenceRefs.map((ref, index) => (
                    <li
                      key={`${ref.ref ?? ref.path ?? index}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 bg-background/60 px-3 py-2 text-xs"
                    >
                      <span className="min-w-0 flex-1 break-all">
                        {formatEvidenceRef(ref)}
                      </span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {ref.path && onOpenFile && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-[11px]"
                            onClick={() => {
                              onOpenChange(false);
                              onOpenFile(ref.path!);
                            }}
                          >
                            <FileText className="size-3" />
                            {t("projects.overviewOpenInFiles")}
                          </Button>
                        )}
                        {ref.sessionId && (
                          <Button asChild size="sm" variant="ghost" className="h-6 px-2 text-[11px]">
                            <Link href={`/sessions/${encodeURIComponent(ref.sessionId)}`}>
                              <Terminal className="size-3" />
                              {t("projects.projectManagerOpenSession")}
                            </Link>
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t("projects.tasksEvidenceReadonlyEmpty")}
                </p>
              )}
            </DetailSection>

            {traceMarkers.length > 0 && (
              <DetailSection label={t("projects.projectManagerLedger")}>
                <div className="grid gap-2 sm:grid-cols-2">
                  {traceMarkers.map((marker) => (
                    <LedgerDatum
                      key={`${marker.labelKey}-${marker.value}`}
                      label={t(marker.labelKey)}
                      value={marker.value}
                    />
                  ))}
                </div>
              </DetailSection>
            )}

            {item.manualCompletion && (
              <div className="space-y-1 rounded-md border border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">{t("task.manualDone")}</p>
                <p>{item.manualCompletion.reason}</p>
                <p>
                  {item.manualCompletion.actorId} ·{" "}
                  {formatTimestamp(item.manualCompletion.createdAt)}
                </p>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DetailSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function TaskExecutionCard({
  projectId,
  workItemId,
  error,
  isLoading,
  isStarting,
  startError,
  taskPacket,
  onStart,
  onNavigateToSession,
  t,
}: {
  projectId: string;
  workItemId: string;
  error: unknown;
  isLoading: boolean;
  isStarting: boolean;
  startError: string | null;
  taskPacket: ProjectManagerTaskPacket | null;
  onStart: () => void;
  onNavigateToSession?: (href: string) => void;
  t: Translate;
}) {
  const { canEdit } = useTaskAuthority();
  const queryClient = useQueryClient();
  const [executeError, setExecuteError] = useState<string | null>(null);

  const executeMutation = useMutation({
    mutationFn: () => executeProjectManagerTaskPacket(projectId, workItemId),
    onSuccess: async (res) => {
      setExecuteError(null);
      const outcome = res.receipt?.outcome;
      const result = res.receipt?.result;
      const resultError = result?.error;
      const dispatched =
        outcome === "confirmed" && !resultError && result?.executionStatus === "dispatched";
      if (!dispatched) {
        const details = [resultError, result?.nextAction].filter(Boolean).join(" — ");
        setExecuteError(details || t("projects.projectManagerTaskPacketStartError"));
      } else {
        toast.success(t("projects.projectManagerExecuteSuccess"));
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "task-packets"] }),
        queryClient.invalidateQueries({
          queryKey: ["project-manager", projectId, "work-item", workItemId, "task-packet"],
        }),
        queryClient.invalidateQueries({ queryKey: ["sessions", { projectId }] }),
      ]);
      const sid = result?.session?.id ?? result?.sessionId;
      if (dispatched && sid && onNavigateToSession) {
        onNavigateToSession(`/sessions/${encodeURIComponent(sid)}`);
      }
    },
    onError: (err) => {
      setExecuteError(
        projectManagerMutationMessage(err, t("projects.projectManagerTaskPacketStartError"), t),
      );
    },
  });

  const canStartTask = taskPacketCanStart(taskPacket, isStarting);
  const canExecuteAutonomous = Boolean(
    canEdit &&
      taskPacket &&
      !taskPacket.blockedReason &&
      (taskPacket.workItemStatus === "todo" || taskPacket.workItemStatus === "in_progress") &&
      !executeMutation.isPending,
  );
  const blockedKey = taskPacket ? taskPacketBlockedReasonKey(taskPacket.blockedReason) : null;

  return (
    <div
      className="space-y-3 rounded-lg border border-border/70 bg-card p-3"
      data-testid="project-manager-task-packet"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          <Terminal className="size-3.5 text-brand" />
          {t("projects.projectManagerTaskPacket")}
        </span>
        {taskPacket?.runtime.adapter && (
          <Badge variant="outline" className="rounded-full font-mono text-[10px]">
            {taskPacket.runtime.adapter}
          </Badge>
        )}
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
      ) : error ? (
        <p className="text-xs text-destructive">
          {projectManagerMutationMessage(error, t("projects.projectManagerTaskPacketLoadError"), t)}
        </p>
      ) : !taskPacket ? (
        <p className="text-xs text-muted-foreground">-</p>
      ) : (
        <>
          {blockedKey && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-600 dark:text-amber-300">
              {t(blockedKey)}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {taskPacket.sessionLink ? (
              <Button
                type="button"
                size="sm"
                variant="brand"
                onClick={() => {
                  if (onNavigateToSession) {
                    onNavigateToSession(taskPacket.sessionLink!.href);
                  } else {
                    window.location.assign(taskPacket.sessionLink!.href);
                  }
                }}
              >
                <ExternalLink className="size-3.5" />
                {t("projects.projectManagerOpenSession")}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="brand"
                disabled={!canEdit || !canStartTask}
                onClick={onStart}
              >
                <Play className="size-3.5" />
                {isStarting
                  ? t("projects.projectManagerTaskPacketStarting")
                  : t("projects.tasksStartCli")}
              </Button>
            )}

            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canExecuteAutonomous}
              onClick={() => {
                setExecuteError(null);
                executeMutation.mutate();
              }}
            >
              <Sparkles className="size-3.5" />
              {executeMutation.isPending
                ? t("projects.projectManagerExecuting")
                : t("projects.projectManagerExecuteAutonomous")}
            </Button>

            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent("forgebadger:open-copilot", {
                    detail: { projectId },
                  }),
                );
              }}
            >
              <Sparkles className="size-3.5 text-brand" />
              {t("projects.overviewAskCopilot")}
            </Button>
          </div>

          {(startError || executeError) && (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {executeError ?? startError}
            </p>
          )}

          {taskPacket.prompt && (
            <details className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs">
              <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
                {t("projects.tasksPromptPreview")}
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-foreground/90">
                {taskPacket.prompt}
              </pre>
            </details>
          )}
        </>
      )}
    </div>
  );
}
