// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DevelopmentTasks } from "./DevelopmentTasks";
import { LanguageProvider } from "@/hooks/use-language";
import { listProjects, type Project } from "@/lib/api";
import { getPlatformAction, type PlatformIntent } from "@/lib/platform-actions-api";
import * as api from "@/lib/development-api";
vi.mock("@/lib/api", () => ({ listProjects: vi.fn() }));
vi.mock("@/lib/platform-actions-api", () => ({ getPlatformAction: vi.fn() }));
vi.mock("@/lib/development-api", async importOriginal => ({ ...await importOriginal<typeof api>(), getDevelopmentCapability: vi.fn(), listDevelopmentTasks: vi.fn(), getDevelopmentTask: vi.fn(), previewDevelopmentAction: vi.fn(), approveDevelopmentAction: vi.fn(), executeDevelopmentAction: vi.fn() }));
const task: api.DevelopmentTask = { id: "t1", projectId: "p1", goal: "修复排版问题", status: "checks_passed", revision: 1, sourceDigest: "source", outputDigest: "output", recipeDigest: "recipe", artifactDigest: "artifact", error: null, createdAt: 1, updatedAt: 1 };
const evidence: api.DevelopmentEvidence = { sourceDigest: "source", outputDigest: "output", recipeDigest: "recipe", files: [{ path: "a.ts", beforeSha256: "before", afterSha256: "after" }], diff: "-old\n+new<script>bad</script>", checks: [{ path: "test.ts", exitCode: 0, stdout: "passed", stderr: "", durationMs: 12, timedOut: false, cancelled: false }], startedAt: 1, finishedAt: 2 };
let intent: PlatformIntent;
let client: QueryClient;
beforeEach(() => {
  localStorage.clear();
  intent = { id: "i1", command_id: "development.task.accept", input_json: '{"projectId":"p1","taskId":"t1","artifactDigest":"artifact"}', resources_json: '{"revision":1}', digest: "d".repeat(64), authority: "owner_action", grant_id: null, expires_at: Date.now() + 60000, status: "pending" };
  vi.mocked(listProjects).mockResolvedValue({ projects: [{ id: "p1", name: "项目一" }, { id: "p2", name: "项目二" }] as Project[] });
  vi.mocked(api.getDevelopmentCapability).mockResolvedValue({ available: true, reason: null });
  vi.mocked(api.listDevelopmentTasks).mockResolvedValue({ tasks: [task] });
  vi.mocked(api.getDevelopmentTask).mockResolvedValue({ task, evidence });
  vi.mocked(api.previewDevelopmentAction).mockImplementation(async () => ({ intent }));
  vi.mocked(api.approveDevelopmentAction).mockImplementation(async () => ({ intent: { ...intent, status: "approved" } }));
  vi.mocked(api.executeDevelopmentAction).mockResolvedValue({ receipt: { intentId: "i1", outcome: "confirmed", result: {}, createdAt: 1 } });
  vi.mocked(getPlatformAction).mockImplementation(async () => ({ intent, receipt: null }));
});
afterEach(() => { cleanup(); client?.clear(); vi.clearAllMocks(); });
function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><LanguageProvider><DevelopmentTasks /></LanguageProvider></QueryClientProvider>);
}
async function selectTask() {
  fireEvent.change(await screen.findByRole("combobox", { name: "项目" }), { target: { value: "p1" } });
  fireEvent.click(await screen.findByRole("button", { name: /修复排版问题/ }));
  await screen.findByRole("button", { name: "预览验收操作" });
}
it("waits for explicit project selection and renders escaped evidence", async () => {
  mount();
  await screen.findByRole("combobox");
  expect(api.listDevelopmentTasks).not.toHaveBeenCalled();
  await selectTask();
  expect(api.getDevelopmentTask).toHaveBeenCalledWith("p1", "t1");
  expect(await screen.findByText(/new<script>bad/)).toBeTruthy();
  expect(document.querySelector("script")).toBeNull();
  expect(screen.getByText(/检查通过后仍需所有者判断/)).toBeTruthy();
});
it("requires separate exact preview and explicit owner confirmation", async () => {
  mount(); await selectTask();
  fireEvent.click(screen.getByRole("button", { name: "预览验收操作" }));
  await screen.findByText(intent.digest);
  expect(screen.getByText(/artifactDigest/)).toBeTruthy();
  expect(api.approveDevelopmentAction).not.toHaveBeenCalled();
  expect(api.executeDevelopmentAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "所有者确认并执行" }));
  await screen.findByText("操作回执已确认。");
  expect(api.approveDevelopmentAction).toHaveBeenCalledTimes(1);
  expect(api.approveDevelopmentAction).toHaveBeenCalledWith(intent);
  expect(api.executeDevelopmentAction).toHaveBeenCalledTimes(1);
  expect(api.executeDevelopmentAction).toHaveBeenCalledWith("i1");
});
it("reuses preview request identity after a network failure", async () => {
  vi.mocked(api.previewDevelopmentAction).mockRejectedValueOnce(new Error("Network lost"));
  mount(); await selectTask();
  fireEvent.click(screen.getByRole("button", { name: "预览验收操作" }));
  await screen.findByText("Network lost");
  fireEvent.click(screen.getByRole("button", { name: "预览验收操作" }));
  await screen.findByText(intent.digest);
  expect(vi.mocked(api.previewDevelopmentAction).mock.calls[0]![2]).toEqual(vi.mocked(api.previewDevelopmentAction).mock.calls[1]![2]);
});
it("does not replay execute after an uncertain response and supports readback", async () => {
  vi.mocked(api.executeDevelopmentAction).mockRejectedValueOnce(new Error("Connection lost"));
  mount(); await selectTask();
  fireEvent.click(screen.getByRole("button", { name: "预览验收操作" }));
  fireEvent.click(await screen.findByRole("button", { name: "所有者确认并执行" }));
  await screen.findByText(/不会自动重试执行/);
  expect(screen.queryByRole("button", { name: "所有者确认并执行" })).toBeNull();
  vi.mocked(getPlatformAction).mockResolvedValue({ intent, receipt: { intentId: "i1", outcome: "unknown", result: null, createdAt: 1 } });
  fireEvent.click(screen.getByRole("button", { name: "读取操作回执" }));
  await screen.findByText(/操作结果未知/);
  expect(api.executeDevelopmentAction).toHaveBeenCalledTimes(1);
});
it("blocks expired previews and discards previews when project changes", async () => {
  intent.expires_at = 1;
  mount(); await selectTask();
  fireEvent.click(screen.getByRole("button", { name: "预览验收操作" }));
  expect((await screen.findByRole("button", { name: "所有者确认并执行" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "p2" } });
  await waitFor(() => expect(screen.queryByText(intent.digest)).toBeNull());
  expect(api.executeDevelopmentAction).not.toHaveBeenCalled();
});
it("rejects stale authority or changed digest before approval", async () => {
  vi.mocked(getPlatformAction).mockResolvedValue({ intent: { ...intent, digest: "changed" }, receipt: null });
  mount(); await selectTask();
  fireEvent.click(screen.getByRole("button", { name: "预览验收操作" }));
  fireEvent.click(await screen.findByRole("button", { name: "所有者确认并执行" }));
  await screen.findByText(/预览已失效/);
  expect(api.approveDevelopmentAction).not.toHaveBeenCalled();
  expect(api.executeDevelopmentAction).not.toHaveBeenCalled();
});
it("shows empty and unavailable states while retaining read-only history", async () => {
  vi.mocked(api.getDevelopmentCapability).mockResolvedValue({ available: false, reason: "Runner unavailable" });
  vi.mocked(api.listDevelopmentTasks).mockResolvedValue({ tasks: [] });
  mount();
  await screen.findByText(/Runner unavailable/);
  fireEvent.change(await screen.findByRole("combobox"), { target: { value: "p1" } });
  await screen.findByText(/暂无任务。在 Copilot/);
});
it("renders query errors and allows read-only retry", async () => {
  vi.mocked(api.listDevelopmentTasks).mockRejectedValueOnce(new Error("List unavailable"));
  mount();
  fireEvent.change(await screen.findByRole("combobox"), { target: { value: "p1" } });
  await screen.findByText("List unavailable");
  fireEvent.click(screen.getByRole("button", { name: "重试读取" }));
  await screen.findByRole("button", { name: /修复排版问题/ });
});
it("only offers cancellation for active tasks and no acceptance for failed checks", async () => {
  vi.mocked(api.getDevelopmentTask).mockResolvedValue({ task: { ...task, status: "running" }, evidence: null });
  mount();
  fireEvent.change(await screen.findByRole("combobox"), { target: { value: "p1" } });
  fireEvent.click(await screen.findByRole("button", { name: /修复排版问题/ }));
  await screen.findByRole("button", { name: "预览取消操作" });
  expect(screen.queryByRole("button", { name: "预览验收操作" })).toBeNull();
  vi.mocked(api.getDevelopmentTask).mockResolvedValue({ task: { ...task, status: "checks_failed", revision: 2 }, evidence });
  await client.invalidateQueries({ queryKey: ["development-task"] });
  await screen.findByText("检查未通过");
  expect(screen.queryByRole("button", { name: /预览.*操作/ })).toBeNull();
});

it("polls active tasks every five seconds and stops after a terminal result", async () => {
  const active = { ...task, status: "running" as const };
  vi.mocked(api.listDevelopmentTasks).mockResolvedValue({ tasks: [active] });
  vi.mocked(api.getDevelopmentTask).mockResolvedValue({ task: active, evidence: null });
  mount();
  fireEvent.change(await screen.findByRole("combobox"), { target: { value: "p1" } });
  fireEvent.click(await screen.findByRole("button", { name: /修复排版问题/ }));
  await screen.findByRole("button", { name: "预览取消操作" });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5200)); });
  expect(api.listDevelopmentTasks).toHaveBeenCalledTimes(2);
  expect(api.getDevelopmentTask).toHaveBeenCalledTimes(2);
  vi.mocked(api.listDevelopmentTasks).mockResolvedValue({ tasks: [task] });
  vi.mocked(api.getDevelopmentTask).mockResolvedValue({ task, evidence });
  await act(async () => { await client.invalidateQueries({ queryKey: ["development-tasks"] }); await client.invalidateQueries({ queryKey: ["development-task"] }); });
  const listCount = vi.mocked(api.listDevelopmentTasks).mock.calls.length;
  const detailCount = vi.mocked(api.getDevelopmentTask).mock.calls.length;
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5200)); });
  expect(api.listDevelopmentTasks).toHaveBeenCalledTimes(listCount);
  expect(api.getDevelopmentTask).toHaveBeenCalledTimes(detailCount);
}, 15000);
