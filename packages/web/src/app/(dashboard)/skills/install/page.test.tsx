// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import SkillInstallPage from "./page";
import { LanguageProvider } from "@/hooks/use-language";
import { installGitHubSkill, previewGitHubSkillSource, refreshMarketplace } from "@/lib/api";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listSkillSources: vi.fn().mockResolvedValue({ sources: [] }),
  listCatalogItems: vi.fn().mockResolvedValue({ items: [] }),
  previewGitHubSkillSource: vi.fn().mockResolvedValue({
    sha: "abc1234def",
    skills: [
      { path: "skills/pdf/SKILL.md", name: "pdf", description: "PDF skill", version: "1.0.0" },
      { path: "skills/xlsx/SKILL.md", name: "xlsx", description: "Spreadsheet skill" },
    ],
  }),
  installGitHubSkill: vi.fn().mockResolvedValue({ skill: { id: "skill-1" } }),
  refreshMarketplace: vi.fn().mockResolvedValue({
    source: { id: "src-1", sourceId: "anthropics-skills", type: "skill", label: "Anthropic Skills", url: "", status: "ok" },
    items: [{ id: "item-1" }],
    skipped: ["npm-entry"],
  }),
  installCatalogSkill: vi.fn(),
  installSkill: vi.fn(),
  previewSkillSource: vi.fn(),
}));

afterEach(() => {
  cleanup();
  pushMock.mockClear();
  vi.mocked(previewGitHubSkillSource).mockClear();
  vi.mocked(installGitHubSkill).mockClear();
  vi.mocked(refreshMarketplace).mockClear();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <LanguageProvider>
      <QueryClientProvider client={client}>
        <SkillInstallPage />
      </QueryClientProvider>
    </LanguageProvider>
  );
}

it("previews and installs a Skill discovered from a GitHub repository", async () => {
  renderPage();

  fireEvent.change(screen.getByPlaceholderText("owner/repo[/path]"), {
    target: { value: "anthropics/skills" },
  });
  fireEvent.click(screen.getByText("预览"));

  await waitFor(() => expect(previewGitHubSkillSource).toHaveBeenCalledWith({ repo: "anthropics/skills" }));
  expect(await screen.findByText("选择要安装的 Skill")).toBeTruthy();
  expect(screen.getByText("pdf")).toBeTruthy();

  fireEvent.click(screen.getByText("安装所选 Skill"));
  await waitFor(() =>
    expect(installGitHubSkill).toHaveBeenCalledWith({
      repo: "anthropics/skills",
      path: "skills/pdf/SKILL.md",
    })
  );
  await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/skills"));
});

it("refreshes a seed marketplace and shows the refresh summary", async () => {
  renderPage();

  fireEvent.click(screen.getByText("anthropics/skills"));

  await waitFor(() =>
    expect(refreshMarketplace).toHaveBeenCalledWith({ repo: "anthropics/skills" })
  );
  expect(await screen.findByText("已刷新 1 个 Skill")).toBeTruthy();
  expect(screen.getByText("跳过 1 个不支持的条目")).toBeTruthy();
});

it("refreshes a custom marketplace repository", async () => {
  renderPage();

  fireEvent.change(screen.getByPlaceholderText("owner/repo"), {
    target: { value: "acme/agent-skills" },
  });
  fireEvent.click(screen.getByText("添加并刷新"));

  await waitFor(() =>
    expect(refreshMarketplace).toHaveBeenCalledWith({ repo: "acme/agent-skills" })
  );
});
