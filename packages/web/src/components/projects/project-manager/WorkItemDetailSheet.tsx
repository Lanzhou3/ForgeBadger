"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Plus, X } from "lucide-react";

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
import {
  addProjectManagerWorkItemDependency,
  removeProjectManagerWorkItemDependency,
  type ProjectManagerLedgerEvent,
  type ProjectManagerStage,
  type ProjectManagerTaskPacket,
  type ProjectManagerWorkItem,
  type ProjectManagerWorkItemLink,
  type ProjectManagerWorkItemStatus,
  type Session,
} from "@/lib/api";
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

export function ProjectManagerWorkItemDetailSheet({
  evidenceDraft,
  evidenceError,
  isEvidenceSaving,
  isTaskPacketLinking,
  isTaskPacketLoading,
  isTaskPacketStarting,
  item,
  ledgerEvents,
  links,
  onAttachEvidence,
  onEvidenceDraftChange,
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
  isEvidenceSaving: boolean;
  isTaskPacketLinking: boolean;
  isTaskPacketLoading: boolean;
  isTaskPacketStarting: boolean;
  item: ProjectManagerWorkItem | null;
  ledgerEvents: ProjectManagerLedgerEvent[];
  links: ProjectManagerWorkItemLink[];
  onAttachEvidence: () => void;
  onEvidenceDraftChange: (draft: EvidenceDraft) => void;
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
  const traceMarkers = item ? workItemTraceMarkers(item, ledgerEvents) : [];

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
            <ProjectManagerTaskPacketSection
              error={taskPacketError}
              isLinking={isTaskPacketLinking}
              isLoading={isTaskPacketLoading}
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
            <fieldset className="space-y-3 rounded-md border border-border/70 p-3">
              <legend className="px-1 text-sm font-medium">{t("projects.projectManagerAttachEvidence")}</legend>
              <p className="text-xs leading-5 text-muted-foreground">
                {t("projects.projectManagerEvidenceReferenceHint")}
              </p>
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
                  className="bg-brand text-brand-foreground hover:bg-brand/90"
                  onClick={onAttachEvidence}
                  disabled={isEvidenceSaving}
                >
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
      addProjectManagerWorkItemDependency(projectId, item.id, blockerWorkItemId),
    onSuccess: async () => {
      setError(null);
      setSelection("");
      await queryClient.invalidateQueries({ queryKey: ["project-manager", projectId] });
    },
    onError: (mutationError) => setError(dependencyErrorMessage(mutationError)),
  });
  const removeMutation = useMutation({
    mutationFn: (blockerWorkItemId: string) =>
      removeProjectManagerWorkItemDependency(projectId, item.id, blockerWorkItemId),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["project-manager", projectId] });
    },
    onError: (mutationError) => setError(dependencyErrorMessage(mutationError)),
  });
  const isPending = addMutation.isPending || removeMutation.isPending;

  return (
    <fieldset className="space-y-3 rounded-md border border-border/70 p-3">
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
  onSessionChange,
  onSessionLink,
  onStart,
  selectedSessionId,
  sessions,
  startError,
  t,
  taskPacket,
}: {
  error: unknown;
  isLinking: boolean;
  isLoading: boolean;
  isStarting: boolean;
  linkError: string | null;
  onSessionChange: (sessionId: string) => void;
  onSessionLink: () => void;
  onStart: () => void;
  selectedSessionId: string;
  sessions: Session[];
  startError: string | null;
  t: Translate;
  taskPacket: ProjectManagerTaskPacket | null;
}) {
  const selectedSessionAvailable = sessions.some((session) => session.id === selectedSessionId);
  const canLinkSession = selectedSessionId.length > 0 && selectedSessionAvailable && !isLinking;
  const canStartTask = taskPacketCanStart(taskPacket, isStarting);

  return (
    <fieldset className="space-y-3 rounded-md border border-border/70 p-3" data-testid="project-manager-task-packet">
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
          {taskPacket.sessionLink && (
            <a
              className="inline-flex text-xs font-medium text-brand hover:underline"
              href={taskPacket.sessionLink.href}
            >
              {t("projects.projectManagerTaskPacketOpenSession")}
            </a>
          )}
          {!taskPacket.sessionLink && (
            <Button
              size="sm"
              className="w-fit bg-brand text-brand-foreground hover:bg-brand/90"
              onClick={onStart}
              disabled={!canStartTask}
            >
              {isStarting
                ? t("projects.projectManagerTaskPacketStarting")
                : t("projects.projectManagerTaskPacketStart")}
            </Button>
          )}
          {startError && (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {startError}
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
              className="bg-brand text-brand-foreground hover:bg-brand/90"
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
