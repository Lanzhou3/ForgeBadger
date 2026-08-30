// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import { OPENFORGE_GATEWAY_EVENT } from "@/lib/gateway-events";
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

function dispatchCliNotification() {
  act(() => {
    window.dispatchEvent(
      new CustomEvent(OPENFORGE_GATEWAY_EVENT, {
        detail: {
          type: "claude_notification",
          payload: {
            notification_type: "task_completed",
            session_id: "sess-1",
            notification_id: "notif-1",
            message: "Build finished",
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
