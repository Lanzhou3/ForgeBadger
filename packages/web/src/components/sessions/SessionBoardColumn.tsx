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
  onNewSessionFor: (projectId: string, projectName: string) => void;
  onOpenProject: (projectId: string) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  children: ReactNode;
}

export function SessionBoardColumn({
  column,
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
        "forgebadger-board-column relative flex h-full min-h-0 shrink-0 flex-col",
        isDragging ? "z-20 opacity-80" : ""
      )}
      style={{
        width,
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : undefined,
      }}
    >
      {/* Entrance animation target: the section's inline transform is owned by
          dnd-kit, so GSAP animates this inner wrapper instead. */}
      <div
        data-board-entrance
        className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/70 bg-muted/25"
      >
        <header className="flex shrink-0 items-center gap-2 rounded-t-xl border-b border-border/60 bg-card/60 px-3 py-2.5 backdrop-blur-xs">
          {sortable ? (
            <button
              type="button"
              {...attributes}
              {...listeners}
              aria-label={`${t("sessions.dragColumn")} · ${column.projectName}`}
              className="flex size-6 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground active:cursor-grabbing"
            >
              <GripVertical className="size-4" aria-hidden="true" />
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
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight" title={column.projectName}>
            {column.projectName}
          </h2>
          <span
            title={formatColumnStats(t("sessions.columnStats"), column.runningCount, column.totalCount)}
            aria-label={formatColumnStats(t("sessions.columnStats"), column.runningCount, column.totalCount)}
            className={cn(
              "forgebadger-tabular-nums shrink-0 rounded-full px-1.5 py-0.5 text-[11px]",
              column.runningCount > 0
                ? "bg-success/10 font-medium text-success"
                : "bg-muted/60 text-muted-foreground"
            )}
          >
            {column.runningCount}/{column.totalCount}
          </span>
          {sortable && column.projectId ? (
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground"
                aria-label={`${t("projects.newSession")} · ${column.projectName}`}
                title={`${t("projects.newSession")} · ${column.projectName}`}
                onClick={() => onNewSessionFor(column.projectId ?? "", column.projectName)}
              >
                <Plus className="size-4" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground"
                aria-label={`${t("sessions.openProject")} · ${column.projectName}`}
                title={`${t("sessions.openProject")} · ${column.projectName}`}
                onClick={() => onOpenProject(column.projectId ?? "")}
              >
                <ArrowUpRight className="size-4" aria-hidden="true" />
              </Button>
            </div>
          ) : null}
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain p-2">
          {column.sessions.length === 0 ? (
            <div
              className={cn(
                "rounded-lg border border-dashed border-border/60 py-8 text-center",
                "text-xs text-muted-foreground"
              )}
            >
              {t("sessions.columnEmpty")}
            </div>
          ) : (
            children
          )}
        </div>
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
