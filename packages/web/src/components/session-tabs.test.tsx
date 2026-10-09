// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { LanguageProvider } from "@/hooks/use-language";
import { FORGEBADGER_GATEWAY_EVENT } from "@/lib/gateway-events";
import { readCollapsedSessionTabGroups, readSessionTabs, setSessionTabGroupCollapsed, writeSessionTabs, type SessionTab } from "@/lib/session-tabs";
import { SessionTabs } from "./session-tabs";

const { pushMock, toastInfoMock, workSnapshotMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  toastInfoMock: vi.fn(),
  workSnapshotMock: vi.fn(),
}));

vi.mock("@/lib/api", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/api")>(),
  getSessionWorkStates: workSnapshotMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/sessions/s1",
}));

vi.mock("@/lib/toast", () => ({
  toast: { info: toastInfoMock },
}));

function seedTabs(tabs: SessionTab[]) {
  writeSessionTabs(tabs);
}

function dispatchStatusChanged(sessionId: string, newStatus: string) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent(FORGEBADGER_GATEWAY_EVENT, {
        detail: {
          type: "session_status_changed",
          payload: { session_id: sessionId, old_status: "running", new_status: newStatus },
        },
      })
    );
  });
}

function renderTabs(activeSessionId = "s1") {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <SessionTabs activeSessionId={activeSessionId} />
      </LanguageProvider>
    </QueryClientProvider>
  );
}

describe("SessionTabs gateway status events", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    workSnapshotMock.mockResolvedValue({ states: [], snapshotAt: 0 });
    window.localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });

  it("pulses only working CLI tabs, restores snapshots and stops on completion without closing", async () => {
    seedTabs([
      { id: "s1", label: "A", status: "running", updatedAt: 1 },
      { id: "s2", label: "B", status: "running", updatedAt: 2 },
    ]);
    workSnapshotMock.mockResolvedValue({ states: [
      { sessionId: "s1", state: "working", updatedAt: 10 },
      { sessionId: "s2", state: "idle", updatedAt: 10 },
    ], snapshotAt: 10 });
    renderTabs();
    const dot = (id: string) => document.querySelector(`[data-session-work-id="${id}"]`)!;
    await waitFor(() => expect(dot("s1").className).toContain("animate-pulse"));
    expect(dot("s2").className).not.toContain("animate-pulse");
    const work = (state: string, updatedAt: number) => act(() => window.dispatchEvent(new CustomEvent(FORGEBADGER_GATEWAY_EVENT, {
      detail: { type: "session_work_state_changed", payload: { session_id: "s1", state, updated_at: updatedAt } },
    })));
    work("idle", 20);
    expect(dot("s1").className).not.toContain("animate-pulse");
    expect(readSessionTabs()).toHaveLength(2);
    expect(readSessionTabs()[0]?.status).toBe("running");
    work("working", 19); // Delayed frames cannot revive the old task.
    expect(dot("s1").className).not.toContain("animate-pulse");
    work("working", 21);
    expect(dot("s1").className).toContain("animate-pulse");
    dispatchStatusChanged("s1", "lost");
    expect(dot("s1").className).not.toContain("animate-pulse");
  });

  it("uses the same live work indicator in a collapsed project's overflow menu", async () => {
    seedTabs([{ id: "s1", label: "A", projectId: "p1", projectName: "Alpha", status: "running", updatedAt: 1 }]);
    workSnapshotMock.mockResolvedValue({ states: [{ sessionId: "s1", state: "working", updatedAt: 10 }], snapshotAt: 10 });
    renderTabs();
    await waitFor(() => expect(document.querySelector('[data-session-work-id="s1"]')?.className).toContain("animate-pulse"));
    fireEvent.click(screen.getByRole("button", { name: "收起项目会话 Alpha" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: /更多会话标签/ }), { button: 0, ctrlKey: false, pointerType: "mouse" });
    await waitFor(() => expect(screen.getByRole("menuitem")).toBeTruthy());
    expect(document.querySelector('[data-session-work-id="s1"]')?.className).toContain("animate-pulse");
    act(() => window.dispatchEvent(new CustomEvent(FORGEBADGER_GATEWAY_EVENT, { detail: {
      type: "session_work_state_changed", payload: { session_id: "s1", state: "idle", updated_at: 11 },
    } })));
    expect(document.querySelector('[data-session-work-id="s1"]')?.className).not.toContain("animate-pulse");
  });

  it("closes an inactive tab when its session exits", () => {
    seedTabs([
      { id: "s1", label: "A", status: "running", updatedAt: 1 },
      { id: "s2", label: "B", status: "running", updatedAt: 2 },
    ]);
    renderTabs("s1");

    dispatchStatusChanged("s2", "exited");

    expect(readSessionTabs().map((tab) => tab.id)).toEqual(["s1"]);
    expect(toastInfoMock).toHaveBeenCalledOnce();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("closes the active tab and navigates to the most recently used running tab", () => {
    seedTabs([
      { id: "s1", label: "A", status: "running", updatedAt: 1 },
      { id: "s2", label: "B", status: "running", updatedAt: 2 },
    ]);
    renderTabs("s1");

    dispatchStatusChanged("s1", "exited");

    expect(readSessionTabs().map((tab) => tab.id)).toEqual(["s2"]);
    expect(pushMock).toHaveBeenCalledWith("/sessions/s2");
  });

  it("skips a stale non-running tab and jumps to the running one", () => {
    // A lingering exited/stopped tab (e.g. a Copilot-command session that was
    // auto-deleted server-side) must never become the navigation target: its
    // page would show the not-found card.
    seedTabs([
      { id: "s1", label: "A", status: "running", updatedAt: 1 },
      { id: "dead", label: "dead", status: "exited", updatedAt: 2 },
      { id: "s3", label: "C", status: "running", updatedAt: 3 },
    ]);
    renderTabs("s1");

    dispatchStatusChanged("s1", "exited");

    expect(readSessionTabs().map((tab) => tab.id)).toEqual(["dead", "s3"]);
    expect(pushMock).toHaveBeenCalledWith("/sessions/s3");
  });

  it("navigates to the session list when no running tab remains", () => {
    seedTabs([
      { id: "s1", label: "A", status: "running", updatedAt: 1 },
      { id: "dead", label: "dead", status: "exited", updatedAt: 2 },
    ]);
    renderTabs("s1");

    dispatchStatusChanged("s1", "exited");

    // No running session left — go to the list instead of a dead tab.
    expect(readSessionTabs().map((tab) => tab.id)).toEqual(["dead"]);
    expect(pushMock).toHaveBeenCalledWith("/sessions");
  });

  it("navigates to the session list when the last tab exits", () => {
    seedTabs([{ id: "s1", label: "A", status: "running", updatedAt: 1 }]);
    renderTabs("s1");

    dispatchStatusChanged("s1", "exited");

    expect(readSessionTabs()).toEqual([]);
    expect(pushMock).toHaveBeenCalledWith("/sessions");
  });

  it("keeps lost sessions visible and only refreshes the tab status", () => {
    seedTabs([{ id: "s1", label: "A", status: "running", updatedAt: 1 }]);
    renderTabs("s1");

    dispatchStatusChanged("s1", "lost");

    const tabs = readSessionTabs();
    expect(tabs).toHaveLength(1);
    expect(tabs[0]?.status).toBe("lost");
    expect(toastInfoMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("ignores events for sessions without an open tab", () => {
    seedTabs([{ id: "s1", label: "A", status: "running", updatedAt: 1 }]);
    renderTabs("s1");

    dispatchStatusChanged("unknown", "exited");

    expect(readSessionTabs().map((tab) => tab.id)).toEqual(["s1"]);
    expect(toastInfoMock).not.toHaveBeenCalled();
  });

  it("collapses and expands a single project without navigating or removing sessions, and restores the preference", () => {
    seedTabs([
      { id: "s1", label: "A", projectId: "p1", projectName: "Alpha", status: "running", updatedAt: 1 },
      { id: "s2", label: "B", projectId: "p1", projectName: "Alpha", status: "running", updatedAt: 2 },
    ]);
    const first = renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "收起项目会话 Alpha" }));
    expect(screen.queryByRole("link", { name: /^A(?:\s*·|$)/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /^B(?:\s*·|$)/ })).toBeNull();
    expect(screen.getByRole("button", { name: "展开项目会话 Alpha" }).getAttribute("aria-expanded")).toBe("false");
    expect(readSessionTabs()).toHaveLength(2);
    expect(pushMock).not.toHaveBeenCalled();
    first.unmount();
    renderTabs();
    expect(screen.queryByRole("link", { name: /^A(?:\s*·|$)/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "展开项目会话 Alpha" }));
    expect(screen.getByRole("link", { name: /^A(?:\s*·|$)/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^B(?:\s*·|$)/ })).toBeTruthy();
    expect([...readCollapsedSessionTabGroups()]).toEqual([]);
  });

  it("keeps folded project headers available and expands the selected group when the active session changes", () => {
    seedTabs([
      ...Array.from({ length: 12 }, (_, index) => ({ id: `first-${index}`, label: `First ${index}`,
        projectId: "p1", projectName: "Alpha", status: "running", updatedAt: index })),
      { id: "s2", label: "B", projectId: "p2", projectName: "Beta", status: "running", updatedAt: 20 },
    ]);
    setSessionTabGroupCollapsed("project:p2", true);
    const rendered = renderTabs("first-0");
    expect(screen.getByRole("button", { name: "展开项目会话 Beta" })).toBeTruthy();
    rendered.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <LanguageProvider><SessionTabs activeSessionId="s2" /></LanguageProvider>
      </QueryClientProvider>
    );
    expect(screen.getByRole("button", { name: "收起项目会话 Beta" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: /^B(?:\s*·|$)/ })).toBeTruthy();
    expect([...readCollapsedSessionTabGroups()]).toEqual([]);
  });

  it("does not reopen a collapsed active group when session status changes and supports other-window preference updates", () => {
    seedTabs([{ id: "s1", label: "A", projectId: "p1", projectName: "Alpha", status: "running", updatedAt: 1 }]);
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "收起项目会话 Alpha" }));
    dispatchStatusChanged("s1", "lost");
    expect(screen.queryByRole("link", { name: /^A(?:\s*·|$)/ })).toBeNull();
    expect(readSessionTabs()[0]?.status).toBe("lost");
    act(() => {
      setSessionTabGroupCollapsed("project:p1", false);
      window.dispatchEvent(new StorageEvent("storage"));
    });
    expect(screen.getByRole("link", { name: /^A(?:\s*·|$)/ })).toBeTruthy();
  });

  it("reveals an active session whose tab metadata arrives after navigation", () => {
    seedTabs([{ id: "s1", label: "A", projectId: "p1", projectName: "Alpha", status: "running", updatedAt: 1 }]);
    setSessionTabGroupCollapsed("project:p2", true);
    const rendered = renderTabs();
    rendered.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <LanguageProvider><SessionTabs activeSessionId="s2" /></LanguageProvider>
      </QueryClientProvider>
    );
    act(() => {
      seedTabs([
        ...readSessionTabs(),
        { id: "s2", label: "B", projectId: "p2", projectName: "Beta", status: "running", updatedAt: 2 },
      ]);
      window.dispatchEvent(new Event("forgebadger-session-tabs-changed"));
    });
    expect(screen.getByRole("link", { name: /^B(?:\s*·|$)/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "收起项目会话 Beta" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps drag handles and close buttons independent from navigation", () => {
    seedTabs([
      { id: "s1", label: "A", projectId: "p1", projectName: "Alpha", status: "running", updatedAt: 1 },
      { id: "s2", label: "B", projectId: "p1", projectName: "Alpha", status: "running", updatedAt: 2 },
    ]);
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "移动会话标签 B" }));
    expect(readSessionTabs()).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "关闭会话标签 B" }));
    expect(readSessionTabs().map(tab => tab.id)).toEqual(["s1"]);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("prevents native link navigation from the click produced at the end of a label drag", () => {
    seedTabs([
      { id: "s1", label: "A", projectId: "p1", projectName: "Alpha", status: "running", updatedAt: 1 },
      { id: "s2", label: "B", projectId: "p1", projectName: "Alpha", status: "running", updatedAt: 2 },
    ]);
    renderTabs();
    const link = screen.getByRole("link", { name: /^B(?:\s*·|$)/ });
    const pointer = (type: string, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY: 10 });
      Object.defineProperty(event, "isPrimary", { value: true });
      return event;
    };
    fireEvent(link, pointer("pointerdown", 10));
    fireEvent(document, pointer("pointermove", 40));
    expect(screen.getByRole("button", { name: "移动会话标签 B" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent(document, pointer("pointerup", 40));
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    fireEvent(link, click);
    expect(click.defaultPrevented).toBe(true);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("reorders with arrow keys on the focused move button and stops at project boundaries", () => {
    seedTabs([
      { id: "s1", label: "A", projectId: "p1", projectName: "Alpha", status: "running", updatedAt: 1 },
      { id: "s2", label: "B", projectId: "p1", projectName: "Alpha", status: "running", updatedAt: 2 },
      { id: "s3", label: "C", projectId: "p2", projectName: "Beta", status: "running", updatedAt: 3 },
    ]);
    renderTabs();
    const handle = screen.getByRole("button", { name: "移动会话标签 A" });
    handle.focus();
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(readSessionTabs().map(tab => tab.id)).toEqual(["s2", "s1", "s3"]);
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(readSessionTabs().map(tab => tab.id)).toEqual(["s2", "s1", "s3"]);
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(readSessionTabs().map(tab => tab.id)).toEqual(["s1", "s2", "s3"]);
    expect(document.activeElement).toBe(handle);
    expect(pushMock).not.toHaveBeenCalled();
  });
});
