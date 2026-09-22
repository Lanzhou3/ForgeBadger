"use client";

import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { ArrowUpRight, GripVertical, Plus } from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";

import { Button } from "@/components/ui/button";
import { useLanguage } from "@/hooks/use-language";
import { cn } from "@/lib/utils";
import { formatColumnStats, type SessionBoardColumnData } from "./session-board-utils";

interface SessionBoardColumnProps {
  column: SessionBoardColumnData;
  index: number;
  /** Header accent color; neutral gray for the unlinked column. */
  color: string | null;
  /** Applied column width in px (shared across all columns). */
  width: number;
  onNewSessionFor: (projectId: string) => void;
  onOpenProject: (projectId: string) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  children: ReactNode;
}

export function SessionBoardColumn({
  column,
  index,
  color,
  width,
  onNewSessionFor,
  onOpenProject,
  onResizeStart,
  children,
}: SessionBoardColumnProps) {
  const { t } = useLanguage();
  const sortable = !column.unlinked;
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    transform,
    isDragging,
  } = useDraggable({ id: column.key, disabled: !sortable });
  const { setNodeRef: setDropRef } = useDroppable({ id: column.key, disabled: !sortable });

  const setRefs = (node: HTMLElement | null) => {
    setDragRef(node);
    setDropRef(node);
  };

  return (
    <section
      ref={setRefs}
      aria-label={column.projectName}
      className={cn(
        "forgebadger-board-column-in relative flex shrink-0 flex-col gap-2 self-start",
        isDragging ? "z-20 opacity-80" : ""
      )}
      style={{
        width,
        animationDelay: `${index * 40}ms`,
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : undefined,
      }}
    >
      <header className="sticky top-0 z-10 flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5">
        {sortable ? (
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`${t("sessions.dragColumn")} · ${column.projectName}`}
            className="flex size-6 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground active:cursor-grabbing"
          >
            <GripVertical className="size-4" />
          </button>
        ) : null}
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-full",
            color ? "" : "bg-muted-foreground/40"
          )}
          style={color ? { backgroundColor: color } : undefined}
        />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold" title={column.projectName}>
          {column.projectName}
        </h2>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatColumnStats(t("sessions.columnStats"), column.runningCount, column.totalCount)}
        </span>
        {sortable && column.projectId ? (
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={`${t("projects.newSession")} · ${column.projectName}`}
              onClick={() => onNewSessionFor(column.projectId ?? "")}
            >
              <Plus className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={`${t("sessions.openProject")} · ${column.projectName}`}
              onClick={() => onOpenProject(column.projectId ?? "")}
            >
              <ArrowUpRight className="size-4" />
            </Button>
          </div>
        ) : null}
      </header>
      <div className="flex flex-col gap-2">
        {column.sessions.length === 0 ? (
          <div
            className={cn(
              "rounded-lg border border-dashed border-border/70 py-8 text-center",
              "text-xs text-muted-foreground"
            )}
          >
            {t("sessions.columnEmpty")}
          </div>
        ) : (
          children
        )}
      </div>
      <div
        role="separator"
        aria-label={t("sessions.resizeColumn")}
        aria-orientation="vertical"
        onPointerDown={onResizeStart}
        className="absolute inset-y-3 right-[-5px] z-10 w-2 cursor-col-resize touch-none rounded-full transition-colors hover:bg-brand/30"
      />
    </section>
  );
}
