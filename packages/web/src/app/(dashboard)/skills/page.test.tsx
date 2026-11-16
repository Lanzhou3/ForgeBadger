// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SkillsPage from "./page";
import * as api from "@/lib/api";
import { LanguageProvider } from "@/hooks/use-language";

vi.mock("next/navigation", () => ({ usePathname: () => "/skills" }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listSkills: vi.fn(),
  listSkillTemplates: vi.fn().mockResolvedValue({ templates: [] }),
  createSkill: vi.fn().mockResolvedValue({}),
  deleteSkill: vi.fn(),
  syncLocalSkills: vi.fn(),
  toggleSkill: vi.fn().mockResolvedValue({}),
  updateSkill: vi.fn(),
  checkSkillUpdate: vi.fn().mockResolvedValue({ updateAvailable: false }),
  checkAllSkillUpdates: vi.fn().mockResolvedValue({ results: [] }),
}));
vi.mock("@/lib/skill-registry-api", () => ({
  listSkillRevisions: vi.fn().mockResolvedValue({ revisions: [] }),
}));
const fixtures: api.Skill[] = [
  {
    id: "pack",
    name: "with-resources",
    description: "Review package",
    source: "local",
    content: "# Package",
    version: "1",
    visibility: "private",
    isEnabled: true,
    resourceManifest: JSON.stringify({
      version: 1,
      files: [
        { relativePath: "references/rules.md", content: "Review these rules" },
      ],
    }),
  },
  {
    id: "markdown",
    name: "markdown-entry",
    source: "local",
    content: "# Markdown",
    visibility: "shared",
    isEnabled: false,
    resourceManifest: null,
  },
  {
    id: "remote",
    name: "remote-skill",
    source: "github:anthropics/skills",
    content: "# Remote",
    isEnabled: false,
    remoteProvenance: JSON.stringify({
      kind: "github",
      storage: "database",
      repo: "anthropics/skills",
      resolvedCommitSha: "abc1234def",
      lastCheck: { updateAvailable: true },
    }),
  },
];
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <LanguageProvider>
      <QueryClientProvider client={client}>
        <SkillsPage />
      </QueryClientProvider>
    </LanguageProvider>,
  );
}
beforeEach(() => {
  vi.mocked(api.listSkills).mockResolvedValue({
    skills: fixtures,
    discovery: {
      roots: ["/skills"],
      discoveredCount: 2,
      createdCount: 0,
      updatedCount: 0,
      deletedCount: 0,
      skippedCount: 2,
      rejectedSkills: [
        { path: "/skills/unsafe", reason: "Symlink outside approved root" },
      ],
    },
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("prioritizes the library and reveals scan diagnostics only on demand", async () => {
  mount();
  expect(await screen.findByText("with-resources")).toBeTruthy();
  expect(screen.queryByRole("form")).toBeNull();
  expect(screen.queryByText("/skills/unsafe")).toBeNull();
  expect(screen.getByText("· 1 项未导入")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "扫描详情" }));
  expect(await screen.findByRole("dialog")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain(
    "Symlink outside approved root",
  );
});

it("combines search, normalized remote source, visibility and status filters", async () => {
  mount();
  await screen.findByText("remote-skill");
  fireEvent.change(screen.getByRole("combobox", { name: "来源筛选" }), {
    target: { value: "github" },
  });
  expect(screen.queryByText("with-resources")).toBeNull();
  expect(screen.getByText("remote-skill")).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox", { name: "搜索 Skills" }), {
    target: { value: "missing" },
  });
  expect(await screen.findByText("没有匹配的 Skill")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
  await screen.findByText("with-resources");
  fireEvent.change(screen.getByRole("combobox", { name: "可见性" }), {
    target: { value: "shared" },
  });
  expect(screen.getByText("markdown-entry")).toBeTruthy();
  expect(screen.queryByText("remote-skill")).toBeNull();
});

it("filters actionable updates and opens the complete stored package without executing markup", async () => {
  mount();
  await screen.findByText("with-resources");
  fireEvent.click(screen.getByRole("radio", { name: /可更新/ }));
  expect(screen.getByText("remote-skill")).toBeTruthy();
  expect(screen.queryByText("with-resources")).toBeNull();
  expect(
    screen.getByRole("button", { name: "remote-skill 更新" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: /全部/ }));
  fireEvent.click(screen.getByText("with-resources"));
  expect(await screen.findByText("UTF-8 资源包")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "references/rules.md" }));
  expect(screen.getByLabelText("文件内容").textContent).toBe(
    "Review these rules",
  );
  expect(
    screen.getByRole("link", { name: "在项目中使用" }).getAttribute("href"),
  ).toBe("/projects");
});

it("retains source revision evidence inside details", async () => {
  mount();
  fireEvent.click(await screen.findByText("remote-skill"));
  expect(await screen.findByText("anthropics/skills@abc1234")).toBeTruthy();
  expect(screen.getByText("仅 Markdown（不含配套资源）")).toBeTruthy();
});

it("opens a create dialog, focuses the first invalid field and submits a trimmed payload", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "新建 Skill" }));
  const form = screen.getByRole("form", { name: "创建 Skill" });
  fireEvent.submit(form);
  expect(await screen.findAllByText("此字段为必填项")).toHaveLength(2);
  expect(document.activeElement).toBe(screen.getByLabelText(/名称/));
  expect(api.createSkill).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(/名称/), {
    target: { value: " safe-review " },
  });
  fireEvent.change(screen.getByLabelText(/内容/), {
    target: { value: " # Review " },
  });
  fireEvent.submit(form);
  await waitFor(() =>
    expect(api.createSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "safe-review",
        content: "# Review",
        visibility: "private",
      }),
    ),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("rolls back a failed optimistic toggle and reports the failure", async () => {
  vi.mocked(api.toggleSkill).mockRejectedValueOnce(new Error("Update refused"));
  mount();
  const toggle = await screen.findByRole("switch", {
    name: "with-resources 默认启用",
  });
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  fireEvent.click(toggle);
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Update refused",
  );
  await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
});

it("paginates long libraries and resets to the first page when filtering", async () => {
  vi.mocked(api.listSkills).mockResolvedValueOnce({
    skills: Array.from({ length: 25 }, (_, index) => ({
      ...fixtures[0]!,
      id: String(index),
      name: `entry-${index}`,
    })),
  });
  mount();
  await screen.findByText("entry-0");
  expect(screen.queryByText("entry-20")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  expect(screen.getByText("entry-24")).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "entry-0" },
  });
  expect(await screen.findByText("entry-0")).toBeTruthy();
});

it("does not present a failed library request as an empty library", async () => {
  vi.mocked(api.listSkills).mockRejectedValueOnce(new Error("Offline"));
  mount();
  expect(await screen.findByText("加载失败")).toBeTruthy();
  expect(screen.queryByText("还没有 Skill")).toBeNull();
});

it("requires a named confirmation before deleting a Skill", async () => {
  mount();
  const menu = await screen.findByRole("button", {
    name: "with-resources 更多操作",
  });
  fireEvent.keyDown(menu, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("menuitem", { name: "删除" }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog.textContent).toContain("with-resources");
  expect(api.deleteSkill).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(api.deleteSkill).not.toHaveBeenCalled();
});
