// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/hooks/use-language";
import { CopilotExtensionsPage } from "./CopilotExtensionsPage";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./CopilotSkillsPanel", () => ({ CopilotSkillsPanel: () => <div>Skill catalog</div> }));
vi.mock("./CopilotConnectionsPanel", () => ({ CopilotConnectionsPanel: () => <div>Connection catalog</div> }));
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
it("exposes exactly two extension tabs inside the settings shell", () => {
  mount();
  expect(screen.getAllByRole("tab")).toHaveLength(2);
  expect(screen.getByRole("tab", { name: /Skills/ })).toBeTruthy();
  expect(screen.getByText("Skill catalog")).toBeTruthy();
  fireEvent.mouseDown(screen.getByRole("tab", { name: /Connections/ }), { button: 0, ctrlKey: false });
  expect(screen.getByText("Connection catalog")).toBeTruthy();
});
it("offers section navigation back to the general settings page", () => {
  mount();
  const nav = screen.getByRole("navigation", { name: "Copilot 设置导航" });
  expect(nav.querySelector('a[href="/copilot/settings"]')).toBeTruthy();
  expect(nav.querySelector('a[href="/copilot/extensions"]')?.getAttribute("aria-current")).toBe("page");
});
