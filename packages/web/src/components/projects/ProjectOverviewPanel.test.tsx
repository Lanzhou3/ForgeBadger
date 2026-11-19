// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LanguageProvider } from "@/hooks/use-language";
import { ProjectOverviewPanel } from "./ProjectOverviewPanel";

const {
  getProjectManagerGoalMock,
  listProjectManagerWorkItemsMock,
  getProjectGitChangesMock,
  getProjectGraphOverviewMock,
  getProjectWorkspaceTreeMock,
  listGoalsMock,
  listFleetsMock,
} = vi.hoisted(() => ({
  getProjectManagerGoalMock: vi.fn(),
  listProjectManagerWorkItemsMock: vi.fn(),
  getProjectGitChangesMock: vi.fn(),
  getProjectGraphOverviewMock: vi.fn(),
  getProjectWorkspaceTreeMock: vi.fn(),
  listGoalsMock: vi.fn(),
  listFleetsMock: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getProjectManagerGoal: getProjectManagerGoalMock,
    listProjectManagerWorkItems: listProjectManagerWorkItemsMock,
    getProjectGitChanges: getProjectGitChangesMock,
    getProjectGraphOverview: getProjectGraphOverviewMock,
    getProjectWorkspaceTree: getProjectWorkspaceTreeMock,
  };
});

vi.mock("@/lib/copilot-api", () => ({
  listGoals: listGoalsMock,
}));

vi.mock("@/lib/fleet-api", () => ({
  listFleets: listFleetsMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem("forgebadger-language", "en");
  getProjectManagerGoalMock.mockResolvedValue({
    goal: {
      id: "g-1",
      projectId: "proj-1",
      summary: "Ship vibe coding command center",
      constraints: ["Keep Gateway single truth"],
      acceptanceCriteria: ["Typecheck passes"],
      status: "active",
      createdAt: 1,
      updatedAt: 2,
    },
  });
  listProjectManagerWorkItemsMock.mockResolvedValue({
    workItems: [
      {
        id: "w-1",
        projectId: "proj-1",
        title: "Task 1",
        description: null,
        status: "done",
        priority: 5,
        acceptanceCriteria: [],
        evidenceRefCount: 0,
        evidenceRefs: [],
        stageId: null,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "w-2",
        projectId: "proj-1",
        title: "Task 2",
        description: null,
        status: "in_progress",
        priority: 7,
        acceptanceCriteria: [],
        evidenceRefCount: 0,
        evidenceRefs: [],
        stageId: null,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  });
  getProjectGitChangesMock.mockResolvedValue({
    isGitRepo: true,
    branch: "feat/command-center",
    changed: [{ path: "src/app.ts", status: " M", staged: false }],
    commits: [],
  });
  getProjectGraphOverviewMock.mockResolvedValue({
    available: true,
    indexState: "complete",
    indexedAt: Date.now(),
    files: { total: 10, byLanguage: [] },
    nodes: { total: 50, byKind: [] },
    edges: { total: 80, byKind: [] },
  });
  getProjectWorkspaceTreeMock.mockResolvedValue({
    projectId: "proj-1",
    rootPath: "/workspace/fb",
    path: "",
    truncated: false,
    entries: [{ name: "AGENTS.md", path: "AGENTS.md", kind: "file" }],
  });
  listGoalsMock.mockResolvedValue({
    goals: [
      {
        id: "cg-1",
        projectId: "proj-1",
        title: "Autonomous Refactor",
        status: "active",
        conversationId: "c-1",
        grants: [],
        createdAt: 1,
        taskTotal: 3,
        taskPasses: 1,
      },
    ],
  });
  listFleetsMock.mockResolvedValue({
    fleets: [
      {
        id: "fl-1",
        projectId: "proj-1",
        projectName: "FB",
        title: "Multi-CLI Fleet",
        status: "running",
        pausedReason: null,
        taskTotal: 4,
        taskDone: 2,
        taskHeld: 0,
        taskRunning: 2,
        updatedAt: 1,
      },
    ],
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("ProjectOverviewPanel", () => {
  it("renders command center sections, live sessions, rule file chips, and triggers unified navigation", async () => {
    const onNavigate = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <LanguageProvider>
        <QueryClientProvider client={client}>
          <ProjectOverviewPanel
            project={{
              id: "proj-1",
              name: "ForgeBadger",
              path: "/workspace/fb",
              description: "Control plane",
            }}
            sessions={[
              {
                id: "sess-1",
                name: "claude-main",
                aiTool: "claude",
                status: "running",
                lastPrompt: "Implement overview",
              },
            ]}
            taskPackets={[
              {
                id: "w-2:task-packet",
                projectId: "proj-1",
                workItemId: "w-2",
                workItemStatus: "in_progress",
                queueStatus: "running",
                title: "Task 2",
                updatedAt: 1,
                prompt: "",
                acceptanceCriteria: [],
                expectedVerification: [],
                evidenceRequirements: [],
                runtime: { adapter: "claude", templateId: "" },
                sessionLink: {
                  sessionId: "sess-1",
                  status: "running",
                  aiTool: "claude",
                  href: "/sessions/sess-1",
                },
                blockedReason: null,
              },
            ]}
            templateName="Claude Standard"
            appliedProviderLabel="Anthropic · claude-3.7"
            onNavigate={onNavigate}
            onEditMetadata={vi.fn()}
          />
        </QueryClientProvider>
      </LanguageProvider>,
    );

    await screen.findByText("Ship vibe coding command center");
    expect(screen.getByText("claude-main")).toBeTruthy();
    expect(screen.getByText("Implement overview")).toBeTruthy();
    expect(screen.getByText("Multi-CLI Fleet")).toBeTruthy();
    expect(screen.getByText("Autonomous Refactor")).toBeTruthy();
    expect(screen.getByText(/feat\/command-center/)).toBeTruthy();
    expect(screen.getByText("Anthropic · claude-3.7")).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: "AGENTS.md" }));
    expect(onNavigate).toHaveBeenCalledWith({ tab: "code", view: "files", file: "AGENTS.md" });

    fireEvent.click(screen.getByRole("button", { name: /feat\/command-center/ }));
    expect(onNavigate).toHaveBeenCalledWith({ tab: "code", view: "git" });

    fireEvent.click(screen.getByRole("button", { name: /CodeGraph index ready/ }));
    expect(onNavigate).toHaveBeenCalledWith({ tab: "code", view: "graph" });

    fireEvent.click(screen.getByRole("button", { name: /Open task board/ }));
    expect(onNavigate).toHaveBeenCalledWith({ tab: "project-manager" });

    fireEvent.click(screen.getByRole("button", { name: "Task 2" }));
    expect(onNavigate).toHaveBeenCalledWith({ tab: "project-manager", workItemId: "w-2" });
  });
});
