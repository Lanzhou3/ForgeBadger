"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Terminal } from "lucide-react";

import { CliBrandIcon } from "@/components/cli-brand-icon";
import { useLanguage } from "@/hooks/use-language";
import { getCliBrand } from "@/lib/cli-brand";
import { FORGEBADGER_GATEWAY_EVENT } from "@/lib/gateway-events";
import { formatRelativeTime, type GatewayEvent } from "@/lib/notifications";
import {
  getLatestRunningTab,
  notifySessionTabsChanged,
  readSessionTabs,
  upsertSessionTab,
  type SessionTab,
} from "@/lib/session-tabs";
import { cn } from "@/lib/utils";

const TERMINAL_ROUTE = /^\/sessions\/[^/]+/u;
const DRAG_THRESHOLD = 5;
// Half the 40px button plus an 8px viewport margin.
const EDGE_OFFSET = 28;

function clampPosition(y: number) {
  const edge = Math.min(EDGE_OFFSET, window.innerHeight / 2);
  return Math.max(edge, Math.min(y, window.innerHeight - edge));
}

/**
 * Floating edge bookmark that jumps back to the most recently used running
 * CLI session. Hidden while on a terminal route or when nothing is running.
 * Reads the shared session-tab storage, so no extra requests are needed.
 */
export function SessionBookmark() {
  const pathname = usePathname();
  const router = useRouter();
  const { t, language } = useLanguage();
  const [tab, setTab] = useState<SessionTab | null>(null);
  // Keep the last target mounted briefly so the bookmark can slide out
  // instead of vanishing when the session stops or the user opens it.
  const [rendered, setRendered] = useState<SessionTab | null>(null);
  const [positionY, setPositionY] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ pointerId: number; startY: number; baseY: number } | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    const onResize = () => setPositionY((y) => y === null ? null : clampPosition(y));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || dragRef.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    suppressClickRef.current = false;
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      baseY: bounds.top + bounds.height / 2,
    };
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = event.clientY - drag.startY;
    if (!suppressClickRef.current && Math.abs(delta) < DRAG_THRESHOLD) return;
    suppressClickRef.current = true;
    setDragging(true);
    setPositionY(clampPosition(drag.baseY + delta));
  }

  function finishDrag(event: PointerEvent<HTMLButtonElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    if (event.type !== "pointerup") suppressClickRef.current = true;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  const refresh = useCallback(() => {
    setTab(getLatestRunningTab(readSessionTabs()) ?? null);
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("forgebadger-session-tabs-changed", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("forgebadger-session-tabs-changed", refresh);
    };
  }, [refresh]);

  // SessionTabs only mounts on the terminal page, so away from it a stored
  // tab's status goes stale; mirror its status sync here or a finished
  // session would keep the bookmark visible.
  useEffect(() => {
    const onGatewayEvent = (event: Event) => {
      const detail = event instanceof CustomEvent ? (event.detail as GatewayEvent) : undefined;
      if (detail?.type !== "session_status_changed") return;
      const sessionId = detail.payload?.session_id;
      const newStatus = detail.payload?.new_status;
      if (typeof sessionId !== "string" || typeof newStatus !== "string") return;
      const stored = readSessionTabs().find((entry) => entry.id === sessionId);
      if (!stored || stored.status === newStatus) return;
      upsertSessionTab({ ...stored, status: newStatus, updatedAt: Date.now() });
      notifySessionTabsChanged();
    };
    window.addEventListener(FORGEBADGER_GATEWAY_EVENT, onGatewayEvent);
    return () => window.removeEventListener(FORGEBADGER_GATEWAY_EVENT, onGatewayEvent);
  }, []);

  const visible = tab !== null && !TERMINAL_ROUTE.test(pathname ?? "");

  useEffect(() => {
    if (visible) {
      setRendered(tab);
      return;
    }
    if (!rendered) return;
    const timer = window.setTimeout(() => setRendered(null), 200);
    return () => window.clearTimeout(timer);
  }, [visible, tab, rendered]);

  if (!rendered) return null;

  const brand = getCliBrand(rendered.aiTool);
  const meta = [
    rendered.projectName,
    brand.id === "unknown" ? null : brand.label,
    formatRelativeTime(new Date(rendered.updatedAt).toISOString(), language),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      style={positionY === null ? undefined : { top: positionY }}
      className={cn(
        "group fixed right-0 top-1/2 z-40 -translate-y-1/2 transition-[translate,opacity] duration-200",
        visible ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-full opacity-0"
      )}
    >
      <button
        type="button"
        aria-label={t("sessions.activeBookmark")}
        title={t("sessions.activeBookmark")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onLostPointerCapture={finishDrag}
        onClick={(event) => {
          // Keyboard activation still works after a drag; pointer clicks must
          // start a fresh gesture before they can navigate again.
          if (event.detail > 0 && suppressClickRef.current) {
            event.preventDefault();
            return;
          }
          router.push(`/sessions/${rendered.id}`);
        }}
        className={cn(
          "relative flex size-10 touch-none select-none items-center justify-center rounded-l-xl border border-r-0 border-border bg-card/95 text-foreground shadow-lg backdrop-blur transition-colors hover:bg-accent",
          dragging ? "cursor-grabbing" : "cursor-grab"
        )}
      >
        {brand.id === "unknown" ? (
          <Terminal className="size-4" />
        ) : (
          <CliBrandIcon aiTool={rendered.aiTool} className="size-4" />
        )}
        <span className="absolute right-1.5 top-1.5 flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-500 ring-1 ring-card" />
        </span>
      </button>
      <div className={cn(
        "pointer-events-none absolute right-full top-1/2 mr-2 w-64 -translate-y-1/2 translate-x-1 rounded-lg border border-border bg-popover p-3 opacity-0 shadow-xl transition-all duration-150",
        !dragging && "group-hover:translate-x-0 group-hover:opacity-100"
      )}>
        <div className="flex items-center gap-2">
          {brand.id === "unknown" ? (
            <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <CliBrandIcon aiTool={rendered.aiTool} className="size-3.5" />
          )}
          <span className="truncate text-sm font-medium text-popover-foreground">
            {rendered.label}
          </span>
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{meta}</div>
        {rendered.lastPrompt ? (
          <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground/80">
            {rendered.lastPrompt}
          </p>
        ) : null}
      </div>
    </div>
  );
}
