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
        gitContent={<p>git body</p>}
        gitCount={4}
        taskContent={<p>task body</p>}
        taskAvailable
        quotaContent={<p>quota body</p>}
        quotaAvailable
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
  it("presents one tabbed surface with a change-count badge and switches panes", () => {
    renderPanel();

    const changes = screen.getByRole("tab", { name: /Changes/ });
    const task = screen.getByRole("tab", { name: /Task packet/ });
    expect(changes.getAttribute("aria-selected")).toBe("true");
    expect(changes.textContent).toContain("4");
    expect(screen.getByText("git body")).toBeTruthy();

    fireEvent.click(task);

    expect(task.getAttribute("aria-selected")).toBe("true");
    expect(changes.getAttribute("aria-selected")).toBe("false");
    expect(screen.getByText("task body").parentElement?.hasAttribute("hidden")).toBe(false);
    expect(screen.getByText("git body").parentElement?.hasAttribute("hidden")).toBe(true);
    // The chosen tab survives a remount so reopening the pane keeps context.
    expect(window.localStorage.getItem("forgebadger.session-inspector-tab")).toBe("task");
  });

  it("hides tabs the session cannot offer and falls back to an available one", () => {
    window.localStorage.setItem("forgebadger.session-inspector-tab", "task");
    renderPanel({ taskAvailable: false, quotaAvailable: false });

    expect(screen.queryByRole("tab", { name: /Task packet/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /Quota/ })).toBeNull();
    expect(screen.getByRole("tab", { name: /Changes/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("keeps the persisted width inside the readable bounds", () => {
    expect(clampInspectorWidth(Number.NaN)).toBe(INSPECTOR_DEFAULT_WIDTH);
    expect(clampInspectorWidth(10)).toBe(INSPECTOR_MIN_WIDTH);
    expect(clampInspectorWidth(9999)).toBe(INSPECTOR_MAX_WIDTH);
    expect(clampInspectorWidth(400.4)).toBe(400);
  });
});
