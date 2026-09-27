// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/hooks/use-language";
import * as api from "@/lib/copilot-api";
import { CopilotAutomationsPage } from "./copilot-automations-page";

vi.mock("next/navigation", () => ({ usePathname: () => "/copilot/automations", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/copilot-api", async (original) => ({
  ...await original<typeof import("@/lib/copilot-api")>(),
  listAutomations: vi.fn(),
  listAutomationSuggestions: vi.fn(),
  createAutomation: vi.fn(),
  deleteAutomation: vi.fn(),
  pauseAutomation: vi.fn(),
  enableAutomation: vi.fn(),
  runAutomationNow: vi.fn(),
  acceptAutomationSuggestion: vi.fn(),
  dismissAutomationSuggestion: vi.fn(),
}));

let client: QueryClient;

function mount() {
  render(
    <LanguageProvider>
      <QueryClientProvider client={client}>
        <CopilotAutomationsPage />
      </QueryClientProvider>
    </LanguageProvider>,
  );
}

const automation: api.CopilotAutomation = {
  id: "a1",
  name: "Daily summary",
  status: "enabled",
  scopeType: "global",
  scopePolicy: "{}",
  prompt: "Summarize",
  scheduleKind: "cron",
  scheduleExpression: "0 9 * * *",
  timezone: "Asia/Shanghai",
  deliveryPlan: "{}",
  authoritySnapshot: "{}",
  nextRunAt: null,
  lastRunAt: null,
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
};

beforeEach(() => {
  cleanup();
  vi.resetAllMocks();
  // jsdom implements neither Pointer Capture nor scrollIntoView; Radix Select calls both.
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  vi.mocked(api.listAutomations).mockResolvedValue({ automations: [] });
  vi.mocked(api.listAutomationSuggestions).mockResolvedValue({ suggestions: [] });
  vi.mocked(api.createAutomation).mockResolvedValue({ automation });
  vi.mocked(api.deleteAutomation).mockResolvedValue({ deleted: true });
  vi.mocked(api.pauseAutomation).mockResolvedValue({ automation: { ...automation, status: "paused" } });
  vi.mocked(api.enableAutomation).mockResolvedValue({ automation });
  vi.mocked(api.runAutomationNow).mockResolvedValue({ runId: "run-1" });
  vi.mocked(api.acceptAutomationSuggestion).mockResolvedValue({ automation });
  vi.mocked(api.dismissAutomationSuggestion).mockResolvedValue({ dismissed: true });
});

afterEach(() => {
  client.clear();
});

it("renders the automation list with localized status badges", async () => {
  vi.mocked(api.listAutomations).mockResolvedValue({
    automations: [automation, { ...automation, id: "a2", name: "Weekly digest", status: "paused" }],
  });
  mount();
  expect(await screen.findByText("Daily summary")).toBeTruthy();
  expect(screen.getByText("Weekly digest")).toBeTruthy();
  expect(screen.getByText("已启用")).toBeTruthy();
  expect(screen.getByText("已暂停")).toBeTruthy();
});

it("shows an icon empty state when no automations exist", async () => {
  mount();
  expect(await screen.findByText("暂无自动化，点击「新建」创建。")).toBeTruthy();
});

it("creates a cron automation from the inline form", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "新建" }));
  fireEvent.change(screen.getByLabelText("名称"), { target: { value: "Nightly audit" } });
  fireEvent.change(screen.getByLabelText("任务提示词"), { target: { value: "Audit the project" } });
  fireEvent.change(screen.getByLabelText("表达式"), { target: { value: "30 2 * * 1-5" } });
  fireEvent.click(screen.getByRole("button", { name: "创建" }));
  await waitFor(() => expect(api.createAutomation).toHaveBeenCalledWith({
    name: "Nightly audit",
    prompt: "Audit the project",
    scopeType: "global",
    scheduleKind: "cron",
    scheduleExpression: "30 2 * * 1-5",
  }));
});

it("rejects malformed cron expressions with a field error and blocks save", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "新建" }));
  fireEvent.change(screen.getByLabelText("名称"), { target: { value: "Broken" } });
  fireEvent.change(screen.getByLabelText("任务提示词"), { target: { value: "Never runs" } });
  fireEvent.change(screen.getByLabelText("表达式"), { target: { value: "0 9 * *" } });
  expect(screen.getByRole("alert").textContent).toContain("5 段");
  expect(screen.getByRole("button", { name: "创建" })).toHaveProperty("disabled", true);
  expect(api.createAutomation).not.toHaveBeenCalled();
});

it("keeps non-cron schedules exempt from cron validation", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "新建" }));
  fireEvent.change(screen.getByLabelText("名称"), { target: { value: "Interval job" } });
  fireEvent.change(screen.getByLabelText("任务提示词"), { target: { value: "Tick" } });
  const trigger = screen.getByRole("combobox", { name: "调度类型" });
  fireEvent.keyDown(trigger, { key: "Enter" });
  const option = await screen.findByRole("option", { name: "interval" });
  fireEvent.pointerDown(option, { button: 0 });
  fireEvent.pointerUp(option, { button: 0 });
  fireEvent.click(option);
  fireEvent.change(screen.getByLabelText("表达式"), { target: { value: "300" } });
  fireEvent.click(screen.getByRole("button", { name: "创建" }));
  await waitFor(() => expect(api.createAutomation).toHaveBeenCalledWith(expect.objectContaining({ scheduleKind: "interval", scheduleExpression: "300" })));
});

it("pauses and re-enables an automation through the row switch", async () => {
  vi.mocked(api.listAutomations).mockResolvedValue({ automations: [automation] });
  mount();
  const toggle = await screen.findByRole("switch", { name: "暂停" });
  fireEvent.click(toggle);
  await waitFor(() => expect(api.pauseAutomation).toHaveBeenCalledWith("a1", expect.any(Object)));
  vi.mocked(api.listAutomations).mockResolvedValue({ automations: [{ ...automation, status: "paused" }] });
  client.invalidateQueries({ queryKey: ["copilot", "automations"] });
  const enableToggle = await screen.findByRole("switch", { name: "启用" });
  fireEvent.click(enableToggle);
  await waitFor(() => expect(api.enableAutomation).toHaveBeenCalledWith("a1", expect.any(Object)));
});

it("asks for confirmation before deleting an automation", async () => {
  vi.mocked(api.listAutomations).mockResolvedValue({ automations: [automation] });
  mount();
  await screen.findByText("Daily summary");
  fireEvent.click(screen.getByRole("button", { name: "删除" }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog.textContent).toContain("不可撤销");
  fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
  expect(api.deleteAutomation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "删除" }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "删除" }));
  await waitFor(() => expect(api.deleteAutomation).toHaveBeenCalledWith("a1", expect.any(Object)));
});

it("runs an automation immediately from the row action", async () => {
  vi.mocked(api.listAutomations).mockResolvedValue({ automations: [automation] });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "立即运行" }));
  await waitFor(() => expect(api.runAutomationNow).toHaveBeenCalledWith("a1", expect.any(Object)));
});

it("accepts and dismisses suggested automations", async () => {
  vi.mocked(api.listAutomationSuggestions).mockResolvedValue({
    suggestions: [{ id: "s1", source: "history", status: "pending", jobSpec: JSON.stringify({ name: "Morning report", prompt: "Compile status" }) }],
  });
  mount();
  expect(await screen.findByText("Morning report")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "接受" }));
  await waitFor(() => expect(api.acceptAutomationSuggestion).toHaveBeenCalledWith("s1", expect.any(Object)));
  fireEvent.click(screen.getByRole("button", { name: "忽略" }));
  await waitFor(() => expect(api.dismissAutomationSuggestion).toHaveBeenCalledWith("s1", expect.any(Object)));
});
