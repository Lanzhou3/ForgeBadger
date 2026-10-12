"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

const STORAGE_KEY = "forgebadger.terminal-toolbar-position";
const MARGIN = 8;
interface Position { x: number; y: number }
interface Geometry { width: number; height: number; toolbarWidth: number; toolbarHeight: number }
interface Drag { pointerId: number; startX: number; startY: number; x: number; y: number; moved: boolean }

function readPosition(): Position | null {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!value || typeof value !== "object" || !("x" in value) || !("y" in value)) return null;
    if (typeof value.x !== "number" || typeof value.y !== "number" || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return null;
    return { x: Math.min(1, Math.max(0, value.x)), y: Math.min(1, Math.max(0, value.y)) };
  } catch { return null; }
}

function persistPosition(position: Position | null) {
  try {
    if (position) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch { /* Dragging remains usable when browser storage is unavailable. */ }
}

/** Position is a fraction of the available travel, so resizing cannot strand the toolbar. */
export function useTerminalToolbarDrag(containerRef: RefObject<HTMLDivElement | null>) {
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const positionRef = useRef<Position | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [geometry, setGeometry] = useState<Geometry | null>(null);

  useEffect(() => {
    const container = containerRef.current, toolbar = toolbarRef.current;
    if (!container || !toolbar) return;
    const measure = () => {
      const frame = container.getBoundingClientRect(), bar = toolbar.getBoundingClientRect();
      setGeometry(previous => previous?.width === frame.width && previous.height === frame.height && previous.toolbarWidth === bar.width && previous.toolbarHeight === bar.height
        ? previous : { width: frame.width, height: frame.height, toolbarWidth: bar.width, toolbarHeight: bar.height });
    };
    measure();
    positionRef.current = readPosition();
    setPosition(positionRef.current);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(container); observer?.observe(toolbar);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); dragRef.current = null; };
  }, [containerRef]);

  function moveTo(x: number, y: number): Position | null {
    const container = containerRef.current, toolbar = toolbarRef.current;
    if (!container || !toolbar) return null;
    const frame = container.getBoundingClientRect(), bar = toolbar.getBoundingClientRect();
    const travelX = Math.max(0, frame.width - bar.width - MARGIN * 2);
    const travelY = Math.max(0, frame.height - bar.height - MARGIN * 2);
    const next = { x: travelX ? Math.min(1, Math.max(0, (x - MARGIN) / travelX)) : 0, y: travelY ? Math.min(1, Math.max(0, (y - MARGIN) / travelY)) : 0 };
    positionRef.current = next;
    setGeometry({ width: frame.width, height: frame.height, toolbarWidth: bar.width, toolbarHeight: bar.height });
    setPosition(next);
    return next;
  }

  function reset() { positionRef.current = null; setPosition(null); persistPosition(null); }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || dragRef.current || !toolbarRef.current || !containerRef.current) return;
    event.preventDefault(); event.stopPropagation();
    const bar = toolbarRef.current.getBoundingClientRect(), frame = containerRef.current.getBoundingClientRect();
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: bar.left - frame.left, y: bar.top - frame.top, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    event.preventDefault(); event.stopPropagation();
    moveTo(drag.x + dx, drag.y + dy);
  }

  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (drag.moved) persistPosition(positionRef.current);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Home") { event.preventDefault(); reset(); return; }
    const delta: Record<string, Position> = { ArrowLeft: { x: -10, y: 0 }, ArrowRight: { x: 10, y: 0 }, ArrowUp: { x: 0, y: -10 }, ArrowDown: { x: 0, y: 10 } };
    const step = delta[event.key];
    if (!step || !toolbarRef.current || !containerRef.current) return;
    event.preventDefault(); event.stopPropagation();
    const bar = toolbarRef.current.getBoundingClientRect(), frame = containerRef.current.getBoundingClientRect();
    persistPosition(moveTo(bar.left - frame.left + step.x, bar.top - frame.top + step.y));
  }

  const style: CSSProperties | undefined = position && geometry ? {
    left: MARGIN + position.x * Math.max(0, geometry.width - geometry.toolbarWidth - MARGIN * 2),
    top: MARGIN + position.y * Math.max(0, geometry.height - geometry.toolbarHeight - MARGIN * 2),
    right: "auto", bottom: "auto",
  } : undefined;
  return { toolbarRef, style, handleProps: {
    onPointerDown, onPointerMove, onPointerUp, onKeyDown,
    onPointerCancel: onPointerUp,
    onLostPointerCapture: () => { dragRef.current = null; },
    onDoubleClick: reset,
  } };
}
