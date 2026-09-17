// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LanguageProvider } from "@/hooks/use-language";
import { ExtractTemplateDialog } from "./ExtractTemplateDialog";

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

const { extractProjectTemplateMock } = vi.hoisted(() => ({
  extractProjectTemplateMock: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    extractProjectTemplate: extractProjectTemplateMock,
  };
});

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderDialog(overrides: Record<string, unknown> = {}) {
  const onExtracted = vi.fn();
  const utils = render(
    <LanguageProvider>
      <QueryClientProvider client={createQueryClient()}>
        <ExtractTemplateDialog
          projectId="project-1"
          open
          onOpenChange={vi.fn()}
          onExtracted={onExtracted}
          {...overrides}
        />
      </QueryClientProvider>
    </LanguageProvider>
  );
  return { onExtracted, ...utils };
}

describe("ExtractTemplateDialog", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    extractProjectTemplateMock.mockResolvedValue({
      template: { id: "template-1", name: "My Template" },
      extracted: [{ filePath: ".claude/settings.json", sizeBytes: 10 }],
      skipped: [{ path: "CLAUDE.md", reason: "exists" }],
    });
  });

  it("submits the default adapter and bind without an empty description", async () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "My Template" } });
    fireEvent.click(screen.getByRole("button", { name: /沉淀模板/ }));

    await waitFor(() =>
      expect(extractProjectTemplateMock).toHaveBeenCalledWith("project-1", {
        name: "My Template",
        adapter: "claude",
        bind: true,
      })
    );
  });

  it("shows extracted and skipped files after success and notifies the page", async () => {
    const { onExtracted } = renderDialog();

    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "My Template" } });
    fireEvent.click(screen.getByRole("button", { name: /沉淀模板/ }));

    await waitFor(() => expect(screen.getByText(".claude/settings.json")).toBeTruthy());
    expect(screen.getByText("已提取的文件")).toBeTruthy();
    expect(screen.getByText("跳过的文件")).toBeTruthy();
    expect(screen.getByText("exists")).toBeTruthy();
    expect(onExtracted).toHaveBeenCalled();
  });

  it("shows the gateway error message when extraction fails", async () => {
    extractProjectTemplateMock.mockRejectedValue(
      new Error("No extractable AI config files found in project")
    );
    renderDialog();

    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "My Template" } });
    fireEvent.click(screen.getByRole("button", { name: /沉淀模板/ }));

    await waitFor(() =>
      expect(
        screen.getByText("No extractable AI config files found in project")
      ).toBeTruthy()
    );
  });

  it("sends bind=false when the bind checkbox is unchecked", async () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "My Template" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /沉淀模板/ }));

    await waitFor(() =>
      expect(extractProjectTemplateMock).toHaveBeenCalledWith("project-1", {
        name: "My Template",
        adapter: "claude",
        bind: false,
      })
    );
  });

  it("disables submission while the name is empty", () => {
    renderDialog();

    const submit = screen.getByRole("button", { name: /沉淀模板/ }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });
});
