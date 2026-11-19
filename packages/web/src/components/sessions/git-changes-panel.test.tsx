// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GitChangesPanel } from "./git-changes-panel";
import {
  commitProjectGitChanges,
  discardProjectGitFile,
  getProjectGitChanges,
  getProjectGitFileDiff,
  stageProjectGitFiles,
  unstageProjectGitFiles,
  type ProjectGitChanges,
} from "@/lib/api";
import { LanguageProvider } from "@/hooks/use-language";

vi.mock("@/lib/api", () => ({
  getProjectGitChanges: vi.fn(),
  getProjectGitFileDiff: vi.fn(),
  stageProjectGitFiles: vi.fn(),
  unstageProjectGitFiles: vi.fn(),
  commitProjectGitChanges: vi.fn(),
  discardProjectGitFile: vi.fn(),
}));

const clients: QueryClient[] = [];

function changes(count: number): ProjectGitChanges {
  return {
    isGitRepo: true,
    branch: "main",
    changed: Array.from({ length: count }, (_, index) => ({
      path: `src/file-${String(index).padStart(3, "0")}.ts`,
      status: " M",
      staged: false,
    })),
    commits: [],
  };
}

function renderPanel(projectId = "project-one") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const panel = (id: string) => (
    <QueryClientProvider client={client}>
      <LanguageProvider>
        <GitChangesPanel projectId={id} />
      </LanguageProvider>
    </QueryClientProvider>
  );
  const result = render(panel(projectId));
  return { client, rerenderProject: (id: string) => result.rerender(panel(id)) };
}

function fileButtons() {
  return within(screen.getByRole("list")).getAllByTestId("git-change-file-button");
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem("forgebadger-language", "en");
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  localStorage.clear();
});

describe("GitChangesPanel", () => {
  it("shows the true total and allows browsing every file beyond 200 with bounded pages", async () => {
    vi.mocked(getProjectGitChanges).mockResolvedValue(changes(251));
    renderPanel();

    await screen.findByText("(251)");
    expect(fileButtons()).toHaveLength(100);
    expect(screen.getByText("Showing 1–100 of 251")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Previous page" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    // Directory and file name are separate spans so the name never truncates.
    expect(screen.getByRole("button", { name: /src\/file\-100\.ts/ })).toBeTruthy();
    expect(screen.getByText("Showing 101–200 of 251")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(fileButtons()).toHaveLength(51);
    // Directory and file name are separate spans so the name never truncates.
    expect(screen.getByRole("button", { name: /src\/file\-250\.ts/ })).toBeTruthy();
    expect(screen.getByText("Showing 201–251 of 251")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next page" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    // Directory and file name are separate spans so the name never truncates.
    expect(screen.getByRole("button", { name: /src\/file\-100\.ts/ })).toBeTruthy();
  });

  it("filters the full list by path, resets pagination and distinguishes no matches from a clean tree", async () => {
    vi.mocked(getProjectGitChanges).mockResolvedValue(changes(251));
    renderPanel();
    await screen.findByText("(251)");
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Filter files by path" }), {
      target: { value: "FILE-250" },
    });
    expect(fileButtons()).toHaveLength(1);
    // Directory and file name are separate spans so the name never truncates.
    expect(screen.getByRole("button", { name: /src\/file\-250\.ts/ })).toBeTruthy();
    expect(screen.getByText("(251)")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "no-such-file" } });
    expect(screen.getByText("No files match this filter")).toBeTruthy();
    expect(screen.queryByText("Working tree clean, nothing to commit")).toBeNull();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    // Directory and file name are separate spans so the name never truncates.
    expect(screen.getByRole("button", { name: /src\/file\-000\.ts/ })).toBeTruthy();
  });

  it("opens a file diff from beyond the former 200-file limit", async () => {
    vi.mocked(getProjectGitChanges).mockResolvedValue(changes(251));
    vi.mocked(getProjectGitFileDiff).mockResolvedValue({
      path: "src/file-250.ts", kind: "diff", diff: "@@ -12,1 +12,1 @@\n-before\n+after", truncated: false,
    });
    renderPanel();
    await screen.findByText("(251)");
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    fireEvent.click(screen.getByRole("button", { name: /src\/file\-250\.ts/ }));

    const dialog = screen.getByRole("dialog");
    await within(dialog).findByText("+after");
    expect(within(dialog).getByText("@@ -12,1 +12,1 @@")).toBeTruthy();
    expect(within(dialog).getAllByText("12").length).toBeGreaterThanOrEqual(2);
    expect(getProjectGitFileDiff).toHaveBeenCalledWith("project-one", "src/file-250.ts", { untracked: false });
  });

  it("clamps the page after a refresh removes files and resets when switching projects", async () => {
    vi.mocked(getProjectGitChanges).mockResolvedValue(changes(251));
    const { client, rerenderProject } = renderPanel();
    await screen.findByText("(251)");
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await act(async () => {
      client.setQueryData(["project-git-changes", "project-one"], changes(150));
    });
    await screen.findByText("Showing 101–150 of 150");
    expect(fileButtons()).toHaveLength(50);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "file-149" } });
    rerenderProject("project-two");
    await screen.findByText("(251)");
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    expect(screen.getByText("Showing 1–100 of 251")).toBeTruthy();
  });

  it("does not report a clean tree while loading or after a failed read", async () => {
    let rejectRequest: (reason: Error) => void = () => {};
    vi.mocked(getProjectGitChanges).mockReturnValue(new Promise((_resolve, reject) => {
      rejectRequest = reject;
    }));
    renderPanel();
    expect(screen.queryByText("Working tree clean, nothing to commit")).toBeNull();
    await act(async () => rejectRequest(new Error("git failed")));
    await waitFor(() => expect(screen.getByText("Failed to load git info")).toBeTruthy());
    expect(screen.queryByText("Working tree clean, nothing to commit")).toBeNull();
  });

  it("stages files, submits commits, and discards changes after confirmation", async () => {
    vi.mocked(getProjectGitChanges).mockResolvedValue({
      isGitRepo: true,
      branch: "feat/vibe",
      changed: [
        { path: "src/unstaged.ts", status: " M", staged: false },
        { path: "src/staged.ts", status: "M ", staged: true },
      ],
      commits: [],
    });
    vi.mocked(stageProjectGitFiles).mockResolvedValue({
      git: {
        isGitRepo: true,
        branch: "feat/vibe",
        changed: [
          { path: "src/unstaged.ts", status: "M ", staged: true },
          { path: "src/staged.ts", status: "M ", staged: true },
        ],
        commits: [],
      },
    });
    vi.mocked(commitProjectGitChanges).mockResolvedValue({
      hash: "abc1234",
      branch: "feat/vibe",
      git: { isGitRepo: true, branch: "feat/vibe", changed: [], commits: [] },
    });
    vi.mocked(discardProjectGitFile).mockResolvedValue({
      git: {
        isGitRepo: true,
        branch: "feat/vibe",
        changed: [{ path: "src/staged.ts", status: "M ", staged: true }],
        commits: [],
      },
    });

    renderPanel();
    await screen.findByText("feat/vibe");

    fireEvent.click(screen.getByRole("checkbox", { name: "Stage: src/unstaged.ts" }));
    await waitFor(() =>
      expect(stageProjectGitFiles).toHaveBeenCalledWith("project-one", {
        paths: ["src/unstaged.ts"],
      }),
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Discard" })[0]!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Discard" }));
    await waitFor(() =>
      expect(discardProjectGitFile).toHaveBeenCalledWith("project-one", "src/unstaged.ts", {
        untracked: false,
      }),
    );

    const commitInput = screen.getByPlaceholderText(/Commit message/);
    fireEvent.change(commitInput, { target: { value: "feat: commit staged work" } });
    fireEvent.submit(commitInput.closest("form")!);
    await waitFor(() =>
      expect(commitProjectGitChanges).toHaveBeenCalledWith("project-one", "feat: commit staged work"),
    );
  });

  it("keeps Stage All enabled for partially staged (MM) files", async () => {
    vi.mocked(getProjectGitChanges).mockResolvedValue({
      isGitRepo: true,
      branch: "feat/vibe",
      changed: [{ path: "src/partial.ts", status: "MM", staged: true }],
      commits: [],
    });

    renderPanel();
    await screen.findByText("feat/vibe");
    const stageAll = screen.getByRole("button", { name: "Stage all" }) as HTMLButtonElement;
    expect(stageAll.disabled).toBe(false);
  });
});
