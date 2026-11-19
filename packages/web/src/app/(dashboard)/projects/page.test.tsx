// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LanguageProvider } from "@/hooks/use-language";
import ProjectsPage from "./page";

const {
  listProjectsMock,
  collaborationProjectsMock,
  getProjectGitSummariesMock,
  getProjectOverviewMock,
  listSessionsMock,
  listFleetsMock,
  listGoalsMock,
} = vi.hoisted(() => ({
  listProjectsMock: vi.fn(),
  collaborationProjectsMock: vi.fn(),
  getProjectGitSummariesMock: vi.fn(),
  getProjectOverviewMock: vi.fn(),
  listSessionsMock: vi.fn(),
  listFleetsMock: vi.fn(),
  listGoalsMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "user-1", role: "admin" } }),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    listProjects: listProjectsMock,
    getProjectGitSummaries: getProjectGitSummariesMock,
    listSessions: listSessionsMock,
  };
});

vi.mock("@/lib/collaboration-api", () => ({
  collaborationApi: {
    projects: collaborationProjectsMock,
  },
}));

vi.mock("@/lib/platform-actions-api", () => ({
  getProjectOverview: getProjectOverviewMock,
}));

vi.mock("@/lib/fleet-api", () => ({
  listFleets: listFleetsMock,
}));

vi.mock("@/lib/copilot-api", () => ({
  listGoals: listGoalsMock,
}));

vi.mock("@/components/sessions/session-launch-dialog", () => ({
  SessionLaunchDialog: ({ open, projectName }: { open: boolean; projectName?: string }) =>
    open ? <div role="dialog">Launch:{projectName}</div> : null,
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <LanguageProvider>
      <QueryClientProvider client={client}>
        <ProjectsPage />
      </QueryClientProvider>
    </LanguageProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem("forgebadger-language", "en");
  listProjectsMock.mockResolvedValue({
    projects: [
      { id: "p-1", name: "ForgeBadger", path: "/workspace/fb", description: "AI IDE control" },
      { id: "p-2", name: "CleanRepo", path: "/workspace/clean", description: "Utilities" },
    ],
  });
  collaborationProjectsMock.mockResolvedValue({
    projects: [{ id: "p-3", name: "TeamRepo", role: "developer", memberCount: 3 }],
  });
  getProjectGitSummariesMock.mockResolvedValue({
    summaries: {
      "p-1": { isGitRepo: true, branch: "feat/command", changedCount: 4 },
      "p-2": { isGitRepo: true, branch: "main", changedCount: 0 },
    },
  });
  getProjectOverviewMock.mockResolvedValue({
    projects: [
      {
        id: "p-1",
        name: "ForgeBadger",
        counts: { total: 5, todo: 1, in_progress: 1, blocked: 0, ready_for_review: 1, done: 2, cancelled: 0 },
      },
    ],
    observedAt: Date.now(),
  });
  listSessionsMock.mockResolvedValue({
    sessions: [
      { id: "s-1", projectId: "p-1", status: "running", lastActive: "2026-11-18T12:00:00Z" },
    ],
  });
  listFleetsMock.mockResolvedValue({
    fleets: [{ id: "f-1", projectId: "p-1", status: "running" }],
  });
  listGoalsMock.mockResolvedValue({
    goals: [],
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("ProjectsPage", () => {
  it("loads projects with batch summaries and filters by search, dirty git, and shared role", async () => {
    renderPage();

    await screen.findByText("ForgeBadger");
    expect(screen.getByText("CleanRepo")).toBeTruthy();
    expect(screen.getByText("TeamRepo")).toBeTruthy();
    expect(screen.getByText(/feat\/command/)).toBeTruthy();
    expect(screen.getByText("2/5")).toBeTruthy();
    expect(screen.getByText("Fleet ×1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Uncommitted" }));
    expect(screen.getByText("ForgeBadger")).toBeTruthy();
    expect(screen.queryByText("CleanRepo")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Shared" }));
    expect(screen.getByText("TeamRepo")).toBeTruthy();
    expect(screen.queryByText("ForgeBadger")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    fireEvent.change(screen.getByPlaceholderText(/Search project/), {
      target: { value: "utilities" },
    });
    expect(screen.getByText("CleanRepo")).toBeTruthy();
    expect(screen.queryByText("ForgeBadger")).toBeNull();
  });

  it("opens the quick session launch dialog for an owned project", async () => {
    renderPage();
    await screen.findByText("ForgeBadger");

    const launchButtons = screen.getAllByRole("button", { name: "Quick session" });
    fireEvent.click(launchButtons[0]!);
    await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("Launch:ForgeBadger"));
  });
});
