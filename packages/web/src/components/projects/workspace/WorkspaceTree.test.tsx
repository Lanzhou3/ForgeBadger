// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import { WorkspaceTree } from "./WorkspaceTree";

const { getProjectWorkspaceTreeMock } = vi.hoisted(() => ({
  getProjectWorkspaceTreeMock: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getProjectWorkspaceTree: getProjectWorkspaceTreeMock,
  };
});

const rootEntries = [
  { name: "src", path: "src", kind: "directory" },
  { name: "README.md", path: "README.md", kind: "file", sizeBytes: 12 },
];

const srcEntries = [
  { name: "index.ts", path: "src/index.ts", kind: "file", sizeBytes: 31 },
];

function treeSnapshot(entries: unknown[], path = "") {
  return {
    projectId: "project-1",
    rootPath: "/workspace/demo",
    path,
    truncated: false,
    entries,
  };
}

function mockTreeApi() {
  getProjectWorkspaceTreeMock.mockImplementation(
    (_id: string, params: { path?: string; depth?: number; limit?: number } = {}) => {
      if (params.path === "src") {
        return Promise.resolve(treeSnapshot(srcEntries, "src"));
      }
      if (params.depth === 3) {
        return Promise.resolve(
          treeSnapshot([
            { name: "src", path: "src", kind: "directory", children: srcEntries },
            rootEntries[1],
          ])
        );
      }
      return Promise.resolve(treeSnapshot(rootEntries));
    }
  );
}

function renderTree(onSelectFile = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <WorkspaceTree projectId="project-1" onSelectFile={onSelectFile} />
      </LanguageProvider>
    </QueryClientProvider>
  );
  return onSelectFile;
}

describe("WorkspaceTree", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockTreeApi();
  });

  it("renders the root entries", async () => {
    renderTree();

    expect(await screen.findByRole("button", { name: "src" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /README\.md/ })).toBeTruthy();
    expect(getProjectWorkspaceTreeMock).toHaveBeenCalledWith("project-1", {
      depth: 1,
      limit: 500,
    });
  });

  it("lazy-loads a directory with its path when expanded", async () => {
    renderTree();

    fireEvent.click(await screen.findByRole("button", { name: "src" }));

    await waitFor(() => {
      expect(getProjectWorkspaceTreeMock).toHaveBeenCalledWith("project-1", {
        path: "src",
        depth: 1,
      });
    });
    expect(await screen.findByRole("button", { name: /index\.ts/ })).toBeTruthy();
  });

  it("calls onSelectFile when a file row is clicked", async () => {
    const onSelectFile = renderTree();

    fireEvent.click(await screen.findByRole("button", { name: /README\.md/ }));

    expect(onSelectFile).toHaveBeenCalledWith("README.md");
  });

  it("filters files by keyword in search mode and selects a match", async () => {
    const onSelectFile = renderTree();

    fireEvent.change(
      await screen.findByPlaceholderText("搜索文件名…"),
      { target: { value: "index" } }
    );

    await waitFor(() => {
      expect(getProjectWorkspaceTreeMock).toHaveBeenCalledWith("project-1", {
        depth: 3,
        limit: 500,
      });
    });

    const match = await screen.findByRole("button", { name: /index\.ts/ });
    // Non-matching root file is hidden in search mode.
    expect(screen.queryByRole("button", { name: /README\.md/ })).toBeNull();

    fireEvent.click(match);
    expect(onSelectFile).toHaveBeenCalledWith("src/index.ts");
  });

  it("shows an empty state when no file matches the keyword", async () => {
    renderTree();

    fireEvent.change(
      await screen.findByPlaceholderText("搜索文件名…"),
      { target: { value: "no-such-file" } }
    );

    expect(await screen.findByText("无匹配文件")).toBeTruthy();
  });
});
