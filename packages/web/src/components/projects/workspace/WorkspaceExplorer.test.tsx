// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LanguageProvider } from "@/hooks/use-language";
import { WorkspaceExplorer } from "./WorkspaceExplorer";

const {
  getProjectWorkspaceTreeMock,
  getProjectWorkspaceFileMock,
  createProjectWorkspaceFileMock,
  renameProjectWorkspaceEntryMock,
} = vi.hoisted(() => ({
  getProjectWorkspaceTreeMock: vi.fn(),
  getProjectWorkspaceFileMock: vi.fn(),
  createProjectWorkspaceFileMock: vi.fn(),
  renameProjectWorkspaceEntryMock: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getProjectWorkspaceTree: getProjectWorkspaceTreeMock,
    getProjectWorkspaceFile: getProjectWorkspaceFileMock,
    createProjectWorkspaceFile: createProjectWorkspaceFileMock,
    renameProjectWorkspaceEntry: renameProjectWorkspaceEntryMock,
  };
});

vi.mock("./highlight", () => ({
  highlightWorkspaceCode: vi.fn().mockResolvedValue(null),
  tokenFontStyle: () => ({ italic: false, bold: false, underline: false }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem("forgebadger-language", "en");
  getProjectWorkspaceTreeMock.mockResolvedValue({
    projectId: "proj-1",
    rootPath: "/workspace/fb",
    path: "",
    truncated: false,
    entries: [
      { name: "README.md", path: "README.md", kind: "file", sizeBytes: 18 },
      { name: "notes.md", path: "notes.md", kind: "file", sizeBytes: 18 },
    ],
  });
  getProjectWorkspaceFileMock.mockImplementation(async (_id: string, filePath: string) => ({
    projectId: "proj-1",
    rootPath: "/workspace/fb",
    path: filePath,
    name: filePath,
    sizeBytes: 12,
    updatedAt: "2026-11-18T12:00:00Z",
    encoding: "utf8",
    content: `content:${filePath}`,
    truncated: false,
    binary: false,
  }));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderExplorer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <LanguageProvider>
      <QueryClientProvider client={client}>
        <WorkspaceExplorer projectId="proj-1" />
      </QueryClientProvider>
    </LanguageProvider>,
  );
}

describe("WorkspaceExplorer", () => {
  it("creates a file, renames it, and guards unsaved edits on switch", async () => {
    createProjectWorkspaceFileMock.mockResolvedValue({ path: "docs/new.md", sizeBytes: 0, updatedAt: "2026-11-18T12:00:00Z" });
    renameProjectWorkspaceEntryMock.mockResolvedValue({ fromPath: "README.md", toPath: "README2.md" });

    renderExplorer();
    await screen.findByText("README.md");

    // Create new file
    fireEvent.click(screen.getByRole("button", { name: "New file" }));
    const input = await screen.findByPlaceholderText("e.g. docs/notes.md");
    fireEvent.change(input, { target: { value: "docs/new.md" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(createProjectWorkspaceFileMock).toHaveBeenCalledWith("proj-1", "docs/new.md", ""));

    // Open README.md, rename it, then dirty-edit and guard switch
    fireEvent.click(screen.getByRole("button", { name: /README\.md/ }));
    await screen.findByText("content:README.md");

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const renameInput = await screen.findByDisplayValue("README.md");
    fireEvent.change(renameInput, { target: { value: "README2.md" } });
    fireEvent.submit(renameInput.closest("form")!);
    await waitFor(() => expect(renameProjectWorkspaceEntryMock).toHaveBeenCalledWith("proj-1", "README.md", "README2.md"));

    // Wait for renamed file to finish loading, then dirty-edit and guard switch
    await screen.findByText("content:README2.md");
    fireEvent.click(await screen.findByRole("button", { name: "Edit file" }));
    const editor = await screen.findByTestId("workspace-file-editor");
    fireEvent.change(editor, { target: { value: "unsaved change" } });
    fireEvent.click(screen.getByRole("button", { name: /notes\.md/ }));
    await screen.findByText("Unsaved file edits");
  });
});
