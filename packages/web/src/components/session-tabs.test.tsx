// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import { FORGEBADGER_GATEWAY_EVENT } from "@/lib/gateway-events";
import { readSessionTabs, writeSessionTabs, type SessionTab } from "@/lib/session-tabs";
import { SessionTabs } from "./session-tabs";

const { pushMock, toastInfoMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  toastInfoMock: vi.fn(),
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
  return render(
    <LanguageProvider>
      <SessionTabs activeSessionId={activeSessionId} />
    </LanguageProvider>
  );
}

describe("SessionTabs gateway status events", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
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

  it("closes the active tab and navigates to the next tab", () => {
    seedTabs([
      { id: "s1", label: "A", status: "running", updatedAt: 1 },
      { id: "s2", label: "B", status: "running", updatedAt: 2 },
    ]);
    renderTabs("s1");

    dispatchStatusChanged("s1", "exited");

    expect(readSessionTabs().map((tab) => tab.id)).toEqual(["s2"]);
    expect(pushMock).toHaveBeenCalledWith("/sessions/s2");
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
});
