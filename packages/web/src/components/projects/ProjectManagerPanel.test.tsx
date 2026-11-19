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
  startProjectManagerTaskPacketMock,
  createProjectManagerWorkItemMock,
  updateProjectManagerWorkItemMock,
  updateProjectManagerWorkItemStatusMock,
  listGoalsMock,
  getGoalMock,
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
  startProjectManagerTaskPacketMock: vi.fn(),
  createProjectManagerWorkItemMock: vi.fn(),
  updateProjectManagerWorkItemMock: vi.fn(),
  updateProjectManagerWorkItemStatusMock: vi.fn(),
  listGoalsMock: vi.fn(),
  getGoalMock: vi.fn(),
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
    startProjectManagerTaskPacket: startProjectManagerTaskPacketMock,
    createProjectManagerWorkItem: createProjectManagerWorkItemMock,
    updateProjectManagerWorkItem: updateProjectManagerWorkItemMock,
    updateProjectManagerWorkItemStatus: updateProjectManagerWorkItemStatusMock,
  };
});

vi.mock("@/lib/copilot-api", () => ({
  listGoals: listGoalsMock,
  getGoal: getGoalMock,
}));

vi.mock("@/components/workspaces/TaskExecutionPanel", () => ({
  TaskExecutionPanel: () => <div data-testid="task-execution-panel-stub" />,
}));

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
];

const workItems = [
  {
    id: "item-1",
    revision: 3,
    projectId: "project-1",
    title: "实现登录",
    description: null,
    status: "in_progress" as const,
    priority: 0,
    acceptanceCriteria: [],
    evidenceRefCount: 0,
    evidenceRefs: [],
    stageId: "stage-1",
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: "item-2",
    revision: 1,
    projectId: "project-1",
    title: "整理需求",
    description: null,
    status: "todo" as const,
    priority: 0,
    acceptanceCriteria: [],
    evidenceRefCount: 0,
    evidenceRefs: [],
    stageId: null,
    createdAt: 2,
    updatedAt: 2,
  },
  {
    id: "item-3",
    revision: 2,
    projectId: "project-1",
    title: "已完成基础脚手架",
    description: null,
    status: "done" as const,
    priority: 0,
    acceptanceCriteria: [],
    evidenceRefCount: 1,
    evidenceRefs: [{ kind: "test", ref: "scaffold.test.ts" }],
    stageId: null,
    createdAt: 0,
    updatedAt: 0,
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
    workItemStatus: "in_progress" as const,
    queueStatus: "running" as const,
    title: "实现登录",
    updatedAt: 1,
    prompt: "Task: 实现登录",
    acceptanceCriteria: [],
    expectedVerification: [],
    evidenceRequirements: [],
    runtime: { adapter: "claude", templateId: null },
    sessionLink: {
      sessionId: "session-1",
      status: "running",
      aiTool: "claude",
      href: "/sessions/session-1",
    },
    blockedReason: null,
  },
  {
    id: "item-2:task-packet",
    projectId: "project-1",
    workItemId: "item-2",
    workItemStatus: "todo" as const,
    queueStatus: "planned" as const,
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

function renderPanel(options: { embedded?: boolean } = {}) {
  return render(
    <LanguageProvider>
      <QueryClientProvider client={createQueryClient()}>
        <ProjectManagerPanel
          projectId="project-1"
          enabled
          authority={{ canEdit: true, canManage: true, legacySessions: true }}
          embedded={options.embedded}
        />
      </QueryClientProvider>
    </LanguageProvider>,
  );
}

describe("ProjectManagerPanel Copilot-first supervision view", () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
    getProjectManagerGoalMock.mockResolvedValue({
      goal: {
        id: "g-1",
        projectId: "project-1",
        summary: "交付轻量化任务监工流",
        constraints: [],
        acceptanceCriteria: [],
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      },
    });
    discoverAdaptersMock.mockResolvedValue({ adapters });
    listProjectManagerWorkItemsMock.mockResolvedValue({ workItems });
    listProjectManagerTaskPacketsMock.mockResolvedValue({ taskPackets });
    listProjectManagerStagesMock.mockResolvedValue({ stages });
    listProjectManagerWorkItemLinksMock.mockResolvedValue({ links });
    listProjectManagerLedgerMock.mockResolvedValue({ events: [] });
    getProjectManagerTaskPacketMock.mockResolvedValue({ taskPacket: taskPackets[0] });
    listSessionsMock.mockResolvedValue({ sessions: [] });
    listGoalsMock.mockResolvedValue({ goals: [] });
    getGoalMock.mockResolvedValue({ goal: null, tasks: [] });
    updateProjectManagerWorkItemMock.mockResolvedValue({ workItem: workItems[0] });
    updateProjectManagerWorkItemStatusMock.mockResolvedValue({
      workItem: { ...workItems[0], status: "done" },
    });
    createProjectManagerWorkItemMock.mockResolvedValue({
      workItem: {
        ...workItems[1],
        id: "item-4",
        title: "补充单行速记任务",
      },
    });
    startProjectManagerTaskPacketMock.mockResolvedValue({
      taskPacket: {
        ...taskPackets[1],
        sessionLink: {
          sessionId: "session-2",
          status: "idle",
          aiTool: "claude",
          href: "/sessions/session-2",
        },
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

  it("renders status-grouped tasks with stage/blocker badges, collapses done items in active view, and supports quick-add", async () => {
    renderPanel();

    expect(await screen.findByText("交付轻量化任务监工流")).toBeTruthy();

    const row1 = await screen.findByTestId("project-manager-item-item-1");
    expect(row1.textContent).toContain("实现登录");
    expect(row1.textContent).toContain("编码实现");
    expect(row1.textContent).toContain("被 1 项阻塞");

    // Done item is collapsed by default in active view until expanded.
    expect(screen.queryByTestId("project-manager-item-item-3")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /已完成与取消 \(1\)/ }));
    expect(await screen.findByTestId("project-manager-item-item-3")).toBeTruthy();

    // 1-line quick-add creates a task with title only.
    fireEvent.change(
      screen.getByPlaceholderText("记一条需求或任务，回车添加（或交由 Copilot 拆解）…"),
      {
        target: { value: "补充单行速记任务" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "添加" }));

    await waitFor(() => {
      expect(createProjectManagerWorkItemMock).toHaveBeenCalledWith("project-1", {
        title: "补充单行速记任务",
      });
    });
  });

  it("starts a CLI session directly from a todo item after selecting a launchable CLI", async () => {
    renderPanel();

    const todoRow = await screen.findByTestId("project-manager-item-item-2");
    fireEvent.click(within(todoRow).getByRole("button", { name: "启动 CLI" }));

    expect(await screen.findByText("选择 Code CLI")).toBeTruthy();
    const claudeOption = await screen.findByTestId("quick-start-cli-option-claude");
    expect((claudeOption.querySelector("input") as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByTestId("quick-start-cli-option-opencode")).toBeNull();

    const confirmButton = screen.getByRole("button", {
      name: "创建任务会话",
    }) as HTMLButtonElement;
    await waitFor(() => expect(confirmButton.disabled).toBe(false));
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(startProjectManagerTaskPacketMock).toHaveBeenCalledWith("project-1", "item-2", {
        aiTool: "claude",
      });
    });
  });

  it("links to the running session instead of offering CLI start and allows 1-click done on personal projects", async () => {
    renderPanel();

    const runningRow = await screen.findByTestId("project-manager-item-item-1");
    expect(within(runningRow).getByText("进入终端")).toBeTruthy();
    expect(within(runningRow).queryByText("启动 CLI")).toBeNull();

    fireEvent.click(within(runningRow).getByRole("button", { name: "标记通过" }));
    await waitFor(() => {
      expect(updateProjectManagerWorkItemStatusMock).toHaveBeenCalledWith("project-1", "item-1", {
        status: "done",
        expectedRevision: 3,
        manualCompletionReason: "所有者已手动验收通过",
      });
    });
  });

  it("keeps shared reviewers read-only and never requests legacy sessions or goals, even on refresh", async () => {
    const client = createQueryClient();
    render(
      <QueryClientProvider client={client}>
        <LanguageProvider>
          <ProjectManagerPanel
            projectId="project-1"
            enabled
            authority={{ canEdit: false, canManage: false, legacySessions: false }}
          />
        </LanguageProvider>
      </QueryClientProvider>,
    );

    const row = await screen.findByTestId("project-manager-item-item-1");
    expect(row.getAttribute("aria-disabled")).toBe("true");
    expect(
      screen.queryByPlaceholderText("记一条需求或任务，回车添加（或交由 Copilot 拆解）…"),
    ).toBeNull();
    expect(listProjectManagerTaskPacketsMock).not.toHaveBeenCalled();
    expect(listGoalsMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "刷新开发任务" }));
    await waitFor(() => expect(listProjectManagerWorkItemsMock).toHaveBeenCalledTimes(2));
    expect(listProjectManagerTaskPacketsMock).not.toHaveBeenCalled();
    expect(listSessionsMock).not.toHaveBeenCalled();
  });

  it("preserves captured revision for shared-project inline assignments and requires completion note for done", async () => {
    const client = createQueryClient();
    const collaboration = {
      project: {
        id: "project-1",
        name: "Project",
        role: "owner" as const,
        memberCount: 2,
        revision: 1,
        verificationRevision: 1,
        executionEnabled: false,
        verification: null,
      },
      members: [
        {
          userId: "dev",
          email: "dev@test.invalid",
          role: "developer" as const,
          state: "active",
          revision: 1,
        },
        {
          userId: "review",
          email: "review@test.invalid",
          role: "reviewer" as const,
          state: "active",
          revision: 1,
        },
      ],
      tasks: [],
      events: [],
    };
    render(
      <QueryClientProvider client={client}>
        <LanguageProvider>
          <ProjectManagerPanel
            projectId="project-1"
            enabled
            authority={{ canEdit: true, canManage: true, legacySessions: false, collaboration }}
          />
        </LanguageProvider>
      </QueryClientProvider>,
    );

    const row = await screen.findByTestId("project-manager-item-item-1");
    fireEvent.click(within(row).getByRole("button", { name: "实现登录" }));

    const sheet = await screen.findByRole("dialog");
    fireEvent.change(within(sheet).getByLabelText("负责人"), { target: { value: "dev" } });
    fireEvent.change(within(sheet).getByLabelText("审核人"), { target: { value: "review" } });

    // Background refresh bumps revision to 9; captured revision 3 must be preserved.
    client.setQueriesData(
      { queryKey: ["project-manager", "project-1", "work-items"] },
      { workItems: workItems.map((item) => ({ ...item, revision: 9 })) },
    );

    fireEvent.click(within(sheet).getByRole("button", { name: "保存分配" }));
    await waitFor(() =>
      expect(updateProjectManagerWorkItemMock).toHaveBeenCalledWith(
        "project-1",
        "item-1",
        expect.objectContaining({
          expectedRevision: 3,
          assigneeId: "dev",
          reviewerId: "review",
        }),
      ),
    );

    // Marking done in a shared project prompts for a 1-line completion note.
    fireEvent.click(within(sheet).getByRole("button", { name: "标记通过" }));
    const noteInput = await within(sheet).findByPlaceholderText("简短验收说明（协作项目必填）");
    fireEvent.change(noteInput, { target: { value: "Reviewed and verified" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "确认" }));

    await waitFor(() =>
      expect(updateProjectManagerWorkItemStatusMock).toHaveBeenCalledWith("project-1", "item-1", {
        status: "done",
        expectedRevision: 3,
        manualCompletionReason: "Reviewed and verified",
      }),
    );
  });

  it("keeps the Dev Tasks heading visible standalone but screen-reader-only when embedded under the tab", async () => {
    const { unmount } = renderPanel();
    const heading = await screen.findByRole("heading", { level: 2, name: "开发任务" });
    expect(heading.className).toContain("text-sm");
    expect(heading.className).not.toContain("sr-only");
    unmount();

    renderPanel({ embedded: true });
    const embeddedHeading = await screen.findByRole("heading", { level: 2, name: "开发任务" });
    expect(embeddedHeading.className).toContain("sr-only");
    expect(
      screen.getByText(
        "由 Copilot 维护计划、拆解任务与沉淀验证证据；你只需下达目标、查看进度并确认验收。",
      ),
    ).toBeTruthy();
  });
});
