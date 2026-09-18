// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import SkillsPage from "./page";
import { LanguageProvider } from "@/hooks/use-language";

vi.mock("@/lib/api", () => ({
  listSkills: vi.fn().mockResolvedValue({
    skills: [
      { id: "pack", name: "with-resources", source: "local", isEnabled: true, resourceManifest: '{"version":1,"files":[]}' },
      { id: "markdown", name: "markdown-entry", source: "local", isEnabled: false, resourceManifest: null },
    ],
    discovery: { roots: [], discoveredCount: 2, createdCount: 0, updatedCount: 0, deletedCount: 0, skippedCount: 1,
      rejectedSkills: [{ path: "/skills/unsafe", reason: "Symlink outside approved root" }] },
  }),
  listSkillSources: vi.fn().mockResolvedValue({ sources: [] }),
  listSkillTemplates: vi.fn().mockResolvedValue({ templates: [] }),
  createSkill: vi.fn(), deleteSkill: vi.fn(), syncLocalSkills: vi.fn(), toggleSkill: vi.fn(), updateSkill: vi.fn(),
}));
afterEach(cleanup);
it("distinguishes resource packages from Markdown-only entries and shows skipped package reasons", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<LanguageProvider><QueryClientProvider client={client}><SkillsPage /></QueryClientProvider></LanguageProvider>);
  expect(await screen.findByText("UTF-8 资源包")).toBeTruthy();
  expect(screen.getByText("仅 Markdown（不含配套资源）")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("/skills/unsafe");
  expect(screen.getByRole("alert").textContent).toContain("Symlink outside approved root");
});
