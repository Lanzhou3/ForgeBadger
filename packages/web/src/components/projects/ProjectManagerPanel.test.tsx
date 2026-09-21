// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import { ProjectManagerPanel } from "./ProjectManagerPanel";

const {
  batchUpdateProjectManagerWorkItemStatusesMock,
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
  createProjectManagerWorkItemMock,
  updateProjectManagerWorkItemMock,
  addProjectManagerWorkItemDependencyMock,
  removeProjectManagerWorkItemDependencyMock,
} = vi.hoisted(() => ({
  batchUpdateProjectManagerWorkItemStatusesMock: vi.fn(),
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
  createProjectManagerWorkItemMock: vi.fn(),
  updateProjectManagerWorkItemMock: vi.fn(),
  addProjectManagerWorkItemDependencyMock: vi.fn(),
  removeProjectManagerWorkItemDependencyMock: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    batchUpdateProjectManagerWorkItemStatuses: batchUpdateProjectManagerWorkItemStatusesMock,
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
    createProjectManagerWorkItem: createProjectManagerWorkItemMock,
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
    revision: 3,
    projectId: "project-1",
    title: "实现登录",
    description: null,
    status: "in_progress",
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
    projectId: "project-1",
    title: "整理需求",
    description: null,
    status: "todo",
    priority: 0,
    acceptanceCriteria: [],
    evidenceRefCount: 0,
    evidenceRefs: [],
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
        <ProjectManagerPanel projectId="project-1" enabled authority={{canEdit:true,canManage:true,legacySessions:true}} />
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
    createProjectManagerWorkItemMock.mockResolvedValue({
      workItem: {
        ...workItems[1],
        id: "item-3",
        title: "补充创建流程",
      },
    });
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

  it("requires a batch completion reason and preserves confirmed revisions through refresh and retry", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const items = workItems.map((item, index) => ({ ...item, status: "in_progress", revision: index === 0 ? 3 : 5 }));
    listProjectManagerWorkItemsMock.mockResolvedValue({ workItems: items });
    batchUpdateProjectManagerWorkItemStatusesMock.mockRejectedValueOnce(new Error("Network unavailable"));
    batchUpdateProjectManagerWorkItemStatusesMock.mockResolvedValueOnce({ workItems: items.map(item => ({ ...item, status: "done" })) });
    const client = createQueryClient();
    render(<LanguageProvider><QueryClientProvider client={client}><ProjectManagerPanel projectId="project-1" enabled authority={{canEdit:true,canManage:true,legacySessions:false}} /></QueryClientProvider></LanguageProvider>);
    for (const checkbox of await screen.findAllByRole("checkbox", { name: "选择工作项" })) fireEvent.click(checkbox);
    fireEvent.keyDown(screen.getByRole("combobox", { name: "批量目标状态" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "完成" }));
    fireEvent.click(screen.getByRole("button", { name: "移动已选择" }));
    const dialog = await screen.findByRole("dialog");
    expect(batchUpdateProjectManagerWorkItemStatusesMock).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "确认变更" }));
    expect(await within(dialog).findByText("请填写手动完成原因。")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("手动完成原因"), { target: { value: "Manual bookkeeping only" } });
    client.setQueriesData({ queryKey: ["project-manager", "project-1", "work-items"] }, { workItems: items.map(item => ({ ...item, revision: 99 })) });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认变更" }));
    await within(dialog).findByText("无法批量更新工作项状态。");
    const payload = { updates: items.map(item => ({ workItemId: item.id, status: "done", expectedRevision: item.revision, manualCompletionReason: "Manual bookkeeping only" })) };
    expect(batchUpdateProjectManagerWorkItemStatusesMock).toHaveBeenNthCalledWith(1, "project-1", payload);
    fireEvent.click(within(dialog).getByRole("button", { name: "确认变更" }));
    await waitFor(() => expect(batchUpdateProjectManagerWorkItemStatusesMock).toHaveBeenNthCalledWith(2, "project-1", payload));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
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
      expect(updateProjectManagerWorkItemMock).toHaveBeenCalledWith("project-1", "item-1", { stageId: "stage-2", expectedRevision: 3 });
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
      expect(removeProjectManagerWorkItemDependencyMock).toHaveBeenCalledWith("project-1", "item-1", "item-2", 3);
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

  it("creates a todo work item without accepting status or source references", async () => {
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "创建工作项" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByText("新任务将从待办开始；证据可在任务详情或验收时补充。")).not.toBeNull();
    expect(within(dialog).queryByLabelText("状态")).toBeNull();
    expect(within(dialog).queryByText("初始证据引用")).toBeNull();
    expect(within(dialog).queryByText("初始飞书引用")).toBeNull();

    fireEvent.change(within(dialog).getByLabelText("标题"), { target: { value: "补充创建流程" } });
    fireEvent.change(within(dialog).getByLabelText("描述"), { target: { value: "简化任务创建表单" } });
    fireEvent.change(within(dialog).getByLabelText("优先级"), { target: { value: "7" } });
    fireEvent.change(within(dialog).getByLabelText("验收标准"), {
      target: { value: "新任务从待办开始\n证据在详情中补充" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建工作项" }));

    await waitFor(() => {
      expect(createProjectManagerWorkItemMock).toHaveBeenCalledWith("project-1", {
        title: "补充创建流程",
        description: "简化任务创建表单",
        priority: 7,
        acceptanceCriteria: ["新任务从待办开始", "证据在详情中补充"],
      });
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

it("keeps shared reviewers read-only and never requests legacy sessions, even on refresh", async () => {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  render(<QueryClientProvider client={client}><LanguageProvider><ProjectManagerPanel projectId="project-1" enabled authority={{canEdit: false, canManage: false, legacySessions: false}} /></LanguageProvider></QueryClientProvider>);
  await screen.findByTestId("project-manager-stages-card");
  await waitFor(() => expect(listProjectManagerWorkItemsMock).toHaveBeenCalled());
  expect(listProjectManagerTaskPacketsMock).not.toHaveBeenCalled();
  const create = screen.getByRole("button", {name: "创建工作项"});
  expect((create as HTMLButtonElement).disabled).toBe(true);
  const edit = screen.getAllByRole("button", {name: "编辑工作项"});
  expect(edit.every(b => (b as HTMLButtonElement).disabled)).toBe(true);
  const card = screen.getByTestId("project-manager-board-card-item-1");
  expect(card.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(screen.getByRole("button", {name: "刷新开发任务"}));
  await waitFor(() => expect(listProjectManagerWorkItemsMock).toHaveBeenCalledTimes(2));
  expect(listProjectManagerTaskPacketsMock).not.toHaveBeenCalled();
  expect(listSessionsMock).not.toHaveBeenCalled();
});


it("uses the single PM editor for assignments and preserves the captured revision across refresh", async () => {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const collaboration = {project: {id: "project-1", name: "Project", role: "owner" as const, memberCount: 2, revision: 1, verificationRevision: 1, executionEnabled: false, verification: null}, members: [{userId:"dev", email:"dev@test.invalid", role:"developer" as const, state:"active", revision:1}, {userId:"review", email:"review@test.invalid", role:"reviewer" as const, state:"active", revision:1}], tasks:[], events:[]};
  render(<QueryClientProvider client={client}><LanguageProvider><ProjectManagerPanel projectId="project-1" enabled authority={{canEdit:true,canManage:true,legacySessions:false,collaboration}} /></LanguageProvider></QueryClientProvider>);
  const card = await screen.findByTestId("project-manager-board-card-item-1");
  fireEvent.click(within(card).getByRole("button", {name:"编辑工作项"}));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("标题"),{target:{value:"One edited task"}});
  fireEvent.change(within(dialog).getByLabelText("负责人"),{target:{value:"dev"}});
  fireEvent.change(within(dialog).getByLabelText("审核人"),{target:{value:"review"}});
  client.setQueriesData({queryKey:["project-manager","project-1","work-items"]},{workItems: workItems.map(item => ({...item,revision:9}))});
  fireEvent.click(within(dialog).getByRole("button",{name:"保存工作项"}));
  await waitFor(()=>expect(updateProjectManagerWorkItemMock).toHaveBeenCalledWith("project-1","item-1",expect.objectContaining({expectedRevision:3,title:"One edited task",assigneeId:"dev",reviewerId:"review"})));
});
});
