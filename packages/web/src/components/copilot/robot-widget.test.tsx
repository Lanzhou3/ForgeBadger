// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import { FORGEBADGER_GATEWAY_EVENT } from "@/lib/gateway-events";
import { RobotWidget } from "@/components/copilot/robot-widget";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { markReadMock, routerPushMock } = vi.hoisted(() => ({
  markReadMock: vi.fn(),
  routerPushMock: vi.fn(),
}));

vi.mock("@/hooks/use-notifications", () => ({
  useNotifications: () => ({ markRead: markReadMock }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

// jsdom lacks pointer capture and matchMedia, both used by the widget.
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};
window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

function renderWidget(props: { onActivate?: () => void; suppressBubbles?: boolean; panelOpen?: boolean } = {}) {
  const onActivate = props.onActivate ?? vi.fn();
  render(
    <LanguageProvider>
      <RobotWidget
        onActivate={onActivate}
        suppressBubbles={props.suppressBubbles}
        panelOpen={props.panelOpen}
      />
    </LanguageProvider>
  );
  return { onActivate };
}

async function robotButton() {
  await waitFor(() => expect(screen.getByRole("button", { name: "Copilot" })).toBeTruthy());
  return screen.getByRole("button", { name: "Copilot" });
}

function clickRobot(robot: HTMLElement) {
  fireEvent.pointerDown(robot, { button: 0, clientX: 500, clientY: 500 });
  fireEvent.pointerUp(robot, { clientX: 500, clientY: 500 });
}

function dispatchCliNotification(notificationId = "notif-1", message = "Build finished") {
  act(() => {
    window.dispatchEvent(
      new CustomEvent(FORGEBADGER_GATEWAY_EVENT, {
        detail: {
          type: "claude_notification",
          payload: {
            notification_type: "task_completed",
            session_id: "sess-1",
            notification_id: notificationId,
            message,
          },
        },
      })
    );
  });
}

describe("RobotWidget activation", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("fires onActivate on a plain click (no drag)", async () => {
    const { onActivate } = renderWidget();

    clickRobot(await robotButton());

    expect(onActivate).toHaveBeenCalledTimes(1);
    // The click no longer navigates; the host owns the chat panel.
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("reflects the panel state through aria-expanded", async () => {
    renderWidget({ panelOpen: true });

    expect((await robotButton()).getAttribute("aria-expanded")).toBe("true");
  });

  it("suppresses notification bubbles while the panel is open", async () => {
    renderWidget({ panelOpen: true });

    dispatchCliNotification();

    // The bubble's call-to-action never appears while the panel is up.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("button", { name: "打开会话" })).toBeNull();
  });

  it("marks the visible bubble as read when the panel is opened", async () => {
    const { onActivate } = renderWidget();

    dispatchCliNotification();
    await waitFor(() => expect(screen.getByRole("button", { name: "打开会话" })).toBeTruthy());

    clickRobot(await robotButton());

    expect(markReadMock).toHaveBeenCalledWith("notif-1");
    expect(onActivate).toHaveBeenCalledTimes(1);
    // The bubble is dismissed locally instead of navigating to its href.
    expect(routerPushMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "打开会话" })).toBeNull();
  });
});

describe("RobotWidget bubble queue", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("shows the queued bubble after the head is dismissed without marking it read", async () => {
    renderWidget();

    dispatchCliNotification("notif-1", "First build finished");
    await waitFor(() => expect(screen.getByText(/First build finished/)).toBeTruthy());
    dispatchCliNotification("notif-2", "Second build finished");

    // Only the head of the queue is rendered.
    expect(screen.queryByText(/Second build finished/)).toBeNull();

    // Dismiss the head via the X button: no markRead, next bubble shows.
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    await waitFor(() => expect(screen.getByText(/Second build finished/)).toBeTruthy());
    expect(screen.queryByText(/First build finished/)).toBeNull();
    expect(markReadMock).not.toHaveBeenCalled();
  });

  it("marks only the head as read when opening its session", async () => {
    renderWidget();

    dispatchCliNotification("notif-1", "First build finished");
    await waitFor(() => expect(screen.getByText(/First build finished/)).toBeTruthy());
    dispatchCliNotification("notif-2", "Second build finished");

    fireEvent.click(screen.getByRole("button", { name: "打开会话" }));

    expect(markReadMock).toHaveBeenCalledTimes(1);
    expect(markReadMock).toHaveBeenCalledWith("notif-1");
    expect(routerPushMock).toHaveBeenCalledWith("/sessions/sess-1");
    // The next queued bubble takes over the display.
    await waitFor(() => expect(screen.getByText(/Second build finished/)).toBeTruthy());
  });
});


describe("RobotWidget motion budget", () => {
  const originalMatchMedia = window.matchMedia;
  let preference: EventTarget & { matches: boolean };

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useFakeTimers();
    window.localStorage.clear();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    preference = Object.assign(new EventTarget(), { matches: false });
    window.matchMedia = (() => preference) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.matchMedia = originalMatchMedia;
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("stops all decorative timers while hidden and resumes on return", () => {
    renderWidget();
    act(() => vi.advanceTimersByTime(8001));
    expect(document.querySelector("[data-robot-frame]")?.getAttribute("data-robot-frame")).toMatch(/^sit/);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    act(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(30000));
    expect(vi.getTimerCount()).toBe(0);

    act(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    act(() => vi.advanceTimersByTime(8001));
    expect(document.querySelector("[data-robot-frame]")?.getAttribute("data-robot-frame")).toMatch(/^sit/);
    cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reacts to reduced-motion changes and keeps keyboard activation available", () => {
    const { onActivate } = renderWidget();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    act(() => {
      preference.matches = true;
      preference.dispatchEvent(new Event("change"));
    });
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(30000));
    expect(document.querySelector("[data-robot-frame]")?.getAttribute("data-robot-frame")).toBe("stand");
    fireEvent.keyDown(screen.getByRole("button", { name: "Copilot" }), { key: "Enter" });
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      preference.matches = false;
      preference.dispatchEvent(new Event("change"));
    });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });

  it("starts static without timers when reduced motion is already enabled", () => {
    preference.matches = true;
    renderWidget();
    expect(vi.getTimerCount()).toBe(0);
    expect(document.querySelector("[data-robot-frame]")?.getAttribute("data-robot-frame")).toBe("stand");
  });
});

describe("RobotWidget drag direction", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
    window.localStorage.setItem("forgebadger.robotCorner", "top-left");
  });
  afterEach(cleanup);

  function facesRight(robot: HTMLElement) {
    // The Blender sprite faces left natively; mirroring makes it face right.
    return robot.querySelector("[data-robot-frame]")!.classList.contains("-scale-x-100");
  }

  it("faces right when dragged right and left when dragged left", async () => {
    const { onActivate } = renderWidget();
    const robot = await robotButton();
    fireEvent.pointerDown(robot, { button: 0, pointerId: 1, clientX: 500, clientY: 500 });
    fireEvent.pointerMove(robot, { pointerId: 1, clientX: 540, clientY: 500 });
    expect(facesRight(robot)).toBe(true);
    fireEvent.pointerMove(robot, { pointerId: 1, clientX: 460, clientY: 500 });
    expect(facesRight(robot)).toBe(false);
    fireEvent.pointerUp(robot, { pointerId: 1, clientX: 460, clientY: 500 });
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("turns immediately on reversal before crossing the original pointer position", async () => {
    renderWidget();
    const robot = await robotButton();
    fireEvent.pointerDown(robot, { button: 0, pointerId: 1, clientX: 500, clientY: 500 });
    fireEvent.pointerMove(robot, { pointerId: 1, clientX: 600, clientY: 500 });
    const outer = robot.parentElement!;
    const rightX = Number.parseFloat(outer.style.left);
    fireEvent.pointerMove(robot, { pointerId: 1, clientX: 580, clientY: 500 });
    expect(facesRight(robot)).toBe(false);
    // Position still follows total displacement; reversing the heading must not jump it.
    expect(Number.parseFloat(outer.style.left)).toBe(rightX - 20);
    fireEvent.pointerMove(robot, { pointerId: 1, clientX: 590, clientY: 500 });
    expect(facesRight(robot)).toBe(true);
    expect(Number.parseFloat(outer.style.left)).toBe(rightX - 10);
  });

  it("keeps its heading during vertical dragging and small horizontal jitter", async () => {
    renderWidget();
    const robot = await robotButton();
    fireEvent.pointerDown(robot, { button: 0, pointerId: 1, clientX: 500, clientY: 500 });
    fireEvent.pointerMove(robot, { pointerId: 1, clientX: 460, clientY: 500 });
    for (const x of [460, 460.5, 459.5, 461]) {
      fireEvent.pointerMove(robot, { pointerId: 1, clientX: x, clientY: 550 });
      expect(facesRight(robot)).toBe(false);
    }
    // Several small steps can accumulate into an intentional turn.
    for (const x of [461.5, 462, 462.5]) {
      fireEvent.pointerMove(robot, { pointerId: 1, clientX: x, clientY: 550 });
    }
    expect(facesRight(robot)).toBe(true);
  });
});
