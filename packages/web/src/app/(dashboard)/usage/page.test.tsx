// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import UsagePage from "./page";

const { getTokenUsageSummaryMock, getProjectActivityMock, listProjectsMock, syncUsageTokensMock } = vi.hoisted(() => ({
  getTokenUsageSummaryMock: vi.fn(),
  getProjectActivityMock: vi.fn(),
  listProjectsMock: vi.fn(),
  syncUsageTokensMock: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getTokenUsageSummary: getTokenUsageSummaryMock,
    getProjectActivity: getProjectActivityMock,
    listProjects: listProjectsMock,
    syncUsageTokens: syncUsageTokensMock,
  };
});

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <UsagePage />
      </QueryClientProvider>
    </LanguageProvider>
  );
}

describe("UsagePage query state", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.setItem("forgebadger-language", "zh-CN");
    getProjectActivityMock.mockResolvedValue({ series: [] });
    listProjectsMock.mockResolvedValue({ projects: [] });
    syncUsageTokensMock.mockResolvedValue({ result: { totalInserted: 0 } });
  });

  it("auto-syncs usage data once when the page opens", async () => {
    getTokenUsageSummaryMock.mockRejectedValue(new Error("gateway unreachable"));
    renderPage();

    await screen.findByText("加载失败");
    expect(syncUsageTokensMock).toHaveBeenCalledTimes(1);
  });

  it("discards pending pre-sync reads and shows the synchronized totals", async () => {
    let resolveOldSummary!: (value: { summary: typeof summary }) => void;
    let resolveOldActivity!: (value: { series: [] }) => void;
    let resolveSync!: (value: { result: { totalInserted: number } }) => void;
    getTokenUsageSummaryMock
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOldSummary = resolve; }))
      .mockResolvedValue({ summary });
    getProjectActivityMock
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOldActivity = resolve; }))
      .mockResolvedValue({ series: [] });
    syncUsageTokensMock.mockImplementationOnce(() => new Promise((resolve) => { resolveSync = resolve; }));
    renderPage();
    await waitFor(() => expect(syncUsageTokensMock).toHaveBeenCalledTimes(1));

    await act(async () => { resolveSync({ result: { totalInserted: 3 } }); });
    await act(async () => {
      resolveOldSummary({ summary: { ...summary, totalTokens: 0 } });
      resolveOldActivity({ series: [] });
    });

    await waitFor(() => expect(getTokenUsageSummaryMock).toHaveBeenCalledTimes(2));
    expect(getProjectActivityMock).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("6k")).toBeTruthy();
    expect(await screen.findByText("已同步 (+3)")).toBeTruthy();
  });

  it("shows the error state with retry instead of staying on the loading line forever", async () => {
    getTokenUsageSummaryMock.mockRejectedValue(new Error("gateway unreachable"));
    renderPage();

    await screen.findByText("加载失败");
    expect(screen.queryByText("正在加载使用统计…")).toBeNull();
    expect(screen.queryByText("暂无使用数据")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    // 3 = initial load + one refetch from the auto-sync invalidation + retry.
    expect(getTokenUsageSummaryMock).toHaveBeenCalledTimes(3);
  });
});

const summary = {
  totalInputTokens: 4000,
  totalOutputTokens: 2000,
  totalCacheReadTokens: 800,
  totalCacheWriteTokens: 200,
  totalReasoningTokens: 100,
  totalTokens: 6000,
  requestCount: 3,
  cacheHitRate: 50,
  byAdapter: [],
  byProject: [],
  byModel: [],
};

function dayOffset(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

describe("UsagePage chart interactions", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.setItem("forgebadger-language", "zh-CN");
    getTokenUsageSummaryMock.mockResolvedValue({ summary });
    getProjectActivityMock.mockResolvedValue({
      series: [
        { day: dayOffset(1), group: "alpha", inputTokens: 800, outputTokens: 400, totalTokens: 1200 },
        { day: dayOffset(2), group: "alpha", inputTokens: 200, outputTokens: 100, totalTokens: 300 },
      ],
    });
    listProjectsMock.mockResolvedValue({ projects: [] });
  });

  it("marks the all-time scope of the metric strip explicitly", async () => {
    renderPage();
    await screen.findByText("上方指标为全部时间汇总；趋势图与热度图仅反映所选区间。");
  });

  it("reveals bar values on tap for touch devices and hides them on a second tap", async () => {
    const { container } = renderPage();
    await screen.findByText("Token 总数");

    const bar = screen.getByTestId(`usage-bar-${dayOffset(1)}`);
    const tooltip = () =>
      Array.from(container.querySelectorAll("div")).find(
        (element) => element.textContent?.includes(dayOffset(1)) && element.className.includes("rounded-md")
      )!;
    // Hover-only by default, tap reveals.
    expect(tooltip().className).toContain("hidden");
    fireEvent.click(bar);
    expect(tooltip().className).toContain("block");
    expect(tooltip().className).not.toContain("hidden");
    fireEvent.click(bar);
    expect(tooltip().className).toContain("hidden");
  });

  it("pins heatmap values on tap and keeps the first column sticky", async () => {
    const { container } = renderPage();
    await screen.findByText("Token 总数");

    // Sticky first column: header spacer, project label, and axis spacer.
    const stickyCells = container.querySelectorAll('[class*="sticky left-0"]');
    expect(stickyCells.length).toBeGreaterThanOrEqual(3);

    const cell = screen.getByTestId(`usage-cell-${dayOffset(1)}`);
    expect(screen.queryByText(/alpha ·/)).toBeNull();
    fireEvent.click(cell);
    expect(screen.getByText(/alpha ·/).textContent).toContain(dayOffset(1));
    expect(screen.getByText(/alpha ·/).textContent).toContain("1.2k");
    // Tapping the same cell again releases the pin.
    fireEvent.click(cell);
    expect(screen.queryByText(/alpha ·/)).toBeNull();
  });
});
