// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import type { Session } from "@/lib/api";
import SessionsPage from "./page";

// jsdom has no ResizeObserver; SessionBoard observes column width changes.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = window.ResizeObserver ?? (ResizeObserverStub as unknown as typeof ResizeObserver);

const { getSessionBoardMock, getDependenciesMock, pushMock } = vi.hoisted(() => ({
  getSessionBoardMock: vi.fn(),
  getDependenciesMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getSessionBoard: getSessionBoardMock,
    getDependencies: getDependenciesMock,
  };
});

function makeSession(overrides: Partial<Session>): Session {
  return {
    id: "s1",
    status: "running",
    name: "session-one",
    projectId: "p1",
    projectName: "Alpha",
    aiTool: "claude",
    ...overrides,
  };
}

const sessions = [
  makeSession({ id: "s1", name: "alpha-fix" }),
  makeSession({ id: "s2", name: "beta-lost", status: "lost" }),
];

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <SessionsPage />
      </QueryClientProvider>
    </LanguageProvider>
  );
}

// jsdom has no matchMedia; the page forces the list view below md, so stub the
// breakpoint query. Default: desktop (the persisted board preference applies).
function stubMatchMedia(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe("SessionsPage", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    stubMatchMedia(true);
    window.localStorage.setItem("forgebadger-language", "zh-CN");
    window.localStorage.removeItem("forgebadger.sessionBoard.columnOrder.v1");
    window.localStorage.removeItem("forgebadger.sessionBoard.view.v1");
    getSessionBoardMock.mockResolvedValue({
      board: {
        projects: [{ id: "p1", name: "Alpha", path: "/tmp/alpha" }],
        sessions,
        sessionTasks: {},
      },
    });
    getDependenciesMock.mockResolvedValue({
      dependencies: [],
      terminalRuntime: {
        persistence: "session-server",
        mode: "ready",
        supported: true,
        message: "",
      },
    });
  });

  it("keeps the toolbar (including the search input) mounted when filters match nothing", async () => {
    renderPage();
    const searchInput = await screen.findByPlaceholderText("搜索会话、项目或工具");
    expect(searchInput.getAttribute("aria-label")).toBe("搜索会话、项目或工具");
    await screen.findByText("alpha-fix");

    fireEvent.change(searchInput, { target: { value: "no-such-session" } });

    // Zero-result card shows, but the toolbar must stay mounted so the user
    // can edit the query instead of being forced to reload the page.
    await screen.findByText("没有匹配的会话");
    const stillMounted = screen.getByPlaceholderText("搜索会话、项目或工具");
    expect((stillMounted as HTMLInputElement).value).toBe("no-such-session");

    fireEvent.change(stillMounted, { target: { value: "alpha" } });
    await waitFor(() => {
      expect(screen.getByText("alpha-fix")).toBeTruthy();
    });
    expect(screen.queryByText("没有匹配的会话")).toBeNull();
  });

  it("renders lost sessions with the lost badge instead of the stopped one", async () => {
    renderPage();
    await screen.findByText("alpha-fix");
    await screen.findByText("beta-lost");

    const lostCard = screen.getByText("beta-lost").closest("[data-session-id]");
    expect(lostCard?.textContent).toContain("已丢失");
    expect(lostCard?.textContent).not.toContain("已停止");

    const runningCard = screen.getByText("alpha-fix").closest("[data-session-id]");
    expect(runningCard?.textContent).toContain("运行中");
  });

  it("forces the list view on mobile so fixed board columns never render", async () => {
    // Below md the kanban board (fixed pixel columns + horizontal scroll) is
    // replaced by the list view, and the board/list toggle is hidden.
    stubMatchMedia(false);
    window.localStorage.setItem("forgebadger.sessionBoard.view.v1", "board");
    renderPage();
    const row = (await screen.findByText("alpha-fix")).closest("[data-session-id]");
    expect(row).toBeTruthy();
    // The running row's Connect button is hidden below md so the title keeps
    // its flex space; tapping the row opens the session instead.
    const connect = row!.querySelector("button");
    expect(connect?.textContent).toContain("连接");
    expect(connect?.className).toContain("hidden");
    expect(connect?.className).toContain("md:inline-flex");
    // The view toggle group is a desktop-only control now (class-level check:
    // jsdom does not apply the md: display classes).
    const toggle = screen.getByRole("group", { name: "切换视图" });
    expect(toggle.className).toContain("md:flex");
  });

  it("fills the viewport vertically in the empty state instead of a short strip", async () => {
    getSessionBoardMock.mockResolvedValue({
      board: {
        projects: [{ id: "p1", name: "Alpha", path: "/tmp/alpha" }],
        sessions: [],
        sessionTasks: {},
      },
    });
    renderPage();
    const emptyTitle = await screen.findByText("暂无会话");
    const cardContent = emptyTitle.closest("div[class*='min-h-[50vh]']");
    expect(cardContent).toBeTruthy();
    expect(cardContent!.className).toContain("justify-center");
  });
});
