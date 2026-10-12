// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/hooks/use-language";
import { CopilotMemoryPanel } from "./copilot-memory-panel";
import { CopilotAutomationsPage } from "./copilot-automations-page";

const { listMemory, deleteMemory, listAutomations, deleteAutomation, listSuggestions } = vi.hoisted(() => ({ listMemory: vi.fn(), deleteMemory: vi.fn(), listAutomations: vi.fn(), deleteAutomation: vi.fn(), listSuggestions: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/copilot/automations", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/copilot-api", async original => ({ ...await original<typeof import("@/lib/copilot-api")>(), listMemoryEntries: listMemory, deleteMemoryEntry: deleteMemory, listAutomations, deleteAutomation, listAutomationSuggestions: listSuggestions }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => { vi.clearAllMocks(); listSuggestions.mockResolvedValue({ suggestions: [] }); });
function show(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<LanguageProvider><QueryClientProvider client={client}>{ui}</QueryClientProvider></LanguageProvider>);
}

it("reports memory loading failures instead of claiming no memories exist", async () => {
  listMemory.mockRejectedValue(new Error("offline"));
  show(<CopilotMemoryPanel />);
  expect((await screen.findByRole("alert")).textContent).toContain("加载失败");
});

it("keeps memory entries visible and reports failed deletions", async () => {
  listMemory.mockResolvedValue({ entries: [{ id: "memory", scope: "global", kind: "fact", text: "Remember this" }] });
  deleteMemory.mockRejectedValue(new Error("offline"));
  show(<CopilotMemoryPanel />);
  await screen.findByText("Remember this");
  fireEvent.click(screen.getByRole("button", { name: "删除" }));
  await screen.findByRole("alert");
  expect(screen.getByText("Remember this")).toBeTruthy();
});

it("reports automation loading errors", async () => {
  listAutomations.mockRejectedValue(new Error("offline"));
  show(<CopilotAutomationsPage />);
  expect((await screen.findByRole("alert")).textContent).toContain("加载失败");
});

it("reports failed automation deletion and keeps its row", async () => {
  listAutomations.mockResolvedValue({ automations: [{ id: "automation", name: "Daily task", status: "enabled", scheduleKind: "cron", scheduleExpression: "0 9 * * *" }] });
  deleteAutomation.mockRejectedValue(new Error("offline"));
  show(<CopilotAutomationsPage />);
  await screen.findByText("Daily task");
  fireEvent.click(screen.getByRole("button", { name: "删除" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("操作失败"));
  expect(screen.getByText("Daily task")).toBeTruthy();
});
