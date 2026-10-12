"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronRight, GripVertical, MoreHorizontal, Plus, X } from "lucide-react";
import {
  DndContext, PointerSensor, closestCenter, useSensor, useSensors,
  type DragEndEvent, type Modifier,
} from "@dnd-kit/core";
import {
  SortableContext, horizontalListSortingStrategy, useSortable,
} from "@dnd-kit/sortable";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CliBrandIcon } from "@/components/cli-brand-icon";
import { SessionLaunchDialog } from "@/components/sessions/session-launch-dialog";
import { useLanguage } from "@/hooks/use-language";
import { useSessionWorkStates } from "@/hooks/use-session-work-states";
import { getSession, type SessionWorkState } from "@/lib/api";
import { getCliBrand } from "@/lib/cli-brand";
import { FORGEBADGER_GATEWAY_EVENT } from "@/lib/gateway-events";
import type { GatewayEvent } from "@/lib/notifications";
import { getSessionWriter } from "@/lib/platform-actions-api";
import { formatRelativeTime } from "@/lib/session-status";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  getLatestRunningTab,
  groupSessionTabs,
  readCollapsedSessionTabGroups,
  reorderSessionTab,
  notifySessionTabsChanged,
  readSessionTabs,
  removeSessionTab,
  sessionTabGroupColor,
  sessionTabGroupKey,
  sessionToTab,
  setSessionTabGroupCollapsed,
  splitSessionTabsByVisibility,
  upsertSessionTab,
  type SessionTab,
} from "@/lib/session-tabs";

export { notifySessionTabsChanged };

const horizontalDrag: Modifier = ({ transform }) => ({ ...transform, y: 0 });
const TAB_DRAG_MODIFIERS = [horizontalDrag];

/**
 * Warm the session page's queries on tab hover so a click navigates to an
 * already-populated screen instead of a cold fetch. Query keys mirror
 * sessions/[id]/page.tsx and use-terminal-writer.ts; the page's own fetches
 * then resolve from the cache.
 */
function prefetchSessionData(queryClient: QueryClient, sessionId: string) {
  void queryClient.prefetchQuery({
    queryKey: ["session", sessionId],
    queryFn: () => getSession(sessionId),
    retry: false,
  });
  void queryClient.prefetchQuery({
    queryKey: ["session-writer", sessionId],
    queryFn: () => getSessionWriter(sessionId),
    retry: false,
  });
}

interface Props {
  activeSessionId: string;
  /** Action cluster rendered at the trailing edge of the tab strip. */
  trailing?: ReactNode;
}

export function SessionTabs({ activeSessionId, trailing }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useLanguage();
  const workStates = useSessionWorkStates();
  const [tabs, setTabs] = useState<SessionTab[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set());
  // Client-only clock so the relative-time suffix that tells same-named
  // sessions apart never renders during SSR.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const previousActiveId = useRef(activeSessionId);
  const suppressTabClick = useRef(false);
  const dragClickTimer = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [fadeRight, setFadeRight] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const refreshTabs = useCallback(() => {
    setTabs(readSessionTabs());
    setCollapsedGroups(readCollapsedSessionTabGroups());
  }, []);

  useEffect(() => {
    refreshTabs();
    window.addEventListener("storage", refreshTabs);
    window.addEventListener("forgebadger-session-tabs-changed", refreshTabs);
    return () => {
      window.removeEventListener("storage", refreshTabs);
      window.removeEventListener("forgebadger-session-tabs-changed", refreshTabs);
    };
  }, [refreshTabs]);

  const setGroupCollapsed = useCallback((groupId: string, collapsed: boolean) => {
    setCollapsedGroups(setSessionTabGroupCollapsed(groupId, collapsed));
    notifySessionTabsChanged();
  }, []);

  // dnd-kit stops the drop click at document capture, so a Link's React
  // handler cannot prevent its native navigation. Cancel that default first.
  useEffect(() => {
    const preventDropClick = (event: MouseEvent) => {
      if (!suppressTabClick.current || !(event.target instanceof Element)) return;
      if (!scrollRef.current?.contains(event.target) || !event.target.closest("[data-session-tab-id]")) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("click", preventDropClick, true);
    return () => {
      window.removeEventListener("click", preventDropClick, true);
      window.clearTimeout(dragClickTimer.current);
    };
  }, []);

  const resetDragClickGuard = useCallback(() => {
    window.clearTimeout(dragClickTimer.current);
    dragClickTimer.current = window.setTimeout(() => { suppressTabClick.current = false; }, 0);
  }, []);

  // Navigation reveals the new active session; a deliberate collapse of the
  // current group stays collapsed through metadata updates and page reloads.
  useEffect(() => {
    if (previousActiveId.current === activeSessionId) return;
    const tab = readSessionTabs().find(entry => entry.id === activeSessionId);
    if (!tab) return;
    previousActiveId.current = activeSessionId;
    setGroupCollapsed(sessionTabGroupKey(tab), false);
  }, [activeSessionId, tabs, setGroupCollapsed]);

  const moveTab = useCallback((sourceId: string, targetId: string) => {
    setTabs(reorderSessionTab(sourceId, targetId));
    notifySessionTabsChanged();
  }, []);

  const reorderTab = useCallback(({ active, over }: DragEndEvent) => {
    resetDragClickGuard();
    if (!over || active.id === over.id) return;
    moveTab(String(active.id), String(over.id));
  }, [moveTab, resetDragClickGuard]);

  // Keep the active tab visible when the strip overflows.
  useEffect(() => {
    const container = scrollRef.current;
    const activeTab = container?.querySelector('[aria-current="page"]')
      ?? container?.querySelector('[data-active-group="true"]');
    activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeSessionId, tabs, collapsedGroups]);

  // Fade the trailing edge of the scroll area only when more tabs are hidden
  // behind the pinned action cluster — soft gradient instead of a hard cut.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => {
      setFadeRight(element.scrollWidth - element.scrollLeft - element.clientWidth > 1);
    };
    // No visible scrollbar by design; translate vertical wheel gestures into
    // horizontal scrolling so mouse users can still traverse the strip.
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      element.scrollLeft += event.deltaY;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.addEventListener("scroll", update, { passive: true });
    element.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", update);
      element.removeEventListener("wheel", onWheel);
    };
  }, [tabs, collapsedGroups]);

  const closeTab = useCallback((sessionId: string) => {
    const nextTabs = removeSessionTab(sessionId);
    setTabs(nextTabs);
    if (sessionId !== activeSessionId) {
      return;
    }

    // Never land on a dead tab: an exited session leaves a stale localStorage
    // tab whose page would show the not-found card (e.g. Copilot-command
    // sessions are auto-deleted server-side once their command finishes).
    // Prefer the most recently used running session; fall back to the session
    // list when nothing is running anymore.
    const nextActive = getLatestRunningTab(nextTabs);
    router.push(nextActive ? `/sessions/${nextActive.id}` : "/sessions");
  }, [activeSessionId, router]);

  // When the CLI process exits on its own (e.g. the user runs /exit), the
  // gateway flips the session to "exited"; close its tab instead of leaving a
  // dead terminal behind. Other statuses only refresh the tab's status dot —
  // "lost" in particular must stay visible as a failure state.
  useEffect(() => {
    const onGatewayEvent = (event: Event) => {
      const detail = event instanceof CustomEvent ? (event.detail as GatewayEvent) : undefined;
      if (detail?.type !== "session_status_changed") return;
      const sessionId = detail.payload?.session_id;
      const newStatus = detail.payload?.new_status;
      if (typeof sessionId !== "string" || typeof newStatus !== "string") return;
      const tab = readSessionTabs().find((entry) => entry.id === sessionId);
      if (!tab) return;
      if (newStatus === "exited") {
        toast.info(`${tab.label} · ${t("sessions.sessionExitedTabClosed")}`);
        closeTab(tab.id);
        return;
      }
      if (tab.status !== newStatus) {
        upsertSessionTab({ ...tab, status: newStatus, updatedAt: Date.now() });
        notifySessionTabsChanged();
      }
    };
    window.addEventListener(FORGEBADGER_GATEWAY_EVENT, onGatewayEvent);
    return () => window.removeEventListener(FORGEBADGER_GATEWAY_EVENT, onGatewayEvent);
  }, [closeTab, t]);

  const { visibleIds, hiddenTabs } = splitSessionTabsByVisibility(tabs, activeSessionId, undefined, collapsedGroups);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={TAB_DRAG_MODIFIERS}
      onDragStart={() => {
        window.clearTimeout(dragClickTimer.current);
        suppressTabClick.current = true;
      }}
      onDragCancel={resetDragClickGuard}
      onDragEnd={reorderTab}
      accessibility={{ screenReaderInstructions: { draggable: t("sessions.tabDragInstructions") } }}
    >
      <div className="flex h-10 min-w-0 items-end border-b border-border bg-muted/20 pl-16 pt-1.5 md:pl-2" data-testid="session-tabs">
        {/* Only the tab labels scroll; the + and action cluster stay pinned right. */}
        <div
          ref={scrollRef}
          className={
            fadeRight
              ? "flex min-w-0 flex-1 items-end gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,black_calc(100%_-_40px),transparent)]"
              : "flex min-w-0 flex-1 items-end gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          }
        >
          {groupSessionTabs(tabs).map((group) => {
            const visibleGroupTabs = group.tabs.filter((tab) => visibleIds.has(tab.id));
            const collapsed = collapsedGroups.has(group.id);
            const groupColor = sessionTabGroupColor(group.projectName ?? "");
            const groupProjectId = group.tabs.find((tab) => tab.projectId)?.projectId;
            const projectName = group.projectName ?? t("sessions.unknownProject");
            const toggleLabel = t(collapsed ? "sessions.expandTabGroup" : "sessions.collapseTabGroup")
              .replace("{project}", projectName);
            const groupElementId = `session-tab-group-${encodeURIComponent(group.id)}`;
            return (
              <div key={group.id} role="group" aria-label={projectName} className="flex shrink-0 items-end gap-1">
                <button
                  type="button"
                  className="mb-1 inline-flex h-7 max-w-44 shrink-0 items-center gap-1 rounded-md px-2 text-[10px] font-semibold hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[active-group=true]:ring-1 data-[active-group=true]:ring-inset data-[active-group=true]:ring-current"
                  style={{ backgroundColor: `${groupColor}26`, color: groupColor }}
                  title={toggleLabel}
                  aria-label={toggleLabel}
                  aria-expanded={!collapsed}
                  aria-controls={groupElementId}
                  data-active-group={group.tabs.some(tab => tab.id === activeSessionId) ? "true" : undefined}
                  onClick={() => setGroupCollapsed(group.id, !collapsed)}
                >
                  <ChevronRight className={collapsed ? "size-3 shrink-0" : "size-3 shrink-0 rotate-90"} />
                  <span className="truncate">{projectName}</span>
                  <span className="shrink-0 opacity-70">({group.tabs.length})</span>
                </button>
                <SortableContext items={visibleGroupTabs.map(tab => tab.id)} strategy={horizontalListSortingStrategy}>
                  <div id={groupElementId} className="flex items-end gap-1">
                    {visibleGroupTabs.map((tab) => {
                      const active = tab.id === activeSessionId || pathname === `/sessions/${tab.id}`;
                      return (
                        <SessionTabItem
                          key={tab.id}
                          tab={tab}
                          workState={workStates.get(tab.id)?.state}
                          active={active}
                          now={now}
                          closeLabel={t("sessions.closeTab")}
                          reorderLabel={t("sessions.reorderTab").replace("{session}", tab.label)}
                          onClose={() => closeTab(tab.id)}
                          onReorder={moveTab}
                        />
                      );
                    })}
                  </div>
                </SortableContext>
                {group.projectName && groupProjectId && (
                  <NewCliSessionButton
                    projectId={groupProjectId}
                    projectName={group.projectName}
                  />
                )}
              </div>
            );
          })}
        </div>
        <div className="flex shrink-0 items-center gap-1 self-center px-1">
          {hiddenTabs.length > 0 && (
            <OverflowTabsMenu
              workStates={workStates}
              hiddenTabs={hiddenTabs}
              overflowLabel={t("sessions.overflowTabs")}
              onNavigate={(id) => {
                // Restore the tab immediately on click so the strip reflects the
                // switch before the navigation resolves (mirrors the board's
                // openSession), then navigate.
                const tab = tabs.find((entry) => entry.id === id);
                if (tab) {
                  setGroupCollapsed(sessionTabGroupKey(tab), false);
                  upsertSessionTab(tab);
                  notifySessionTabsChanged();
                }
                router.push(`/sessions/${id}`);
              }}
            />
          )}
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            title={t("sessions.openSessionList")}
            aria-label={t("sessions.openSessionList")}
          >
            <Link href="/sessions">
              <Plus className="size-3.5" />
            </Link>
          </Button>
          {trailing}
        </div>
      </div>
    </DndContext>
  );
}

function SessionTabItem({
  tab,
  workState,
  active,
  now,
  closeLabel,
  reorderLabel,
  onClose,
  onReorder,
}: {
  tab: SessionTab;
  workState?: SessionWorkState["state"];
  active: boolean;
  now: number | null;
  closeLabel: string;
  reorderLabel: string;
  onClose: () => void;
  onReorder: (sourceId: string, targetId: string) => void;
}) {
  const brand = getCliBrand(tab.aiTool);
  const { language } = useLanguage();
  const text = tab.lastPrompt ?? tab.label;
  // Same-named sessions (default name = project name) are told apart by the
  // tab's last update time when no prompt has been recorded yet.
  const relativeSuffix =
    !tab.lastPrompt && now !== null ? ` · ${formatRelativeTime(tab.updatedAt, now, language)}` : "";
  const queryClient = useQueryClient();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
    data: { groupId: sessionTabGroupKey(tab) },
  });

  return (
    <div
      ref={setNodeRef}
      data-session-tab-id={tab.id}
      onPointerDown={(event) => {
        if (event.target instanceof Element && event.target.closest("button")) return;
        listeners?.onPointerDown?.(event);
      }}
      className={cn(
        "select-none",
        isDragging && "relative z-10 opacity-80",
        active
          ? "group flex h-8 max-w-60 shrink-0 items-center gap-2 rounded-t-md border border-b-background border-border bg-background px-2.5 text-left text-xs text-foreground transition-colors duration-150"
          : "group flex h-8 max-w-60 shrink-0 items-center gap-2 rounded-t-md border border-transparent bg-transparent px-2.5 text-left text-xs text-muted-foreground transition-colors duration-150 hover:border-border/60 hover:bg-muted/40 hover:text-foreground"
      )}
      style={{
        ...(active ? { boxShadow: `inset 0 2px 0 0 ${brand.color}` } : {}),
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition: transition ?? undefined,
      }}
      title={`${text}${tab.projectName ? ` · ${tab.projectName}` : ""} · ${brand.label}`}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
        aria-label={reorderLabel}
        title={reorderLabel}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          event.stopPropagation();
          const group = groupSessionTabs(readSessionTabs()).find(group => group.id === sessionTabGroupKey(tab));
          const index = group?.tabs.findIndex(entry => entry.id === tab.id) ?? -1;
          if (index < 0) return;
          const target = group?.tabs[index + (event.key === "ArrowLeft" ? -1 : 1)];
          if (target) onReorder(tab.id, target.id);
        }}
      >
        <GripVertical className="size-3" />
      </button>
      <span className="flex shrink-0 items-center gap-1.5">
        <SessionWorkDot tab={tab} state={workState} />
        {/* Official CLI logo; fall back to the text short label for unknown CLIs.
            mcode renders its full app-icon tile (blue tile + white card + thin
            frame), so it gets one size step up here to match the visual weight
            of the filled single-color marks at this small slot. */}
        {brand.id !== "unknown" ? (
          <CliBrandIcon
            aiTool={tab.aiTool}
            className={brand.id === "mcode" ? "size-3.5" : "size-3"}
          />
        ) : (
          <span
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: brand.color }}
          >
            {brand.shortLabel}
          </span>
        )}
      </span>
      <Link
        href={`/sessions/${tab.id}`}
        draggable={false}
        aria-current={active ? "page" : undefined}
        className="min-w-0 flex-1 truncate"
        onMouseEnter={() => prefetchSessionData(queryClient, tab.id)}
      >
        {text}
        {relativeSuffix ? <span className="text-muted-foreground">{relativeSuffix}</span> : null}
      </Link>
      <button
        type="button"
        aria-label={`${closeLabel} ${tab.label}`}
        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity duration-150 hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

/**
 * Collapsed view for tabs beyond the inline strip: a "…" button whose menu
 * lists the hidden sessions so a pathological number of running tabs can't
 * turn the strip into an endless horizontal scroll.
 */
function OverflowTabsMenu({
  hiddenTabs,
  workStates,
  overflowLabel,
  onNavigate,
}: {
  hiddenTabs: SessionTab[];
  workStates: ReadonlyMap<string, SessionWorkState>;
  overflowLabel: string;
  onNavigate: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 self-center text-muted-foreground"
          title={overflowLabel}
          aria-label={`${overflowLabel} (${hiddenTabs.length})`}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>{overflowLabel}</DropdownMenuLabel>
        {hiddenTabs.map((tab) => {
          const brand = getCliBrand(tab.aiTool);
          return (
            <DropdownMenuItem
              key={tab.id}
              onSelect={() => onNavigate(tab.id)}
              onMouseEnter={() => prefetchSessionData(queryClient, tab.id)}
            >
              <span className="flex min-w-0 items-center gap-2">
                <SessionWorkDot tab={tab} state={workStates.get(tab.id)?.state} />
                {brand.id !== "unknown" ? (
                  <CliBrandIcon aiTool={tab.aiTool} className="size-3.5 shrink-0" />
                ) : null}
                <span className="min-w-0 flex-1 truncate">
                  {tab.lastPrompt ?? tab.label}
                </span>
                {tab.projectName ? (
                  <span className="shrink-0 truncate text-[10px] text-muted-foreground">
                    {tab.projectName}
                  </span>
                ) : null}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SessionWorkDot({ tab, state }: { tab: SessionTab; state?: SessionWorkState["state"] }) {
  const { t } = useLanguage();
  const working = tab.status === "running" && state === "working";
  const label = t(tab.status !== "running" ? "sessions.workInactive"
    : working ? "sessions.workWorking" : state === "idle" ? "sessions.workIdle" : "sessions.workUnknown");
  return <span
    data-session-work-id={tab.id}
    data-work-state={tab.status === "running" ? state ?? "unknown" : "idle"}
    role="img" aria-label={label} title={label}
    className={cn("size-1.5 shrink-0 rounded-full", working ? "motion-safe:animate-pulse" : "opacity-50")}
    style={{ backgroundColor: getCliBrand(tab.aiTool).color }}
  />;
}

/**
 * "+" appended after a project's last tab: opens the CLI picker and creates a
 * new session for that project with the chosen CLI.
 */
function NewCliSessionButton({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  const label = `${t("projects.newSession")} · ${projectName}`;

  return (
    <>
        <Button
          variant="ghost"
          size="icon"
          className="mb-1 size-6 shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
          title={label}
          aria-label={label}
          onClick={() => setOpen(true)}
        >
          <Plus className="size-3.5" />
        </Button>
      <SessionLaunchDialog
        projectId={projectId}
        open={open}
        onOpenChange={setOpen}
        onCreated={(session) => {
          upsertSessionTab(sessionToTab(session));
          notifySessionTabsChanged();
          router.push(`/sessions/${session.id}`);
        }}
      />
    </>
  );
}
