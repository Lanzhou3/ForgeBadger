// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CopilotSettingsPage } from "./copilot-settings-page";
import { LanguageProvider } from "@/hooks/use-language";
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/api", () => ({ listModelProviders: vi.fn().mockResolvedValue({ models: [] }) }));
vi.mock("@/lib/copilot-extensions-api", () => ({
  copilotSkillsKey: ["copilot", "skills"],
  copilotConnectionsKey: ["copilot", "connections"],
  listCopilotSkills: vi.fn().mockResolvedValue({ skills: [] }),
  listCopilotConnections: vi.fn().mockResolvedValue({ connections: [] }),
}));
vi.mock("./copilot-memory-panel", () => ({ CopilotMemoryPanel: () => <div>Memory</div> }));
vi.mock("./copilot-autonomy-panel", () => ({ CopilotAutonomyPanel: () => null }));
function mount() {
  render(
    <LanguageProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <CopilotSettingsPage />
      </QueryClientProvider>
    </LanguageProvider>,
  );
}
beforeEach(() => { cleanup(); vi.clearAllMocks(); });
it("renders the settings nav with entries into every Copilot settings section", () => {
  mount();
  expect(screen.getByRole("heading", { name: "Copilot 设置" })).toBeTruthy();
  const nav = screen.getByRole("navigation", { name: "Copilot 设置导航" });
  expect(nav.querySelector('a[href="/copilot/extensions"]')).toBeTruthy();
  expect(nav.querySelector('a[href="/copilot/channels"]')).toBeTruthy();
  expect(nav.querySelector('a[href="/copilot/automations"]')).toBeTruthy();
});
it("links summary cards to extensions, channels and automations", () => {
  mount();
  expect(screen.getAllByRole("link", { name: /Copilot 扩展/ }).some((link) => link.getAttribute("href") === "/copilot/extensions")).toBe(true);
  expect(screen.getAllByRole("link", { name: /远程渠道/ }).some((link) => link.getAttribute("href") === "/copilot/channels")).toBe(true);
  expect(screen.getAllByRole("link", { name: /定时自动化/ }).some((link) => link.getAttribute("href") === "/copilot/automations")).toBe(true);
});
it("shows the native runtime with a model management entry and no standalone tool panels", () => {
  mount();
  expect(screen.getByText("Gateway 原生")).toBeTruthy();
  expect(screen.getByRole("link", { name: "管理模型" }).getAttribute("href")).toBe("/models");
  expect(screen.queryByRole("switch")).toBeNull();
});
it("returns to Copilot chat", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "返回对话" }));
  expect(push).toHaveBeenCalledWith("/copilot");
});
