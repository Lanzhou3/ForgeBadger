"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";

import { gsap, useGSAP } from "@/lib/gsap-motion";
import type { Session, SessionBoardTask } from "@/lib/api";
import { sessionTabGroupColor } from "@/lib/session-tabs";
import { cn } from "@/lib/utils";
import { SessionBoardCard } from "./SessionBoardCard";
import { SessionBoardColumn } from "./SessionBoardColumn";
import { clampColumnWidth, moveColumnKey } from "./session-board-prefs";
import {
  isRecentlyCreated,
  type SessionBoardColumnData,
} from "./session-board-utils";

const EDGE_FADE_PX = 32;
const SCROLL_EDGE_TOLERANCE_PX = 1;
/** Cap the staggered card entrance per column so wide lanes stay snappy. */
const ENTRANCE_CARDS_PER_COLUMN = 4;
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

export function buildEdgeFadeMask(fadeLeft: boolean, fadeRight: boolean): string | undefined {
  if (!fadeLeft && !fadeRight) {
    return undefined;
  }
  const from = fadeLeft ? `transparent, black ${EDGE_FADE_PX}px` : "black";
  const to = fadeRight ? `black calc(100% - ${EDGE_FADE_PX}px), transparent` : "black";
  return `linear-gradient(to right, ${from}, ${to})`;
}

interface SessionBoardProps {
  columns: SessionBoardColumnData[];
  sessionTasks: Record<string, SessionBoardTask[]>;
  prompts: Record<string, string>;
  now: number | null;
  actionPending: boolean;
  columnWidth: number;
  onColumnWidthChange: (width: number) => void;
  onColumnOrderChange: (order: string[]) => void;
  onOpenSession: (session: Session) => void;
  onStartSession: (session: Session) => void;
  onStopSession: (session: Session) => void;
  onDeleteSession: (session: Session) => void;
}

export function SessionBoard({
  columns,
  sessionTasks,
  prompts,
  now,
  actionPending,
  columnWidth,
  onColumnWidthChange,
  onColumnOrderChange,
  onOpenSession,
  onStartSession,
  onStopSession,
  onDeleteSession,
}: SessionBoardProps) {
  const router = useRouter();
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [edgeFade, setEdgeFade] = useState({ left: false, right: false });
  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  const width = liveWidth ?? columnWidth;

  // One entrance per mount: useGSAP's empty-config effect runs once per mount
  // (recreated in Strict Mode after its cleanup revert, which is what we want),
  // so filters, polling refetches, and session actions never replay it.
  useGSAP(
    () => {
      const root = scrollRef.current;
      if (!root || window.matchMedia?.(REDUCED_MOTION)?.matches) {
        return;
      }
      const columnEls = Array.from(
        root.querySelectorAll<HTMLElement>(".forgebadger-board-column")
      );
      if (columnEls.length === 0) {
        return;
      }
      const timeline = gsap.timeline({ defaults: { ease: "power2.out" } });
      columnEls.forEach((columnEl, columnIndex) => {
        // Animate the inner wrapper, never the section: the section's inline
        // transform is owned by dnd-kit while dragging.
        const entranceEl = columnEl.querySelector<HTMLElement>("[data-board-entrance]");
        if (!entranceEl) {
          return;
        }
        const columnAt = columnIndex * 0.07;
        timeline.fromTo(
          entranceEl,
          { autoAlpha: 0, y: 10 },
          {
            autoAlpha: 1,
            y: 0,
            duration: 0.3,
            clearProps: "transform,opacity,visibility",
          },
          columnAt
        );
        const cardEls = Array.from(
          entranceEl.querySelectorAll<HTMLElement>("[data-session-id]")
        ).slice(0, ENTRANCE_CARDS_PER_COLUMN);
        if (cardEls.length > 0) {
          timeline.fromTo(
            cardEls,
            { autoAlpha: 0, y: 6 },
            {
              autoAlpha: 1,
              y: 0,
              duration: 0.22,
              stagger: 0.03,
              clearProps: "transform,opacity,visibility",
            },
            columnAt + 0.06
          );
        }
      });
    },
    { scope: scrollRef }
  );

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    const updateEdgeFade = () => {
      const maxScrollLeft = element.scrollWidth - element.clientWidth;
      setEdgeFade({
        left: element.scrollLeft > SCROLL_EDGE_TOLERANCE_PX,
        right: element.scrollLeft < maxScrollLeft - SCROLL_EDGE_TOLERANCE_PX,
      });
    };
    updateEdgeFade();
    element.addEventListener("scroll", updateEdgeFade, { passive: true });
    const observer = new ResizeObserver(updateEdgeFade);
    observer.observe(element);
    for (const child of Array.from(element.children)) {
      observer.observe(child);
    }
    return () => {
      element.removeEventListener("scroll", updateEdgeFade);
      observer.disconnect();
    };
  }, [columns.length, width]);

  const maskImage = buildEdgeFadeMask(edgeFade.left, edgeFade.right);

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = width;
    const handleMove = (moveEvent: PointerEvent) => {
      setLiveWidth(clampColumnWidth(startWidth + moveEvent.clientX - startX));
    };
    const handleUp = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", handleMove);
      const finalWidth = clampColumnWidth(startWidth + upEvent.clientX - startX);
      setLiveWidth(null);
      onColumnWidthChange(finalWidth);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    const linkedKeys = columns.filter((column) => !column.unlinked).map((column) => column.key);
    const next = moveColumnKey(linkedKeys, String(active.id), String(over.id));
    if (next.join("\n") !== linkedKeys.join("\n")) {
      onColumnOrderChange(next);
    }
  };

  return (
    <DndContext sensors={dragSensors} onDragEnd={handleDragEnd}>
      <div
        ref={scrollRef}
        className="overflow-x-auto pb-2"
        style={
          maskImage
            ? { maskImage, WebkitMaskImage: maskImage }
            : undefined
        }
      >
        <div className="flex items-start gap-4">
          {columns.map((column, index) => (
            <SessionBoardColumn
              key={column.key}
              column={column}
              index={index}
              color={column.unlinked ? null : sessionTabGroupColor(column.projectName)}
              width={width}
              onNewSessionFor={(projectId) => router.push(`/projects/${projectId}?tab=sessions`)}
              onOpenProject={(projectId) => router.push(`/projects/${projectId}`)}
              onResizeStart={beginResize}
            >
              {column.sessions.map((session) => (
                <SessionBoardCard
                  key={session.id}
                  session={session}
                  tasks={sessionTasks[session.id] ?? []}
                  lastPrompt={prompts[session.id]}
                  highlight={now !== null && isRecentlyCreated(session, now, 120_000)}
                  now={now}
                  actionPending={actionPending}
                  onOpen={onOpenSession}
                  onStart={onStartSession}
                  onStop={onStopSession}
                  onDelete={onDeleteSession}
                />
              ))}
            </SessionBoardColumn>
          ))}
        </div>
      </div>
    </DndContext>
  );
}

export function SessionBoardSkeleton() {
  return (
    <div className="flex items-start gap-4 overflow-x-auto pb-2">
      {[0, 1, 2].map((columnIndex) => (
        <div key={columnIndex} className="flex w-[300px] shrink-0 flex-col gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 shadow-xs">
            <div className="size-2 rounded-full bg-muted-foreground/30" />
            <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            <div className="ml-auto h-3 w-16 animate-pulse rounded bg-muted" />
          </div>
          <div className="flex flex-col gap-2 rounded-xl bg-muted/20 p-2">
            {[0, 1, 2].map((cardIndex) => (
              <div
                key={cardIndex}
                className={cn("animate-pulse rounded-lg border border-border bg-card p-3")}
              >
                <div className="flex items-center gap-2">
                  <div className="size-2 rounded-full bg-muted" />
                  <div className="h-4 w-16 rounded bg-muted" />
                </div>
                <div className="mt-2 h-4 w-4/5 rounded bg-muted" />
                <div className="mt-1.5 h-3 w-2/5 rounded bg-muted" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
