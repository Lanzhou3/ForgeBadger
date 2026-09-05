// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CopilotManagementPanel } from "./CopilotManagementPanel";
import * as api from "@/lib/platform-actions-api";
vi.mock("@/lib/platform-actions-api", () => ({
  listGrants: vi.fn(),
  getProjectOverview: vi.fn(),
  createGrant: vi.fn(),
  revokeGrant: vi.fn(),
  updateProjectManagement: vi.fn(),
}));
const project = {
  id: "p1",
  name: "项目一",
  management: {
    projectId: "p1",
    mode: "manual" as const,
    ownerLabel: "",
    nextAction: "",
    freshnessHours: 24,
    revision: 3,
    updatedAt: null,
  },
  counts: {
    total: 1,
    todo: 1,
    in_progress: 0,
    blocked: 0,
    ready_for_review: 0,
    done: 0,
    cancelled: 0,
  },
  goal: null,
  autonomy: "manual_only" as const,
  evidenceFreshness: {
    status: "unknown" as const,
    fresh: 0,
    stale: 0,
    unknown: 1,
    lastObservedAt: null,
  },
};
const grant = {
  id: "g1",
  name: "日常管理",
  status: "active",
  revision: 1,
  scope: {
    projectIds: ["p1"],
    capabilities: ["pm.work_item.create"],
    allowedRoots: [],
  },
  expiresAt: Date.now() + 3600000,
  maxActions: 20,
  maxConcurrency: 1,
  usedActions: 2,
};
function mount(onStart = vi.fn().mockResolvedValue(undefined)) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <CopilotManagementPanel boundGrantId="g1" onStartConversation={onStart} />
    </QueryClientProvider>,
  );
  return onStart;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listGrants).mockResolvedValue({
    grants: [grant],
    capabilities: [
      {
        id: "pm.work_item.create",
        capability: "pm.work_item.create",
        effect: "database",
      },
    ],
  });
  vi.mocked(api.getProjectOverview).mockResolvedValue({
    projects: [project],
    observedAt: Date.now(),
  });
});
afterEach(cleanup);
it("starts a fresh conversation with the selected grant and displays action budgets", async () => {
  const start = mount();
  fireEvent.click(await screen.findByText("以此授权新建会话"));
  await waitFor(() => expect(start).toHaveBeenCalledWith("g1"));
  expect(screen.getByText(/操作次数 2\/20/)).toBeTruthy();
  expect(screen.getByText(/当前会话绑定/)).toBeTruthy();
});
it("disables revoked and expired grants", async () => {
  vi.mocked(api.listGrants).mockResolvedValue({
    grants: [
      { ...grant, status: "revoked" },
      { ...grant, id: "g2", expiresAt: 1 },
    ],
    capabilities: [],
  });
  mount();
  await screen.findByText("已撤销");
  expect(
    screen
      .getAllByText("以此授权新建会话")
      .every((button) => (button as HTMLButtonElement).disabled),
  ).toBe(true);
});
it("creates explicit project and action scope", async () => {
  vi.mocked(api.createGrant).mockResolvedValue({ grant });
  mount();
  await screen.findByText("创建工作项", { selector: "span" });
  fireEvent.change(screen.getByLabelText("授权名称"), {
    target: { value: "执行范围" },
  });
  fireEvent.click(screen.getByLabelText("项目一"));
  fireEvent.click(screen.getByLabelText("创建工作项"));
  fireEvent.submit(screen.getByLabelText("授权名称").closest("form")!);
  await waitFor(() =>
    expect(api.createGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "执行范围",
        projectIds: ["p1"],
        capabilities: ["pm.work_item.create"],
        maxActions: 20,
        maxConcurrency: 1,
      }),
    ),
  );
});
it("saves management using the observed revision and preserves manual defaults", async () => {
  vi.mocked(api.updateProjectManagement).mockResolvedValue({
    management: project.management,
  });
  mount();
  await screen.findByText("人工项目 · 人工执行");
  fireEvent.change(screen.getByLabelText("负责人"), {
    target: { value: "张三" },
  });
  fireEvent.change(screen.getByLabelText("下一步"), {
    target: { value: "检查验收" },
  });
  fireEvent.submit(screen.getByLabelText("负责人").closest("form")!);
  await waitFor(() =>
    expect(api.updateProjectManagement).toHaveBeenCalledWith("p1", {
      mode: "manual",
      ownerLabel: "张三",
      nextAction: "检查验收",
      freshnessHours: 24,
      expectedRevision: 3,
    }),
  );
});
it("surfaces loading errors with retry controls", async () => {
  vi.mocked(api.listGrants).mockRejectedValue(new Error("offline"));
  mount();
  expect(await screen.findByText("授权加载失败")).toBeTruthy();
});
