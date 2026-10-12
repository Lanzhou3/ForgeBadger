// @vitest-environment jsdom
import { useRef } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTerminalToolbarDrag } from "./use-terminal-toolbar-drag";

const KEY = "forgebadger.terminal-toolbar-position";
let width = 800, height = 600;
function Harness() {
  const frame = useRef<HTMLDivElement | null>(null);
  const drag = useTerminalToolbarDrag(frame);
  return <div ref={frame} data-testid="drag-frame"><div ref={drag.toolbarRef} style={drag.style} data-testid="drag-toolbar"><button {...drag.handleProps}>Move</button></div></div>;
}
beforeEach(() => {
  width = 800; height = 600; localStorage.removeItem(KEY);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const frame = this.dataset.testid === "drag-frame";
    const x = frame ? 100 : 100 + (this.style.left ? parseFloat(this.style.left) : 8);
    const y = frame ? 50 : 50 + (this.style.top ? parseFloat(this.style.top) : height - 38);
    return { x, y, left: x, top: y, right: x + (frame ? width : 240), bottom: y + (frame ? height : 30), width: frame ? width : 240, height: frame ? height : 30, toJSON: () => ({}) };
  });
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    pointerId: number;
    constructor(type: string, options: PointerEventInit = {}) { super(type, options); this.pointerId = options.pointerId ?? 1; }
  });
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => true);
  Element.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  Reflect.deleteProperty(Element.prototype, "setPointerCapture");
  Reflect.deleteProperty(Element.prototype, "hasPointerCapture");
  Reflect.deleteProperty(Element.prototype, "releasePointerCapture");
});

it("moves with a pointer, stays within the pane and persists the final position", () => {
  render(<Harness />);
  const handle = screen.getByRole("button", { name: "Move" });
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 120, clientY: 620 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 400, clientY: 200 });
  fireEvent.pointerUp(handle, { pointerId: 1 });
  const toolbar = screen.getByTestId("drag-toolbar");
  expect(toolbar.style.left).toBe("288px"); expect(toolbar.style.top).toBe("142px");
  expect(localStorage.getItem(KEY)).not.toBeNull();
  fireEvent.pointerDown(handle, { button: 0, pointerId: 2, clientX: 400, clientY: 200 });
  fireEvent.pointerMove(handle, { pointerId: 2, clientX: 2000, clientY: -2000 });
  fireEvent.pointerUp(handle, { pointerId: 2 });
  expect(toolbar.style.left).toBe("552px"); expect(toolbar.style.top).toBe("8px");
});

it("restores position and keeps it reachable when the pane becomes smaller", () => {
  localStorage.setItem(KEY, JSON.stringify({ x: 1, y: 1 }));
  render(<Harness />);
  const toolbar = screen.getByTestId("drag-toolbar");
  expect(toolbar.style.left).toBe("552px"); expect(toolbar.style.top).toBe("562px");
  act(() => { width = 390; height = 200; window.dispatchEvent(new Event("resize")); });
  expect(toolbar.style.left).toBe("142px"); expect(toolbar.style.top).toBe("162px");
});

it("supports keyboard movement and resets the saved position", () => {
  render(<Harness />);
  const handle = screen.getByRole("button", { name: "Move" });
  fireEvent.keyDown(handle, { key: "ArrowUp" });
  expect(screen.getByTestId("drag-toolbar").style.top).toBe("552px");
  fireEvent.keyDown(handle, { key: "Home" });
  expect(screen.getByTestId("drag-toolbar").style.top).toBe(""); expect(localStorage.getItem(KEY)).toBeNull();
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  fireEvent.doubleClick(handle);
  expect(screen.getByTestId("drag-toolbar").style.left).toBe(""); expect(localStorage.getItem(KEY)).toBeNull();
});

it("keeps dragging usable with malformed preferences or blocked storage", () => {
  localStorage.setItem(KEY, "invalid JSON");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
  render(<Harness />);
  fireEvent.keyDown(screen.getByRole("button", { name: "Move" }), { key: "ArrowRight" });
  expect(screen.getByTestId("drag-toolbar").style.left).toBe("18px");
});
