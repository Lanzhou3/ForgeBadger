// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/hooks/use-language";
import * as api from "@/lib/copilot-api";
import { CopilotGoalDetailPage } from "./copilot-goal-detail-page";

vi.mock("next/navigation", () => ({ usePathname: () => "/copilot/goals/g1", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/copilot-api", async (original) => ({
  ...await original<typeof import("@/lib/copilot-api")>(),
  getGoal: vi.fn(),
  answerGoal: vi.fn(),
  getGoalDiff: vi.fn(),
  mergeGoal: vi.fn(),
  pauseGoal: vi.fn(),
  resumeGoal: vi.fn(),
  cancelGoal: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { toast } from "@/lib/toast";

let client: QueryClient;

function mount(goalId = "g1") {
  render(
    <LanguageProvider>
      <QueryClientProvider client={client}>
        <CopilotGoalDetailPage goalId={goalId} />
      </QueryClientProvider>
    </LanguageProvider>,
  );
}

const goal: api.CopilotGoal = {
  id: "g1",
  conversationId: "c1",
  projectId: null,
  title: "Ship goal mode",
  spec: "Implement goal mode end to end.",
  status: "active",
  tokenBudget: null,
  maxDurationMs: null,
  maxRuns: null,
  blockedReason: null,
  grants: [],
  createdAt: 1728624000000,
  updatedAt: 1728624000000,
  completedAt: null,
};

const baseTask: api.CopilotGoalTask = {
  id: "t1",
  goalId: "g1",
  seq: 1,
  description: "Build UI",
  status: "passes",
  evidence: null,
  verifyCommand: null,
  verifiedAt: null,
  verifyExitCode: null,
  dispatchedSessionId: null,
  createdAt: 1728624000000,
  updatedAt: 1728624000000,
};

function goalPayload(overrides: Partial<{
  goal: Partial<api.CopilotGoal>;
  tasks: api.CopilotGoalTask[];
  usage: Partial<api.CopilotGoalUsage>;
  pendingQuestion: string | null;
}> = {}) {
  return {
    goal: { ...goal, ...overrides.goal },
    tasks: overrides.tasks ?? [baseTask],
    // Two numeric-epoch entries exercise the newest-first sort on every render.
    journal: [
      { id: "j1", goalId: "g1", runId: "r1", note: "First journal entry", createdAt: 1728624000000 },
      { id: "j2", goalId: "g1", runId: "r2", note: "Second journal entry", createdAt: 1728624060000 },
    ],
    usage: { chargedTokens: 1000, runCount: 1, elapsedMs: 60_000, costUsd: null, ...overrides.usage },
    pendingQuestion: overrides.pendingQuestion ?? null,
  };
}

beforeEach(() => {
  cleanup();
  vi.resetAllMocks();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  vi.mocked(api.getGoal).mockResolvedValue(goalPayload());
  vi.mocked(api.answerGoal).mockResolvedValue({ goal });
  vi.mocked(api.getGoalDiff).mockResolvedValue({ files: [], truncated: false });
  vi.mocked(api.mergeGoal).mockResolvedValue({ merged: ["src/a.ts"], deleted: [], kept: [] });
  vi.mocked(api.pauseGoal).mockResolvedValue({ goal });
  vi.mocked(api.resumeGoal).mockResolvedValue({ goal });
  vi.mocked(api.cancelGoal).mockResolvedValue({ goal });
});

afterEach(() => {
  client.clear();
});

it("renders verified, unverified, and no-verify task states", async () => {
  vi.mocked(api.getGoal).mockResolvedValue(goalPayload({
    tasks: [
      { ...baseTask, id: "t1", verifyCommand: "pnpm test", verifiedAt: 1728624000000, verifyExitCode: 0 },
      { ...baseTask, id: "t2", seq: 2, status: "pending", verifyCommand: "pnpm build", verifiedAt: null, verifyExitCode: null },
      { ...baseTask, id: "t3", seq: 3, status: "pending" },
    ],
  }));
  mount();
  expect(await screen.findByText("已验证")).toBeTruthy();
  expect(screen.getByText("未验证")).toBeTruthy();
  expect(screen.getAllByText(/pnpm (test|build)/).length).toBe(2);
});

it("shows the pending-question card, hides pause, keeps cancel, and submits an answer", async () => {
  vi.mocked(api.getGoal).mockResolvedValue(goalPayload({
    goal: { status: "blocked", blockedReason: "awaiting_user" },
    pendingQuestion: "Which project root should I use?",
  }));
  mount();
  expect(await screen.findByText("Goal 等待你的答复")).toBeTruthy();
  expect(screen.getByText("Which project root should I use?")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "暂停" })).toBeNull();
  expect(screen.queryByRole("button", { name: "继续" })).toBeNull();
  expect(screen.getByRole("button", { name: /取消/ })).toBeTruthy();
  // The raw "awaiting_user" blocked banner is replaced by the question card.
  expect(screen.queryByText(/awaiting_user/)).toBeNull();

  fireEvent.change(screen.getByLabelText("输入答复…"), { target: { value: "Use the repo root" } });
  fireEvent.click(screen.getByRole("button", { name: "答复并继续" }));
  await waitFor(() => expect(api.answerGoal).toHaveBeenCalledWith("g1", "Use the repo root"));
});

it("renders the diff file list with added/modified/deleted badges when expanded", async () => {
  vi.mocked(api.getGoalDiff).mockResolvedValue({
    files: [
      { path: "src/new.ts", status: "added", diff: "@@ -0,0 +1 @@\n+export const a = 1;", truncated: false },
      { path: "src/changed.ts", status: "modified", diff: "@@ -1 +1 @@\n-old\n+new", truncated: true },
      { path: "src/gone.ts", status: "deleted", diff: "@@ -1 +0,0 @@\n-gone", truncated: false },
    ],
    truncated: false,
  });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /变更评审/ }));
  expect(await screen.findByText("src/new.ts")).toBeTruthy();
  expect(screen.getByText("src/changed.ts")).toBeTruthy();
  expect(screen.getByText("src/gone.ts")).toBeTruthy();
  expect(screen.getByText("新增")).toBeTruthy();
  expect(screen.getByText("修改")).toBeTruthy();
  expect(screen.getByText("删除")).toBeTruthy();
  expect(screen.getByText("已截断")).toBeTruthy();
  // Per-file diff view with line coloring.
  fireEvent.click(screen.getByRole("button", { name: /src\/changed\.ts/ }));
  const row = screen.getByText("src/changed.ts").closest("div[class*='border-border/70']")!;
  expect(within(row as HTMLElement).getByText("-old").className).toContain("bg-red-500/10");
  expect(within(row as HTMLElement).getByText("+new").className).toContain("bg-emerald-500/10");
});

it("shows the empty diff state when the sandbox has no changes", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /变更评审/ }));
  expect(await screen.findByText("沙箱尚无变更。")).toBeTruthy();
  expect(api.getGoalDiff).toHaveBeenCalled();
});

it("shows a diff load error with retry", async () => {
  vi.mocked(api.getGoalDiff).mockRejectedValue(new Error("boom"));
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /变更评审/ }));
  expect((await screen.findByRole("alert")).textContent).toContain("变更加载失败");
  vi.mocked(api.getGoalDiff).mockResolvedValue({ files: [], truncated: false });
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await waitFor(() => expect(screen.getByText("沙箱尚无变更。")).toBeTruthy());
});

it("merges only for completed/blocked goals behind a confirm and toasts the count", async () => {
  vi.mocked(api.getGoal).mockResolvedValue(goalPayload({ goal: { status: "completed" } }));
  mount();
  // Active-status guard is covered by the default active payload: no merge button.
  expect(screen.queryByRole("button", { name: /合并到项目/ })).toBeNull();
  cleanup();

  vi.mocked(api.getGoal).mockResolvedValue(goalPayload({ goal: { status: "completed" } }));
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /合并到项目/ }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog.textContent).toContain("三方合并");
  expect(dialog.textContent).toContain("不会覆盖");
  fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
  expect(api.mergeGoal).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /合并到项目/ }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /合并到项目/ }));
  await waitFor(() => expect(api.mergeGoal).toHaveBeenCalledWith("g1"));
  await waitFor(() => expect(vi.mocked(toast.success).mock.calls[0]?.[0]).toContain("1"));
});

it("surfaces an answer failure without clearing the draft", async () => {
  vi.mocked(api.getGoal).mockResolvedValue(goalPayload({
    goal: { status: "blocked", blockedReason: "awaiting_user" },
    pendingQuestion: "Continue?",
  }));
  vi.mocked(api.answerGoal).mockRejectedValue(new Error("409"));
  mount();
  const input = await screen.findByLabelText("输入答复…");
  fireEvent.change(input, { target: { value: "yes" } });
  fireEvent.click(screen.getByRole("button", { name: "答复并继续" }));
  expect((await screen.findByRole("alert")).textContent).toContain("答复失败");
  expect((input as HTMLTextAreaElement).value).toBe("yes");
});

it("renders one grant badge per granted authority", async () => {
  vi.mocked(api.getGoal).mockResolvedValue(goalPayload({
    goal: { grants: ["operate_sessions", "terminal_run"] },
  }));
  mount();
  const header = (await screen.findByText("Ship goal mode")).closest("header")!;
  expect(within(header as HTMLElement).getByText("会话启停")).toBeTruthy();
  expect(within(header as HTMLElement).getByText("终端命令")).toBeTruthy();
  expect(within(header as HTMLElement).queryByText("任务派发")).toBeNull();
});

it("renders no grant badges for an empty grant list", async () => {
  mount();
  const header = (await screen.findByText("Ship goal mode")).closest("header")!;
  expect(within(header as HTMLElement).queryByText("会话启停")).toBeNull();
});

it("formats costUsd >= $1 with two decimals", async () => {
  vi.mocked(api.getGoal).mockResolvedValue(goalPayload({ usage: { costUsd: 1.257 } }));
  mount();
  expect(await screen.findByText("$1.26")).toBeTruthy();
});

it("formats costUsd below $1 with four significant digits", async () => {
  vi.mocked(api.getGoal).mockResolvedValue(goalPayload({ usage: { costUsd: 0.123456 } }));
  mount();
  expect(await screen.findByText("$0.1235")).toBeTruthy();
});

it("omits the cost row when costUsd is null", async () => {
  mount();
  await screen.findByText("Ship goal mode");
  expect(screen.queryByText("成本")).toBeNull();
});

it("links a dispatched task to its CLI session", async () => {
  vi.mocked(api.getGoal).mockResolvedValue(goalPayload({
    tasks: [{ ...baseTask, dispatchedSessionId: "sess-42" }],
  }));
  mount();
  const link = await screen.findByRole("link", { name: /已派发/ });
  expect(link.getAttribute("href")).toBe("/sessions/sess-42");
});

it("shows no dispatched badge for undispatched tasks", async () => {
  mount();
  await screen.findByText("Ship goal mode");
  expect(screen.queryByRole("link", { name: /已派发/ })).toBeNull();
});

it("sorts the journal newest-first with numeric epoch timestamps", async () => {
  mount();
  await screen.findByText("Ship goal mode");
  const first = screen.getByText("Second journal entry");
  const second = screen.getByText("First journal entry");
  expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("shows no Resume for a blocked goal and maps the blocked reason to copy", async () => {
  vi.mocked(api.getGoal).mockResolvedValue(goalPayload({
    goal: { status: "blocked", blockedReason: "goal_budget_exhausted" },
  }));
  mount();
  expect(await screen.findByText(/预算已耗尽/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "继续" })).toBeNull();
  expect(screen.getByRole("button", { name: /取消/ })).toBeTruthy();
});

it("falls back to the raw reason when no localized mapping exists", async () => {
  vi.mocked(api.getGoal).mockResolvedValue(goalPayload({
    goal: { status: "blocked", blockedReason: "some_future_reason" },
  }));
  mount();
  expect(await screen.findByText(/some_future_reason/)).toBeTruthy();
});

it("shows the truncated banner when the diff response is capped", async () => {
  vi.mocked(api.getGoalDiff).mockResolvedValue({
    files: [{ path: "src/a.ts", status: "modified", diff: "@@ -1 +1 @@\n-old\n+new", truncated: true }],
    truncated: true,
  });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /变更评审/ }));
  expect(await screen.findByText("diff 已截断，仅展示部分变更。")).toBeTruthy();
});

it("shows deleted/kept counts in the merge success toast", async () => {
  vi.mocked(api.getGoal).mockResolvedValue(goalPayload({ goal: { status: "completed" } }));
  // The gateway returns path lists, not counts.
  vi.mocked(api.mergeGoal).mockResolvedValue({ merged: ["a.ts", "b.ts"], deleted: ["x.ts", "y.ts", "z.ts"], kept: ["k.ts"] });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /合并到项目/ }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /合并到项目/ }));
  await waitFor(() => expect(api.mergeGoal).toHaveBeenCalledWith("g1"));
  await waitFor(() => expect(vi.mocked(toast.success).mock.calls[0]?.[0]).toContain("删除 3，保留 1"));
});

it("describes a worktree merge as a goal-branch fast-forward and toasts the commit", async () => {
  vi.mocked(api.getGoal).mockResolvedValue(goalPayload({
    goal: { status: "completed", workspace: { kind: "worktree", branch: "forgebadger/goal-g1", baseCommit: "a".repeat(40), targetBranch: "main" } }
  }));
  vi.mocked(api.mergeGoal).mockResolvedValue({ merged: ["a.ts"], deleted: [], kept: [], commit: "b".repeat(40) });
  mount();
  expect(await screen.findByText("工作区：git worktree（forgebadger/goal-g1）")).toBeTruthy();
  fireEvent.click(await screen.findByRole("button", { name: /合并到项目/ }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog.textContent).toMatch(/在 forgebadger\/goal-g1 上提交 .*快进合并到 main/);
  fireEvent.click(within(dialog).getByRole("button", { name: /合并到项目/ }));
  await waitFor(() => expect(vi.mocked(toast.success).mock.calls[0]?.[0]).toContain(`提交 ${"b".repeat(12)}`));
});

it("surfaces the backend message when merge is rejected (409)", async () => {
  vi.mocked(api.getGoal).mockResolvedValue(goalPayload({ goal: { status: "completed" } }));
  vi.mocked(api.mergeGoal).mockRejectedValue(new Error("COPILOT_GOAL_RUN_ACTIVE"));
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /合并到项目/ }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /合并到项目/ }));
  await waitFor(() => expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe("COPILOT_GOAL_RUN_ACTIVE"));
});

it("submits the answer with Cmd/Ctrl+Enter", async () => {
  vi.mocked(api.getGoal).mockResolvedValue(goalPayload({
    goal: { status: "blocked", blockedReason: "awaiting_user" },
    pendingQuestion: "Continue?",
  }));
  mount();
  const input = await screen.findByLabelText("输入答复…");
  fireEvent.change(input, { target: { value: "go ahead" } });
  fireEvent.keyDown(input, { key: "Enter", metaKey: true });
  await waitFor(() => expect(api.answerGoal).toHaveBeenCalledWith("g1", "go ahead"));
});

it("polls the detail page while the goal is active and stops after it settles", async () => {
  vi.useFakeTimers();
  try {
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("Ship goal mode")).toBeTruthy();
    expect(api.getGoal).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(api.getGoal).toHaveBeenCalledTimes(2);

    vi.mocked(api.getGoal).mockResolvedValue(goalPayload({ goal: { status: "completed" } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(api.getGoal).toHaveBeenCalledTimes(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(16000); });
    expect(api.getGoal).toHaveBeenCalledTimes(3);
  } finally {
    vi.useRealTimers();
  }
});

it("links board-backed tasks to the project board and shows board cancellation", async () => {
  vi.mocked(api.getGoal).mockResolvedValue(goalPayload({
    goal: { projectId: "p1" },
    tasks: [
      { ...baseTask, id: "t-board", workItemId: "w1", boardStatus: "ready_for_review" },
      { ...baseTask, id: "t-cancel", seq: 2, description: "Dropped task", status: "cancelled", workItemId: "w2", boardStatus: "cancelled" },
    ],
  }));
  mount();
  const badge = await screen.findByRole("link", { name: /看板：待验收/ });
  expect(badge.getAttribute("href")).toBe("/projects/p1");
  expect(screen.getByText("已取消（看板）")).toBeTruthy();
  expect(screen.getByRole("link", { name: /看板：已取消/ })).toBeTruthy();
});
