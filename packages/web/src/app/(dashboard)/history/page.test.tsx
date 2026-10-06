// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import HistoryPage from "./page";

const { listProjectsMock, listSessionsMock, listSnapshotsMock } = vi.hoisted(() => ({
  listProjectsMock: vi.fn(),
  listSessionsMock: vi.fn(),
  listSnapshotsMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    listProjects: listProjectsMock,
    listSessions: listSessionsMock,
    listSnapshots: listSnapshotsMock,
    restoreSnapshot: vi.fn(),
  };
});

// jsdom implements neither Pointer Capture nor scrollIntoView; Radix Select
// calls both while rendering.
function stubRadixSelectEnvironment() {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <HistoryPage />
      </QueryClientProvider>
    </LanguageProvider>
  );
}

describe("HistoryPage snapshot pagination", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    stubRadixSelectEnvironment();
    window.localStorage.setItem("forgebadger-language", "zh-CN");
    listProjectsMock.mockResolvedValue({ projects: [] });
    listSessionsMock.mockResolvedValue({ sessions: [] });
  });

  it("renders the first page of snapshots and loads more on demand", async () => {
    const snapshots = Array.from({ length: 45 }, (_, index) => ({
      id: `snap-${index}`,
      sessionId: null,
      projectId: null,
      runtimeSessionName: `fb-history-${index}`,
      modelId: null,
      configVersion: null,
      createdAt: new Date(Date.now() - index * 3_600_000).toISOString(),
    }));
    listSnapshotsMock.mockResolvedValue({ snapshots });

    renderPage();

    // Page size is 20: the 21st snapshot stays hidden until "load more".
    await screen.findByText("fb-history-0");
    expect(screen.queryByText("fb-history-20")).toBeNull();
    expect(screen.getByText("已显示 20 / 45 条")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    await screen.findByText("fb-history-20");
    expect(screen.queryByText("fb-history-40")).toBeNull();
    expect(screen.getByText("已显示 40 / 45 条")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    await screen.findByText("fb-history-44");
    // Everything is shown: the load-more control (and its count) is gone.
    expect(screen.queryByRole("button", { name: "加载更多" })).toBeNull();
    expect(screen.queryByText(/已显示/)).toBeNull();
  });

  it("shows the empty state without pagination when there are no snapshots", async () => {
    listSnapshotsMock.mockResolvedValue({ snapshots: [] });
    renderPage();

    await screen.findByText("暂无快照");
    expect(screen.queryByRole("button", { name: "加载更多" })).toBeNull();
  });
});
