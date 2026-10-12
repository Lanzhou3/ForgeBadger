// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import { GatewayApiError, type Session } from "@/lib/api";
import { readSessionTabs, writeSessionTabs } from "@/lib/session-tabs";
import TerminalPage from "./page";

const { getSessionMock, connectSessionMock, startSessionMock, listTaskPacketsMock, getSessionWorkStatesMock, pushMock, replaceMock } = vi.hoisted(
  () => ({
    getSessionMock: vi.fn(),
    connectSessionMock: vi.fn(),
    startSessionMock: vi.fn(),
    listTaskPacketsMock: vi.fn(),
    getSessionWorkStatesMock: vi.fn(),
    pushMock: vi.fn(),
    replaceMock: vi.fn(),
  })
);

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "s1" }),
  usePathname: () => "/sessions/s1",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
}));

vi.mock("@/lib/auth", () => ({
  getToken: () => "auth-token",
}));

vi.mock("@/components/sessions/session-notification-bell", () => ({
  SessionNotificationBell: () => null,
}));

// The real xterm stack is exercised in terminal-view.test; here the terminal
// only needs to mount so the page chrome (focus-mode toggle) renders.
vi.mock("@/components/terminal-view", () => ({
  TerminalView: () => <div data-testid="terminal-view-stub" />,
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getSession: getSessionMock,
    connectSession: connectSessionMock,
    startSession: startSessionMock,
    listProjectManagerTaskPackets: listTaskPacketsMock,
    getSessionWorkStates: getSessionWorkStatesMock,
  };
});

// jsdom has no ResizeObserver; some terminal-adjacent components observe sizes.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = window.ResizeObserver ?? (ResizeObserverStub as unknown as typeof ResizeObserver);

// jsdom lacks these DOM APIs that the side panels call in effects.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false);
Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture ?? (() => {});
window.HTMLElement.prototype.scrollIntoView ??= vi.fn();

function makeSession(overrides: Partial<Session>): Session {
  return {
    id: "s1",
    status: "stopped",
    name: "ghost-session",
    projectId: "p1",
    projectName: "Alpha",
    aiTool: "claude",
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <TerminalPage />
      </QueryClientProvider>
    </LanguageProvider>
  );
}

describe("TerminalPage lost session", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.setItem("forgebadger-language", "zh-CN");
    writeSessionTabs([]);
    pushMock.mockClear();
    replaceMock.mockClear();
    listTaskPacketsMock.mockResolvedValue({ taskPackets: [] });
    getSessionWorkStatesMock.mockResolvedValue({ states: [], snapshotAt: 0 });
    connectSessionMock.mockResolvedValue({ session: makeSession({}), attachToken: "" });
    startSessionMock.mockResolvedValue({ session: makeSession({ status: "running" }) });
  });

  it("shows the lost explanation and restart guidance instead of the stopped panel", async () => {
    getSessionMock.mockResolvedValue({ session: makeSession({ status: "lost" }) });
    renderPage();

    await screen.findByText("会话已丢失");
    expect(screen.getByText(/终端进程已不可恢复/)).toBeTruthy();
    // Restart guidance: an explicit Start action, not just a back link.
    expect(screen.getByRole("button", { name: "启动" })).toBeTruthy();
    // Distinguishable from the generic stopped/cannot-open panel.
    expect(screen.queryByText("无法打开终端")).toBeNull();
    expect(screen.queryByText(/会话未运行/)).toBeNull();
    // The terminal itself must not mount for a lost session.
    expect(screen.queryByText(/正在准备终端连接/)).toBeNull();
    expect(connectSessionMock).not.toHaveBeenCalled();
    // The tab strip stays mounted so other sessions remain reachable.
    expect(screen.getByTestId("session-tabs")).toBeTruthy();
  });

  it("keeps the stopped panel neutral and points at its own start button", async () => {
    getSessionMock.mockResolvedValue({ session: makeSession({ status: "stopped" }) });
    renderPage();

    // Neutral, expected-state framing — not the destructive cannot-open card.
    const title = await screen.findByText("会话已停止");
    expect(title.className).toContain("text-foreground");
    expect(title.className).not.toContain("text-destructive");
    const card = title.closest(".max-w-md")!;
    expect(card.className).toContain("bg-muted/30");
    expect(card.className).not.toContain("bg-destructive/10");
    // The guidance references the Start action rendered on this panel…
    expect(screen.getByText(/点击下方「启动」按钮重新打开终端/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "启动" })).toBeTruthy();
    // …and never the stale "go back to the list and use Connect" line.
    expect(screen.queryByText(/返回会话列表并使用连接按钮/)).toBeNull();
    expect(screen.queryByText("无法打开终端")).toBeNull();
    // The tab strip stays mounted (previously the whole page was replaced,
    // which stranded the user on a dead panel with no tab bar).
    expect(screen.getByTestId("session-tabs")).toBeTruthy();
    expect(screen.queryByText("会话已丢失")).toBeNull();
    expect(connectSessionMock).not.toHaveBeenCalled();
  });

  it("does not tell the user to use Connect for a deleted session", async () => {
    getSessionMock.mockRejectedValue(new Error("not found"));
    renderPage();

    await screen.findByText("无法打开终端");
    expect(screen.getByText(/会话不存在或已被删除/)).toBeTruthy();
    // Deleted sessions cannot be reconnected: no Connect hint, only the back link.
    expect(screen.queryByText(/返回会话列表并使用连接按钮/)).toBeNull();
    expect(screen.getByRole("link", { name: "返回会话" })).toBeTruthy();
    // Even an unreadable session keeps the tab strip so other tabs stay usable.
    expect(screen.getByTestId("session-tabs")).toBeTruthy();
    // A generic (non-404) failure does not trigger the deleted-session self-heal.
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("removes a dead tab and jumps to a running session on a real 404", async () => {
    getSessionMock.mockRejectedValue(new GatewayApiError("Session not found", 404));
    writeSessionTabs([
      { id: "s1", label: "dead", status: "running", updatedAt: 1 },
      { id: "s2", label: "live", status: "running", updatedAt: 2 },
    ]);
    renderPage();

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/sessions/s2"));
    expect(replaceMock).not.toHaveBeenCalledWith("/sessions/s1");
    // The dead tab is removed; the running one stays.
    expect(readSessionTabs().map((tab) => tab.id)).toEqual(["s2"]);
  });

  it("drops a dead tab and goes to the session list when nothing is running", async () => {
    getSessionMock.mockRejectedValue(new GatewayApiError("Session not found", 404));
    writeSessionTabs([
      { id: "s1", label: "dead", status: "running", updatedAt: 1 },
      { id: "s2", label: "stopped", status: "exited", updatedAt: 2 },
    ]);
    renderPage();

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/sessions"));
  });

  it("marks the body in focus mode so the app sidebar chrome is hidden", async () => {
    getSessionMock.mockResolvedValue({ session: makeSession({ status: "running" }) });
    connectSessionMock.mockResolvedValue({
      session: makeSession({ status: "running" }),
      attachToken: "attach-1",
    });
    renderPage();

    const focusButton = await screen.findByRole("button", { name: "专注模式" });
    fireEvent.click(focusButton);
    // globals.css hides [data-app-sidebar] and the mobile trigger while the
    // attribute is set, giving the terminal the full window width.
    expect(document.body.hasAttribute("data-session-focus-mode")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "退出专注" }));
    expect(document.body.hasAttribute("data-session-focus-mode")).toBe(false);
  });
});
