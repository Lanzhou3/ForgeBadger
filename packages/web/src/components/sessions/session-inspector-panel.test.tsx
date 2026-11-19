// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LanguageProvider } from "@/hooks/use-language";
import {
  clampInspectorWidth,
  INSPECTOR_DEFAULT_WIDTH,
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
  SessionInspectorPanel,
} from "./session-inspector-panel";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = window.ResizeObserver ?? (ResizeObserverStub as unknown as typeof ResizeObserver);

function renderPanel(
  props: Partial<React.ComponentProps<typeof SessionInspectorPanel>> = {}
) {
  return render(
    <LanguageProvider>
      <SessionInspectorPanel
        open
        onOpenChange={() => undefined}
        quotaStrip={<div data-testid="quota-strip-stub">5h 剩 70%</div>}
        gitContent={<p>git body</p>}
        gitCount={4}
        taskContent={<p>task body</p>}
        taskAvailable
        {...props}
      />
    </LanguageProvider>
  );
}

beforeEach(() => {
  window.localStorage.setItem("forgebadger-language", "en");
  window.localStorage.removeItem("forgebadger.session-inspector-tab");
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("SessionInspectorPanel", () => {
  it("keeps the pinned quota strip visible while switching between Changes and Task packet", () => {
    renderPanel();

    expect(screen.getByTestId("quota-strip-stub")).toBeTruthy();
    const changes = screen.getByRole("tab", { name: /Changes/ });
    const task = screen.getByRole("tab", { name: /Task packet/ });
    expect(changes.getAttribute("aria-selected")).toBe("true");
    expect(changes.textContent).toContain("4");
    expect(screen.getByText("git body")).toBeTruthy();

    fireEvent.click(task);

    expect(screen.getByTestId("quota-strip-stub")).toBeTruthy();
    expect(task.getAttribute("aria-selected")).toBe("true");
    expect(changes.getAttribute("aria-selected")).toBe("false");
    expect(screen.getByText("task body").parentElement?.hasAttribute("hidden")).toBe(false);
    expect(screen.getByText("git body").parentElement?.hasAttribute("hidden")).toBe(true);
    // The chosen tab survives a remount so reopening the pane keeps context.
    expect(window.localStorage.getItem("forgebadger.session-inspector-tab")).toBe("task");
  });

  it("drops the tab bar when no task packet exists and falls back to Changes", () => {
    window.localStorage.setItem("forgebadger.session-inspector-tab", "task");
    renderPanel({ taskAvailable: false });

    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByText("Changes")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("git body").parentElement?.hasAttribute("hidden")).toBe(false);
  });

  it("keeps the persisted width inside the readable bounds", () => {
    expect(clampInspectorWidth(Number.NaN)).toBe(INSPECTOR_DEFAULT_WIDTH);
    expect(clampInspectorWidth(10)).toBe(INSPECTOR_MIN_WIDTH);
    expect(clampInspectorWidth(9999)).toBe(INSPECTOR_MAX_WIDTH);
    expect(clampInspectorWidth(400.4)).toBe(400);
  });
});
