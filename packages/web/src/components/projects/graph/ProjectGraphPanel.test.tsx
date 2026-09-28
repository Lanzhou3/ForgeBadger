// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LanguageProvider } from "@/hooks/use-language";

// jsdom does not implement ResizeObserver/DOMMatrixReadOnly; React Flow needs both.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
const globalScope = globalThis as unknown as Record<string, unknown>;
globalScope.ResizeObserver = globalScope.ResizeObserver ?? ResizeObserverStub;
globalScope.DOMMatrixReadOnly = globalScope.DOMMatrixReadOnly ??
  class {
    m22 = 1;
    scale = () => this;
    translate = () => this;
  };
import {
  getProjectGraphAffected,
  getProjectGraphFileGraph,
  getProjectGraphOverview,
  getProjectGitChanges,
  getProjectWorkspaceFile,
  searchProjectGraphSymbols,
  type GraphSymbolRef
} from "@/lib/api";
import { ProjectGraphPanel } from "./ProjectGraphPanel";
import { SymbolSearchBox } from "./SymbolSearchBox";

const overviewMock = vi.mocked(getProjectGraphOverview);
const fileGraphMock = vi.mocked(getProjectGraphFileGraph);
const searchMock = vi.mocked(searchProjectGraphSymbols);
const gitMock = vi.mocked(getProjectGitChanges);
const affectedMock = vi.mocked(getProjectGraphAffected);
const workspaceFileMock = vi.mocked(getProjectWorkspaceFile);

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getProjectGraphOverview: vi.fn(),
    getProjectGraphFileGraph: vi.fn(),
    searchProjectGraphSymbols: vi.fn(),
    getProjectGitChanges: vi.fn(),
    getProjectGraphAffected: vi.fn(),
    getProjectWorkspaceFile: vi.fn()
  };
});

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPanel(props: Partial<React.ComponentProps<typeof ProjectGraphPanel>> = {}) {
  return render(
    <LanguageProvider>
      <QueryClientProvider client={createQueryClient()}>
        <ProjectGraphPanel projectId="project-1" enabled {...props} />
      </QueryClientProvider>
    </LanguageProvider>
  );
}

const availableOverview = {
  available: true as const,
  indexState: "complete",
  indexedAt: 1700000000000,
  files: {
    total: 620,
    byLanguage: [
      { key: "typescript", count: 461 },
      { key: "tsx", count: 117 }
    ]
  },
  nodes: {
    total: 10740,
    byKind: [{ key: "function", count: 2559 }]
  },
  edges: {
    total: 27162,
    byKind: [{ key: "calls", count: 15353 }]
  }
};

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProjectGraphPanel", () => {
  it("renders stat cards when the index is available", async () => {
    overviewMock.mockResolvedValue(availableOverview);
    fileGraphMock.mockResolvedValue({
      available: true,
      nodes: [{ path: "src/a.ts" }],
      edges: [],
      truncated: false
    });

    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("620")).toBeTruthy();
      expect(screen.getByText("10740")).toBeTruthy();
      expect(screen.getByText("27162")).toBeTruthy();
      expect(screen.getByText("complete")).toBeTruthy();
    });
  });

  it("shows setup guidance when CodeGraph is not initialized", async () => {
    overviewMock.mockResolvedValue({ available: false, reason: "not_initialized" });
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText(/CodeGraph/)).toBeTruthy();
      // The CLI hint is rendered for copyable onboarding.
      expect(screen.getByText("codegraph init .")).toBeTruthy();
    });
  });

  it("shows upgrade guidance for an unsupported schema", async () => {
    overviewMock.mockResolvedValue({ available: false, reason: "schema_unsupported" });
    renderPanel();

    await waitFor(() => {
      // zh dictionary mentions 升级 in the unsupported-schema copy.
      expect(screen.getByText(/升级|升級|Upgrade/)).toBeTruthy();
    });
  });

  it("flags truncation in the file view when results were pruned", async () => {
    overviewMock.mockResolvedValue(availableOverview);
    fileGraphMock.mockResolvedValue({
      available: true,
      nodes: [{ path: "src/a.ts" }],
      edges: [],
      truncated: true
    });

    renderPanel();
    await waitFor(() => {
      expect(screen.getByText(/裁剪|裁剪|pruned/)).toBeTruthy();
    });
  });

  it("renders the guidance hint in the default file view", async () => {
    overviewMock.mockResolvedValue(availableOverview);
    fileGraphMock.mockResolvedValue({ available: true, nodes: [], edges: [], truncated: false });
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText(/符号.*有名字的实体|符號.*有名字的實體|named entity in your code/i)).toBeTruthy();
    });
  });

  it("shows the no-git notice in affected mode for non-git projects", async () => {
    overviewMock.mockResolvedValue(availableOverview);
    fileGraphMock.mockResolvedValue({ available: true, nodes: [], edges: [], truncated: false });
    gitMock.mockResolvedValue({
      isGitRepo: false,
      changed: [],
      commits: []
    });

    renderPanel();
    // Wait for stats to render before switching modes.
    await waitFor(() => expect(screen.getByText("620")).toBeTruthy());
    fireEvent.click((await screen.findAllByRole("button", { name: /改动影响面|改動影響面|Change impact/ }))[0]!);

    await waitFor(() => {
      expect(screen.getByText(/不是 git 仓库|不是 git 儲存庫|not a git repository/i)).toBeTruthy();
    });
  });

  it("analyzes impact from git changes and renders summary counters", async () => {
    overviewMock.mockResolvedValue(availableOverview);
    fileGraphMock.mockResolvedValue({ available: true, nodes: [], edges: [], truncated: false });
    gitMock.mockResolvedValue({
      isGitRepo: true,
      changed: [{ path: "src/b.ts", status: "modified", staged: false }],
      commits: []
    });
    affectedMock.mockResolvedValue({
      available: true,
      seededFiles: 1,
      seededSymbols: 2,
      depth: 2,
      nodes: [
        {
          id: "fn:main",
          name: "main",
          qualifiedName: "b.main",
          kind: "function",
          filePath: "src/b.ts",
          startLine: 10,
          signature: null,
          depth: 0
        }
      ],
      edges: [],
      truncated: false
    });

    renderPanel();
    await waitFor(() => expect(screen.getByText("620")).toBeTruthy());
    fireEvent.click((await screen.findAllByRole("button", { name: /改动影响面|改動影響面|Change impact/ }))[0]!);
    const analyzeButton = await waitFor(() => {
      const button = screen.getByRole("button", { name: /分析影响面|分析影響面|Analyze impact/ });
      expect((button as HTMLButtonElement).disabled).toBe(false);
      return button;
    });
    fireEvent.click(analyzeButton);

    await waitFor(() => {
      expect(affectedMock).toHaveBeenCalledWith("project-1", ["src/b.ts"], 2);
      expect(screen.getByText(/1 个变更文件|1 個變更檔案|1 changed files/)).toBeTruthy();
      expect(screen.getByText(/2 个直接涉及的符号|2 個直接涉及的符號|2 directly touched symbols/)).toBeTruthy();
    });
  });

  it("opens the source drawer when a file node is clicked", async () => {
    overviewMock.mockResolvedValue(availableOverview);
    fileGraphMock.mockResolvedValue({
      available: true,
      nodes: [{ path: "src/a.ts", language: "ts" }],
      edges: [],
      truncated: false
    });
    workspaceFileMock.mockResolvedValue({
      projectId: "project-1",
      rootPath: "/tmp/project-1",
      name: "a.ts",
      path: "src/a.ts",
      content: "const a = 1;\n",
      sizeBytes: 13,
      binary: false,
      truncated: false,
      encoding: "utf8",
      updatedAt: "2026-08-23T00:00:00Z"
    });

    const utils = renderPanel();
    await waitFor(() => expect(screen.getByText("620")).toBeTruthy());

    const domNode = await waitFor(() => {
      const element = utils.container.querySelector(".react-flow__node");
      expect(element).toBeTruthy();
      return element!;
    });
    fireEvent.click(domNode);

    // The drawer shows the file breadcrumb from the viewer.
    await waitFor(() => {
      expect(screen.getAllByText("a.ts").length).toBeGreaterThan(0);
    });
    expect(workspaceFileMock).toHaveBeenCalledWith("project-1", "src/a.ts");
  });
});

describe("SymbolSearchBox", () => {
  it("searches with debounce and renders selectable results", async () => {
    const symbols: GraphSymbolRef[] = [
      {
        id: "fn:greet",
        name: "greet",
        qualifiedName: "a.greet",
        kind: "function",
        filePath: "src/a.ts",
        startLine: 5,
        signature: null
      }
    ];
    searchMock.mockResolvedValue({ available: true, symbols });
    const onSelect = vi.fn();

    const utils = render(
      <LanguageProvider>
        <QueryClientProvider client={createQueryClient()}>
          <SymbolSearchBox projectId="project-1" enabled onSelect={onSelect} />
        </QueryClientProvider>
      </LanguageProvider>
    );

    const input = utils.container.querySelector("input") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "greet" } });

    await waitFor(
      () => {
        expect(screen.getByText("greet")).toBeTruthy();
      },
      { timeout: 3000 }
    );
    expect(searchMock).toHaveBeenCalledWith("project-1", { q: "greet", limit: 12 });

    fireEvent.click(screen.getByText("greet"));
    expect(onSelect).toHaveBeenCalledWith(symbols[0]);
  });

  it("renders the empty state for hostile queries without crashing", async () => {
    searchMock.mockResolvedValue({ available: true, symbols: [] });

    const utils = render(
      <LanguageProvider>
        <QueryClientProvider client={createQueryClient()}>
          <SymbolSearchBox projectId="project-1" enabled onSelect={vi.fn()} />
        </QueryClientProvider>
      </LanguageProvider>
    );
    const input = utils.container.querySelector("input") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "' OR 1=1 --" } });

    await waitFor(
      () => {
        expect(screen.getByText(/无匹配符号|無符合符號|No matching symbols/)).toBeTruthy();
      },
      { timeout: 3000 }
    );
  });
});
