// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CopilotSettingsPage } from "./copilot-settings-page";
import { LanguageProvider } from "@/hooks/use-language";
import { listModelProviders } from "@/lib/api";
import { getCopilotPreferences } from "@/lib/copilot-api";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/api", () => ({ listModelProviders: vi.fn().mockResolvedValue({ models: [] }) }));
vi.mock("@/lib/copilot-api", () => ({
  getCopilotPreferences: vi.fn().mockResolvedValue({ modelId: null, thinkingEffort: "medium" }),
  updateCopilotPreferences: vi.fn().mockResolvedValue({ modelId: null, thinkingEffort: "medium" }),
}));
vi.mock("./copilot-memory-panel", () => ({ CopilotMemoryPanel: () => <div>Memory</div> }));
vi.mock("./copilot-execution-policy-panel", () => ({ CopilotExecutionPolicyPanel: () => null }));
vi.mock("./copilot-team-panel", () => ({ CopilotTeamPanel: () => null }));

function mount() {
  render(
    <LanguageProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <CopilotSettingsPage />
      </QueryClientProvider>
    </LanguageProvider>,
  );
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.mocked(getCopilotPreferences).mockResolvedValue({ modelId: null, thinkingEffort: "medium" });
});

it("displays the effective chat model instead of always showing the platform default", async () => {
  vi.mocked(listModelProviders).mockResolvedValueOnce({
    providers: [],
    credentials: [],
    models: [
      { id: "default", name: "Default", providerName: "Provider", isDefault: true, status: "active" },
      { id: "chosen", name: "Chosen", providerName: "Provider", isDefault: false, status: "active" },
    ].map((model) => ({
      ...model,
      providerProfileId: "provider",
      providerKey: "openai",
      baseUrl: null,
      modelId: model.id,
      capabilities: [],
      contextWindow: null,
      supportEfforts: [],
      defaultEffort: null,
    })),
  });
  vi.mocked(getCopilotPreferences).mockResolvedValue({ modelId: "chosen", thinkingEffort: "medium" });
  mount();
  expect(await screen.findByText("Provider / Chosen", { exact: false })).toBeTruthy();
  expect(screen.queryByText("Provider / Default", { exact: false })).toBeNull();
});

it("renders the settings nav with entries into every Copilot settings section", () => {
  mount();
  expect(screen.getByRole("heading", { name: "Copilot 设置" })).toBeTruthy();
  const nav = screen.getByRole("navigation", { name: "Copilot 设置导航" });
  expect(nav.querySelector('a[href="/copilot/extensions"]')).toBeTruthy();
  expect(nav.querySelector('a[href="/copilot/channels"]')).toBeTruthy();
  expect(nav.querySelector('a[href="/copilot/automations"]')).toBeTruthy();
  // Horizontal chip row on mobile: the overflow is hinted with a right-edge
  // fade, and the desktop column drops both the mask and the overflow.
  expect(nav.className).toContain("overflow-x-auto");
  expect(nav.className).toContain("[mask-image:linear-gradient");
  expect(nav.className).toContain("lg:[mask-image:none]");
});

it("removes duplicate summary entry cards while keeping direct model & reasoning controls", async () => {
  mount();
  expect(screen.queryByText("Gateway 原生")).toBeNull();
  expect(screen.queryByRole("link", { name: /Copilot 扩展/ })).toBeNull();
  expect(screen.queryByRole("link", { name: /定时自动化/ })).toBeNull();
  expect(screen.getByRole("link", { name: "管理模型" }).getAttribute("href")).toBe("/models");
  expect(await screen.findByTestId("copilot-status-bar")).toBeTruthy();
  expect(screen.getByRole("combobox", { name: "当前模型" })).toBeTruthy();
  expect(screen.getByRole("combobox", { name: "思考强度" })).toBeTruthy();
});

it("returns to Copilot chat", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "返回对话" }));
  expect(push).toHaveBeenCalledWith("/copilot");
});
