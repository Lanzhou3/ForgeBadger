// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CopilotAccessPage } from "./CopilotAccessPage";
import { LanguageProvider } from "@/hooks/use-language";
import * as copilotApi from "@/lib/copilot-api";
import * as api from "@/lib/platform-actions-api";
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/copilot-api", () => ({
  createConversation: vi.fn(),
}));
vi.mock("@/lib/platform-actions-api", () => ({
  listGrants: vi.fn(),
  getProjectOverview: vi.fn(),
  createGrant: vi.fn(),
  revokeGrant: vi.fn(),
  deleteGrant: vi.fn(),
}));
const grant = {
  id: "g1",
  name: "日常管理",
  status: "active",
  revision: 1,
  scope: { projectIds: ["p1"], capabilities: ["pm.work_item.create"], allowedRoots: [] },
  expiresAt: null,
  maxActions: null,
  maxConcurrency: 1,
  usedActions: 0,
};
function mount() {
  render(
    <LanguageProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <CopilotAccessPage />
      </QueryClientProvider>
    </LanguageProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listGrants).mockResolvedValue({ grants: [grant], capabilities: [] });
  vi.mocked(api.getProjectOverview).mockResolvedValue({ projects: [], observedAt: Date.now() });
  vi.mocked(copilotApi.createConversation).mockResolvedValue({
    conversation: { id: "c1" },
  } as Awaited<ReturnType<typeof copilotApi.createConversation>>);
});
afterEach(cleanup);
it("explains how grants work and offers the settings nav", async () => {
  mount();
  expect(screen.getByRole("heading", { name: "授权与项目权限" })).toBeTruthy();
  expect(screen.getByText("选择项目与允许的操作")).toBeTruthy();
  expect(screen.getByText("设置有效期、次数与并发上限")).toBeTruthy();
  expect(screen.getByText("绑定到新会话，Copilot 在范围内工作")).toBeTruthy();
  const nav = screen.getByRole("navigation", { name: "Copilot 设置导航" });
  expect(nav.querySelector('a[href="/copilot/settings/access"]')?.getAttribute("aria-current")).toBe("page");
  expect(await screen.findByRole("button", { name: "新建授权" })).toBeTruthy();
});
it("creates a grant-bound conversation and navigates to it", async () => {
  mount();
  fireEvent.click(await screen.findByText("以此授权新建会话"));
  await waitFor(() => expect(copilotApi.createConversation).toHaveBeenCalledWith(undefined, "g1"));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/copilot?c=c1"));
});
