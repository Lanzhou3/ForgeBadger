// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/hooks/use-language";
import * as api from "@/lib/fleet-api";
import { FleetPage } from "./fleet-page";
import { detailOf, fleetTask, reviewAttempt, taskTeam } from "./fleet-fixtures";

vi.mock("next/navigation", () => ({ usePathname: () => "/fleet/f1", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/fleet-api", async (original) => ({
  ...await original<typeof import("@/lib/fleet-api")>(),
  getFleet: vi.fn(), getFleetTeam: vi.fn(), getFleetDiff: vi.fn(), mergeFleet: vi.fn(), pauseFleet: vi.fn(), resumeFleet: vi.fn(),
  answerFleetTask: vi.fn(), cancelFleetTask: vi.fn(), addFleetTask: vi.fn(), messageFleet: vi.fn(), updateFleet: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

let client: QueryClient;
const mount = () => render(
  <LanguageProvider><QueryClientProvider client={client}><FleetPage fleetId="f1" /></QueryClientProvider></LanguageProvider>,
);
const column = (name: string) => screen.getByRole("region", { name });

const mixed = () => {
  const d = { dispatchedSessionId: "s1", dispatchStatus: "completed" as const };
  const tasks = [
    fleetTask({ id: "q", seq: 1, description: "Queued thing" }),
    fleetTask({ id: "w", seq: 2, description: "Writing thing", status: "in_progress", dispatchedSessionId: "s2", dispatchStatus: "running" }),
    fleetTask({ id: "v", seq: 3, description: "Unverified thing", ...d }),
    fleetTask({ id: "r", seq: 4, description: "Reviewed thing", ...d, dispatchUpdatedAt: 150 }),
    fleetTask({ id: "i", seq: 5, description: "Integrate thing", ...d, verifiedAt: 5, verifyExitCode: 0 }),
    fleetTask({ id: "h", seq: 6, description: "Held thing", hold: { question: "Which retention?", askedAt: 1 } }),
    fleetTask({ id: "p", seq: 7, description: "Passed thing", status: "passes" }),
  ];
  const team = {
    members: [{ id: "ada", name: "Ada", title: "", adapter: "claude", roles: ["writer"] }], maxParallelWriters: 3,
    tasks: [
      taskTeam({ taskId: "q", worker: null, workspace: "shared", integrated: null }),
      taskTeam({ taskId: "w" }), taskTeam({ taskId: "v" }),
      taskTeam({ taskId: "r", review: { rounds: 1, roundsLeft: 1, attempts: [reviewAttempt()] } }),
      taskTeam({ taskId: "i" }), taskTeam({ taskId: "h", worker: null, workspace: "shared", integrated: null }), taskTeam({ taskId: "p", integrated: true }),
    ],
  };
  return { tasks, team };
};

beforeEach(() => {
  cleanup();
  vi.resetAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const { tasks, team } = mixed();
  vi.mocked(api.getFleet).mockResolvedValue(detailOf({ tasks, journal: [{ id: "j1", runId: null, taskId: "w", note: "Started the queue", createdAt: 1 }], timers: [{ id: "tm", taskId: null, dueAt: 9, note: "Check the queue" }] }));
  vi.mocked(api.getFleetTeam).mockResolvedValue(team);
  vi.mocked(api.getFleetDiff).mockResolvedValue({ files: [{ path: "a.ts", status: "added", diff: "+a", truncated: false }], truncated: false });
  vi.mocked(api.mergeFleet).mockResolvedValue({ merged: ["a.ts"], deleted: [], kept: [], cleanedTaskWorktrees: 1 });
  vi.mocked(api.pauseFleet).mockResolvedValue({ fleet: detailOf().fleet });
  vi.mocked(api.resumeFleet).mockResolvedValue({ fleet: detailOf().fleet });
  vi.mocked(api.answerFleetTask).mockResolvedValue({ task: fleetTask() });
  vi.mocked(api.cancelFleetTask).mockResolvedValue({ task: fleetTask() });
  vi.mocked(api.addFleetTask).mockResolvedValue({ task: fleetTask() });
  vi.mocked(api.messageFleet).mockResolvedValue({ accepted: true });
  vi.mocked(api.updateFleet).mockResolvedValue({ fleet: detailOf().fleet });
});
afterEach(() => client.clear());

it("places each card in the column its state says", async () => {
  mount();
  await screen.findByText("Queued thing");
  const expected: Array<[string, string]> = [["排队", "Queued thing"], ["编写中", "Writing thing"], ["待验证", "Unverified thing"], ["审查中", "Reviewed thing"],
    ["待集成", "Integrate thing"], ["等你", "Held thing"], ["完成", "Passed thing"]];
  for (const [name, text] of expected) expect(within(column(name)).getByText(text)).toBeTruthy();
  expect(screen.getByTestId("count-owner").textContent).toBe("1");
});

it("opens the drawer with review findings for a task", async () => {
  mount();
  fireEvent.click(await screen.findByTestId("fleet-card-4"));
  expect(await screen.findByText("crashes on empty input")).toBeTruthy();
  expect(screen.getByText("src/parser.ts:12")).toBeTruthy();
});

it("answers a held task through the API", async () => {
  mount();
  fireEvent.click(await screen.findByTestId("fleet-card-6"));
  fireEvent.change(await screen.findByLabelText("输入答复…"), { target: { value: "90 days" } });
  fireEvent.click(screen.getByRole("button", { name: "答复" }));
  await waitFor(() => expect(api.answerFleetTask).toHaveBeenCalledWith("f1", "h", "90 days"));
});

it("cancels a task after confirmation", async () => {
  mount();
  fireEvent.click(await screen.findByTestId("fleet-card-1"));
  fireEvent.click(await screen.findByRole("button", { name: "取消任务" }));
  fireEvent.click(await screen.findByRole("button", { name: "确认取消" }));
  await waitFor(() => expect(api.cancelFleetTask).toHaveBeenCalledWith("f1", "q"));
});

it("adds a task with parsed file scope and messages the flagship", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "添加任务" }));
  fireEvent.change(await screen.findByLabelText("描述"), { target: { value: "New work" } });
  fireEvent.change(screen.getByLabelText("验证命令"), { target: { value: "pnpm test x" } });
  fireEvent.change(screen.getByLabelText("文件范围"), { target: { value: "src/a.ts, src/b/**\nsrc/a.ts" } });
  fireEvent.click(screen.getByRole("button", { name: "添加" }));
  await waitFor(() => expect(api.addFleetTask).toHaveBeenCalledWith("f1", { description: "New work", verifyCommand: "pnpm test x", fileScope: ["src/a.ts", "src/b/**"] }));

  fireEvent.change(screen.getByLabelText("给旗舰留言"), { target: { value: "Skip payments" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() => expect(api.messageFleet).toHaveBeenCalledWith("f1", "Skip payments"));
});

it("pauses an active fleet and resumes a paused one", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "暂停" }));
  await waitFor(() => expect(api.pauseFleet).toHaveBeenCalledWith("f1"));
  cleanup();
  vi.mocked(api.getFleet).mockResolvedValue(detailOf({ fleet: { ...detailOf().fleet, status: "paused", pausedReason: "owner" } }));
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "继续" }));
  await waitFor(() => expect(api.resumeFleet).toHaveBeenCalledWith("f1"));
  expect(screen.getByText("你手动暂停了舰队")).toBeTruthy();
});

it("disables merge while the flagship runs and merges after confirming when idle", async () => {
  vi.mocked(api.getFleet).mockResolvedValue(detailOf({ leadActive: true, tasks: mixed().tasks }));
  mount();
  const busy = await screen.findByRole("button", { name: "合并到项目" }) as HTMLButtonElement;
  expect(busy.disabled).toBe(true);
  expect(busy.title).toBe("旗舰正在运行，等它停下再合并");
  cleanup();

  vi.mocked(api.getFleet).mockResolvedValue(detailOf({ tasks: mixed().tasks }));
  mount();
  const idle = await screen.findByRole("button", { name: "合并到项目" }) as HTMLButtonElement;
  await waitFor(() => expect(idle.disabled).toBe(false));
  fireEvent.click(idle);
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "合并到项目" }));
  await waitFor(() => expect(api.mergeFleet).toHaveBeenCalledWith("f1"));
});

it("still renders the board when the team request fails", async () => {
  vi.mocked(api.getFleetTeam).mockRejectedValue(new Error("git down"));
  mount();
  expect(await screen.findByText("成员状态加载失败，看板只显示基本进度。")).toBeTruthy();
  expect(within(column("编写中")).getByText("Writing thing")).toBeTruthy();
});

it("shows an error with retry when the fleet cannot load, and an empty hint without tasks", async () => {
  vi.mocked(api.getFleet).mockRejectedValueOnce(new Error("nope"));
  mount();
  expect(await screen.findByRole("alert")).toBeTruthy();
  vi.mocked(api.getFleet).mockResolvedValue(detailOf());
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  expect(await screen.findByText(/还没有任务/)).toBeTruthy();
});

it("lists the journal and pending timers, and saves standing instructions", async () => {
  mount();
  expect(await screen.findByText("Started the queue")).toBeTruthy();
  expect(screen.getByText("Check the queue")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /常驻指示/ }));
  fireEvent.change(await screen.findByPlaceholderText("写给旗舰的长期规则…"), { target: { value: "New rules" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(api.updateFleet).toHaveBeenCalledWith("f1", { instructions: "New rules" }));
});

it("switches to the flow list", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "走向" }));
  expect(await screen.findByRole("region", { name: "任务走向" })).toBeTruthy();
  expect(screen.getByText("旗舰在等你回答")).toBeTruthy();
});
