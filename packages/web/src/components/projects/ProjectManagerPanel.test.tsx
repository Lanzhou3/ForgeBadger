// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import { ProjectManagerPanel } from "./ProjectManagerPanel";

const {
  getProjectManagerGoalMock,
  discoverAdaptersMock,
  listProjectManagerWorkItemsMock,
  listProjectManagerTaskPacketsMock,
  listProjectManagerStagesMock,
  listProjectManagerWorkItemLinksMock,
  listProjectManagerLedgerMock,
  getProjectManagerTaskPacketMock,
  listSessionsMock,
  seedProjectManagerStageTemplateMock,
  startProjectManagerTaskPacketMock,
  updateProjectManagerWorkItemMock,
  addProjectManagerWorkItemDependencyMock,
  removeProjectManagerWorkItemDependencyMock,
} = vi.hoisted(() => ({
  getProjectManagerGoalMock: vi.fn(),
  discoverAdaptersMock: vi.fn(),
  listProjectManagerWorkItemsMock: vi.fn(),
  listProjectManagerTaskPacketsMock: vi.fn(),
  listProjectManagerStagesMock: vi.fn(),
  listProjectManagerWorkItemLinksMock: vi.fn(),
  listProjectManagerLedgerMock: vi.fn(),
  getProjectManagerTaskPacketMock: vi.fn(),
  listSessionsMock: vi.fn(),
  seedProjectManagerStageTemplateMock: vi.fn(),
  startProjectManagerTaskPacketMock: vi.fn(),
  updateProjectManagerWorkItemMock: vi.fn(),
  addProjectManagerWorkItemDependencyMock: vi.fn(),
  removeProjectManagerWorkItemDependencyMock: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getProjectManagerGoal: getProjectManagerGoalMock,
    discoverAdapters: discoverAdaptersMock,
    listProjectManagerWorkItems: listProjectManagerWorkItemsMock,
    listProjectManagerTaskPackets: listProjectManagerTaskPacketsMock,
    listProjectManagerStages: listProjectManagerStagesMock,
    listProjectManagerWorkItemLinks: listProjectManagerWorkItemLinksMock,
    listProjectManagerLedger: listProjectManagerLedgerMock,
    getProjectManagerTaskPacket: getProjectManagerTaskPacketMock,
    listSessions: listSessionsMock,
    seedProjectManagerStageTemplate: seedProjectManagerStageTemplateMock,
    startProjectManagerTaskPacket: startProjectManagerTaskPacketMock,
    updateProjectManagerWorkItem: updateProjectManagerWorkItemMock,
    addProjectManagerWorkItemDependency: addProjectManagerWorkItemDependencyMock,
    removeProjectManagerWorkItemDependency: removeProjectManagerWorkItemDependencyMock,
  };
});

const stages = [
  {
    id: "stage-1",
    projectId: "project-1",
    name: "编码实现",
    description: null,
    position: 0,
    status: "active",
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: "stage-2",
    projectId: "project-1",
    name: "测试验证",
    description: null,
    position: 1,
    status: "completed",
    createdAt: 2,
    updatedAt: 2,
  },
];

const workItems = [
  {
    id: "item-1",
    projectId: "project-1",
    title: "实现登录",
    description: null,
    status: "in_progress",
    priority: 0,
    acceptanceCriteria: [],
    evidenceRefCount: 0,
    evidenceRefs: [],
    feishuRefCount: 0,
    stageId: "stage-1",
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: "item-2",
    projectId: "project-1",
    title: "整理需求",
    description: null,
    status: "todo",
    priority: 0,
    acceptanceCriteria: [],
    evidenceRefCount: 0,
    evidenceRefs: [],
    feishuRefCount: 0,
    stageId: null,
    createdAt: 2,
    updatedAt: 2,
  },
];

const links = [
  {
    id: "link-1",
    projectId: "project-1",
    blockerWorkItemId: "item-2",
    blockedWorkItemId: "item-1",
    createdAt: 3,
  },
];

const taskPackets = [
  {
    id: "item-1:task-packet",
    projectId: "project-1",
    workItemId: "item-1",
    workItemStatus: "in_progress",
    queueStatus: "running",
    title: "实现登录",
    updatedAt: 1,
    prompt: "Task: 实现登录",
    acceptanceCriteria: [],
    expectedVerification: [],
    evidenceRequirements: [],
    runtime: { adapter: "claude", templateId: null },
    sessionLink: { sessionId: "session-1", status: "running", aiTool: "claude", href: "/sessions/session-1" },
    blockedReason: null,
  },
  {
    id: "item-2:task-packet",
    projectId: "project-1",
    workItemId: "item-2",
    workItemStatus: "todo",
    queueStatus: "planned",
    title: "整理需求",
    updatedAt: 2,
    prompt: "Task: 整理需求",
    acceptanceCriteria: [],
    expectedVerification: [],
    evidenceRequirements: [],
    runtime: { adapter: "claude", templateId: null },
    sessionLink: null,
    blockedReason: "no_linked_session",
  },
];

const adapters = [
  {
    id: "claude",
    label: "Claude Code",
    command: "claude",
    supportLevel: "supported",
    launchEnabled: true,
    configDir: ".claude",
    runtimeModes: ["terminal"],
    available: true,
    status: "available",
    version: "1.2.0",
  },
  {
    id: "opencode",
    label: "OpenCode",
    command: "opencode",
    supportLevel: "supported",
    launchEnabled: false,
    configDir: ".opencode",
    runtimeModes: ["terminal"],
    available: true,
    status: "available",
  },
];

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPanel() {
  return render(
    <LanguageProvider>
      <QueryClientProvider client={createQueryClient()}>
        <ProjectManagerPanel projectId="project-1" enabled />
      </QueryClientProvider>
    </LanguageProvider>
  );
}

describe("ProjectManagerPanel stages and dependencies", () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
    getProjectManagerGoalMock.mockResolvedValue({ goal: null });
    discoverAdaptersMock.mockResolvedValue({ adapters });
    listProjectManagerWorkItemsMock.mockResolvedValue({ workItems });
    listProjectManagerTaskPacketsMock.mockResolvedValue({ taskPackets });
    listProjectManagerStagesMock.mockResolvedValue({ stages });
    listProjectManagerWorkItemLinksMock.mockResolvedValue({ links });
    listProjectManagerLedgerMock.mockResolvedValue({ events: [] });
    getProjectManagerTaskPacketMock.mockResolvedValue({ taskPacket: taskPackets[0] });
    listSessionsMock.mockResolvedValue({ sessions: [] });
    updateProjectManagerWorkItemMock.mockResolvedValue({ workItem: workItems[0] });
    removeProjectManagerWorkItemDependencyMock.mockResolvedValue({});
    addProjectManagerWorkItemDependencyMock.mockResolvedValue({ link: links[0] });
    seedProjectManagerStageTemplateMock.mockResolvedValue({ stages });
    startProjectManagerTaskPacketMock.mockResolvedValue({
      taskPacket: {
        ...taskPackets[1],
        sessionLink: { sessionId: "session-2", status: "idle", aiTool: "claude", href: "/sessions/session-2" },
        blockedReason: null,
      },
      session: {
        id: "session-2",
        status: "idle",
        name: "Task: 整理需求",
        projectId: "project-1",
        projectName: "project-1",
        aiTool: "claude",
      },
    });
  });

  it("groups work items into stage lanes with dependency badges and session chips", async () => {
    renderPanel();

    const stageLane = await screen.findByTestId("project-manager-stage-lane-stage-1");
    expect(stageLane.textContent).toContain("实现登录");
    expect(stageLane.textContent).toContain("阻塞于: 1");

    const backlogLane = screen.getByTestId("project-manager-stage-lane-backlog");
    expect(backlogLane.textContent).toContain("整理需求");
    expect(backlogLane.textContent).toContain("阻塞了: 1");

    const sessionChip = stageLane.querySelector("a[href='/sessions/session-1']");
    expect(sessionChip).not.toBeNull();
  });

  it("moves a work item to another stage from the lane card", async () => {
    renderPanel();

    const stageLane = await screen.findByTestId("project-manager-stage-lane-stage-1");
    const select = stageLane.querySelector("select");
    expect(select).not.toBeNull();
    fireEvent.change(select as HTMLSelectElement, { target: { value: "stage-2" } });

    await waitFor(() => {
      expect(updateProjectManagerWorkItemMock).toHaveBeenCalledWith("project-1", "item-1", { stageId: "stage-2" });
    });
  });

  it("shows stage and dependency management in the work item detail sheet", async () => {
    renderPanel();

    const stageLane = await screen.findByTestId("project-manager-stage-lane-stage-1");
    fireEvent.click(within(stageLane as HTMLElement).getByText("实现登录"));
    expect(stageLane.textContent).toContain("实现登录");

    const dependencies = await screen.findByText("依赖关系");
    expect(dependencies).not.toBeNull();

    const fieldset = dependencies.closest("fieldset");
    expect(fieldset?.textContent).toContain("整理需求");

    const removeButton = fieldset?.querySelector("button[aria-label='删除']");
    expect(removeButton).not.toBeNull();
    fireEvent.click(removeButton as HTMLButtonElement);
    await waitFor(() => {
      expect(removeProjectManagerWorkItemDependencyMock).toHaveBeenCalledWith("project-1", "item-1", "item-2");
    });
  });

  it("offers the SDLC template seed when no stages exist", async () => {
    listProjectManagerStagesMock.mockResolvedValue({ stages: [] });
    renderPanel();

    const seedButton = await screen.findByText("使用 SDLC 模板");
    fireEvent.click(seedButton);

    await waitFor(() => {
      expect(seedProjectManagerStageTemplateMock).toHaveBeenCalledWith("project-1");
    });
  });

  it("creates a CLI session directly from a todo work item board card after choosing the CLI", async () => {
    renderPanel();

    const todoCard = await screen.findByTestId("project-manager-board-card-item-2");
    fireEvent.click(within(todoCard).getByText("创建会话"));

    expect(await screen.findByText("选择 Code CLI")).not.toBeNull();
    const claudeOption = await screen.findByTestId("quick-start-cli-option-claude");
    expect((claudeOption.querySelector("input") as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByTestId("quick-start-cli-option-opencode")).toBeNull();

    const confirmButton = screen.getByRole("button", { name: "创建任务会话" }) as HTMLButtonElement;
    await waitFor(() => expect(confirmButton.disabled).toBe(false));
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(startProjectManagerTaskPacketMock).toHaveBeenCalledWith("project-1", "item-2", { aiTool: "claude" });
    });
  });

  it("links to the running session instead of offering creation when one is linked", async () => {
    renderPanel();

    const runningCard = await screen.findByTestId("project-manager-board-card-item-1");
    expect(within(runningCard).getByText("打开关联会话")).not.toBeNull();
    expect(within(runningCard).queryByText("创建会话")).toBeNull();
  });
});
