// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import TemplatesPage from "./page";

const {
  listTemplatesMock,
  listCatalogItemsMock,
  getTemplateMock,
  listTemplateVersionsMock,
  getTemplateUsageMock,
  previewTemplateSyncMock,
  applyTemplateSyncMock,
  cloneTemplateMock,
  createTemplateMock,
  deleteTemplateMock,
  exportTemplateMock,
  importTemplateMock,
  installCatalogTemplateMock,
  restoreTemplateVersionMock,
  updateTemplateMock,
  updateTemplateFileMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  listTemplatesMock: vi.fn(),
  listCatalogItemsMock: vi.fn(),
  getTemplateMock: vi.fn(),
  listTemplateVersionsMock: vi.fn(),
  getTemplateUsageMock: vi.fn(),
  previewTemplateSyncMock: vi.fn(),
  applyTemplateSyncMock: vi.fn(),
  cloneTemplateMock: vi.fn(),
  createTemplateMock: vi.fn(),
  deleteTemplateMock: vi.fn(),
  exportTemplateMock: vi.fn(),
  importTemplateMock: vi.fn(),
  installCatalogTemplateMock: vi.fn(),
  restoreTemplateVersionMock: vi.fn(),
  updateTemplateMock: vi.fn(),
  updateTemplateFileMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    listTemplates: listTemplatesMock,
    listCatalogItems: listCatalogItemsMock,
    getTemplate: getTemplateMock,
    listTemplateVersions: listTemplateVersionsMock,
    getTemplateUsage: getTemplateUsageMock,
    previewTemplateSync: previewTemplateSyncMock,
    applyTemplateSync: applyTemplateSyncMock,
    cloneTemplate: cloneTemplateMock,
    createTemplate: createTemplateMock,
    deleteTemplate: deleteTemplateMock,
    exportTemplate: exportTemplateMock,
    importTemplate: importTemplateMock,
    installCatalogTemplate: installCatalogTemplateMock,
    restoreTemplateVersion: restoreTemplateVersionMock,
    updateTemplate: updateTemplateMock,
    updateTemplateFile: updateTemplateFileMock,
  };
});

vi.mock("@/lib/toast", () => ({
  toast: {
    error: toastErrorMock,
  },
}));

const template = {
  id: "tpl-1",
  name: "My Template",
  version: "1.0.0",
  visibility: "private" as const,
  files: [],
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <TemplatesPage />
      </QueryClientProvider>
    </LanguageProvider>
  );
}

describe("TemplatesPage sync block", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    listTemplatesMock.mockResolvedValue({ templates: [template] });
    listCatalogItemsMock.mockResolvedValue({ items: [] });
    getTemplateMock.mockResolvedValue({ template: { ...template, files: [] } });
    listTemplateVersionsMock.mockResolvedValue({ versions: [] });
    getTemplateUsageMock.mockResolvedValue({
      usageCount: 2,
      projects: [
        { id: "p1", name: "Alpha", path: "/tmp/alpha", configStatus: "compliant" },
        { id: "p2", name: "Beta", path: "/tmp/beta", configStatus: "stale" },
      ],
    });
    previewTemplateSyncMock.mockResolvedValue({
      projects: [
        {
          projectId: "p1",
          projectName: "Alpha",
          summary: {
            templateId: "tpl-1",
            totalFiles: 2,
            missingFiles: [".claude/CLAUDE.md"],
            identicalFiles: [],
            modifiedFiles: [".claude/settings.json"],
            unsafeFiles: [],
            requiresDecision: [".claude/settings.json"],
          },
        },
      ],
    });
    applyTemplateSyncMock.mockResolvedValue({
      templateId: "tpl-1",
      projects: [
        {
          projectId: "p1",
          projectName: "Alpha",
          result: {
            outcome: "applied",
            writtenFiles: [".claude/CLAUDE.md"],
            skippedFiles: [],
            failedFiles: [],
            conflicts: [],
            backupPath: "/backups/tpl-1",
          },
        },
      ],
    });
  });

  it("shows the error state with retry instead of the empty list when the query fails", async () => {
    listTemplatesMock.mockRejectedValue(new Error("gateway unreachable"));
    renderPage();

    await screen.findByText("加载失败");
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
    // The failure must not masquerade as an empty template library.
    expect(screen.queryByText("暂无模板")).toBeNull();
  });

  it("keeps the page title at the shared text-xl size with a semantic h1", async () => {
    renderPage();
    const heading = await screen.findByRole("heading", { level: 1 });
    expect(heading.className).toContain("text-xl");
    expect(heading.className).not.toContain("text-2xl");
  });

  it("renders the usage list with project status after selecting a template", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("My Template")).toBeTruthy());
    fireEvent.click(screen.getByText("My Template"));

    await waitFor(() => expect(screen.getByText(/2 个项目使用此模板/)).toBeTruthy());
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
    expect(screen.getAllByText("一致").length).toBeGreaterThan(0);
    expect(screen.getByText("过期")).toBeTruthy();
    expect(getTemplateUsageMock).toHaveBeenCalledWith("tpl-1");
  });

  it("partitions templates into governed and seed-only sections", async () => {
    listTemplatesMock.mockResolvedValue({
      templates: [
        { ...template, id: "tpl-governed", name: "Governed Template", usageCount: 3 },
        { ...template, id: "tpl-seed", name: "Seed Template" },
      ],
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("治理中的模板")).toBeTruthy());
    expect(screen.getByText("仅作初始化种子的模板")).toBeTruthy();
    expect(screen.getByText("Governed Template")).toBeTruthy();
    expect(screen.getByText("Seed Template")).toBeTruthy();
  });

  it("previews sync and applies with overwrite decisions for modified files", async () => {
    renderPage();

    await waitFor(() => expect(screen.getAllByText("My Template").length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText("My Template")[0]!);
    await waitFor(() => expect(screen.getByText(/2 个项目使用此模板/)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /预览变更/ }));
    await waitFor(() => expect(screen.getByText(/1 个待创建文件/)).toBeTruthy());
    expect(previewTemplateSyncMock).toHaveBeenCalledWith("tpl-1");
    expect(screen.getByText(/未勾选的项目将跳过已修改文件/)).toBeTruthy();

    const overwriteCheckbox = screen.getByRole("checkbox");
    fireEvent.click(overwriteCheckbox);
    fireEvent.click(screen.getByRole("button", { name: /应用到 1 个项目/ }));

    // Batch writes require an explicit confirmation first.
    await waitFor(() => expect(screen.getByText("批量应用同步？")).toBeTruthy());
    expect(applyTemplateSyncMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认应用" }));

    await waitFor(() => expect(applyTemplateSyncMock).toHaveBeenCalled());
    expect(applyTemplateSyncMock).toHaveBeenCalledWith("tpl-1", {
      projectIds: ["p1"],
      decisions: { p1: { ".claude/settings.json": "overwrite" } },
    });
    await waitFor(() => expect(screen.getByText(/备份: \/backups\/tpl-1/)).toBeTruthy());
  });

  it("offers a JSON download for the exported template package", async () => {
    const createObjectURL = vi.fn((_blob: Blob) => "blob:mock");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURL, configurable: true });
    exportTemplateMock.mockResolvedValue({ templatePackage: { name: "My Template", files: [] } });

    renderPage();
    await waitFor(() => expect(screen.getAllByText("My Template").length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText("My Template")[0]!);

    fireEvent.click(screen.getByRole("button", { name: /导出/ }));
    const downloadButton = await screen.findByRole("button", { name: /下载 JSON/ });
    await waitFor(() => expect((downloadButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(downloadButton);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0]![0];
    expect(blob.type).toBe("application/json");
  });

  it("shows a friendly error when the import package is not valid JSON", async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText("My Template").length).toBeGreaterThan(0));

    fireEvent.change(screen.getByLabelText(/模板包 JSON/), { target: { value: "{ not json" } });
    fireEvent.click(screen.getByRole("button", { name: /^导入$/ }));

    await waitFor(() =>
      expect(screen.getByText(/模板包不是有效的 JSON/)).toBeTruthy(),
    );
    expect(importTemplateMock).not.toHaveBeenCalled();
  });

  it("keeps the catalog install section collapsed by default", async () => {
    renderPage();

    await waitFor(() => expect(screen.getAllByText("My Template").length).toBeGreaterThan(0));
    const toggles = screen.getAllByRole("button", { name: /从目录安装/ });
    const toggle = toggles.find((element) => element.getAttribute("aria-expanded") !== null);
    expect(toggle).toBeTruthy();
    expect(toggle!.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/暂无可安装模板/)).toBeNull();

    fireEvent.click(toggle!);
    expect(toggle!.getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => expect(screen.getByText(/暂无可安装模板/)).toBeTruthy());
  });
});

const templateA = {
  id: "tpl-a",
  name: "Template A",
  version: "1.0.0",
  visibility: "private" as const,
  files: [{ filePath: "CLAUDE.md", content: "# Alpha guide", fileType: "markdown" }],
};

const templateB = {
  id: "tpl-b",
  name: "Template B",
  version: "1.0.0",
  visibility: "private" as const,
  files: [{ filePath: "CLAUDE.md", content: "# Beta guide", fileType: "markdown" }],
};

function editorTextarea() {
  return document.querySelector("textarea.min-h-80") as HTMLTextAreaElement;
}

function saveButton() {
  return screen.getByRole("button", { name: /保存模板/ }) as HTMLButtonElement;
}

describe("TemplatesPage editor safety", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    listTemplatesMock.mockResolvedValue({ templates: [templateA] });
    listCatalogItemsMock.mockResolvedValue({ items: [] });
    getTemplateMock.mockResolvedValue({ template: templateA });
    listTemplateVersionsMock.mockResolvedValue({ versions: [] });
    updateTemplateMock.mockResolvedValue({ template: templateA });
    updateTemplateFileMock.mockResolvedValue({ ok: true });
  });

  it("auto-loads the first file content after selecting a template", async () => {
    renderPage();

    fireEvent.click(await screen.findByText("Template A"));
    await waitFor(() => expect(editorTextarea().value).toBe("# Alpha guide"));
    expect(updateTemplateFileMock).not.toHaveBeenCalled();
  });

  it("updates the saved baseline and permits reverting to the original content", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("Template A"));
    await waitFor(() => expect(editorTextarea().value).toBe("# Alpha guide"));
    fireEvent.change(editorTextarea(), { target: { value: "# saved B" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(updateTemplateFileMock).toHaveBeenCalledWith("tpl-a", "CLAUDE.md", "# saved B"));
    await waitFor(() => expect(saveButton().disabled).toBe(true));
    fireEvent.change(editorTextarea(), { target: { value: "# Alpha guide" } });
    expect(saveButton().disabled).toBe(false);
  });

  it("saves identical content to a new path and protects a path-only draft on template switch", async () => {
    listTemplatesMock.mockResolvedValue({ templates: [templateA, templateB] });
    renderPage();
    fireEvent.click(await screen.findByText("Template A"));
    await waitFor(() => expect(editorTextarea().value).toBe("# Alpha guide"));
    fireEvent.change(document.querySelector("#template-file")!, { target: { value: "AGENTS.md" } });
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(screen.getByText("Template B"));
    expect(screen.getByText("放弃未保存的修改？")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(updateTemplateFileMock).toHaveBeenCalledWith("tpl-a", "AGENTS.md", "# Alpha guide"));
    await waitFor(() => expect(saveButton().disabled).toBe(true));
  });

  it("preserves edits made while a file save is pending", async () => {
    let finish!: (value: { ok: boolean }) => void;
    updateTemplateFileMock.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    renderPage();
    fireEvent.click(await screen.findByText("Template A"));
    await waitFor(() => expect(editorTextarea().value).toBe("# Alpha guide"));
    fireEvent.change(editorTextarea(), { target: { value: "# submitted" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(updateTemplateFileMock).toHaveBeenCalledTimes(1));
    fireEvent.change(editorTextarea(), { target: { value: "# later draft" } });
    await act(async () => { finish({ ok: true }); });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(editorTextarea().value).toBe("# later draft");
    fireEvent.change(editorTextarea(), { target: { value: "# submitted" } });
    expect(saveButton().disabled).toBe(true);
  });

  it("does not overwrite the baseline of another loaded file when an earlier save completes", async () => {
    const otherFile = { filePath: "AGENTS.md", content: "# Other file", fileType: "markdown" };
    getTemplateMock.mockResolvedValue({ template: { ...templateA, files: [...templateA.files, otherFile] } });
    let finish!: (value: { ok: boolean }) => void;
    updateTemplateFileMock.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    renderPage();
    fireEvent.click(await screen.findByText("Template A"));
    await waitFor(() => expect(editorTextarea().value).toBe("# Alpha guide"));
    fireEvent.change(editorTextarea(), { target: { value: "# submitted" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(updateTemplateFileMock).toHaveBeenCalledTimes(1));
    fireEvent.change(document.querySelector("#template-file")!, { target: { value: "AGENTS.md" } });
    fireEvent.click(screen.getByRole("button", { name: /载入文件|加载文件/ }));
    expect(editorTextarea().value).toBe("# Other file");
    await act(async () => { finish({ ok: true }); });
    await waitFor(() => expect(saveButton().disabled).toBe(true));
    fireEvent.change(editorTextarea(), { target: { value: "# edited other" } });
    expect(saveButton().disabled).toBe(false);
  });

  it("does not apply an old save baseline after leaving and returning to the same template", async () => {
    listTemplatesMock.mockResolvedValue({ templates: [templateA, templateB] });
    getTemplateMock.mockImplementation((id: string) => Promise.resolve({ template: id === "tpl-a" ? templateA : templateB }));
    let finish!: (value: { ok: boolean }) => void;
    updateTemplateFileMock.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    renderPage();
    fireEvent.click(await screen.findByText("Template A"));
    await waitFor(() => expect(editorTextarea().value).toBe("# Alpha guide"));
    fireEvent.change(editorTextarea(), { target: { value: "# submitted" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(updateTemplateFileMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText("Template B"));
    fireEvent.click(screen.getByRole("button", { name: "放弃修改" }));
    await waitFor(() => expect(editorTextarea().value).toBe("# Beta guide"));
    fireEvent.click(screen.getByText("Template A"));
    await waitFor(() => expect(editorTextarea().value).toBe("# Alpha guide"));
    getTemplateMock.mockImplementation((id: string) => Promise.resolve({ template: id === "tpl-a"
      ? { ...templateA, files: [{ ...templateA.files[0], content: "# submitted" }] } : templateB }));
    await act(async () => { finish({ ok: true }); });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(editorTextarea().value).toBe("# Alpha guide");
  });

  it("keeps a newer loaded file baseline when an older save response arrives", async () => {
    listTemplateVersionsMock.mockResolvedValue({ versions: [{ id: 1, name: "Earlier", version: "0.9.0", action: "saved", createdAt: "2026-10-06T00:00:00Z" }] });
    let finish!: (value: { ok: boolean }) => void;
    updateTemplateFileMock.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    renderPage();
    fireEvent.click(await screen.findByText("Template A"));
    await waitFor(() => expect(editorTextarea().value).toBe("# Alpha guide"));
    fireEvent.change(editorTextarea(), { target: { value: "# submitted B" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(updateTemplateFileMock).toHaveBeenCalledTimes(1));
    const newer = { ...templateA, files: [{ ...templateA.files[0], content: "# newer C" }] };
    getTemplateMock.mockResolvedValue({ template: newer });
    restoreTemplateVersionMock.mockResolvedValue({ template: newer });
    fireEvent.click(await screen.findByRole("button", { name: "回滚" }));
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() => expect(restoreTemplateVersionMock).toHaveBeenCalledWith("tpl-a", 1));
    await waitFor(() => expect(editorTextarea().value).toBe("# newer C"));
    await act(async () => { finish({ ok: true }); });
    await waitFor(() => expect(saveButton().disabled).toBe(true));
    expect(editorTextarea().value).toBe("# newer C");
  });

  it("keeps save disabled while file content is still loading", async () => {
    getTemplateMock.mockImplementation(() => new Promise(() => {}));
    renderPage();

    fireEvent.click(await screen.findByText("Template A"));
    await waitFor(() => expect(editorTextarea()).toBeTruthy());
    expect(editorTextarea().value).toBe("");
    expect(saveButton().disabled).toBe(true);
    expect(updateTemplateFileMock).not.toHaveBeenCalled();
  });

  it("never saves unmodified content, so the default file cannot be wiped", async () => {
    renderPage();

    fireEvent.click(await screen.findByText("Template A"));
    await waitFor(() => expect(editorTextarea().value).toBe("# Alpha guide"));
    expect(saveButton().disabled).toBe(true);

    fireEvent.click(saveButton());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(updateTemplateMock).not.toHaveBeenCalled();
    expect(updateTemplateFileMock).not.toHaveBeenCalled();
  });

  it("confirms before discarding unsaved edits when switching templates", async () => {
    listTemplatesMock.mockResolvedValue({ templates: [templateA, templateB] });
    getTemplateMock.mockImplementation((id: string) =>
      Promise.resolve({ template: id === "tpl-a" ? templateA : templateB })
    );
    renderPage();

    fireEvent.click(await screen.findByText("Template A"));
    await waitFor(() => expect(editorTextarea().value).toBe("# Alpha guide"));
    fireEvent.change(editorTextarea(), { target: { value: "# edited draft" } });

    fireEvent.click(screen.getByText("Template B"));
    await waitFor(() => expect(screen.getByText("放弃未保存的修改？")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(getTemplateMock).toHaveBeenCalledTimes(1);
    expect(editorTextarea().value).toBe("# edited draft");

    fireEvent.click(screen.getByText("Template B"));
    await waitFor(() => expect(screen.getByText("放弃未保存的修改？")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "放弃修改" }));
    await waitFor(() => expect(getTemplateMock).toHaveBeenCalledWith("tpl-b"));
    await waitFor(() => expect(editorTextarea().value).toBe("# Beta guide"));
  });

  it("switches templates directly when the editor has no unsaved edits", async () => {
    listTemplatesMock.mockResolvedValue({ templates: [templateA, templateB] });
    getTemplateMock.mockImplementation((id: string) =>
      Promise.resolve({ template: id === "tpl-a" ? templateA : templateB })
    );
    renderPage();

    fireEvent.click(await screen.findByText("Template A"));
    await waitFor(() => expect(editorTextarea().value).toBe("# Alpha guide"));
    fireEvent.click(screen.getByText("Template B"));

    await waitFor(() => expect(getTemplateMock).toHaveBeenCalledWith("tpl-b"));
    expect(screen.queryByText("放弃未保存的修改？")).toBeNull();
  });

  it("toasts about the partial failure and keeps retry available when the file save fails", async () => {
    updateTemplateFileMock.mockRejectedValue(new Error("disk full"));
    renderPage();

    fireEvent.click(await screen.findByText("Template A"));
    await waitFor(() => expect(editorTextarea().value).toBe("# Alpha guide"));
    fireEvent.change(editorTextarea(), { target: { value: "# edited" } });

    fireEvent.click(saveButton());
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));
    expect(toastErrorMock).toHaveBeenCalledWith("元数据已保存，但文件内容保存失败，请重新保存文件内容。");
    expect(updateTemplateMock).toHaveBeenCalledWith("tpl-a", {
      name: "Template A",
      description: "",
      visibility: "private",
    });
    expect(updateTemplateFileMock).toHaveBeenCalledWith("tpl-a", "CLAUDE.md", "# edited");

    expect(screen.queryByText("disk full")).toBeNull();
    expect(editorTextarea().value).toBe("# edited");
    expect(saveButton().disabled).toBe(false);
  });
});
