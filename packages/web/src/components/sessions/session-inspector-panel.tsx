"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ChevronRight, ClipboardList, Gauge, GitBranch } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useTrilingual } from "@/hooks/use-trilingual";
import { cn } from "@/lib/utils";

export type InspectorTabId = "changes" | "task" | "quota";

const ACTIVE_TAB_STORAGE_KEY = "forgebadger.session-inspector-tab";
const WIDTH_STORAGE_KEY = "forgebadger.session-inspector-width";
export const INSPECTOR_MIN_WIDTH = 268;
export const INSPECTOR_MAX_WIDTH = 520;
export const INSPECTOR_DEFAULT_WIDTH = 336;

export function clampInspectorWidth(value: number): number {
  if (!Number.isFinite(value)) return INSPECTOR_DEFAULT_WIDTH;
  return Math.min(INSPECTOR_MAX_WIDTH, Math.max(INSPECTOR_MIN_WIDTH, Math.round(value)));
}

function readStoredWidth(): number {
  try {
    const raw = window.localStorage.getItem(WIDTH_STORAGE_KEY);
    if (!raw) return INSPECTOR_DEFAULT_WIDTH;
    return clampInspectorWidth(Number(raw));
  } catch {
    return INSPECTOR_DEFAULT_WIDTH;
  }
}

function readStoredTab(): InspectorTabId {
  try {
    const raw = window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    if (raw === "changes" || raw === "task" || raw === "quota") return raw;
  } catch {
    // Storage may be unavailable in restricted contexts; fall back to default.
  }
  return "changes";
}

interface SessionInspectorPanelProps {
  /** Desktop column visibility. Below lg the same flag opens a right-side sheet. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gitContent: ReactNode;
  gitCount?: number | null;
  taskContent: ReactNode;
  taskAvailable: boolean;
  quotaContent: ReactNode;
  quotaAvailable: boolean;
}

/**
 * Right-side session inspector: one tabbed surface (changes · task packet ·
 * quota) instead of three stacked bordered panels, so a file list can use the
 * full pane height without nested scrollbars. The pane is resizable on desktop
 * and becomes a sheet below lg, where the column is hidden entirely.
 */
export function SessionInspectorPanel({
  open,
  onOpenChange,
  gitContent,
  gitCount,
  taskContent,
  taskAvailable,
  quotaContent,
  quotaAvailable,
}: SessionInspectorPanelProps) {
  const pick = useTrilingual();
  const [tab, setTab] = useState<InspectorTabId>("changes");
  const [width, setWidth] = useState(INSPECTOR_DEFAULT_WIDTH);
  const [isDesktop, setIsDesktop] = useState(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    setTab(readStoredTab());
    setWidth(readStoredWidth());
    // No media query support (test/jsdom runtimes): render the inline column
    // rather than a modal sheet, which would trap the whole page.
    if (typeof window.matchMedia !== "function") {
      setIsDesktop(true);
      return;
    }
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const tabs = useMemo(
    () =>
      (
        [
          {
            id: "changes" as const,
            label: pick("变更", "變更", "Changes"),
            count: gitCount ?? null,
            icon: GitBranch,
            available: true,
          },
          {
            id: "task" as const,
            label: pick("任务包", "任務包", "Task packet"),
            count: null,
            icon: ClipboardList,
            available: taskAvailable,
          },
          {
            id: "quota" as const,
            label: pick("额度", "額度", "Quota"),
            count: null,
            icon: Gauge,
            available: quotaAvailable,
          },
        ]
      ).filter((entry) => entry.available),
    [gitCount, pick, quotaAvailable, taskAvailable]
  );

  // A persisted tab can point at a tab this session does not expose (e.g. a
  // session without a project has no changes tab): fall back to the first.
  const activeTab = tabs.some((entry) => entry.id === tab) ? tab : (tabs[0]?.id ?? "changes");

  const selectTab = useCallback((next: InspectorTabId) => {
    setTab(next);
    try {
      window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, next);
    } catch {
      // Persisting the tab is a nicety, never a requirement.
    }
  }, []);

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width };
    const handleMove = (moveEvent: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== moveEvent.pointerId) return;
      // Dragging the handle left widens the pane.
      setWidth(clampInspectorWidth(drag.startWidth + (drag.startX - moveEvent.clientX)));
    };
    const handleUp = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag || drag.pointerId !== upEvent.pointerId) return;
      const finalWidth = clampInspectorWidth(drag.startWidth + (drag.startX - upEvent.clientX));
      setWidth(finalWidth);
      try {
        window.localStorage.setItem(WIDTH_STORAGE_KEY, String(finalWidth));
      } catch {
        // Width persistence is optional.
      }
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  const tabList = (
    <div
      role="tablist"
      aria-label={pick("会话辅助面板", "會話輔助面板", "Session inspector")}
      className="flex items-center gap-0.5 border-b border-border/70 bg-muted/25 px-1.5 py-1"
    >
      {tabs.map((entry) => {
        const Icon = entry.icon;
        const selected = entry.id === activeTab;
        return (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => selectTab(entry.id)}
            className={cn(
              "inline-flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded px-2 text-xs font-medium text-muted-foreground transition-[background-color,color,box-shadow]",
              "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              selected && "bg-card text-foreground shadow-xs"
            )}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{entry.label}</span>
            {entry.count !== null && entry.count > 0 ? (
              <span className="forgebadger-tabular-nums shrink-0 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
                {entry.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );

  const body = (
    <div
      role="tabpanel"
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3"
    >
      <div hidden={activeTab !== "changes"}>{gitContent}</div>
      <div hidden={activeTab !== "task"}>{taskContent}</div>
      <div hidden={activeTab !== "quota"}>{quotaContent}</div>
    </div>
  );

  if (!isDesktop) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-sm">
          <SheetHeader className="border-b border-border/70">
            <SheetTitle className="text-sm">{pick("会话辅助面板", "會話輔助面板", "Session inspector")}</SheetTitle>
            <SheetDescription className="sr-only">
              {pick("查看 Git 变更、任务包与模型额度。", "檢視 Git 變更、任務包與模型額度。", "Inspect Git changes, task packets, and quota.")}
            </SheetDescription>
          </SheetHeader>
          {tabList}
          {body}
        </SheetContent>
      </Sheet>
    );
  }

  if (!open) return null;

  return (
    <aside
      aria-label={pick("会话辅助面板", "會話輔助面板", "Session inspector")}
      className="relative hidden min-h-0 shrink-0 flex-col border-l border-border bg-sidebar/55 lg:flex"
      style={{ width }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={pick("调整侧栏宽度", "調整側欄寬度", "Resize inspector")}
        onPointerDown={beginResize}
        className="group absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none"
      >
        <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-brand/50" />
      </div>
      {tabList}
      {body}
    </aside>
  );
}
