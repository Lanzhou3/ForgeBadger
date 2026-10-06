// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import type { Session } from "@/lib/api";
import TerminalPage from "./page";

const { getSessionMock, connectSessionMock, startSessionMock, listTaskPacketsMock } = vi.hoisted(
  () => ({
    getSessionMock: vi.fn(),
    connectSessionMock: vi.fn(),
    startSessionMock: vi.fn(),
    listTaskPacketsMock: vi.fn(),
  })
);

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "s1" }),
  usePathname: () => "/sessions/s1",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
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
    window.localStorage.removeItem("forgebadger.session-tabs.v1");
    listTaskPacketsMock.mockResolvedValue({ taskPackets: [] });
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
    // The header names the session instead of showing the raw id.
    expect(screen.getByText("ghost-session")).toBeTruthy();
    // Mobile: the header reserves the fixed-hamburger band (terminal routes
    // skip the shell-level pt-16), restored to normal padding at md.
    const fallbackHeader = screen.getByTestId("session-fallback-header");
    expect(fallbackHeader.className).toContain("pl-16");
    expect(fallbackHeader.className).toContain("md:pl-4");
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
