"use client";

import { useMemo, useState, type ReactNode } from "react";
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
import {
  ArrowRightCircle,
  ClipboardList,
  ExternalLink,
  Eye,
  Flag,
  LayoutDashboard,
  ListChecks,
  Pencil,
  Play,
  Plus,
  Search,
  Table2,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  ProjectManagerTaskPacket,
  ProjectManagerWorkItem,
  ProjectManagerWorkItemStatus,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  groupTaskPacketsByQueueStatus,
  TASK_PACKET_QUEUE_STATUSES,
} from "../project-manager-task-packet";
import {
  PROJECT_MANAGER_STATUS_TRANSITIONS,
  WORK_ITEM_STATUSES,
  type Translate,
  type WorkItemStatusFilter,
  type WorkItemViewMode,
} from "./types";
import {
  formatTimestamp,
  priorityClassName,
  priorityLabelKey,
  priorityLevel,
  statusBadgeClassName,
  statusBadgeVariant,
  statusDotClassName,
  statusLabel,
  taskPacketQueueBadgeVariant,
  taskPacketQueueStatusLabel,
} from "./utils";
import { EmptyState, LedgerDatum } from "./shared";

function matchesSearch(item: ProjectManagerWorkItem, query: string) {
  if (!query) return true;
  return item.title.toLowerCase().includes(query);
}

const BOARD_COLUMN_DROPPABLE_PREFIX = "board-column:";

function boardColumnDroppableId(status: ProjectManagerWorkItemStatus) {
  return `${BOARD_COLUMN_DROPPABLE_PREFIX}${status}`;
}

function boardColumnStatusFromDroppableId(id: unknown): ProjectManagerWorkItemStatus | null {
  if (typeof id !== "string" || !id.startsWith(BOARD_COLUMN_DROPPABLE_PREFIX)) return null;
  const status = id.slice(BOARD_COLUMN_DROPPABLE_PREFIX.length);
  return (WORK_ITEM_STATUSES as string[]).includes(status)
    ? (status as ProjectManagerWorkItemStatus)
    : null;
}

export function ProjectManagerWorkItemsSection({
  batchStatusError,
  batchStatusPending,
  batchTargetOptions,
  batchTargetStatus,
  highlightedWorkItemId,
  isFetching,
  onBatchStatusSubmit,
  onBatchTargetStatusChange,
  onClearSelection,
  onCreate,
  onDelete,
  onEdit,
  onQuickStart,
  onStatusFilterChange,
  onStatusChange,
  onToggleSelection,
  onViewDetails,
  onViewModeChange,
  quickStartError,
  quickStartPendingWorkItemId,
  selectedWorkItemIds,
  statusError,
  statusFilter,
  statusMutationPending,
  tableWorkItems,
  taskPackets,
  taskPacketsError,
  taskPacketsFetching,
  viewMode,
  workItems,
  t,
}: {
  batchStatusError: string | null;
  batchStatusPending: boolean;
  batchTargetOptions: ProjectManagerWorkItemStatus[];
  batchTargetStatus: ProjectManagerWorkItemStatus | "";
  highlightedWorkItemId?: string | null;
  isFetching: boolean;
  onBatchStatusSubmit: () => void;
  onBatchTargetStatusChange: (status: ProjectManagerWorkItemStatus | "") => void;
  onClearSelection: () => void;
  onCreate: () => void;
  onDelete: (item: ProjectManagerWorkItem) => void;
  onEdit: (item: ProjectManagerWorkItem) => void;
  onQuickStart: (item: ProjectManagerWorkItem) => void;
  onStatusFilterChange: (status: WorkItemStatusFilter) => void;
  onStatusChange: (item: ProjectManagerWorkItem, nextStatus: ProjectManagerWorkItemStatus) => void;
  onToggleSelection: (item: ProjectManagerWorkItem, selected: boolean) => void;
  onViewDetails: (item: ProjectManagerWorkItem) => void;
  onViewModeChange: (mode: WorkItemViewMode) => void;
  quickStartError: string | null;
  quickStartPendingWorkItemId: string | null;
  selectedWorkItemIds: string[];
  statusError: string | null;
  statusFilter: WorkItemStatusFilter;
  statusMutationPending: boolean;
  tableWorkItems: ProjectManagerWorkItem[];
  taskPackets: ProjectManagerTaskPacket[];
  taskPacketsError: unknown;
  taskPacketsFetching: boolean;
  viewMode: WorkItemViewMode;
  workItems: ProjectManagerWorkItem[];
  t: Translate;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visibleWorkItems = useMemo(
    () => workItems.filter((item) => matchesSearch(item, normalizedQuery)),
    [workItems, normalizedQuery]
  );
  const visibleTableWorkItems = useMemo(
    () => tableWorkItems.filter((item) => matchesSearch(item, normalizedQuery)),
    [tableWorkItems, normalizedQuery]
  );
  const taskPacketByWorkItemId = useMemo(
    () => new Map(taskPackets.map((packet) => [packet.workItemId, packet])),
    [taskPackets]
  );
  const isFilterEmpty = (statusFilter !== "all" || normalizedQuery.length > 0) && visibleTableWorkItems.length === 0;
  const selectedWorkItemCount = selectedWorkItemIds.filter((id) =>
    workItems.some((item) => item.id === id)
  ).length;

  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <ClipboardList className="size-4 text-brand" />
          {t("projects.projectManagerWorkItems")}
          <span className="rounded border border-border/70 bg-muted/20 px-1.5 py-0.5 font-mono text-xs text-muted-foreground tabular-nums">
            {workItems.length}
          </span>
        </CardTitle>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="inline-flex w-fit rounded-md border border-border/70 bg-muted/20 p-1">
            <Button
              size="sm"
              variant={viewMode === "board" ? "default" : "ghost"}
              className={viewMode === "board" ? "bg-brand text-brand-foreground hover:bg-brand/90" : undefined}
              aria-pressed={viewMode === "board"}
              onClick={() => onViewModeChange("board")}
            >
              <LayoutDashboard className="mr-2 size-4" />
              {t("projects.projectManagerBoard")}
            </Button>
            <Button
              size="sm"
              variant={viewMode === "table" ? "default" : "ghost"}
              className={viewMode === "table" ? "bg-brand text-brand-foreground hover:bg-brand/90" : undefined}
              aria-pressed={viewMode === "table"}
              onClick={() => onViewModeChange("table")}
            >
              <Table2 className="mr-2 size-4" />
              {t("projects.projectManagerTable")}
            </Button>
            <Button
              size="sm"
              variant={viewMode === "queue" ? "default" : "ghost"}
              className={viewMode === "queue" ? "bg-brand text-brand-foreground hover:bg-brand/90" : undefined}
              aria-pressed={viewMode === "queue"}
              onClick={() => onViewModeChange("queue")}
            >
              <ListChecks className="mr-2 size-4" />
              {t("projects.projectManagerTaskQueue")}
            </Button>
          </div>
          <div className="relative lg:flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t("projects.projectManagerSearchPlaceholder")}
              className="h-9 pl-8"
            />
          </div>
          <Select
            value={statusFilter}
            onValueChange={(value) => onStatusFilterChange(value as WorkItemStatusFilter)}
            disabled={isFetching}
          >
            <SelectTrigger
              aria-label={t("projects.projectManagerFilterByStatus")}
              className="w-full lg:w-44"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("projects.projectManagerAllStatuses")}</SelectItem>
              {WORK_ITEM_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {statusLabel(status, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="bg-brand text-brand-foreground hover:bg-brand/90"
            onClick={onCreate}
          >
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
        {batchStatusError && (
          <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {batchStatusError}
          </p>
        )}
        {quickStartError && (
          <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {quickStartError}
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
            icon={ClipboardList}
          />
        ) : viewMode === "board" ? (
          <ProjectManagerWorkItemBoard
            batchStatusPending={batchStatusPending}
            highlightedWorkItemId={highlightedWorkItemId}
            onDelete={onDelete}
            onEdit={onEdit}
            onQuickStart={onQuickStart}
            onStatusChange={onStatusChange}
            onToggleSelection={onToggleSelection}
            onViewDetails={onViewDetails}
            quickStartPendingWorkItemId={quickStartPendingWorkItemId}
            selectedWorkItemIds={selectedWorkItemIds}
            statusMutationPending={statusMutationPending}
            t={t}
            taskPacketByWorkItemId={taskPacketByWorkItemId}
            workItems={visibleWorkItems}
          />
        ) : viewMode === "table" ? (
          visibleTableWorkItems.length === 0 ? (
            <EmptyState
              title={t("projects.projectManagerFilterEmptyTitle")}
              body={t("projects.projectManagerFilterEmptyBody")}
              icon={ClipboardList}
            />
          ) : (
            <ProjectManagerWorkItemTable
              highlightedWorkItemId={highlightedWorkItemId}
              onQuickStart={onQuickStart}
              onStatusChange={onStatusChange}
              onViewDetails={onViewDetails}
              quickStartPendingWorkItemId={quickStartPendingWorkItemId}
              statusMutationPending={statusMutationPending}
              t={t}
              taskPacketByWorkItemId={taskPacketByWorkItemId}
              workItems={visibleTableWorkItems}
            />
          )
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{t("projects.projectManagerTaskQueueDescription")}</p>
            <ProjectManagerTaskQueue
              error={taskPacketsError}
              highlightedWorkItemId={highlightedWorkItemId}
              isFetching={taskPacketsFetching}
              onQuickStart={onQuickStart}
              onViewDetails={onViewDetails}
              quickStartPendingWorkItemId={quickStartPendingWorkItemId}
              t={t}
              taskPackets={taskPackets}
              workItems={workItems}
            />
          </div>
        )}
      </CardContent>
      {selectedWorkItemCount > 0 && (
        <div
          className="forgebadger-slide-up-toolbar fixed bottom-6 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-lg"
          data-testid="project-manager-batch-toolbar"
        >
          <span className="text-sm font-medium">
            {t("projects.projectManagerSelected")}: {selectedWorkItemCount}
          </span>
          <Select
            value={batchTargetStatus || undefined}
            onValueChange={(value) => onBatchTargetStatusChange(value as ProjectManagerWorkItemStatus)}
            disabled={batchStatusPending || batchTargetOptions.length === 0}
          >
            <SelectTrigger
              size="sm"
              aria-label={t("projects.projectManagerBatchTargetStatus")}
              className="min-w-44"
            >
              <SelectValue placeholder={t("projects.projectManagerBatchTargetStatus")} />
            </SelectTrigger>
            <SelectContent>
              {batchTargetOptions.map((status) => (
                <SelectItem key={status} value={status}>
                  {statusLabel(status, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {batchTargetOptions.length === 0 && (
            <span className="text-xs text-muted-foreground">{t("projects.projectManagerNoBatchTargets")}</span>
          )}
          <Button
            size="sm"
            className="bg-brand text-brand-foreground hover:bg-brand/90"
            onClick={onBatchStatusSubmit}
            disabled={batchStatusPending || !batchTargetStatus}
          >
            {t("projects.projectManagerMoveSelected")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onClearSelection}
            disabled={batchStatusPending}
          >
            {t("projects.projectManagerClearSelection")}
          </Button>
        </div>
      )}
    </Card>
  );
}

function ProjectManagerWorkItemBoard({
  batchStatusPending,
  highlightedWorkItemId,
  onDelete,
  onEdit,
  onQuickStart,
  onStatusChange,
  onToggleSelection,
  onViewDetails,
  quickStartPendingWorkItemId,
  selectedWorkItemIds,
  statusMutationPending,
  t,
  taskPacketByWorkItemId,
  workItems,
}: {
  batchStatusPending: boolean;
  highlightedWorkItemId?: string | null;
  onDelete: (item: ProjectManagerWorkItem) => void;
  onEdit: (item: ProjectManagerWorkItem) => void;
  onQuickStart: (item: ProjectManagerWorkItem) => void;
  onStatusChange: (item: ProjectManagerWorkItem, nextStatus: ProjectManagerWorkItemStatus) => void;
  onToggleSelection: (item: ProjectManagerWorkItem, selected: boolean) => void;
  onViewDetails: (item: ProjectManagerWorkItem) => void;
  quickStartPendingWorkItemId: string | null;
  selectedWorkItemIds: string[];
  statusMutationPending: boolean;
  t: Translate;
  taskPacketByWorkItemId: Map<string, ProjectManagerTaskPacket>;
  workItems: ProjectManagerWorkItem[];
}) {
  const [activeDragWorkItemId, setActiveDragWorkItemId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<ProjectManagerWorkItemStatus | null>(null);
  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  );
  const activeDragWorkItem = activeDragWorkItemId
    ? workItems.find((item) => item.id === activeDragWorkItemId) ?? null
    : null;

  // Only legal transitions (PROJECT_MANAGER_STATUS_TRANSITIONS) may act as
  // drop targets; illegal columns stay unhighlighted and drops are ignored.
  const legalDropStatus = (
    item: ProjectManagerWorkItem | null,
    status: ProjectManagerWorkItemStatus | null
  ): ProjectManagerWorkItemStatus | null => {
    if (!item || !status || status === item.status) return null;
    return PROJECT_MANAGER_STATUS_TRANSITIONS[item.status].includes(status) ? status : null;
  };

  const resetDragState = () => {
    setActiveDragWorkItemId(null);
    setDragOverStatus(null);
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragWorkItemId(String(event.active.id));
    setDragOverStatus(null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const item = workItems.find((entry) => entry.id === String(event.active.id)) ?? null;
    setDragOverStatus(legalDropStatus(item, boardColumnStatusFromDroppableId(event.over?.id)));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const item = workItems.find((entry) => entry.id === String(event.active.id)) ?? null;
    const targetStatus = legalDropStatus(item, boardColumnStatusFromDroppableId(event.over?.id));
    resetDragState();
    if (!item || !targetStatus) return;
    onStatusChange(item, targetStatus);
  };

  return (
    <div className="space-y-3" data-testid="project-manager-board">
      <DndContext
        sensors={dragSensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={resetDragState}
      >
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {WORK_ITEM_STATUSES.map((status) => {
            const columnItems = workItems.filter((item) => item.status === status);
            return (
              <ProjectManagerBoardColumn
                key={status}
                highlighted={dragOverStatus === status}
                itemCount={columnItems.length}
                status={status}
                t={t}
              >
                {columnItems.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border/70 px-3 py-6 text-center text-xs text-muted-foreground">
                    {t("projects.projectManagerBoardEmptyColumn")}
                  </div>
                ) : (
                  columnItems.map((item, index) => (
                    <ProjectManagerBoardCard
                      key={item.id}
                      highlighted={item.id === highlightedWorkItemId}
                      index={index}
                      isStarting={quickStartPendingWorkItemId === item.id}
                      item={item}
                      onDelete={onDelete}
                      onEdit={onEdit}
                      onQuickStart={onQuickStart}
                      onStatusChange={onStatusChange}
                      onToggleSelection={onToggleSelection}
                      onViewDetails={onViewDetails}
                      selected={selectedWorkItemIds.includes(item.id)}
                      statusMutationPending={statusMutationPending || batchStatusPending}
                      t={t}
                      taskPacket={taskPacketByWorkItemId.get(item.id) ?? null}
                    />
                  ))
                )}
              </ProjectManagerBoardColumn>
            );
          })}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeDragWorkItem ? (
            <ProjectManagerBoardCardDragPreview item={activeDragWorkItem} t={t} />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function ProjectManagerBoardColumn({
  children,
  highlighted,
  itemCount,
  status,
  t,
}: {
  children: ReactNode;
  highlighted: boolean;
  itemCount: number;
  status: ProjectManagerWorkItemStatus;
  t: Translate;
}) {
  const { setNodeRef } = useDroppable({ id: boardColumnDroppableId(status) });

  return (
    <section
      ref={setNodeRef}
      className={cn(
        "min-h-56 rounded-md border border-border/70 bg-background/40",
        highlighted && "forgebadger-lane-drop-highlight"
      )}
      data-testid={`project-manager-board-column-${status}`}
    >
      <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className={cn("size-2 rounded-full", statusDotClassName(status))} aria-hidden />
          <span className="text-xs font-medium">{statusLabel(status, t)}</span>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {itemCount}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-2 p-2">
        {children}
      </div>
    </section>
  );
}

function ProjectManagerBoardCard({
  highlighted,
  index,
  isStarting,
  item,
  onDelete,
  onEdit,
  onQuickStart,
  onStatusChange,
  onToggleSelection,
  onViewDetails,
  selected,
  statusMutationPending,
  t,
  taskPacket,
}: {
  highlighted: boolean;
  index: number;
  isStarting: boolean;
  item: ProjectManagerWorkItem;
  onDelete: (item: ProjectManagerWorkItem) => void;
  onEdit: (item: ProjectManagerWorkItem) => void;
  onQuickStart: (item: ProjectManagerWorkItem) => void;
  onStatusChange: (item: ProjectManagerWorkItem, nextStatus: ProjectManagerWorkItemStatus) => void;
  onToggleSelection: (item: ProjectManagerWorkItem, selected: boolean) => void;
  onViewDetails: (item: ProjectManagerWorkItem) => void;
  selected: boolean;
  statusMutationPending: boolean;
  t: Translate;
  taskPacket: ProjectManagerTaskPacket | null;
}) {
  const level = priorityLevel(item.priority);
  const {
    attributes: dragAttributes,
    isDragging,
    listeners: dragListeners,
    setNodeRef: setDragNodeRef,
  } = useDraggable({ id: item.id, disabled: statusMutationPending });

  return (
    <article
      ref={setDragNodeRef}
      className={cn(
        "forgebadger-animate-in rounded-md border border-border/70 bg-muted/10 p-3 shadow-xs transition-colors hover:border-border",
        highlighted && "border-brand/50 bg-brand/5",
        selected && "ring-2 ring-brand/40",
        isDragging && "opacity-40"
      )}
      style={{ animationDelay: `${index * 40}ms` }}
      data-testid={`project-manager-board-card-${item.id}`}
      {...dragAttributes}
      {...dragListeners}
    >
      <div className="flex items-start gap-2">
        <Checkbox
          className="mt-1"
          checked={selected}
          aria-label={t("projects.projectManagerSelectWorkItem")}
          onCheckedChange={(checked) => onToggleSelection(item, checked === true)}
        />
        <div className="min-w-0 flex-1">
          <div className="break-words text-sm font-medium leading-5">{item.title}</div>
          {item.description && (
            <p className="mt-1 line-clamp-2 break-words text-xs leading-5 text-muted-foreground">
              {item.description}
            </p>
          )}
        </div>
        <span
          className={cn("inline-flex shrink-0 items-center gap-1 text-xs", priorityClassName(level))}
          title={`${t(priorityLabelKey(level))} · ${item.priority}`}
        >
          <Flag className="size-3.5" />
          <span className="font-mono tabular-nums">{item.priority}</span>
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge variant="outline">{t("projects.projectManagerEvidenceRefs")}: {item.evidenceRefCount}</Badge>
        {item.feishuRefCount > 0 && (
          <Badge variant="outline">{t("projects.projectManagerFeishuRefs")}: {item.feishuRefCount}</Badge>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <WorkItemSessionActions
          isStarting={isStarting}
          item={item}
          onQuickStart={onQuickStart}
          size="xs"
          t={t}
          taskPacket={taskPacket}
        />
        <Button size="xs" variant="outline" onClick={() => onViewDetails(item)}>
          <Eye className="mr-1 size-3" />
          {t("projects.projectManagerViewDetails")}
        </Button>
        <Button size="xs" variant="outline" onClick={() => onEdit(item)}>
          <Pencil className="mr-1 size-3" />
          {t("projects.projectManagerEditWorkItem")}
        </Button>
        <Button size="xs" variant="destructive" onClick={() => onDelete(item)}>
          <Trash2 className="mr-1 size-3" />
          {t("projects.projectManagerDeleteWorkItem")}
        </Button>
        <ProjectManagerStatusActions
          disabled={statusMutationPending}
          item={item}
          onStatusChange={onStatusChange}
          t={t}
          size="xs"
        />
      </div>
    </article>
  );
}

function ProjectManagerBoardCardDragPreview({
  item,
  t,
}: {
  item: ProjectManagerWorkItem;
  t: Translate;
}) {
  const level = priorityLevel(item.priority);

  return (
    <div
      className="w-64 rotate-2 cursor-grabbing rounded-md border border-brand/50 bg-card p-3 opacity-90 shadow-lg"
      data-testid={`project-manager-board-card-drag-preview-${item.id}`}
    >
      <div className="break-words text-sm font-medium leading-5">{item.title}</div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <Badge variant="outline">
          {t("projects.projectManagerEvidenceRefs")}: {item.evidenceRefCount}
        </Badge>
        <span className={cn("inline-flex items-center gap-1 text-xs", priorityClassName(level))}>
          <Flag className="size-3.5" />
          <span className="font-mono tabular-nums">{item.priority}</span>
        </span>
      </div>
    </div>
  );
}

function ProjectManagerWorkItemTable({
  highlightedWorkItemId,
  onQuickStart,
  onStatusChange,
  onViewDetails,
  quickStartPendingWorkItemId,
  statusMutationPending,
  taskPacketByWorkItemId,
  workItems,
  t,
}: {
  highlightedWorkItemId?: string | null;
  onQuickStart: (item: ProjectManagerWorkItem) => void;
  onStatusChange: (item: ProjectManagerWorkItem, nextStatus: ProjectManagerWorkItemStatus) => void;
  onViewDetails: (item: ProjectManagerWorkItem) => void;
  quickStartPendingWorkItemId: string | null;
  statusMutationPending: boolean;
  taskPacketByWorkItemId: Map<string, ProjectManagerTaskPacket>;
  workItems: ProjectManagerWorkItem[];
  t: Translate;
}) {
  return (
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
              item.id === highlightedWorkItemId && "border-brand/50 bg-brand/5"
            )}
          >
            <TableCell className="max-w-[240px] whitespace-normal break-words font-medium">
              {item.title}
            </TableCell>
            <TableCell>
              <Badge variant={statusBadgeVariant(item.status)} className={statusBadgeClassName(item.status)}>
                {statusLabel(item.status, t)}
              </Badge>
            </TableCell>
            <TableCell className="font-mono text-xs">{item.priority}</TableCell>
            <TableCell className="font-mono text-xs tabular-nums">{item.evidenceRefCount}</TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {formatTimestamp(item.updatedAt)}
            </TableCell>
            <TableCell className="text-right">
              <div className="flex flex-col justify-end gap-2 sm:flex-row sm:items-center">
                <WorkItemSessionActions
                  isStarting={quickStartPendingWorkItemId === item.id}
                  item={item}
                  onQuickStart={onQuickStart}
                  t={t}
                  taskPacket={taskPacketByWorkItemId.get(item.id) ?? null}
                />
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
  );
}

function ProjectManagerTaskQueue({
  error,
  highlightedWorkItemId,
  isFetching,
  onQuickStart,
  onViewDetails,
  quickStartPendingWorkItemId,
  taskPackets,
  t,
  workItems,
}: {
  error: unknown;
  highlightedWorkItemId?: string | null;
  isFetching: boolean;
  onQuickStart: (item: ProjectManagerWorkItem) => void;
  onViewDetails: (item: ProjectManagerWorkItem) => void;
  quickStartPendingWorkItemId: string | null;
  taskPackets: ProjectManagerTaskPacket[];
  t: Translate;
  workItems: ProjectManagerWorkItem[];
}) {
  const workItemById = useMemo(
    () => new Map(workItems.map((item) => [item.id, item])),
    [workItems]
  );
  const groupedTaskPackets = useMemo(
    () => groupTaskPacketsByQueueStatus(taskPackets),
    [taskPackets]
  );

  if (error) {
    return (
      <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {t("projects.projectManagerTaskQueueLoadError")}
      </p>
    );
  }

  if (isFetching && taskPackets.length === 0) {
    return (
      <div className="rounded-md border border-border/70 px-3 py-6 text-center text-sm text-muted-foreground">
        {t("projects.projectManagerTaskQueueLoading")}
      </div>
    );
  }

  if (taskPackets.length === 0) {
    return (
      <EmptyState
        title={t("projects.projectManagerTaskQueueEmptyTitle")}
        body={t("projects.projectManagerTaskQueueEmptyBody")}
        icon={ListChecks}
      />
    );
  }

  return (
    <div className="space-y-3" data-testid="project-manager-task-queue">
      {isFetching && (
        <p className="text-xs text-muted-foreground">{t("projects.projectManagerTaskQueueLoading")}</p>
      )}
      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        {TASK_PACKET_QUEUE_STATUSES.map((queueStatus) => {
          const columnPackets = groupedTaskPackets[queueStatus];
          return (
            <section
              key={queueStatus}
              className="min-h-56 rounded-md border border-border/70 bg-background/40"
              data-testid={`project-manager-task-queue-column-${queueStatus}`}
            >
              <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Badge variant={taskPacketQueueBadgeVariant(queueStatus)}>
                    {taskPacketQueueStatusLabel(queueStatus, t)}
                  </Badge>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                    {columnPackets.length}
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-2 p-2">
                {columnPackets.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border/70 px-3 py-6 text-center text-xs text-muted-foreground">
                    {t("projects.projectManagerTaskQueueEmptyColumn")}
                  </div>
                ) : (
                  columnPackets.map((taskPacket) => (
                    <ProjectManagerTaskQueueCard
                      key={taskPacket.id}
                      highlighted={taskPacket.workItemId === highlightedWorkItemId}
                      isStarting={quickStartPendingWorkItemId === taskPacket.workItemId}
                      onQuickStart={onQuickStart}
                      onViewDetails={onViewDetails}
                      t={t}
                      taskPacket={taskPacket}
                      workItem={workItemById.get(taskPacket.workItemId) ?? null}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ProjectManagerTaskQueueCard({
  highlighted,
  isStarting,
  onQuickStart,
  onViewDetails,
  taskPacket,
  t,
  workItem,
}: {
  highlighted: boolean;
  isStarting: boolean;
  onQuickStart: (item: ProjectManagerWorkItem) => void;
  onViewDetails: (item: ProjectManagerWorkItem) => void;
  taskPacket: ProjectManagerTaskPacket;
  t: Translate;
  workItem: ProjectManagerWorkItem | null;
}) {
  return (
    <article
      className={cn(
        "rounded-md border border-border/70 bg-muted/10 p-3 shadow-xs transition-colors hover:border-border",
        highlighted && "border-brand/50 bg-brand/5"
      )}
      data-testid={`project-manager-task-queue-card-${taskPacket.workItemId}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={statusBadgeVariant(taskPacket.workItemStatus)}>
          {statusLabel(taskPacket.workItemStatus, t)}
        </Badge>
        <Badge variant="outline">{taskPacket.runtime.adapter}</Badge>
        <Badge variant="outline">{taskPacket.runtime.templateId}</Badge>
      </div>
      <h3 className="mt-2 break-words text-sm font-medium leading-5">{taskPacket.title}</h3>
      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <LedgerDatum
          label={t("projects.projectManagerAcceptanceCriteria")}
          value={taskPacket.acceptanceCriteria.length}
        />
        <LedgerDatum
          label={t("projects.projectManagerTaskPacketExpectedVerification")}
          value={taskPacket.expectedVerification.length}
        />
      </div>
      <div className="mt-3 rounded-md border border-border/50 bg-background/40 px-2 py-2">
        <div className="text-xs text-muted-foreground">{t("projects.projectManagerTaskPacketLinkedSession")}</div>
        <div className="mt-1 break-all font-mono text-xs">
          {taskPacket.sessionLink
            ? `${taskPacket.sessionLink.sessionId} / ${taskPacket.sessionLink.status}`
            : t("projects.projectManagerTaskPacketBlockedNoSession")}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{formatTimestamp(taskPacket.updatedAt)}</span>
        <div className="flex flex-wrap items-center gap-2">
          {workItem && (
            <WorkItemSessionActions
              isStarting={isStarting}
              item={workItem}
              onQuickStart={onQuickStart}
              size="xs"
              t={t}
              taskPacket={taskPacket}
            />
          )}
          <Button
            size="xs"
            variant="outline"
            disabled={!workItem}
            onClick={() => {
              if (workItem) onViewDetails(workItem);
            }}
          >
            <Eye className="mr-1 size-3" />
            {t("projects.projectManagerViewDetails")}
          </Button>
        </div>
      </div>
    </article>
  );
}

/**
 * Quick session actions for a work item: create a CLI session from its task
 * packet when none is linked, or jump to the linked session.
 */
function WorkItemSessionActions({
  isStarting,
  item,
  onQuickStart,
  size = "sm",
  taskPacket,
  t,
}: {
  isStarting: boolean;
  item: ProjectManagerWorkItem;
  onQuickStart: (item: ProjectManagerWorkItem) => void;
  size?: "xs" | "sm";
  taskPacket: ProjectManagerTaskPacket | null;
  t: Translate;
}) {
  if (taskPacket?.sessionLink) {
    return (
      <a
        className="inline-flex items-center self-center text-xs font-medium text-brand hover:underline"
        href={taskPacket.sessionLink.href}
      >
        <ExternalLink className="mr-1 size-3" />
        {t("projects.projectManagerTaskPacketOpenSession")}
      </a>
    );
  }
  if (!taskPacket) return null;

  return (
    <Button
      size={size}
      variant="outline"
      disabled={isStarting}
      onClick={() => onQuickStart(item)}
    >
      <Play className={size === "xs" ? "mr-1 size-3" : "mr-2 size-4"} />
      {isStarting
        ? t("projects.projectManagerTaskPacketStarting")
        : t("projects.projectManagerTaskPacketQuickStart")}
    </Button>
  );
}

export function ProjectManagerStatusActions({
  disabled,
  item,
  onStatusChange,
  size = "sm",
  t,
}: {
  disabled: boolean;
  item: ProjectManagerWorkItem;
  onStatusChange: (item: ProjectManagerWorkItem, nextStatus: ProjectManagerWorkItemStatus) => void;
  size?: "xs" | "sm";
  t: Translate;
}) {
  const nextStatuses = PROJECT_MANAGER_STATUS_TRANSITIONS[item.status];
  if (nextStatuses.length === 0) {
    return <span className="inline-flex h-9 items-center text-xs text-muted-foreground">-</span>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size={size} variant="outline" disabled={disabled}>
          <ArrowRightCircle className={size === "xs" ? "mr-1 size-3" : "mr-2 size-4"} />
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
