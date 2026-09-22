// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import SkillsPage from "./page";
import { LanguageProvider } from "@/hooks/use-language";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listSkills: vi.fn().mockResolvedValue({
    skills: [
      { id: "pack", name: "with-resources", source: "local", isEnabled: true, resourceManifest: '{"version":1,"files":[]}' },
      { id: "markdown", name: "markdown-entry", source: "local", isEnabled: false, resourceManifest: null },
      { id: "remote", name: "remote-skill", source: "github:anthropics/skills", isEnabled: false, resourceManifest: null,
        remoteProvenance: JSON.stringify({
          kind: "github", repo: "anthropics/skills", ref: "main", resolvedCommitSha: "abc1234def",
          contentHash: "sha256:deadbeef", installedAt: "2026-09-22T00:00:00Z",
          lastCheck: { checkedAt: "2026-09-22T01:00:00Z", latestCommitSha: "def4567abc", updateAvailable: true },
        }) },
      { id: "stale", name: "stale-skill", source: "github:anthropics/skills", isEnabled: false, resourceManifest: null,
        remoteProvenance: JSON.stringify({
          kind: "github", repo: "anthropics/skills", ref: "main", resolvedCommitSha: "999888777",
          contentHash: "sha256:abc", installedAt: "2026-09-22T00:00:00Z",
        }) },
    ],
    discovery: { roots: [], discoveredCount: 2, createdCount: 0, updatedCount: 0, deletedCount: 0, skippedCount: 1,
      rejectedSkills: [{ path: "/skills/unsafe", reason: "Symlink outside approved root" }] },
  }),
  listSkillSources: vi.fn().mockResolvedValue({ sources: [] }),
  listSkillTemplates: vi.fn().mockResolvedValue({ templates: [] }),
  createSkill: vi.fn(), deleteSkill: vi.fn(), syncLocalSkills: vi.fn(), toggleSkill: vi.fn(), updateSkill: vi.fn(),
  checkSkillUpdate: vi.fn().mockResolvedValue({ updateAvailable: false, currentSha: "abc1234def", latestSha: "abc1234def" }),
  checkAllSkillUpdates: vi.fn().mockResolvedValue({ results: [] }),
  updateRemoteSkill: vi.fn().mockResolvedValue({ skill: { id: "remote" } }),
}));
afterEach(cleanup);
it("distinguishes resource packages from Markdown-only entries and shows skipped package reasons", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<LanguageProvider><QueryClientProvider client={client}><SkillsPage /></QueryClientProvider></LanguageProvider>);
  expect(await screen.findByText("UTF-8 资源包")).toBeTruthy();
  expect(screen.getAllByText("仅 Markdown（不含配套资源）")).toHaveLength(3);
  expect(screen.getByRole("alert").textContent).toContain("/skills/unsafe");
  expect(screen.getByRole("alert").textContent).toContain("Symlink outside approved root");
});

it("shows provenance badges, update-available state, and remote update actions", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<LanguageProvider><QueryClientProvider client={client}><SkillsPage /></QueryClientProvider></LanguageProvider>);

  expect(await screen.findByText("anthropics/skills@abc1234")).toBeTruthy();
  expect(screen.getByText("anthropics/skills@9998887")).toBeTruthy();
  expect(screen.getByText("可更新")).toBeTruthy();
  expect(screen.getByText("检查全部更新")).toBeTruthy();
  expect(screen.getAllByText("检查更新")).toHaveLength(2);
  expect(screen.getByText("更新")).toBeTruthy();
});
