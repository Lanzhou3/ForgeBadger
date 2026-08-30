"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Layers,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
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
import { Textarea } from "@/components/ui/textarea";
import {
  createProjectManagerStage,
  deleteProjectManagerStage,
  reorderProjectManagerStages,
  seedProjectManagerStageTemplate,
  updateProjectManagerStage,
  updateProjectManagerWorkItem,
  type ProjectManagerStage,
  type ProjectManagerTaskPacket,
  type ProjectManagerWorkItem,
  type ProjectManagerWorkItemLink,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Translate } from "./types";
import {
  projectManagerMutationMessage,
  stageStatusLabel,
  statusBadgeClassName,
  statusBadgeVariant,
  statusLabel,
} from "./utils";
import { EmptyState } from "./shared";

const BACKLOG_LANE_KEY = "backlog";
const LANE_HIGHLIGHT_MS = 1200;
const LANE_DROPPABLE_PREFIX = "lane:";

function laneDroppableId(laneKey: string) {
  return `${LANE_DROPPABLE_PREFIX}${laneKey}`;
}

function laneKeyFromDroppableId(id: unknown): string | null {
  if (typeof id !== "string" || !id.startsWith(LANE_DROPPABLE_PREFIX)) return null;
  return id.slice(LANE_DROPPABLE_PREFIX.length);
}

export function ProjectManagerPipelineBoard({
  isFetching,
  links,
  onViewDetails,
  projectId,
  stages,
  t,
  taskPackets,
  workItems,
}: {
  isFetching: boolean;
  links: ProjectManagerWorkItemLink[];
  onViewDetails: (item: ProjectManagerWorkItem) => void;
  projectId: string;
  stages: ProjectManagerStage[];
  t: Translate;
  taskPackets: ProjectManagerTaskPacket[];
  workItems: ProjectManagerWorkItem[];
}) {
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState({ name: "", description: "" });
  const [createError, setCreateError] = useState<string | null>(null);
  const [renamingStage, setRenamingStage] = useState<ProjectManagerStage | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deletingStage, setDeletingStage] = useState<ProjectManagerStage | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [highlightedLaneKey, setHighlightedLaneKey] = useState<string | null>(null);
  const [activeDragWorkItemId, setActiveDragWorkItemId] = useState<string | null>(null);
  const [dragOverLaneKey, setDragOverLaneKey] = useState<string | null>(null);
  const highlightTimeoutRef = useRef<number | null>(null);

  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  );

  useEffect(() => () => {
    if (highlightTimeoutRef.current !== null) {
      window.clearTimeout(highlightTimeoutRef.current);
    }
  }, []);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["project-manager", projectId] });
  };
  const stageErrorMessage = (error: unknown) =>
    projectManagerMutationMessage(error, t("projects.projectManagerStageMutationError"));

  const flashLaneHighlight = (laneKey: string) => {
    setHighlightedLaneKey(laneKey);
    if (highlightTimeoutRef.current !== null) {
      window.clearTimeout(highlightTimeoutRef.current);
    }
    highlightTimeoutRef.current = window.setTimeout(() => setHighlightedLaneKey(null), LANE_HIGHLIGHT_MS);
  };

  const createMutation = useMutation({
    mutationFn: (input: { name: string; description?: string | null }) =>
      createProjectManagerStage(projectId, input),
    onSuccess: async () => {
      setCreateError(null);
      setIsCreateOpen(false);
      setCreateDraft({ name: "", description: "" });
      await invalidate();
    },
    onError: (error) => setCreateError(stageErrorMessage(error)),
  });
  const seedMutation = useMutation({
    mutationFn: () => seedProjectManagerStageTemplate(projectId),
    onSuccess: async () => {
      setActionError(null);
      await invalidate();
    },
    onError: (error) => setActionError(stageErrorMessage(error)),
  });
  const renameMutation = useMutation({
    mutationFn: ({ name, stageId }: { name: string; stageId: string }) =>
      updateProjectManagerStage(projectId, stageId, { name }),
    onSuccess: async () => {
      setRenameError(null);
      setRenamingStage(null);
      await invalidate();
    },
    onError: (error) => setRenameError(stageErrorMessage(error)),
  });
  const deleteMutation = useMutation({
    mutationFn: (stageId: string) => deleteProjectManagerStage(projectId, stageId),
    onSuccess: async () => {
      setDeleteError(null);
      setDeletingStage(null);
      await invalidate();
    },
    onError: (error) => setDeleteError(stageErrorMessage(error)),
  });
  const reorderMutation = useMutation({
    mutationFn: (stageIds: string[]) => reorderProjectManagerStages(projectId, stageIds),
    onSuccess: async () => {
      setActionError(null);
      await invalidate();
    },
    onError: (error) => setActionError(stageErrorMessage(error)),
  });
  const moveWorkItemMutation = useMutation({
    mutationFn: ({ stageId, workItemId }: { stageId: string | null; workItemId: string }) =>
      updateProjectManagerWorkItem(projectId, workItemId, { stageId }),
    onSuccess: async (_data, variables) => {
      setActionError(null);
      flashLaneHighlight(variables.stageId ?? BACKLOG_LANE_KEY);
      await invalidate();
    },
    onError: (error) => setActionError(stageErrorMessage(error)),
  });

  const sessionByWorkItemId = useMemo(() => {
    const map = new Map<string, NonNullable<ProjectManagerTaskPacket["sessionLink"]>>();
    for (const packet of taskPackets) {
      if (packet.sessionLink) map.set(packet.workItemId, packet.sessionLink);
    }
    return map;
  }, [taskPackets]);

  const dependencyCounts = useMemo(() => {
    const blockedBy = new Map<string, number>();
    const blocking = new Map<string, number>();
    for (const link of links) {
      blockedBy.set(link.blockedWorkItemId, (blockedBy.get(link.blockedWorkItemId) ?? 0) + 1);
      blocking.set(link.blockerWorkItemId, (blocking.get(link.blockerWorkItemId) ?? 0) + 1);
    }
    return { blockedBy, blocking };
  }, [links]);

  const stagePending = createMutation.isPending || seedMutation.isPending || reorderMutation.isPending;

  const moveStage = (stage: ProjectManagerStage, direction: -1 | 1) => {
    const ids = stages.map((entry) => entry.id);
    const index = ids.indexOf(stage.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    const next = [...ids];
    const current = next[index];
    const swap = next[target];
    if (current === undefined || swap === undefined) return;
    next[index] = swap;
    next[target] = current;
    setActionError(null);
    reorderMutation.mutate(next);
  };

  const submitCreate = () => {
    const name = createDraft.name.trim();
    if (!name) {
      setCreateError(t("projects.projectManagerStageNameRequired"));
      return;
    }
    setCreateError(null);
    const description = createDraft.description.trim();
    createMutation.mutate({ name, ...(description ? { description } : {}) });
  };

  const submitRename = () => {
    if (!renamingStage) return;
    const name = renameDraft.trim();
    if (!name) {
      setRenameError(t("projects.projectManagerStageNameRequired"));
      return;
    }
    setRenameError(null);
    renameMutation.mutate({ name, stageId: renamingStage.id });
  };

  const moveWorkItem = (item: ProjectManagerWorkItem, stageId: string | null) => {
    setActionError(null);
    moveWorkItemMutation.mutate({ stageId, workItemId: item.id });
  };

  const activeDragWorkItem = activeDragWorkItemId
    ? workItems.find((item) => item.id === activeDragWorkItemId) ?? null
    : null;

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragWorkItemId(String(event.active.id));
    setDragOverLaneKey(null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    setDragOverLaneKey(laneKeyFromDroppableId(event.over?.id));
  };

  const resetDragState = () => {
    setActiveDragWorkItemId(null);
    setDragOverLaneKey(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const laneKey = laneKeyFromDroppableId(event.over?.id);
    const item = workItems.find((entry) => entry.id === String(event.active.id)) ?? null;
    resetDragState();
    if (!laneKey || !item) return;
    const nextStageId = laneKey === BACKLOG_LANE_KEY ? null : laneKey;
    if (nextStageId === item.stageId) return;
    moveWorkItem(item, nextStageId);
  };

  return (
    <Card data-testid="project-manager-stages-card">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Layers className="size-4 text-brand" />
            {t("projects.projectManagerPipelineTitle")}
            <span className="rounded border border-border/70 bg-muted/20 px-1.5 py-0.5 font-mono text-xs text-muted-foreground tabular-nums">
              {stages.length}
            </span>
            {isFetching && <RefreshCw className="size-3 animate-spin text-muted-foreground" />}
          </CardTitle>
          <p className="text-xs text-muted-foreground">{t("projects.projectManagerPipelineDescription")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {stages.length === 0 && (
            <Button
              size="sm"
              className="bg-brand text-brand-foreground hover:bg-brand/90"
              onClick={() => {
                setActionError(null);
                seedMutation.mutate();
              }}
              disabled={stagePending}
            >
              <Sparkles className="mr-2 size-4" />
              {t("projects.projectManagerStageSeedTemplate")}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setCreateError(null);
              setCreateDraft({ name: "", description: "" });
              setIsCreateOpen(true);
            }}
            disabled={stagePending}
          >
            <Plus className="mr-2 size-4" />
            {t("projects.projectManagerStageCreate")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {actionError && (
          <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {actionError}
          </p>
        )}
        {stages.length === 0 ? (
          <EmptyState
            title={t("projects.projectManagerStageEmptyTitle")}
            body={t("projects.projectManagerStageEmptyBody")}
            icon={Layers}
          />
        ) : (
          <DndContext
            sensors={dragSensors}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={resetDragState}
          >
            <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
              <ProjectManagerStageLane
                dependencyCounts={dependencyCounts}
                highlighted={highlightedLaneKey === BACKLOG_LANE_KEY || dragOverLaneKey === BACKLOG_LANE_KEY}
                items={workItems.filter((item) => item.stageId === null)}
                movePending={moveWorkItemMutation.isPending}
                onMoveWorkItem={moveWorkItem}
                onViewDetails={onViewDetails}
                sessionByWorkItemId={sessionByWorkItemId}
                stages={stages}
                t={t}
                title={t("projects.projectManagerStageBacklog")}
              />
              {stages.map((stage, index) => (
                <Fragment key={stage.id}>
                  <ChevronRight className="mt-8 size-4 shrink-0 self-start text-muted-foreground/50" aria-hidden />
                  <ProjectManagerStageLane
                    dependencyCounts={dependencyCounts}
                    highlighted={highlightedLaneKey === stage.id || dragOverLaneKey === stage.id}
                    items={workItems.filter((item) => item.stageId === stage.id)}
                    movePending={moveWorkItemMutation.isPending}
                    onDelete={() => {
                      setDeleteError(null);
                      setDeletingStage(stage);
                    }}
                    onMove={index > 0 ? () => moveStage(stage, -1) : undefined}
                    onMoveBack={index < stages.length - 1 ? () => moveStage(stage, 1) : undefined}
                    onMoveWorkItem={moveWorkItem}
                    onRename={() => {
                      setRenameError(null);
                      setRenameDraft(stage.name);
                      setRenamingStage(stage);
                    }}
                    onViewDetails={onViewDetails}
                    sessionByWorkItemId={sessionByWorkItemId}
                    stage={stage}
                    stages={stages}
                    t={t}
                    title={stage.name}
                  />
                </Fragment>
              ))}
            </div>
            <DragOverlay dropAnimation={null}>
              {activeDragWorkItem ? (
                <ProjectManagerStageItemDragPreview item={activeDragWorkItem} t={t} />
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </CardContent>
      <ProjectManagerStageFormDialog
        description={createDraft.description}
        error={createError}
        isSaving={createMutation.isPending}
        name={createDraft.name}
        onDescriptionChange={(description) => setCreateDraft((draft) => ({ ...draft, description }))}
        onNameChange={(name) => setCreateDraft((draft) => ({ ...draft, name }))}
        onOpenChange={(open) => {
          if (!open) {
            setIsCreateOpen(false);
            setCreateError(null);
          }
        }}
        onSave={submitCreate}
        open={isCreateOpen}
        t={t}
        title={t("projects.projectManagerStageCreate")}
      />
      <ProjectManagerStageFormDialog
        description=""
        error={renameError}
        isSaving={renameMutation.isPending}
        name={renameDraft}
        onNameChange={setRenameDraft}
        onOpenChange={(open) => {
          if (!open) {
            setRenamingStage(null);
            setRenameError(null);
          }
        }}
        onSave={submitRename}
        open={!!renamingStage}
        t={t}
        title={t("projects.projectManagerStageRename")}
      />
      <Dialog
        open={!!deletingStage}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingStage(null);
            setDeleteError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("projects.projectManagerStageDelete")}</DialogTitle>
            <DialogDescription>{t("projects.projectManagerStageDeleteConfirm")}</DialogDescription>
          </DialogHeader>
          {deletingStage && <p className="text-sm font-medium">{deletingStage.name}</p>}
          {deleteError && (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {deleteError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingStage(null)} disabled={deleteMutation.isPending}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => deletingStage && deleteMutation.mutate(deletingStage.id)}
              disabled={deleteMutation.isPending}
            >
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function stageStatusDotClassName(status: ProjectManagerStage["status"] | undefined) {
  if (!status) return "bg-muted-foreground/60";
  if (status === "active") return "bg-brand forgebadger-pulse-dot";
  if (status === "completed") return "bg-emerald-500";
  return "bg-muted-foreground/40";
}

function ProjectManagerStageLane({
  dependencyCounts,
  highlighted,
  items,
  movePending,
  onDelete,
  onMove,
  onMoveBack,
  onMoveWorkItem,
  onRename,
  onViewDetails,
  sessionByWorkItemId,
  stage,
  stages,
  t,
  title,
}: {
  dependencyCounts: { blockedBy: Map<string, number>; blocking: Map<string, number> };
  highlighted: boolean;
  items: ProjectManagerWorkItem[];
  movePending: boolean;
  onDelete?: () => void;
  onMove?: () => void;
  onMoveBack?: () => void;
  onMoveWorkItem: (item: ProjectManagerWorkItem, stageId: string | null) => void;
  onRename?: () => void;
  onViewDetails: (item: ProjectManagerWorkItem) => void;
  sessionByWorkItemId: Map<string, NonNullable<ProjectManagerTaskPacket["sessionLink"]>>;
  stage?: ProjectManagerStage;
  stages: ProjectManagerStage[];
  t: Translate;
  title: string;
}) {
  const laneKey = stage ? stage.id : BACKLOG_LANE_KEY;
  const { setNodeRef: setLaneDroppableRef } = useDroppable({ id: laneDroppableId(laneKey) });

  return (
    <section
      ref={setLaneDroppableRef}
      className={cn(
        "flex w-72 shrink-0 flex-col rounded-md border border-border/70 bg-background/40",
        highlighted && "forgebadger-lane-drop-highlight"
      )}
      data-testid={stage ? `project-manager-stage-lane-${stage.id}` : "project-manager-stage-lane-backlog"}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn("size-2 shrink-0 rounded-full", stageStatusDotClassName(stage?.status))}
            aria-hidden
          />
          <span className="truncate text-sm font-medium">{title}</span>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">{items.length}</span>
          {stage && stage.status !== "active" && (
            <Badge variant="outline">{stageStatusLabel(stage.status, t)}</Badge>
          )}
        </div>
        {stage && (onRename || onDelete) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="xs" variant="ghost" aria-label={title}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onRename && (
                <DropdownMenuItem onClick={onRename}>
                  <Pencil className="mr-2 size-3" />
                  {t("projects.projectManagerStageRename")}
                </DropdownMenuItem>
              )}
              {onMove && (
                <DropdownMenuItem onClick={onMove}>
                  <ArrowLeft className="mr-2 size-3" />
                  {t("projects.projectManagerStageMoveLeft")}
                </DropdownMenuItem>
              )}
              {onMoveBack && (
                <DropdownMenuItem onClick={onMoveBack}>
                  <ArrowRight className="mr-2 size-3" />
                  {t("projects.projectManagerStageMoveRight")}
                </DropdownMenuItem>
              )}
              {onDelete && (
                <DropdownMenuItem onClick={onDelete} className="text-destructive">
                  <Trash2 className="mr-2 size-3" />
                  {t("projects.projectManagerStageDelete")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="flex max-h-96 flex-col gap-2 overflow-y-auto p-2">
        {items.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/70 px-3 py-6 text-center text-xs text-muted-foreground">
            {t("projects.projectManagerStageLaneEmpty")}
          </div>
        ) : (
          items.map((item, index) => (
            <ProjectManagerStageItemCard
              dependencyCounts={dependencyCounts}
              index={index}
              item={item}
              key={item.id}
              movePending={movePending}
              onMoveWorkItem={onMoveWorkItem}
              onViewDetails={onViewDetails}
              sessionLink={sessionByWorkItemId.get(item.id) ?? null}
              stages={stages}
              t={t}
            />
          ))
        )}
      </div>
    </section>
  );
}

function ProjectManagerStageItemCard({
  dependencyCounts,
  index,
  item,
  movePending,
  onMoveWorkItem,
  onViewDetails,
  sessionLink,
  stages,
  t,
}: {
  dependencyCounts: { blockedBy: Map<string, number>; blocking: Map<string, number> };
  index: number;
  item: ProjectManagerWorkItem;
  movePending: boolean;
  onMoveWorkItem: (item: ProjectManagerWorkItem, stageId: string | null) => void;
  onViewDetails: (item: ProjectManagerWorkItem) => void;
  sessionLink: NonNullable<ProjectManagerTaskPacket["sessionLink"]> | null;
  stages: ProjectManagerStage[];
  t: Translate;
}) {
  const blockedByCount = dependencyCounts.blockedBy.get(item.id) ?? 0;
  const blockingCount = dependencyCounts.blocking.get(item.id) ?? 0;
  const {
    attributes: dragAttributes,
    isDragging,
    listeners: dragListeners,
    setNodeRef: setDragNodeRef,
  } = useDraggable({ id: item.id, disabled: movePending });

  return (
    <article
      ref={setDragNodeRef}
      className={cn(
        "forgebadger-animate-in rounded-md border border-border/70 bg-muted/10 p-3 shadow-xs transition-colors hover:border-border",
        isDragging && "opacity-40"
      )}
      style={{ animationDelay: `${index * 40}ms` }}
      data-testid={`project-manager-stage-item-${item.id}`}
      {...dragAttributes}
      {...dragListeners}
    >
      <button
        type="button"
        className="w-full break-words text-left text-sm font-medium leading-5 transition-colors hover:text-brand"
        onClick={() => onViewDetails(item)}
      >
        {item.title}
      </button>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant={statusBadgeVariant(item.status)} className={statusBadgeClassName(item.status)}>
          {statusLabel(item.status, t)}
        </Badge>
        {blockedByCount > 0 && (
          <Badge variant="destructive">
            {t("projects.projectManagerDependencyBlockedBy")}: {blockedByCount}
          </Badge>
        )}
        {blockingCount > 0 && (
          <Badge variant="secondary">
            {t("projects.projectManagerDependencyBlocking")}: {blockingCount}
          </Badge>
        )}
        {sessionLink && (
          <a
            className="inline-flex items-center gap-1 rounded border border-border/70 px-1.5 py-0.5 text-xs text-brand transition-colors hover:border-brand/40 hover:underline"
            href={sessionLink.href}
          >
            <Link2 className="size-3" />
            {t("projects.projectManagerLinkedSession")}
          </a>
        )}
      </div>
      <div className="mt-2">
        <select
          aria-label={t("projects.projectManagerStageAssign")}
          className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
          value={item.stageId ?? ""}
          disabled={movePending}
          onChange={(event) => onMoveWorkItem(item, event.target.value || null)}
        >
          <option value="">{t("projects.projectManagerStageBacklog")}</option>
          {stages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.name}
            </option>
          ))}
        </select>
      </div>
    </article>
  );
}

function ProjectManagerStageItemDragPreview({
  item,
  t,
}: {
  item: ProjectManagerWorkItem;
  t: Translate;
}) {
  return (
    <div
      className="w-72 rotate-2 cursor-grabbing rounded-md border border-brand/50 bg-card p-3 opacity-90 shadow-lg"
      data-testid={`project-manager-stage-item-drag-preview-${item.id}`}
    >
      <div className="break-words text-sm font-medium leading-5">{item.title}</div>
      <div className="mt-2">
        <Badge variant={statusBadgeVariant(item.status)} className={statusBadgeClassName(item.status)}>
          {statusLabel(item.status, t)}
        </Badge>
      </div>
    </div>
  );
}

function ProjectManagerStageFormDialog({
  description,
  error,
  isSaving,
  name,
  onDescriptionChange,
  onNameChange,
  onOpenChange,
  onSave,
  open,
  t,
  title,
}: {
  description?: string;
  error: string | null;
  isSaving: boolean;
  name: string;
  onDescriptionChange?: (value: string) => void;
  onNameChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  open: boolean;
  t: Translate;
  title: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="project-manager-stage-name">{t("projects.projectManagerStageName")}</Label>
            <Input
              id="project-manager-stage-name"
              value={name}
              aria-invalid={!!error && name.trim().length === 0}
              disabled={isSaving}
              onChange={(event) => onNameChange(event.target.value)}
            />
          </div>
          {onDescriptionChange && (
            <div className="space-y-2">
              <Label htmlFor="project-manager-stage-description">
                {t("projects.projectManagerStageDescription")}
              </Label>
              <Textarea
                id="project-manager-stage-description"
                value={description ?? ""}
                disabled={isSaving}
                onChange={(event) => onDescriptionChange(event.target.value)}
              />
            </div>
          )}
          {error && (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t("common.cancel")}
          </Button>
          <Button
            className="bg-brand text-brand-foreground hover:bg-brand/90"
            onClick={onSave}
            disabled={isSaving}
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectManagerStageSelect({
  item,
  projectId,
  stages,
  t,
}: {
  item: ProjectManagerWorkItem;
  projectId: string;
  stages: ProjectManagerStage[];
  t: Translate;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (stageId: string | null) =>
      updateProjectManagerWorkItem(projectId, item.id, { stageId }),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["project-manager", projectId] });
    },
    onError: (mutationError) =>
      setError(projectManagerMutationMessage(mutationError, t("projects.projectManagerStageMutationError"))),
  });

  return (
    <div className="space-y-2">
      <select
        aria-label={t("projects.projectManagerStageAssign")}
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
        value={item.stageId ?? ""}
        disabled={mutation.isPending}
        onChange={(event) => mutation.mutate(event.target.value || null)}
      >
        <option value="">{t("projects.projectManagerStageBacklog")}</option>
        {stages.map((stage) => (
          <option key={stage.id} value={stage.id}>
            {stage.name}
          </option>
        ))}
      </select>
      {error && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
