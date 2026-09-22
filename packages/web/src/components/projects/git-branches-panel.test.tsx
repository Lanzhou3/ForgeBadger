// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LanguageProvider } from "@/hooks/use-language";
import { GitBranchesPanel } from "./git-branches-panel";
import type { ProjectGitBranches } from "@/lib/api";

const { getProjectGitBranchesMock, checkoutProjectGitBranchMock, toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  getProjectGitBranchesMock: vi.fn(),
  checkoutProjectGitBranchMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getProjectGitBranches: getProjectGitBranchesMock,
    checkoutProjectGitBranch: checkoutProjectGitBranchMock,
  };
});

vi.mock("@/lib/toast", () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

function branchesFixture(overrides: Partial<ProjectGitBranches> = {}): ProjectGitBranches {
  return {
    isGitRepo: true,
    current: "main",
    branches: [
      { name: "feature-x", isCurrent: false },
      { name: "main", isCurrent: true },
    ],
    workingTree: { clean: true, changedCount: 0, sample: [] },
    ...overrides,
  };
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <GitBranchesPanel projectId="project-1" enabled />
      </QueryClientProvider>
    </LanguageProvider>
  );
}

describe("GitBranchesPanel", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    getProjectGitBranchesMock.mockResolvedValue(branchesFixture());
  });

  it("renders the branch list with the current branch marked", async () => {
    renderPanel();

    await waitFor(() => expect(screen.getByText("feature-x")).toBeTruthy());
    // "main" appears both in the header pill and in the branch list row.
    const mainElements = screen.getAllByText("main");
    expect(mainElements.length).toBeGreaterThanOrEqual(2);
    const currentButton = mainElements
      .map((element) => element.closest("button"))
      .find(Boolean) as HTMLButtonElement | undefined;
    expect(currentButton?.disabled).toBe(true);
  });

  it("switches branches after confirmation and invalidates queries", async () => {
    checkoutProjectGitBranchMock.mockResolvedValue({ current: "feature-x", created: false });
    renderPanel();

    await waitFor(() => expect(screen.getByText("feature-x")).toBeTruthy());
    fireEvent.click(screen.getByText("feature-x"));

    const confirmButtons = await screen.findAllByRole("button", { name: /切换分支|Switch branch/ });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    await waitFor(() => expect(checkoutProjectGitBranchMock).toHaveBeenCalledWith("project-1", { branch: "feature-x" }));
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalled());
  });

  it("blocks switching when the working tree is dirty", async () => {
    getProjectGitBranchesMock.mockResolvedValue(
      branchesFixture({
        workingTree: { clean: false, changedCount: 2, sample: ["tracked.ts", "untracked.md"] },
      })
    );
    renderPanel();

    await waitFor(() => expect(screen.getByText("feature-x")).toBeTruthy());
    fireEvent.click(screen.getByText("feature-x"));

    await waitFor(() => expect(screen.getByText("untracked.md")).toBeTruthy());
    const confirmButtons = screen.getAllByRole("button", { name: /切换分支|Switch branch/ });
    const confirmButton = confirmButtons[confirmButtons.length - 1]! as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);
    expect(checkoutProjectGitBranchMock).not.toHaveBeenCalled();
  });

  it("surfaces checkout failures as an error toast", async () => {
    checkoutProjectGitBranchMock.mockRejectedValue(new Error("Working tree has 2 uncommitted change(s)"));
    renderPanel();

    await waitFor(() => expect(screen.getByText("feature-x")).toBeTruthy());
    fireEvent.click(screen.getByText("feature-x"));
    const confirmButtons = await screen.findAllByRole("button", { name: /切换分支|Switch branch/ });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("Working tree has 2 uncommitted change(s)"));
  });

  it("creates a new branch from the dialog", async () => {
    checkoutProjectGitBranchMock.mockResolvedValue({ current: "feature-new", created: true });
    renderPanel();

    await waitFor(() => expect(screen.getByText("feature-x")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /新建分支|New branch/ }));
    fireEvent.change(screen.getByPlaceholderText(/feature\/login/), { target: { value: "feature-new" } });
    const createButtons = screen.getAllByRole("button", { name: /新建分支|New branch/ });
    fireEvent.click(createButtons[createButtons.length - 1]!);

    await waitFor(() =>
      expect(checkoutProjectGitBranchMock).toHaveBeenCalledWith("project-1", { branch: "feature-new", create: true })
    );
  });
});
