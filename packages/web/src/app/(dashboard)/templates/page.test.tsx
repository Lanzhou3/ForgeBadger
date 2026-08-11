// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

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
            outcome: "synced",
            writtenFiles: [".claude/CLAUDE.md"],
            skippedFiles: [],
            backupPath: undefined,
          },
        },
      ],
    });
  });

  it("renders the usage list with project status after selecting a template", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("My Template")).toBeTruthy());
    fireEvent.click(screen.getByText("My Template"));

    await waitFor(() => expect(screen.getByText(/2 projects use this template/)).toBeTruthy());
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
    expect(screen.getByText("In sync")).toBeTruthy();
    expect(screen.getByText("Stale")).toBeTruthy();
    expect(getTemplateUsageMock).toHaveBeenCalledWith("tpl-1");
  });

  it("previews sync and applies with overwrite decisions for modified files", async () => {
    renderPage();

    await waitFor(() => expect(screen.getAllByText("My Template").length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText("My Template")[0]!);
    await waitFor(() => expect(screen.getByText(/2 projects use this template/)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Preview changes/ }));
    await waitFor(() => expect(screen.getByText(/1 files to create/)).toBeTruthy());
    expect(previewTemplateSyncMock).toHaveBeenCalledWith("tpl-1");

    const overwriteCheckbox = screen.getByRole("checkbox");
    fireEvent.click(overwriteCheckbox);
    fireEvent.click(screen.getByRole("button", { name: /Apply to 1 projects/ }));

    await waitFor(() => expect(applyTemplateSyncMock).toHaveBeenCalled());
    expect(applyTemplateSyncMock).toHaveBeenCalledWith("tpl-1", {
      projectIds: ["p1"],
      decisions: { p1: { ".claude/settings.json": "overwrite" } },
    });
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