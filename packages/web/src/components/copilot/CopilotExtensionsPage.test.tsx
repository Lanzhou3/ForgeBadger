// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/hooks/use-language";
import { CopilotExtensionsPage } from "./CopilotExtensionsPage";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./CopilotSkillsPanel", () => ({ CopilotSkillsPanel: () => <div>Playbooks catalog</div> }));
vi.mock("./copilot-runtime-panel", () => ({
  CapabilitiesSection: () => <div>Built-in tool switches</div>,
  copilotCapabilitiesQueryKey: ["copilot", "capabilities"],
}));
vi.mock("./CopilotConnectionsPanel", () => ({ CopilotConnectionsPanel: () => <div>Connection catalog</div> }));
vi.mock("./CopilotMachineRootsPanel", () => ({ CopilotMachineRootsPanel: () => <div>Root catalog</div> }));
vi.mock("@/lib/copilot-machine-roots-api", () => ({
  copilotMachineRootsKey: ["copilot", "machine-roots"],
  listCopilotMachineRoots: vi.fn().mockResolvedValue({ roots: [] }),
}));
vi.mock("@/lib/copilot-extensions-api", () => ({
  copilotSkillsKey: ["copilot", "skills"],
  copilotConnectionsKey: ["copilot", "connections"],
  listCopilotSkills: vi.fn().mockResolvedValue({ skills: [] }),
  listCopilotConnections: vi.fn().mockResolvedValue({ connections: [] }),
}));

function mount() {
  render(
    <LanguageProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <CopilotExtensionsPage />
      </QueryClientProvider>
    </LanguageProvider>,
  );
}

afterEach(cleanup);

it("exposes Playbooks, Built-in tools, MCP Connections and Local-search tabs inside the settings shell", () => {
  mount();
  expect(screen.getAllByRole("tab")).toHaveLength(4);
  expect(screen.getByRole("tab", { name: /操作手册/ })).toBeTruthy();
  expect(screen.getByText("Playbooks catalog")).toBeTruthy();
  fireEvent.mouseDown(screen.getByRole("tab", { name: /内置工具/ }), { button: 0, ctrlKey: false });
  expect(screen.getByText("Built-in tool switches")).toBeTruthy();
  fireEvent.mouseDown(screen.getByRole("tab", { name: /MCP 连接/ }), { button: 0, ctrlKey: false });
  expect(screen.getByText("Connection catalog")).toBeTruthy();
  fireEvent.mouseDown(screen.getByRole("tab", { name: /本机检索/ }), { button: 0, ctrlKey: false });
  expect(screen.getByText("Root catalog")).toBeTruthy();
});

it("offers section navigation back to the general settings page", () => {
  mount();
  const nav = screen.getByRole("navigation", { name: "Copilot 设置导航" });
  expect(nav.querySelector('a[href="/copilot/settings"]')).toBeTruthy();
  expect(nav.querySelector('a[href="/copilot/extensions"]')?.getAttribute("aria-current")).toBe("page");
});
