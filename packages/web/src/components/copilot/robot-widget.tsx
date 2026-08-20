"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useRouter } from "next/navigation";
import { XIcon } from "lucide-react";

import { PixelRobot } from "@/components/copilot/pixel-robot";
import { useLanguage } from "@/hooks/use-language";
import { useNotifications } from "@/hooks/use-notifications";
import { shouldTriggerBrowserNotification } from "@/lib/browser-notifications";
import { OPENFORGE_GATEWAY_EVENT } from "@/lib/gateway-events";
import {
  toastDurationFor,
  toastToneFor,
  toneAccentClassNames,
  toneIconClassNames,
  toneIcons,
  type NotificationToastTone,
} from "@/lib/notification-toast";
import {
  createNotificationFromEvent,
  notificationContextParts,
  type GatewayEvent,
} from "@/lib/notifications";
import {
  BLINK_DURATION_MS,
  BLINK_MAX_INTERVAL_MS,
  BLINK_MIN_INTERVAL_MS,
  CLICK_DRAG_THRESHOLD_PX,
  CORNER_MARGIN_PX,
  IDLE_SIT_DELAY_MS,
  ROBOT_CORNER_STORAGE_KEY,
  ROBOT_NUDGE_DURATION_MS,
  ROBOT_SIZE_PX,
  SIT_FRAME_INTERVAL_MS,
  WALK_FRAME_INTERVAL_MS,
  bubblePlacement,
  cornerOffsetPosition,
  isRobotCorner,
  nearestCorner,
  type RobotCorner,
  type RobotFrameKey,
  type RobotPosition,
  type ViewportSize,
} from "@/lib/pixel-robot";
import { cn } from "@/lib/utils";

interface RobotWidgetProps {
  onActivate: () => void;
  /** When the Copilot page is open the robot stays visible but stays quiet. */
  suppressBubbles?: boolean;
}

type RobotMode = "stand" | "walk" | "sit";

interface RobotBubble {
  id: string;
  title: string;
  description: string;
  href: string;
  tone: NotificationToastTone;
  duration: number;
}

interface DragState {
  startX: number;
  startY: number;
  baseX: number;
  baseY: number;
  moved: boolean;
}

export function RobotWidget({ onActivate, suppressBubbles = false }: RobotWidgetProps) {
  const { t } = useLanguage();
  const router = useRouter();
  const { markRead } = useNotifications();

  const [pos, setPos] = useState<RobotPosition | null>(null);
  const [corner, setCorner] = useState<RobotCorner>("bottom-right");
  const [mode, setMode] = useState<RobotMode>("stand");
  const [dragging, setDragging] = useState(false);
  const [flip, setFlip] = useState(false);
  const [blinking, setBlinking] = useState(false);
  const [walkFrame, setWalkFrame] = useState<RobotFrameKey>("walk1");
  const [sitFrame, setSitFrame] = useState<RobotFrameKey>("sit1");
  const [bubble, setBubble] = useState<RobotBubble | null>(null);
  const [nudge, setNudge] = useState(false);

  const robotRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modeRef = useRef<RobotMode>(mode);
  const cornerRef = useRef<RobotCorner>(corner);
  const suppressBubblesRef = useRef(suppressBubbles);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    suppressBubblesRef.current = suppressBubbles;
    if (suppressBubbles) {
      setBubble(null);
    }
  }, [suppressBubbles]);

  // Mount: restore the persisted corner and keep the robot pinned on resize.
  useEffect(() => {
    reducedMotionRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const stored = window.localStorage.getItem(ROBOT_CORNER_STORAGE_KEY);
    const initial = isRobotCorner(stored) ? stored : "bottom-right";
    setCorner(initial);
    cornerRef.current = initial;
    setPos(cornerOffsetPosition(initial, currentViewport(), ROBOT_SIZE_PX, CORNER_MARGIN_PX));

    function onResize() {
      if (dragRef.current) return;
      setPos(cornerOffsetPosition(cornerRef.current, currentViewport(), ROBOT_SIZE_PX, CORNER_MARGIN_PX));
    }

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Blink loop: a ~160ms closed-eye frame every 3-6s while standing or sitting.
  useEffect(() => {
    if (mode === "walk" || reducedMotionRef.current) {
      setBlinking(false);
      return;
    }
    let cancelled = false;
    let blinkTimer: ReturnType<typeof setTimeout> | null = null;
    let openTimer: ReturnType<typeof setTimeout> | null = null;

    function scheduleBlink() {
      const delay =
        BLINK_MIN_INTERVAL_MS + Math.random() * (BLINK_MAX_INTERVAL_MS - BLINK_MIN_INTERVAL_MS);
      blinkTimer = setTimeout(() => {
        if (cancelled) return;
        setBlinking(true);
        openTimer = setTimeout(() => {
          setBlinking(false);
          if (!cancelled) scheduleBlink();
        }, BLINK_DURATION_MS);
      }, delay);
    }

    scheduleBlink();
    return () => {
      cancelled = true;
      setBlinking(false);
      if (blinkTimer) clearTimeout(blinkTimer);
      if (openTimer) clearTimeout(openTimer);
    };
  }, [mode]);

  // Any interaction stands the robot back up and re-arms the 8s sit timer.
  const interact = useCallback(() => {
    setMode((current) => (current === "sit" ? "stand" : current));
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      if (modeRef.current !== "walk") {
        setMode("sit");
      }
    }, IDLE_SIT_DELAY_MS);
  }, []);

  useEffect(() => {
    interact();
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [interact]);

  // Walk frames swap legs while dragging; reduced motion stays on one frame.
  useEffect(() => {
    if (mode !== "walk" || reducedMotionRef.current) {
      setWalkFrame("walk1");
      return;
    }
    const id = setInterval(
      () => setWalkFrame((current) => (current === "walk1" ? "walk2" : "walk1")),
      WALK_FRAME_INTERVAL_MS
    );
    return () => clearInterval(id);
  }, [mode]);

  // Sit frames loop a typing motion; reduced motion stays on one frame.
  useEffect(() => {
    if (mode !== "sit" || reducedMotionRef.current) {
      setSitFrame("sit1");
      return;
    }
    const id = setInterval(
      () => setSitFrame((current) => (current === "sit1" ? "sit2" : "sit1")),
      SIT_FRAME_INTERVAL_MS
    );
    return () => clearInterval(id);
  }, [mode]);

  // Notification bubble: derive content from the shared gateway event bus.
  useEffect(() => {
    function onGatewayEvent(event: Event) {
      if (suppressBubblesRef.current) return;
      try {
        const message = (event as CustomEvent<GatewayEvent>).detail;
        const notification = createNotificationFromEvent(message);
        if (!notification || !shouldTriggerBrowserNotification(message, notification)) return;
        const context = notificationContextParts(notification, {
          project: t("notifications.projectContext"),
          session: t("notifications.sessionContext"),
          cli: t("notifications.cliContext"),
        }).join(" · ");
        setBubble({
          id: notification.id,
          title: t(notification.titleKey),
          description: [context, notification.message].filter(Boolean).join(" · "),
          href: notification.href,
          tone: toastToneFor(notification.notificationType, message),
          duration: toastDurationFor(notification.notificationType),
        });
        if (!reducedMotionRef.current) {
          setNudge(true);
          if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
          nudgeTimerRef.current = setTimeout(() => setNudge(false), ROBOT_NUDGE_DURATION_MS);
        }
      } catch {
        // Ignore malformed frames from the local event stream.
      }
    }

    window.addEventListener(OPENFORGE_GATEWAY_EVENT, onGatewayEvent);
    return () => {
      window.removeEventListener(OPENFORGE_GATEWAY_EVENT, onGatewayEvent);
      if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    };
  }, [t]);

  // Auto-dismiss the bubble; a new bubble replaces the timer.
  useEffect(() => {
    if (!bubble) return;
    bubbleTimerRef.current = setTimeout(() => setBubble(null), bubble.duration);
    return () => {
      if (bubbleTimerRef.current) {
        clearTimeout(bubbleTimerRef.current);
        bubbleTimerRef.current = null;
      }
    };
  }, [bubble]);

  const snapToNearestCorner = useCallback((clientX: number, clientY: number) => {
    const viewport = currentViewport();
    const next = nearestCorner(clientX, clientY, viewport);
    setCorner(next);
    cornerRef.current = next;
    window.localStorage.setItem(ROBOT_CORNER_STORAGE_KEY, next);
    setPos(cornerOffsetPosition(next, viewport, ROBOT_SIZE_PX, CORNER_MARGIN_PX));
  }, []);

  const openBubble = useCallback(() => {
    setBubble((current) => {
      if (current) {
        markRead(current.id);
        router.push(current.href);
      }
      return null;
    });
  }, [markRead, router]);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !pos) return;
    robotRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      baseX: pos.x,
      baseY: pos.y,
      moved: false,
    };
    interact();
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < CLICK_DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      setDragging(true);
      setMode("walk");
    }
    if (Math.abs(dx) > 1) {
      setFlip(dx < 0);
    }
    const viewport = currentViewport();
    setPos({
      x: clamp(drag.baseX + dx, 0, viewport.width - ROBOT_SIZE_PX),
      y: clamp(drag.baseY + dy, 0, viewport.height - ROBOT_SIZE_PX),
    });
    interact();
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    robotRef.current?.releasePointerCapture(event.pointerId);
    if (!drag.moved) {
      onActivate();
      interact();
      return;
    }
    setDragging(false);
    setMode("stand");
    snapToNearestCorner(event.clientX, event.clientY);
    interact();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onActivate();
    }
  }

  if (!pos) return null;

  const frame: RobotFrameKey = blinking
    ? mode === "sit"
      ? "sitBlink"
      : "blink"
    : mode === "walk"
      ? walkFrame
      : mode === "sit"
        ? sitFrame
        : "stand";
  const placement = bubblePlacement(corner);
  const ToneIcon = bubble ? toneIcons[bubble.tone] : null;

  return (
    <div
      className={cn(
        "fixed z-40",
        !dragging && "transition-[left,top] duration-300 ease-out motion-reduce:transition-none"
      )}
      style={{ left: pos.x, top: pos.y, width: ROBOT_SIZE_PX, height: ROBOT_SIZE_PX }}
    >
      <div
        ref={robotRef}
        role="button"
        tabIndex={0}
        aria-label={t("nav.copilot")}
        className={cn(
          "touch-none select-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring",
          dragging ? "cursor-grabbing" : "cursor-grab"
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragRef.current = null;
          setDragging(false);
          setMode("stand");
          snapToNearestCorner(pos.x, pos.y);
        }}
        onPointerEnter={interact}
        onKeyDown={onKeyDown}
      >
        <div className={nudge ? "of-robot-nudge" : undefined}>
          <PixelRobot frame={frame} flip={flip} size={ROBOT_SIZE_PX} className="drop-shadow-lg" />
        </div>
      </div>
      {bubble && ToneIcon && (
        <div
          className={cn(
            "of-animate-in absolute w-64 max-w-[calc(100vw-6rem)] rounded-lg border border-border bg-card p-3 shadow-xl shadow-black/30",
            toneAccentClassNames[bubble.tone],
            placement.side === "left" ? "right-full mr-3" : "left-full ml-3",
            placement.vertical === "above" ? "bottom-0" : "top-0"
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "absolute h-2.5 w-2.5 rotate-45 border-border bg-card",
              placement.side === "left"
                ? "-right-[6px] border-r border-t"
                : "-left-[6px] border-b border-l",
              placement.vertical === "above" ? "bottom-5" : "top-5"
            )}
          />
          <div className="flex items-start gap-2">
            <ToneIcon
              className={cn(toneIconClassNames[bubble.tone], "mt-0.5 shrink-0")}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-card-foreground">{bubble.title}</p>
              {bubble.description && (
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                  {bubble.description}
                </p>
              )}
              <div className="mt-2 flex items-center gap-1.5">
                <button
                  type="button"
                  className="rounded-md bg-brand px-2 py-1 text-xs font-medium text-brand-foreground transition-colors hover:bg-brand/90"
                  onClick={openBubble}
                >
                  {t("notifications.openSession")}
                </button>
                <button
                  type="button"
                  aria-label={t("common.close")}
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={() => setBubble(null)}
                >
                  <XIcon className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function currentViewport(): ViewportSize {
  return { width: window.innerWidth, height: window.innerHeight };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
