"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MoreHorizontal, Plus, X } from "lucide-react";

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
import { getCliBrand } from "@/lib/cli-brand";
import { FORGEBADGER_GATEWAY_EVENT } from "@/lib/gateway-events";
import type { GatewayEvent } from "@/lib/notifications";
import { toast } from "@/lib/toast";
import {
  groupSessionTabs,
  notifySessionTabsChanged,
  readSessionTabs,
  removeSessionTab,
  sessionTabGroupColor,
  sessionToTab,
  splitSessionTabsByVisibility,
  upsertSessionTab,
  type SessionTab,
} from "@/lib/session-tabs";

export { notifySessionTabsChanged };

interface Props {
  activeSessionId: string;
  /** Action cluster rendered at the trailing edge of the tab strip. */
  trailing?: ReactNode;
}

export function SessionTabs({ activeSessionId, trailing }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useLanguage();
  const [tabs, setTabs] = useState<SessionTab[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [fadeRight, setFadeRight] = useState(false);

  const refreshTabs = useCallback(() => {
    setTabs(readSessionTabs());
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

  // Keep the active tab visible when the strip overflows.
  useEffect(() => {
    const container = scrollRef.current;
    const activeTab = container?.querySelector('[aria-current="page"]');
    activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeSessionId, tabs]);

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
  }, [tabs]);

  const closeTab = useCallback((sessionId: string) => {
    const nextTabs = removeSessionTab(sessionId);
    setTabs(nextTabs);
    if (sessionId !== activeSessionId) {
      return;
    }

    const nextActive = nextTabs.find((tab) => tab.id !== sessionId);
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

  const { visibleIds, hiddenTabs } = splitSessionTabsByVisibility(tabs, activeSessionId);

  return (
    <div className="flex h-10 min-w-0 items-end border-b border-border bg-muted/20 pl-2 pt-1.5">
      {/* Only the tab labels scroll; the + and action cluster stay pinned right. */}
      <div
        ref={scrollRef}
        className={
          fadeRight
            ? "flex min-w-0 flex-1 items-end gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,black_calc(100%_-_40px),transparent)]"
            : "flex min-w-0 flex-1 items-end gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        }
      >
        {groupSessionTabs(tabs).map((group, groupIndex, groups) => {
          const visibleGroupTabs = group.tabs.filter((tab) => visibleIds.has(tab.id));
          if (visibleGroupTabs.length === 0) return null;
          const groupColor = sessionTabGroupColor(group.projectName ?? "");
          const groupProjectId = group.tabs.find((tab) => tab.projectId)?.projectId;
          return (
            <Fragment key={group.projectName ?? "__no_project__"}>
              {groups.length > 1 && (
                <span
                  className="mb-1 inline-flex h-7 max-w-36 shrink-0 items-center truncate rounded-md px-2 text-[10px] font-semibold"
                  style={{ backgroundColor: `${groupColor}26`, color: groupColor }}
                  title={group.projectName ?? t("sessions.unknownProject")}
                >
                  {group.projectName ?? t("sessions.unknownProject")}
                </span>
              )}
              {visibleGroupTabs.map((tab) => {
                const active = tab.id === activeSessionId || pathname === `/sessions/${tab.id}`;
                return (
                  <SessionTabItem
                    key={tab.id}
                    tab={tab}
                    active={active}
                    closeLabel={t("sessions.closeTab")}
                    onClose={() => closeTab(tab.id)}
                  />
                );
              })}
              {group.projectName && groupProjectId && (
                <NewCliSessionButton
                  projectId={groupProjectId}
                  projectName={group.projectName}
                />
              )}
            </Fragment>
          );
        })}
      </div>
      <div className="flex shrink-0 items-center gap-1 self-center px-1">
        {hiddenTabs.length > 0 && (
          <OverflowTabsMenu
            hiddenTabs={hiddenTabs}
            overflowLabel={t("sessions.overflowTabs")}
            onNavigate={(id) => {
              // Restore the tab immediately on click so the strip reflects the
              // switch before the navigation resolves (mirrors the board's
              // openSession), then navigate.
              const tab = tabs.find((entry) => entry.id === id);
              if (tab) {
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
  );
}

function SessionTabItem({
  tab,
  active,
  closeLabel,
  onClose,
}: {
  tab: SessionTab;
  active: boolean;
  closeLabel: string;
  onClose: () => void;
}) {
  const brand = getCliBrand(tab.aiTool);
  const running = tab.status === "running";
  const text = tab.lastPrompt ?? tab.label;

  return (
    <div
      className={
        active
          ? "group flex h-8 max-w-60 shrink-0 items-center gap-2 rounded-t-md border border-b-background border-border bg-background px-2.5 text-left text-xs text-foreground transition-colors duration-150"
          : "group flex h-8 max-w-60 shrink-0 items-center gap-2 rounded-t-md border border-transparent bg-transparent px-2.5 text-left text-xs text-muted-foreground transition-colors duration-150 hover:border-border/60 hover:bg-muted/40 hover:text-foreground"
      }
      style={active ? { boxShadow: `inset 0 2px 0 0 ${brand.color}` } : undefined}
      title={`${text}${tab.projectName ? ` · ${tab.projectName}` : ""} · ${brand.label}`}
    >
      <span className="flex shrink-0 items-center gap-1.5">
        <span
          className={
            running
              ? "size-1.5 rounded-full motion-safe:animate-pulse"
              : "size-1.5 rounded-full opacity-50"
          }
          style={{ backgroundColor: brand.color }}
        />
        {/* Official CLI logo; fall back to the text short label for unknown CLIs. */}
        {brand.id !== "unknown" ? (
          <CliBrandIcon aiTool={tab.aiTool} className="size-3" />
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
        aria-current={active ? "page" : undefined}
        className="min-w-0 flex-1 truncate"
      >
        {text}
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
  overflowLabel,
  onNavigate,
}: {
  hiddenTabs: SessionTab[];
  overflowLabel: string;
  onNavigate: (id: string) => void;
}) {
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
            <DropdownMenuItem key={tab.id} onSelect={() => onNavigate(tab.id)}>
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className={
                    tab.status === "running"
                      ? "size-1.5 shrink-0 rounded-full motion-safe:animate-pulse"
                      : "size-1.5 shrink-0 rounded-full opacity-50"
                  }
                  style={{ backgroundColor: brand.color }}
                />
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
