"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { PortfolioCompanionSprite } from "@/components/portfolio/portfolio-companion-sprite";
import { usePortfolioWorkspaceProjection } from "@/hooks/use-portfolio";
import {
  PORTFOLIO_COMPANION_CLICK_DRAG_THRESHOLD_PX,
  PORTFOLIO_COMPANION_BLINK_CLOSED_MS,
  PORTFOLIO_COMPANION_BLINK_MAX_INTERVAL_MS,
  PORTFOLIO_COMPANION_BLINK_MIN_INTERVAL_MS,
  PORTFOLIO_COMPANION_CORNER_STORAGE_KEY,
  PORTFOLIO_COMPANION_SIZE_PX,
  isPortfolioCompanionCorner,
  nearestPortfolioCompanionCorner,
  portfolioCompanionPosition,
  type PortfolioCompanionAnchor,
  type PortfolioCompanionCorner,
  type PortfolioCompanionFrame,
  type PortfolioCompanionPosition,
  type PortfolioCompanionViewport,
} from "@/lib/portfolio-companion";
import { cn } from "@/lib/utils";
import { usePortfolioCopy } from "@/lib/portfolio-i18n";

interface PortfolioCompanionWidgetProps {
  onActivate: () => void;
  expanded: boolean;
  controlsId: string;
  onPositionChange?: (anchor: PortfolioCompanionAnchor) => void;
}

interface DragState {
  startX: number;
  startY: number;
  baseX: number;
  baseY: number;
  moved: boolean;
}

type CompanionMode = "stand" | "walk" | "sit";

/** A draggable navigation affordance; it renders only redacted Portfolio summary state. */
export function PortfolioCompanionWidget({ onActivate, expanded, controlsId, onPositionChange }: PortfolioCompanionWidgetProps) {
  const { copy } = usePortfolioCopy();
  const projectionQuery = usePortfolioWorkspaceProjection();
  const [position, setPosition] = useState<PortfolioCompanionPosition | null>(null);
  const [mode, setMode] = useState<CompanionMode>("stand");
  const [dragging, setDragging] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [blinking, setBlinking] = useState(false);
  const [walkFrame, setWalkFrame] = useState<"walk1" | "walk2">("walk1");
  const [sitFrame, setSitFrame] = useState<"sit1" | "sit2">("sit1");

  const widgetRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const cornerRef = useRef<PortfolioCompanionCorner>("bottom-right");
  const modeRef = useRef(mode);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    if (position) onPositionChange?.({ position, viewport: viewport() });
  }, [onPositionChange, position]);

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const stored = window.localStorage.getItem(PORTFOLIO_COMPANION_CORNER_STORAGE_KEY);
    const initialCorner = isPortfolioCompanionCorner(stored) ? stored : "bottom-right";
    cornerRef.current = initialCorner;
    setPosition(portfolioCompanionPosition(initialCorner, viewport()));

    function onResize() {
      if (!dragRef.current) setPosition(portfolioCompanionPosition(cornerRef.current, viewport()));
    }

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const resetIdleTimer = useCallback(() => {
    setMode((current) => (current === "sit" ? "stand" : current));
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      if (modeRef.current !== "walk") setMode("sit");
    }, 8_000);
  }, []);

  useEffect(() => {
    resetIdleTimer();
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [resetIdleTimer]);

  useEffect(() => {
    if (mode === "walk" || reducedMotionRef.current) {
      setBlinking(false);
      return;
    }
    let cancelled = false;
    let closeTimer: number | null = null;
    let nextBlinkTimer: number | null = null;
    const scheduleBlink = () => {
      const delay = PORTFOLIO_COMPANION_BLINK_MIN_INTERVAL_MS
        + Math.random() * (PORTFOLIO_COMPANION_BLINK_MAX_INTERVAL_MS - PORTFOLIO_COMPANION_BLINK_MIN_INTERVAL_MS);
      nextBlinkTimer = window.setTimeout(() => {
        if (cancelled) return;
        setBlinking(true);
        closeTimer = window.setTimeout(() => {
          if (cancelled) return;
          setBlinking(false);
          scheduleBlink();
        }, PORTFOLIO_COMPANION_BLINK_CLOSED_MS);
      }, delay);
    };
    scheduleBlink();
    return () => {
      cancelled = true;
      if (closeTimer !== null) window.clearTimeout(closeTimer);
      if (nextBlinkTimer !== null) window.clearTimeout(nextBlinkTimer);
    };
  }, [mode]);

  useEffect(() => {
    if (mode !== "walk" || reducedMotionRef.current) {
      setWalkFrame("walk1");
      return;
    }
    const interval = window.setInterval(() => setWalkFrame((current) => (current === "walk1" ? "walk2" : "walk1")), 140);
    return () => window.clearInterval(interval);
  }, [mode]);

  useEffect(() => {
    if (mode !== "sit" || reducedMotionRef.current) {
      setSitFrame("sit1");
      return;
    }
    const interval = window.setInterval(() => setSitFrame((current) => (current === "sit1" ? "sit2" : "sit1")), 500);
    return () => window.clearInterval(interval);
  }, [mode]);

  const snapTo = useCallback((clientX: number, clientY: number) => {
    const nextCorner = nearestPortfolioCompanionCorner(clientX, clientY, viewport());
    cornerRef.current = nextCorner;
    window.localStorage.setItem(PORTFOLIO_COMPANION_CORNER_STORAGE_KEY, nextCorner);
    setPosition(portfolioCompanionPosition(nextCorner, viewport()));
  }, []);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !position) return;
    widgetRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = { startX: event.clientX, startY: event.clientY, baseX: position.x, baseY: position.y, moved: false };
    resetIdleTimer();
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const xDelta = event.clientX - drag.startX;
    const yDelta = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(xDelta, yDelta) < PORTFOLIO_COMPANION_CLICK_DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    setDragging(true);
    setMode("walk");
    if (Math.abs(xDelta) > 1) setFlipped(xDelta < 0);
    const currentViewport = viewport();
    setPosition({
      x: clamp(drag.baseX + xDelta, 0, currentViewport.width - PORTFOLIO_COMPANION_SIZE_PX),
      y: clamp(drag.baseY + yDelta, 0, currentViewport.height - PORTFOLIO_COMPANION_SIZE_PX),
    });
    resetIdleTimer();
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (widgetRef.current?.hasPointerCapture(event.pointerId)) widgetRef.current.releasePointerCapture(event.pointerId);
    if (!drag.moved) {
      onActivate();
      resetIdleTimer();
      return;
    }
    setDragging(false);
    setMode("stand");
    snapTo(event.clientX, event.clientY);
    resetIdleTimer();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onActivate();
    }
  }

  if (!position) return null;

  const frame: PortfolioCompanionFrame = blinking
    ? mode === "sit" ? "sitBlink" : "blink"
    : mode === "walk" ? walkFrame
    : mode === "sit" ? sitFrame
    : "stand";
  const safeStatus = statusText(projectionQuery.data, projectionQuery.isLoading, projectionQuery.isError, copy);

  return (
    <div
      className={cn("fixed z-40", !dragging && "transition-[left,top] duration-300 ease-out motion-reduce:transition-none")}
      style={{ left: position.x, top: position.y, width: PORTFOLIO_COMPANION_SIZE_PX, height: PORTFOLIO_COMPANION_SIZE_PX }}
    >
      <div
        ref={widgetRef}
        data-portfolio-companion-widget
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-expanded={expanded}
        aria-controls={controlsId}
        aria-label={copy.widgetOpen.replace("{status}", safeStatus)}
        title={safeStatus}
        className={cn("touch-none select-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring", dragging ? "cursor-grabbing" : "cursor-grab")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragRef.current = null;
          setDragging(false);
          setMode("stand");
          snapTo(position.x, position.y);
        }}
        onPointerEnter={resetIdleTimer}
        onKeyDown={onKeyDown}
      >
        <PortfolioCompanionSprite frame={frame} flip={flipped} size={PORTFOLIO_COMPANION_SIZE_PX} className="drop-shadow-lg" />
      </div>
    </div>
  );
}

function statusText(
  projection: ReturnType<typeof usePortfolioWorkspaceProjection>["data"],
  isLoading: boolean,
  isError: boolean,
  copy: ReturnType<typeof usePortfolioCopy>["copy"]
): string {
  if (isLoading) return copy.widgetLoading;
  if (isError || !projection) return copy.widgetUnavailable;
  const activeRisks = projection.risks.filter((risk) => !isSettled(risk.state)).length;
  const pendingAuthorizations = projection.authorizations.filter((authorization) => !isSettled(authorization.state)).length;
  if (activeRisks > 0 || pendingAuthorizations > 0) return copy.widgetAttention;
  return copy.widgetClear;
}

function isSettled(state: string): boolean {
  return ["resolved", "accepted", "rejected", "expired", "cancelled", "consumed"].includes(state);
}

function viewport(): PortfolioCompanionViewport {
  return { width: window.innerWidth, height: window.innerHeight };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
