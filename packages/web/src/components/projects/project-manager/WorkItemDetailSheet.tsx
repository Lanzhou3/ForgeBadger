"use client";
import { hasCapability } from "@/lib/collaboration-api";
import { TaskCopilotArtifacts } from "./TaskCopilotArtifacts";
import { TaskExecutionPanel } from "@/components/workspaces/TaskExecutionPanel";
import { useTaskAuthority } from "./TaskAuthority";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, ExternalLink, Play, Plus, Sparkles, Terminal, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  addProjectManagerWorkItemDependency,
  executeProjectManagerTaskPacket,
  getProjectGitChanges,
  removeProjectManagerWorkItemDependency,
  type ProjectManagerLedgerEvent,
  type ProjectManagerStage,
  type ProjectManagerTaskPacket,
  type ProjectManagerWorkItem,
  type ProjectManagerWorkItemLink,
  type ProjectManagerWorkItemStatus,
  type Session,
} from "@/lib/api";
import { toast } from "@/lib/toast";
import {
  taskPacketCanStart,
  taskPacketBlockedReasonKey,
  taskPacketSessionOptionLabel,
} from "../project-manager-task-packet";
import { EVIDENCE_REFERENCE_TYPE_OPTIONS, type EvidenceDraft, type Translate } from "./types";
import {
  applyEvidenceReferenceType,
  formatEvidenceRef,
  formatTimestamp,
  projectManagerMutationMessage,
  readEvidenceReferenceType,
  statusBadgeVariant,
  statusLabel,
  workItemTraceMarkers,
} from "./utils";
import { LedgerDatum, SummaryMetric } from "./shared";
import { ProjectManagerStageSelect } from "./PipelineBoard";
import { ProjectManagerStatusActions } from "./WorkItemsSection";

type DetailSheetTab = "overview" | "activity" | "copilot";

export function ProjectManagerWorkItemDetailSheet({
  evidenceDraft,
  evidenceError,
  goalLink = null,
  isEvidenceSaving,
  isTaskPacketLinking,
  isTaskPacketLoading,
  isTaskPacketStarting,
  item,
  ledgerEvents,
  links,
  onAttachEvidence,
  onEvidenceDraftChange,
  onNavigateToSession,
  onOpenChange,
  onStatusChange,
  onTaskPacketSessionChange,
  onTaskPacketSessionLink,
  onTaskPacketStart,
  open,
  projectId,
  stages,
  statusMutationPending,
  t,
  taskPacket,
  taskPacketError,
  taskPacketLinkError,
  taskPacketStartError,
  taskPacketSessionId,
  taskPacketSessions,
  workItems,
}: {
  evidenceDraft: EvidenceDraft;
  evidenceError: string | null;
  goalLink?: { goalId: string; goalTitle: string; taskStatus: string } | null;
  isEvidenceSaving: boolean;
  isTaskPacketLinking: boolean;
  isTaskPacketLoading: boolean;
  isTaskPacketStarting: boolean;
  item: ProjectManagerWorkItem | null;
  ledgerEvents: ProjectManagerLedgerEvent[];
  links: ProjectManagerWorkItemLink[];
  onAttachEvidence: () => void;
  onEvidenceDraftChange: (draft: EvidenceDraft) => void;
  onNavigateToSession?: (href: string) => void;
  onOpenChange: (open: boolean) => void;
  onStatusChange: (item: ProjectManagerWorkItem, nextStatus: ProjectManagerWorkItemStatus) => void;
  onTaskPacketSessionChange: (sessionId: string) => void;
  onTaskPacketSessionLink: () => void;
  onTaskPacketStart: () => void;
  open: boolean;
  projectId: string;
  stages: ProjectManagerStage[];
  statusMutationPending: boolean;
  t: Translate;
  taskPacket: ProjectManagerTaskPacket | null;
  taskPacketError: unknown;
  taskPacketLinkError: string | null;
  taskPacketStartError: string | null;
  taskPacketSessionId: string;
  taskPacketSessions: Session[];
  workItems: ProjectManagerWorkItem[];
}) {
  const { canEdit, legacySessions, collaboration, actorId } = useTaskAuthority();
  const [detailTab, setDetailTab] = useState<DetailSheetTab>("overview");

  useEffect(() => {
    if (!open) {
      setDetailTab("overview");
    }
  }, [open]);

  const gitChangesQuery = useQuery({
    queryKey: ["project-git-changes", projectId],
    queryFn: () => getProjectGitChanges(projectId),
    enabled: open && Boolean(item) && Boolean(projectId) && detailTab === "activity",
    retry: false,
  });

  const traceMarkers = item ? workItemTraceMarkers(item, ledgerEvents) : [];
  const gitChangedEntries = gitChangesQuery.data?.changed ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2 pr-6">
            <SheetTitle>{item?.title ?? t("projects.projectManagerViewDetails")}</SheetTitle>
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
            <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
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

            <Tabs
              value={detailTab}
              onValueChange={(value) => setDetailTab(value as DetailSheetTab)}
            >
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="overview">
                  {t("projects.projectManagerDetailTabOverview")}
                </TabsTrigger>
                <TabsTrigger value="activity">
                  {t("projects.projectManagerDetailTabActivity")}
                  {item.evidenceRefCount > 0 && (
                    <span className="ml-1.5 rounded-full bg-background px-1.5 py-0.5 text-[10px] tabular-nums">
                      {item.evidenceRefCount}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="copilot">
                  {t("projects.projectManagerDetailTabCopilot")}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="mt-4 space-y-4">
                <DetailField label={t("projects.projectManagerWorkItemDescription")}>
                  {item.description ? (
                    <p className="whitespace-pre-wrap break-words">{item.description}</p>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </DetailField>
                <div className="grid gap-2 sm:grid-cols-2">
                  <SummaryMetric label={t("projects.projectManagerPriority")} value={item.priority} />
                  <SummaryMetric label={t("projects.projectManagerEvidenceRefs")} value={item.evidenceRefCount} />
                </div>
                {collaboration && (
                  <div className="grid gap-2 text-sm sm:grid-cols-2">
                    <p>{t("workspace.assignee")}: {collaboration.members.find((m) => m.userId === item.assigneeId)?.email ?? t("workspace.unassigned")}</p>
                    <p>{t("workspace.reviewAssignee")}: {collaboration.members.find((m) => m.userId === item.reviewerId)?.email ?? t("workspace.unassigned")}</p>
                  </div>
                )}
                <DetailField label={t("projects.projectManagerStageAssign")}>
                  <ProjectManagerStageSelect
                    item={item}
                    projectId={projectId}
                    stages={stages}
                    t={t}
                  />
                </DetailField>
                <ProjectManagerDependenciesSection
                  item={item}
                  links={links}
                  projectId={projectId}
                  t={t}
                  workItems={workItems}
                />
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
                {item.manualCompletion && (
                  <div className="space-y-1 rounded-md border border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground">
                    <p className="font-medium text-foreground">{t("task.manualDone")}</p>
                    <p>{item.manualCompletion.reason}</p>
                    <p>{item.manualCompletion.actorId} · {formatTimestamp(item.manualCompletion.createdAt)}</p>
                  </div>
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                  <DetailField label={t("projects.projectManagerCreated")}>
                    {formatTimestamp(item.createdAt)}
                  </DetailField>
                  <DetailField label={t("projects.projectManagerUpdated")}>
                    {formatTimestamp(item.updatedAt)}
                  </DetailField>
                </div>
              </TabsContent>

              <TabsContent value="activity" className="mt-4 space-y-4">
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
                  <DetailField label={t("projects.projectManagerLedger")}>
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

                <fieldset disabled={!canEdit} className="space-y-3 rounded-md border border-border/70 p-3">
                  <legend className="px-1 text-sm font-medium">{t("projects.projectManagerAttachEvidence")}</legend>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {t("projects.projectManagerEvidenceReferenceHint")}
                  </p>

                  {(gitChangedEntries.length > 0 || taskPacketSessions.length > 0) && (
                    <div className="flex flex-wrap gap-2">
                      {gitChangedEntries.length > 0 && (
                        <select
                          aria-label={t("projects.projectManagerEvidencePickGit")}
                          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                          value=""
                          onChange={(event) => {
                            const selectedFilePath = event.target.value;
                            if (!selectedFilePath) return;
                            onEvidenceDraftChange({
                              ...applyEvidenceReferenceType(evidenceDraft, "file_path", t),
                              kind: "file_change",
                              label: selectedFilePath,
                              ref: selectedFilePath,
                              path: selectedFilePath,
                            });
                          }}
                        >
                          <option value="">{t("projects.projectManagerEvidencePickGit")}</option>
                          {gitChangedEntries.slice(0, 50).map((entry) => (
                            <option key={entry.path} value={entry.path}>
                              {entry.path} ({entry.status.trim() || "M"})
                            </option>
                          ))}
                        </select>
                      )}
                      {taskPacketSessions.length > 0 && (
                        <select
                          aria-label={t("projects.projectManagerEvidencePickSession")}
                          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                          value=""
                          onChange={(event) => {
                            const chosenId = event.target.value;
                            if (!chosenId) return;
                            const chosen = taskPacketSessions.find((s) => s.id === chosenId);
                            onEvidenceDraftChange({
                              ...applyEvidenceReferenceType(evidenceDraft, "session", t),
                              kind: "session",
                              label: chosen?.name || chosenId,
                              ref: chosenId,
                              sessionId: chosenId,
                            });
                          }}
                        >
                          <option value="">{t("projects.projectManagerEvidencePickSession")}</option>
                          {taskPacketSessions.map((session) => (
                            <option key={session.id} value={session.id}>
                              {taskPacketSessionOptionLabel(session)}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="project-manager-evidence-type">{t("projects.projectManagerEvidenceReferenceType")}</Label>
                      <select
                        id="project-manager-evidence-type"
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
                        value={evidenceDraft.referenceType}
                        disabled={isEvidenceSaving}
                        onChange={(event) =>
                          onEvidenceDraftChange(applyEvidenceReferenceType(
                            evidenceDraft,
                            readEvidenceReferenceType(event.target.value),
                            t
                          ))
                        }
                      >
                        {EVIDENCE_REFERENCE_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {t(option.labelKey)}
                          </option>
                        ))}
                      </select>
                    </div>
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
                    <div className="space-y-2">
                      <Label htmlFor="project-manager-evidence-session-id">{t("projects.projectManagerEvidenceSessionId")}</Label>
                      <Input
                        id="project-manager-evidence-session-id"
                        value={evidenceDraft.sessionId}
                        aria-invalid={
                          !!evidenceError &&
                          (evidenceDraft.referenceType === "terminal_snapshot" || evidenceDraft.referenceType === "session") &&
                          evidenceDraft.sessionId.trim().length === 0
                        }
                        disabled={isEvidenceSaving}
                        onChange={(event) => onEvidenceDraftChange({ ...evidenceDraft, sessionId: event.target.value })}
                      />
                    </div>
                  </div>
                  {evidenceDraft.referenceType === "terminal_snapshot" && (
                    <p className="text-xs leading-5 text-muted-foreground">
                      {t("projects.projectManagerTerminalSnapshotMarkerHint")}
                    </p>
                  )}
                  {evidenceError && (
                    <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {evidenceError}
                    </p>
                  )}
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="brand"
                      onClick={onAttachEvidence}
                      disabled={isEvidenceSaving}
                    >
                      <Plus className="mr-2 size-4" />
                      {t("projects.projectManagerAttachEvidence")}
                    </Button>
                  </div>
                </fieldset>
              </TabsContent>

              <TabsContent value="copilot" className="mt-4 space-y-4">
                {collaboration && (
                  <TaskCopilotArtifacts
                    key={`artifact:${actorId}:${projectId}:${item.id}`}
                    actorId={actorId}
                    projectId={projectId}
                    taskId={item.id}
                    revision={item.revision}
                    canLink={hasCapability(collaboration.project, "develop")}
                  />
                )}
                {collaboration && (
                  <TaskExecutionPanel
                    key={`execution:${actorId}:${projectId}:${item.id}`}
                    detail={collaboration}
                    taskId={item.id}
                    actorId={actorId}
                  />
                )}
                {legacySessions && (
                  <ProjectManagerTaskPacketSection
                    projectId={projectId}
                    workItemId={item.id}
                    error={taskPacketError}
                    isLinking={isTaskPacketLinking}
                    isLoading={isTaskPacketLoading}
                    onNavigateToSession={onNavigateToSession}
                    onSessionChange={onTaskPacketSessionChange}
                    onSessionLink={onTaskPacketSessionLink}
                    onStart={onTaskPacketStart}
                    selectedSessionId={taskPacketSessionId}
                    sessions={taskPacketSessions}
                    t={t}
                    taskPacket={taskPacket}
                    linkError={taskPacketLinkError}
                    startError={taskPacketStartError}
                    isStarting={isTaskPacketStarting}
                  />
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ProjectManagerDependenciesSection({
  item,
  links,
  projectId,
  t,
  workItems,
}: {
  item: ProjectManagerWorkItem;
  links: ProjectManagerWorkItemLink[];
  projectId: string;
  t: Translate;
  workItems: ProjectManagerWorkItem[];
}) {
  const { canEdit: edit, canManage, legacySessions } = useTaskAuthority();
  const canEdit = canManage ?? edit;

  const queryClient = useQueryClient();
  const [selection, setSelection] = useState("");
  const [error, setError] = useState<string | null>(null);

  const blockedBy = links.filter((link) => link.blockedWorkItemId === item.id);
  const blocking = links.filter((link) => link.blockerWorkItemId === item.id);
  const candidates = workItems.filter(
    (workItem) => workItem.id !== item.id && !blockedBy.some((link) => link.blockerWorkItemId === workItem.id)
  );
  const titleFor = (workItemId: string) =>
    workItems.find((workItem) => workItem.id === workItemId)?.title ?? workItemId;

  const dependencyErrorMessage = (mutationError: unknown) =>
    projectManagerMutationMessage(mutationError, t("projects.projectManagerDependencyMutationError"));
  const addMutation = useMutation({
    mutationFn: (blockerWorkItemId: string) =>
      addProjectManagerWorkItemDependency(projectId, item.id, blockerWorkItemId, item.revision),
    onSuccess: async () => {
      setError(null);
      setSelection("");
      await queryClient.invalidateQueries({ queryKey: ["project-manager", projectId] });
    },
    onError: (mutationError) => setError(dependencyErrorMessage(mutationError)),
  });
  const removeMutation = useMutation({
    mutationFn: (blockerWorkItemId: string) =>
      removeProjectManagerWorkItemDependency(projectId, item.id, blockerWorkItemId, item.revision),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["project-manager", projectId] });
    },
    onError: (mutationError) => setError(dependencyErrorMessage(mutationError)),
  });
  const isPending = addMutation.isPending || removeMutation.isPending;

  return (
    <fieldset disabled={!canEdit} className="space-y-3 rounded-md border border-border/70 p-3">
      <legend className="px-1 text-sm font-medium">{t("projects.projectManagerDependencies")}</legend>
      {blockedBy.length === 0 && blocking.length === 0 && (
        <p className="text-xs text-muted-foreground">{t("projects.projectManagerDependencyNone")}</p>
      )}
      {blockedBy.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">
            {t("projects.projectManagerDependencyBlockedBy")}
          </div>
          <div className="flex flex-wrap gap-2">
            {blockedBy.map((link) => (
              <Badge key={link.id} variant="destructive" className="gap-1">
                {titleFor(link.blockerWorkItemId)}
                <button
                  type="button"
                  aria-label={t("common.delete")}
                  className="rounded-full hover:bg-destructive-foreground/20"
                  disabled={isPending}
                  onClick={() => removeMutation.mutate(link.blockerWorkItemId)}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        </div>
      )}
      {blocking.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">
            {t("projects.projectManagerDependencyBlocking")}
          </div>
          <div className="flex flex-wrap gap-2">
            {blocking.map((link) => (
              <Badge key={link.id} variant="secondary">
                {titleFor(link.blockedWorkItemId)}
              </Badge>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <select
          aria-label={t("projects.projectManagerDependencyAdd")}
          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
          value={selection}
          disabled={isPending || candidates.length === 0}
          onChange={(event) => setSelection(event.target.value)}
        >
          <option value="">{t("projects.projectManagerDependencyAddPlaceholder")}</option>
          {candidates.map((workItem) => (
            <option key={workItem.id} value={workItem.id}>
              {workItem.title}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="outline"
          disabled={isPending || !selection}
          onClick={() => selection && addMutation.mutate(selection)}
        >
          <Plus className="mr-2 size-4" />
          {t("projects.projectManagerDependencyAdd")}
        </Button>
      </div>
      {error && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}

function ProjectManagerTaskPacketSection({
  error,
  isLinking,
  isLoading,
  isStarting,
  linkError,
  onNavigateToSession,
  onSessionChange,
  onSessionLink,
  onStart,
  projectId,
  selectedSessionId,
  sessions,
  startError,
  t,
  taskPacket,
  workItemId,
}: {
  error: unknown;
  isLinking: boolean;
  isLoading: boolean;
  isStarting: boolean;
  linkError: string | null;
  onNavigateToSession?: (href: string) => void;
  onSessionChange: (sessionId: string) => void;
  onSessionLink: () => void;
  onStart: () => void;
  projectId: string;
  selectedSessionId: string;
  sessions: Session[];
  startError: string | null;
  t: Translate;
  taskPacket: ProjectManagerTaskPacket | null;
  workItemId: string;
}) {
  const { canEdit } = useTaskAuthority();
  const queryClient = useQueryClient();
  const [executeError, setExecuteError] = useState<string | null>(null);
  const selectedSessionAvailable = sessions.some((session) => session.id === selectedSessionId);
  const canLinkSession = selectedSessionId.length > 0 && selectedSessionAvailable && !isLinking;
  const canStartTask = taskPacketCanStart(taskPacket, isStarting);

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
        queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "work-item", workItemId, "task-packet"] }),
        queryClient.invalidateQueries({ queryKey: ["sessions", { projectId }] }),
      ]);
      const sid = result?.session?.id ?? result?.sessionId;
      if (dispatched && sid && onNavigateToSession) {
        onNavigateToSession(`/sessions/${encodeURIComponent(sid)}`);
      }
    },
    onError: (err) => {
      setExecuteError(projectManagerMutationMessage(err, t("projects.projectManagerTaskPacketStartError")));
    },
  });

  const canExecuteAutonomous = Boolean(
    canEdit &&
      taskPacket &&
      !taskPacket.blockedReason &&
      (taskPacket.workItemStatus === "todo" || taskPacket.workItemStatus === "in_progress") &&
      !executeMutation.isPending,
  );

  return (
    <fieldset disabled={!canEdit} className="space-y-3 rounded-md border border-border/70 p-3" data-testid="project-manager-task-packet">
      <legend className="flex items-center gap-2 px-1 text-sm font-medium">
        <ClipboardList className="size-4" />
        {t("projects.projectManagerTaskPacket")}
      </legend>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("projects.projectManagerLoading")}</p>
      ) : error ? (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {projectManagerMutationMessage(error, t("projects.projectManagerTaskPacketLoadError"))}
        </p>
      ) : taskPacket ? (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <LedgerDatum label={t("projects.projectManagerTaskPacketRuntimeAdapter")} value={taskPacket.runtime.adapter} />
            <LedgerDatum label={t("projects.projectManagerTaskPacketRuntimeTemplate")} value={taskPacket.runtime.templateId} />
            <LedgerDatum
              label={t("projects.projectManagerTaskPacketStatus")}
              value={t(taskPacketBlockedReasonKey(taskPacket.blockedReason))}
            />
            <LedgerDatum
              label={t("projects.projectManagerTaskPacketLinkedSession")}
              value={taskPacket.sessionLink?.sessionId ?? "-"}
            />
          </div>
          <DetailField label={t("projects.projectManagerTaskPacketPrompt")}>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border/70 bg-muted/20 p-3 text-xs leading-5">
              {taskPacket.prompt}
            </pre>
          </DetailField>
          <TaskPacketList
            emptyLabel="-"
            label={t("projects.projectManagerAcceptanceCriteria")}
            values={taskPacket.acceptanceCriteria}
          />
          <TaskPacketList
            emptyLabel="-"
            label={t("projects.projectManagerTaskPacketExpectedVerification")}
            values={taskPacket.expectedVerification}
          />
          <TaskPacketList
            emptyLabel="-"
            label={t("projects.projectManagerTaskPacketEvidenceRequirements")}
            values={taskPacket.evidenceRequirements}
          />
          <div className="flex flex-wrap items-center gap-2">
            {taskPacket.sessionLink && (
              <>
                <a
                  className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
                  href={taskPacket.sessionLink.href}
                >
                  <ExternalLink className="size-3.5" />
                  {t("projects.projectManagerTaskPacketOpenSession")}
                </a>
                {onNavigateToSession && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onNavigateToSession(taskPacket.sessionLink!.href)}
                  >
                    <Terminal className="size-3.5" />
                    {t("projects.projectManagerOpenSession")}
                  </Button>
                )}
              </>
            )}
            {!taskPacket.sessionLink && (
              <Button
                size="sm"
                variant="brand"
                className="w-fit"
                onClick={onStart}
                disabled={!canStartTask}
              >
                <Play className="size-3.5" />
                {isStarting
                  ? t("projects.projectManagerTaskPacketStarting")
                  : t("projects.projectManagerTaskPacketStart")}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="secondary"
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
          </div>
          {(startError || executeError) && (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {executeError ?? startError}
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
              value={selectedSessionId}
              disabled={isLinking || sessions.length === 0}
              onChange={(event) => onSessionChange(event.target.value)}
            >
              <option value="">
                {sessions.length > 0
                  ? t("projects.projectManagerTaskPacketSelectSession")
                  : t("projects.projectManagerTaskPacketNoSessions")}
              </option>
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {taskPacketSessionOptionLabel(session)}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="brand"
              onClick={onSessionLink}
              disabled={!canLinkSession}
            >
              {t("projects.projectManagerTaskPacketLinkSession")}
            </Button>
          </div>
          {linkError && (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {linkError}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("projects.projectManagerTaskPacketUnavailable")}</p>
      )}
    </fieldset>
  );
}

function TaskPacketList({
  emptyLabel,
  label,
  values,
}: {
  emptyLabel: string;
  label: string;
  values: string[];
}) {
  return (
    <DetailField label={label}>
      {values.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {values.map((value) => (
            <li key={value} className="break-words">{value}</li>
          ))}
        </ul>
      ) : (
        <span className="text-muted-foreground">{emptyLabel}</span>
      )}
    </DetailField>
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
