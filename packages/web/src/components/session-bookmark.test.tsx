// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import { writeSessionTabs } from "@/lib/session-tabs";
import { SessionBookmark } from "./session-bookmark";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/projects",
}));

function bookmark() {
  render(<LanguageProvider><SessionBookmark /></LanguageProvider>);
  const button = screen.getByRole("button");
  button.setPointerCapture = vi.fn();
  button.hasPointerCapture = () => true;
  button.releasePointerCapture = vi.fn();
  vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
    top: 380, bottom: 420, left: 960, right: 1000,
    width: 40, height: 40, x: 960, y: 380, toJSON: () => ({}),
  });
  return button;
}

function pointer(button: HTMLElement, type: string, y: number, id = 1) {
  const event = new MouseEvent(type, { bubbles: true, clientX: 980, clientY: y, button: 0 });
  Object.defineProperty(event, "pointerId", { value: id });
  fireEvent(button, event);
}

describe("SessionBookmark dragging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    writeSessionTabs([{ id: "s1", label: "Active session", status: "running", updatedAt: Date.now() }]);
  });
  afterEach(cleanup);

  it("moves vertically and does not navigate when released after a drag", () => {
    const button = bookmark();
    pointer(button, "pointerdown", 400);
    pointer(button, "pointermove", 550);
    expect(button.parentElement?.style.top).toBe("550px");
    pointer(button, "pointerup", 550);
    fireEvent.click(button, { detail: 1 });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("keeps slight pointer movement clickable and supports keyboard activation after dragging", () => {
    const button = bookmark();
    pointer(button, "pointerdown", 400);
    pointer(button, "pointermove", 402);
    pointer(button, "pointerup", 402);
    fireEvent.click(button, { detail: 1 });
    expect(pushMock).toHaveBeenCalledWith("/sessions/s1");
    pushMock.mockClear();
    pointer(button, "pointerdown", 400);
    pointer(button, "pointermove", 500);
    pointer(button, "pointerup", 500);
    fireEvent.click(button, { detail: 0 });
    expect(pushMock).toHaveBeenCalledWith("/sessions/s1");
  });

  it("clamps both edges and stays visible after the viewport shrinks", () => {
    const button = bookmark();
    pointer(button, "pointerdown", 400);
    pointer(button, "pointermove", -100);
    expect(button.parentElement?.style.top).toBe("28px");
    pointer(button, "pointermove", 1000);
    expect(button.parentElement?.style.top).toBe("772px");
    pointer(button, "pointerup", 1000);
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 500 });
    fireEvent(window, new Event("resize"));
    expect(button.parentElement?.style.top).toBe("472px");
  });

  it.each(["pointercancel", "lostpointercapture"])("ends %s without navigating or getting stuck", (type) => {
    const button = bookmark();
    pointer(button, "pointerdown", 400);
    pointer(button, "pointermove", 500);
    pointer(button, type, 500);
    pointer(button, "pointermove", 600);
    expect(button.parentElement?.style.top).toBe("500px");
    fireEvent.click(button, { detail: 1 });
    expect(pushMock).not.toHaveBeenCalled();
    pointer(button, "pointerdown", 500);
    pointer(button, "pointerup", 500);
    fireEvent.click(button, { detail: 1 });
    expect(pushMock).toHaveBeenCalledWith("/sessions/s1");
  });

  it("ignores a second pointer while dragging", () => {
    const button = bookmark();
    pointer(button, "pointerdown", 400);
    pointer(button, "pointerdown", 100, 2);
    pointer(button, "pointermove", 200, 2);
    pointer(button, "pointerup", 200, 2);
    pointer(button, "pointermove", 450);
    expect(button.parentElement?.style.top).toBe("450px");
  });
});
