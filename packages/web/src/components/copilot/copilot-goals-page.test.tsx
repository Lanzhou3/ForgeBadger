// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/hooks/use-language";
import * as coreApi from "@/lib/api";
import * as api from "@/lib/copilot-api";
import { CopilotGoalsPage } from "./copilot-goals-page";

vi.mock("next/navigation", () => ({ usePathname: () => "/copilot/goals", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/api", async (original) => ({
  ...await original<typeof import("@/lib/api")>(),
  listProjects: vi.fn(),
}));
vi.mock("@/lib/copilot-api", async (original) => ({
  ...await original<typeof import("@/lib/copilot-api")>(),
  listGoals: vi.fn(),
  createConversation: vi.fn(),
  createGoal: vi.fn(),
}));

let client: QueryClient;

function mount() {
  render(
    <LanguageProvider>
      <QueryClientProvider client={client}>
        <CopilotGoalsPage />
      </QueryClientProvider>
    </LanguageProvider>,
  );
}

const goal: api.CopilotGoalListItem = {
  id: "g1",
  title: "Ship goal mode",
  status: "active",
  projectId: null,
  conversationId: "c1",
  grants: [],
  createdAt: 1728624000000,
  taskTotal: 4,
  taskPasses: 1,
};

beforeEach(() => {
  cleanup();
  vi.resetAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(api.listGoals).mockResolvedValue({ goals: [] });
  vi.mocked(coreApi.listProjects).mockResolvedValue({ projects: [] });
});

afterEach(() => {
  client.clear();
});

it("renders the goal list with status badges and task progress", async () => {
  vi.mocked(api.listGoals).mockResolvedValue({
    goals: [goal, { ...goal, id: "g2", title: "Docs pass", status: "completed", taskPasses: 2, taskTotal: 2 }],
  });
  mount();
  expect(await screen.findByText("Ship goal mode")).toBeTruthy();
  expect(screen.getByText("Docs pass")).toBeTruthy();
  expect(screen.getByText("进行中")).toBeTruthy();
  expect(screen.getByText("已完成")).toBeTruthy();
  expect(screen.getByText("1/4")).toBeTruthy();
  expect(screen.getByText("2/2")).toBeTruthy();
  const bars = screen.getAllByRole("progressbar");
  expect(bars.length).toBe(2);
  expect(bars[0]?.getAttribute("aria-valuenow")).toBe("25");
  expect(bars[1]?.getAttribute("aria-valuenow")).toBe("100");
});

it("shows an empty state when no goals exist", async () => {
  mount();
  expect(await screen.findByText("还没有目标。点击「创建目标」或在 Copilot 对话中输入 /goal 开始。")).toBeTruthy();
});

it("opens the create dialog from the header button and links to team settings", async () => {
  mount();
  const teamLink = await screen.findByRole("link", { name: "配置 AI 队友" });
  expect(teamLink.getAttribute("href")).toBe("/copilot/settings#copilot-team");
  fireEvent.click(screen.getByRole("button", { name: "创建目标" }));
  expect(await screen.findByRole("dialog")).toBeTruthy();
  expect(screen.getByText("创建新目标")).toBeTruthy();
});

it("filters goals by status pill with live counts", async () => {
  vi.mocked(api.listGoals).mockResolvedValue({
    goals: [
      goal,
      { ...goal, id: "g2", title: "Blocked goal", status: "blocked" },
      { ...goal, id: "g3", title: "Docs pass", status: "completed", taskPasses: 4, taskTotal: 4 },
    ],
  });
  mount();
  expect(await screen.findByText("Ship goal mode")).toBeTruthy();
  expect(screen.getByRole("button", { name: "全部 (3)" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "进行中 (1)" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "待处理 (1)" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "已完成 (1)" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "待处理 (1)" }));
  expect(screen.getByText("Blocked goal")).toBeTruthy();
  expect(screen.queryByText("Ship goal mode")).toBeNull();
  expect(screen.queryByText("Docs pass")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "已完成 (1)" }));
  expect(screen.getByText("Docs pass")).toBeTruthy();
  expect(screen.queryByText("Blocked goal")).toBeNull();
});

it("shows an error alert with retry when loading fails", async () => {
  vi.mocked(api.listGoals).mockRejectedValue(new Error("boom"));
  mount();
  expect((await screen.findByRole("alert")).textContent).toContain("加载失败");
  vi.mocked(api.listGoals).mockResolvedValue({ goals: [goal] });
  screen.getByRole("button", { name: "重试" }).click();
  await waitFor(() => expect(screen.getByText("Ship goal mode")).toBeTruthy());
});

it("polls every 8s while an active goal exists and stops when none are active", async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(api.listGoals).mockResolvedValue({ goals: [goal] });
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("Ship goal mode")).toBeTruthy();
    expect(api.listGoals).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(api.listGoals).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(api.listGoals).toHaveBeenCalledTimes(3);

    // All goals settled: interval disabled, no further fetches.
    vi.mocked(api.listGoals).mockResolvedValue({ goals: [{ ...goal, status: "completed" }] });
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(api.listGoals).toHaveBeenCalledTimes(4);
    await act(async () => { await vi.advanceTimersByTimeAsync(16000); });
    expect(api.listGoals).toHaveBeenCalledTimes(4);
  } finally {
    vi.useRealTimers();
  }
});
