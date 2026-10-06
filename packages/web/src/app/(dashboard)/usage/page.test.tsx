// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import UsagePage from "./page";

const { getTokenUsageSummaryMock, getProjectActivityMock, listProjectsMock } = vi.hoisted(() => ({
  getTokenUsageSummaryMock: vi.fn(),
  getProjectActivityMock: vi.fn(),
  listProjectsMock: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getTokenUsageSummary: getTokenUsageSummaryMock,
    getProjectActivity: getProjectActivityMock,
    listProjects: listProjectsMock,
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
  });

  it("shows the error state with retry instead of staying on the loading line forever", async () => {
    getTokenUsageSummaryMock.mockRejectedValue(new Error("gateway unreachable"));
    renderPage();

    await screen.findByText("加载失败");
    expect(screen.queryByText("正在加载使用统计…")).toBeNull();
    expect(screen.queryByText("暂无使用数据")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(getTokenUsageSummaryMock).toHaveBeenCalledTimes(2);
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
