// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/hooks/use-language";
import { SkillPackageReview } from "./SkillPackageReview";
import { SkillDiscoveryPage } from "./SkillDiscoveryPage";
import * as registry from "@/lib/skill-registry-api";
vi.mock("next/navigation", () => ({ usePathname: () => "/skills/discover" }));
vi.mock("@/lib/api", () => ({
  listProjects: vi.fn().mockResolvedValue({ projects: [] }),
}));
vi.mock("@/lib/skill-registry-api", () => ({
  bootstrapSkillRegistry: vi.fn().mockResolvedValue({}),
  searchSkillRegistry: vi.fn().mockResolvedValue({
    items: [
      {
        id: "github:demo/review",
        name: "review",
        description: "Review code",
        sourceLabel: "demo/review",
        sourceUrl: "https://github.com/demo/review",
        provider: "github",
        locator: { kind: "github", repo: "demo/review", path: "SKILL.md" },
      },
    ],
    total: 1,
    hasMore: false,
    statuses: [
      { provider: "clawhub", status: "error", message: "HTTP 429" },
      { provider: "github", status: "cached" },
    ],
  }),
  previewSkillPackage: vi.fn().mockResolvedValue({
    token: "review-token",
    operation: "install",
    expiresAt: "2099-01-01",
    revision: "abc123",
    canonicalId: "github:demo/review/SKILL.md",
    sourceUrl: "https://github.com/demo/review",
    package: {
      name: "review",
      description: "Review code",
      version: "1",
      warnings: ["contains-scripts"],
      packageHash: "sha256:12345",
      sizeBytes: 100,
      files: [
        { path: "SKILL.md", content: "<script>alert(1)</script>" },
        { path: "references/rules.md", content: "Review these rules" },
      ],
    },
    changes: [],
  }),
  installSkillPackage: vi
    .fn()
    .mockResolvedValue({ skill: { id: "installed" } }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function wrapper(child: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <LanguageProvider>
      <QueryClientProvider client={client}>{child}</QueryClientProvider>
    </LanguageProvider>,
  );
}
it("reviews all files as escaped text and installs only after explicit confirmation", async () => {
  const { container } = wrapper(
    <SkillPackageReview
      input={{
        locator: { kind: "github", repo: "demo/review", path: "SKILL.md" },
      }}
      onClose={() => {}}
    />,
  );
  expect(
    await screen.findByText("确认来源与文件后保存。项目生效需通过配置同步。"),
  ).toBeTruthy();
  expect(await screen.findByText("<script>alert(1)</script>")).toBeTruthy();
  expect(container.querySelector("script")).toBeNull();
  expect(registry.installSkillPackage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "references/rules.md" }));
  expect(screen.getByText("Review these rules")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "已审阅，确认安装" }));
  expect(
    await screen.findByText("已保存。请在项目配置中预览并同步，使变更生效。"),
  ).toBeTruthy();
  expect(registry.installSkillPackage).toHaveBeenCalledTimes(1);
  expect(vi.mocked(registry.installSkillPackage).mock.calls[0]?.[0].token).toBe(
    "review-token",
  );
});
it("keeps usable search results visible when a provider fails and debounces keywords", async () => {
  wrapper(<SkillDiscoveryPage />);
  expect(await screen.findByText("Review code")).toBeTruthy();
  expect(screen.getByText(/clawhub: 暂不可用/)).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "搜索 Skills" }), {
    target: { value: "testing" },
  });
  await waitFor(() =>
    expect(registry.searchSkillRegistry).toHaveBeenCalledWith(
      expect.objectContaining({ q: "testing", includeSkillsSh: false }),
      expect.any(AbortSignal),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "预览安装" }));
  expect(await screen.findByRole("dialog")).toBeTruthy();
});
