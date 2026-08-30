"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useRouter } from "next/navigation";
import { XIcon } from "lucide-react";

import { PixelRobot } from "@/components/copilot/pixel-robot";
import { useLanguage } from "@/hooks/use-language";
import { useNotifications } from "@/hooks/use-notifications";
import { shouldTriggerBrowserNotification } from "@/lib/browser-notifications";
import { readMigratedStorageValue, writeMigratedStorageValue } from "@/lib/brand-storage";
import { FORGEBADGER_GATEWAY_EVENT } from "@/lib/gateway-events";
import {
  toastDurationFor,
  toastToneFor,
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
  LEGACY_ROBOT_CORNER_STORAGE_KEY,
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
  /** Click/Enter on the robot: toggles the floating chat panel. */
  onActivate: () => void;
  /** When the Copilot page is open the robot stays visible but stays quiet. */
  suppressBubbles?: boolean;
  /** While the chat panel is open, notification bubbles stay out of the way. */
  panelOpen?: boolean;
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

export function RobotWidget({ onActivate, suppressBubbles = false, panelOpen = false }: RobotWidgetProps) {
  const { t } = useLanguage();
  const router = useRouter();
  const { markRead } = useNotifications();

  // Bubbles stay quiet on the Copilot page and while the chat panel is open.
  const bubblesSuppressed = suppressBubbles || panelOpen;

  const [pos, setPos] = useState<RobotPosition | null>(null);
  const [corner, setCorner] = useState<RobotCorner>("bottom-right");
  const [mode, setMode] = useState<RobotMode>("stand");
  const [dragging, setDragging] = useState(false);
  const [flip, setFlip] = useState(false);
  const [blinking, setBlinking] = useState(false);
  const [walkFrame, setWalkFrame] = useState<RobotFrameKey>("walk1");
  const [sitFrame, setSitFrame] = useState<RobotFrameKey>("sit1");
  const [bubble, setBubble] = useState<RobotBubble | null>(null);
  const bubbleRef = useRef<RobotBubble | null>(null);
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
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    suppressBubblesRef.current = bubblesSuppressed;
    if (bubblesSuppressed) {
      bubbleRef.current = null;
      setBubble(null);
    }
  }, [bubblesSuppressed]);

  // Mount: restore the persisted corner and keep the robot pinned on resize.
  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    reducedMotionRef.current = prefersReducedMotion;
    setReducedMotion(prefersReducedMotion);
    const stored = readMigratedStorageValue(
      window.localStorage,
      ROBOT_CORNER_STORAGE_KEY,
      LEGACY_ROBOT_CORNER_STORAGE_KEY
    );
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
        const next: RobotBubble = {
          id: notification.id,
          title: t(notification.titleKey),
          description: [context, notification.message].filter(Boolean).join(" · "),
          href: notification.href,
          tone: toastToneFor(notification.notificationType, message),
          duration: toastDurationFor(notification.notificationType),
        };
        bubbleRef.current = next;
        setBubble(next);
        if (!reducedMotionRef.current) {
          setNudge(true);
          if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
          nudgeTimerRef.current = setTimeout(() => setNudge(false), ROBOT_NUDGE_DURATION_MS);
        }
      } catch {
        // Ignore malformed frames from the local event stream.
      }
    }

    window.addEventListener(FORGEBADGER_GATEWAY_EVENT, onGatewayEvent);
    return () => {
      window.removeEventListener(FORGEBADGER_GATEWAY_EVENT, onGatewayEvent);
      if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    };
  }, [t]);

  // Auto-dismiss the bubble; a new bubble replaces the timer.
  useEffect(() => {
    if (!bubble) return;
    bubbleTimerRef.current = setTimeout(() => {
      bubbleRef.current = null;
      setBubble(null);
    }, bubble.duration);
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
    writeMigratedStorageValue(
      window.localStorage,
      ROBOT_CORNER_STORAGE_KEY,
      LEGACY_ROBOT_CORNER_STORAGE_KEY,
      next
    );
    setPos(cornerOffsetPosition(next, viewport, ROBOT_SIZE_PX, CORNER_MARGIN_PX));
  }, []);

  const openBubble = useCallback(() => {
    // Side effects (markRead / router.push touch other components' state) must
    // run in the event handler, NOT inside the setBubble updater - React runs
    // updaters during render and updating NotificationProvider from there is
    // the "setState while rendering a different component" error.
    const current = bubbleRef.current;
    bubbleRef.current = null;
    setBubble(null);
    if (current) {
      markRead(current.id);
      router.push(current.href);
    }
  }, [markRead, router]);

  // Opening the chat panel counts as reading the notification bubble that is
  // currently shown: dismiss it locally and mark it read, then toggle.
  const activate = useCallback(() => {
    const current = bubbleRef.current;
    if (!panelOpen && current) {
      bubbleRef.current = null;
      setBubble(null);
      markRead(current.id);
    }
    onActivate();
  }, [panelOpen, markRead, onActivate]);

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
      activate();
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
      activate();
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

  // Comic layout: the bubble floats over the robot's head (or hangs below it
  // when the robot lives in a top corner), horizontally centered on the robot
  // and clamped to the viewport so it never spills off-screen near edges.
  const viewportWidth = window.innerWidth;
  const bubbleWidth = Math.min(288, Math.max(viewportWidth - 48, 160));
  const minRelLeft = 12 - pos.x;
  const maxRelLeft = viewportWidth - bubbleWidth - 12 - pos.x;
  const bubbleRelLeft = clamp(
    (ROBOT_SIZE_PX - bubbleWidth) / 2,
    minRelLeft,
    Math.max(minRelLeft, maxRelLeft)
  );
  const robotOnRight = corner.endsWith("right");
  // Mirror the tail sprite whenever its fixed anchor side would make the tip
  // lean away from the robot's body (e.g. tail bottom-left / top-right).
  const mirrorTail = robotOnRight !== (placement.vertical === "above");

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
        aria-expanded={panelOpen}
        className={cn(
          "touch-none select-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring",
          dragging
            ? "cursor-grabbing"
            : "cursor-grab transition-transform duration-200 ease-out hover:-translate-y-0.5 active:translate-y-0 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
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
        {/* Ground shadow: breathes counter-phase to the idle bob so the robot
            reads as lifted off the surface instead of pasted on. */}
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute -bottom-1 left-1/2 h-[7px] w-[72%] -translate-x-1/2 rounded-full bg-black/60 blur-[3px]",
            !dragging && mode === "stand" && !reducedMotion && "forgebadger-robot-ground-shadow"
          )}
        />
        <div className={nudge ? "forgebadger-robot-nudge" : undefined}>
          <div
            className={cn(
              !dragging && mode === "stand" && !reducedMotion && "forgebadger-robot-idle-bob",
              bubble && "forgebadger-robot-alert rounded-md"
            )}
          >
            <PixelRobot frame={frame} flip={flip} size={ROBOT_SIZE_PX} glow={!!bubble} />
          </div>
        </div>
      </div>
      {bubble && ToneIcon && (
        <div
          className={cn(
            "forgebadger-bubble-pop absolute rounded-lg border-[1.5px] border-zinc-900 bg-zinc-50 p-3 text-zinc-900 shadow-lg shadow-black/40",
            placement.vertical === "above" ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]"
          )}
          style={{ left: bubbleRelLeft, width: bubbleWidth }}
        >
          {/* Comic speech tail: a sharp spike jutting out of the bottom
              (or top) corner on the robot's side, aimed straight down (or up)
              at its head — as if the robot itself is speaking. The unstroked
              edge tucks under the bubble border, leaving an inked opening
              like real manga. */}
          <svg
            aria-hidden="true"
            viewBox="0 0 18 12"
            className={cn(
              "absolute h-3 w-[18px]",
              robotOnRight ? "right-2.5" : "left-2.5",
              placement.vertical === "above" ? "-bottom-[10px]" : "-top-[10px]",
              mirrorTail && "-scale-x-100",
              placement.vertical === "below" && "rotate-180"
            )}
          >
            <path d="M0 0 H18 L6 12 Z" fill="#fafafa" />
            <path
              d="M18 0 L6 12 L0 0"
              fill="none"
              stroke="#18181b"
              strokeWidth="1.5"
              strokeLinejoin="miter"
            />
          </svg>
          <div className="flex items-start justify-between gap-2">
            <p className="flex items-start gap-1.5 text-sm font-semibold leading-snug">
              <ToneIcon className={cn(toneIconClassNames[bubble.tone], "mt-px shrink-0")} />
              {bubble.title}
            </p>
            <button
              type="button"
              aria-label={t("common.close")}
              className="-mr-1 -mt-0.5 shrink-0 rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-900/10 hover:text-zinc-700"
              onClick={() => {
                bubbleRef.current = null;
                setBubble(null);
              }}
            >
              <XIcon className="size-3.5" aria-hidden="true" />
            </button>
          </div>
          {bubble.description && (
            <p className="mt-1 line-clamp-2 pl-[22px] text-xs leading-relaxed text-zinc-500">
              {bubble.description}
            </p>
          )}
          <div className="mt-2.5 flex items-center gap-1.5 pl-[22px]">
            <button
              type="button"
              className="h-7 rounded-md bg-zinc-900 px-3 text-xs font-medium text-zinc-50 transition-colors hover:bg-zinc-700"
              onClick={openBubble}
            >
              {t("notifications.openSession")}
            </button>
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
