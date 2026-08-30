// @vitest-environment jsdom
import { createRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LanguageProvider } from "@/hooks/use-language";
import { ConfigSyncPanel, type ConfigSyncPanelHandle } from "./ConfigSyncPanel";

const { previewConfigSyncMock, applyConfigSyncMock, getConfigComplianceMock, updateProjectTemplateMock } = vi.hoisted(() => ({
  previewConfigSyncMock: vi.fn(),
  applyConfigSyncMock: vi.fn(),
  getConfigComplianceMock: vi.fn(),
  updateProjectTemplateMock: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    previewConfigSync: previewConfigSyncMock,
    applyConfigSync: applyConfigSyncMock,
    getConfigCompliance: getConfigComplianceMock,
    updateProjectTemplate: updateProjectTemplateMock,
  };
});

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPanel(overrides: Record<string, unknown> = {}) {
  const ref = createRef<ConfigSyncPanelHandle>();
  const utils = render(
    <LanguageProvider>
      <QueryClientProvider client={createQueryClient()}>
        <ConfigSyncPanel
          ref={ref}
          projectId="project-1"
          templateId="builtin-claude-code"
          credentialMode="host_environment"
          {...overrides}
        />
      </QueryClientProvider>
    </LanguageProvider>
  );
  return { ref, ...utils };
}

describe("ConfigSyncPanel", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    previewConfigSyncMock.mockResolvedValue({
      plan: { dryRun: true, files: [{ relativePath: ".claude/settings.json", content: "", sizeBytes: 0 }] },
      conflicts: [
        {
          relativePath: ".claude/settings.json",
          conflictType: "modified",
          allowedActions: ["overwrite", "skip"],
          existingSha256: "aaaa",
          incomingSha256: "bbbb",
          diffPreview: [],
        },
      ],
      summary: {
        templateId: "builtin-claude-code",
        totalFiles: 1,
        missingFiles: [],
        identicalFiles: [],
        modifiedFiles: [".claude/settings.json"],
        unsafeFiles: [],
        requiresDecision: [".claude/settings.json"],
      },
    });
    applyConfigSyncMock.mockResolvedValue({
      writtenFiles: [".claude/settings.json"],
      skippedFiles: [],
      backupPath: "/tmp/backup",
      summary: {
        templateId: "builtin-claude-code",
        totalFiles: 1,
        missingFiles: [],
        identicalFiles: [],
        modifiedFiles: [".claude/settings.json"],
        unsafeFiles: [],
        requiresDecision: [".claude/settings.json"],
      },
    });
    getConfigComplianceMock.mockResolvedValue({
      compliance: {
        status: "needs_attention",
        templateId: "builtin-claude-code",
        totalFiles: 1,
        missingFiles: [],
        identicalFiles: [],
        modifiedFiles: [".claude/settings.json"],
        staleFiles: [".claude/settings.json"],
        unsafeFiles: [],
        requiresDecision: [],
      },
    });
  });

  it("previews conflicts and applies with default skip decisions", async () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /预览配置/ }));

    await waitFor(() => expect(screen.getByText(".claude/settings.json")).toBeTruthy());
    expect(previewConfigSyncMock).toHaveBeenCalledWith(
      "project-1",
      "builtin-claude-code",
      "host_environment"
    );

    fireEvent.click(screen.getByRole("button", { name: /应用配置/ }));

    await waitFor(() => expect(applyConfigSyncMock).toHaveBeenCalled());
    expect(applyConfigSyncMock).toHaveBeenCalledWith(
      "project-1",
      { ".claude/settings.json": "skip" },
      "builtin-claude-code",
      "host_environment"
    );
  });

  it("runs a pending preview action once and reports consumption", async () => {
    const onPendingActionConsumed = vi.fn();
    renderPanel({ pendingAction: "preview", onPendingActionConsumed });

    await waitFor(() => expect(previewConfigSyncMock).toHaveBeenCalledTimes(1));
    expect(previewConfigSyncMock).toHaveBeenCalledWith(
      "project-1",
      "builtin-claude-code",
      "host_environment"
    );
    expect(onPendingActionConsumed).toHaveBeenCalledTimes(1);
  });

  it("ignores pending actions when no template is tracked", async () => {
    const onPendingActionConsumed = vi.fn();
    renderPanel({ templateId: null, pendingAction: "preview", onPendingActionConsumed });

    await waitFor(() => expect(screen.getByText("独立配置")).toBeTruthy());
    expect(previewConfigSyncMock).not.toHaveBeenCalled();
  });

  it("checks compliance and renders the metrics card", async () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /检查合规/ }));

    await waitFor(() => expect(screen.getByText("需要处理")).toBeTruthy());
    expect(getConfigComplianceMock).toHaveBeenCalledWith("project-1", {
      templateId: "builtin-claude-code",
      credentialMode: "host_environment",
    });
    expect(screen.getByText("总文件")).toBeTruthy();
    expect(screen.getByText("过期")).toBeTruthy();
  });

  it("clears conflicts when the template changes", async () => {
    const { ref, rerender } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /预览配置/ }));
    await waitFor(() => expect(screen.getByText(".claude/settings.json")).toBeTruthy());

    rerender(
      <LanguageProvider>
        <QueryClientProvider client={createQueryClient()}>
          <ConfigSyncPanel
            ref={ref}
            projectId="project-1"
            templateId="builtin-opencode"
            credentialMode="host_environment"
          />
        </QueryClientProvider>
      </LanguageProvider>
    );

    await waitFor(() => expect(screen.queryByText(".claude/settings.json")).toBeNull());
  });

  it("notifies the page about pending preview/compliance state", async () => {
    const onPendingChange = vi.fn();
    renderPanel({ onPendingChange });

    fireEvent.click(screen.getByRole("button", { name: /检查合规/ }));
    await waitFor(() => expect(getConfigComplianceMock).toHaveBeenCalled());

    expect(onPendingChange).toHaveBeenCalled();
    for (const [pending] of onPendingChange.mock.calls) {
      expect(typeof pending.preview).toBe("boolean");
      expect(typeof pending.compliance).toBe("boolean");
    }
  });

  it("renders the independent config note when no template is tracked", async () => {
    renderPanel({ templateId: null });

    expect(screen.getByText("独立配置")).toBeTruthy();
    expect(screen.getByText(/未跟踪任何模板/)).toBeTruthy();
    expect(screen.queryByText("停止跟踪模板")).toBeNull();
    expect(screen.queryByRole("button", { name: /预览配置/ })).toBeNull();
  });

  it("stops tracking only after confirmation", async () => {
    updateProjectTemplateMock.mockResolvedValue({ project: { id: "project-1", templateId: null } });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { ref } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /停止跟踪模板/ }));

    await waitFor(() => expect(updateProjectTemplateMock).toHaveBeenCalledWith("project-1", null));
    confirmSpy.mockRestore();
  });

  it("does not stop tracking when confirmation is cancelled", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { ref } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /停止跟踪模板/ }));

    expect(updateProjectTemplateMock).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});