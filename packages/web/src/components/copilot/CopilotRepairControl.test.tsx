// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LanguageProvider } from "@/hooks/use-language";
import { CopilotRepairControl } from "./CopilotRepairControl";
import { listConversationRuns, revokeRunRepairs } from "@/lib/copilot-api";

vi.mock("@/lib/copilot-api", () => ({ listConversationRuns: vi.fn(), revokeRunRepairs: vi.fn() }));
const clients: QueryClient[] = [];
function renderControl() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  return render(<LanguageProvider><QueryClientProvider client={client}>
    <CopilotRepairControl conversationId="conversation" />
  </QueryClientProvider></LanguageProvider>);
}

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.setItem("forgebadger-language", "zh-CN");
  vi.mocked(revokeRunRepairs).mockResolvedValue({ revoked: true });
});
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); });

it("keeps ordinary conversations free of repair controls", async () => {
  vi.mocked(listConversationRuns).mockResolvedValue({ runs: [], activeRun: null, repairRunIds: [] });
  renderControl();
  await waitFor(() => expect(listConversationRuns).toHaveBeenCalledWith("conversation"));
  expect(screen.queryByRole("button")).toBeNull();
});

it("retries only the remaining roots after a partial revocation failure", async () => {
  vi.mocked(listConversationRuns)
    .mockResolvedValueOnce({ runs: [], activeRun: null, repairRunIds: ["first", "second"] })
    .mockResolvedValue({ runs: [], activeRun: null, repairRunIds: ["second"] });
  vi.mocked(revokeRunRepairs)
    .mockResolvedValueOnce({ revoked: true }).mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ revoked: true });
  renderControl();
  fireEvent.click(await screen.findByRole("button", { name: "停止此对话的后续修复" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "停止此对话的后续修复" }));
  await screen.findByRole("button", { name: "已停止后续修复" });
  expect(vi.mocked(revokeRunRepairs).mock.calls.map(([id]) => id)).toEqual(["first", "second", "second"]);
});

it("offers a retry when repair authorization cannot be loaded", async () => {
  vi.mocked(listConversationRuns).mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ runs: [], activeRun: null, repairRunIds: ["root"] });
  renderControl();
  fireEvent.click(await screen.findByRole("button", { name: "停止修复失败，请重试。" }));
  expect(await screen.findByRole("button", { name: "停止此对话的后续修复" })).toBeTruthy();
});
