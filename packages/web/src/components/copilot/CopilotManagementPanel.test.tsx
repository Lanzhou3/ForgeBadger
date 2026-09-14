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
  deleteGrant: vi.fn(),
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
  fireEvent.click(await screen.findByRole("button", {name: /查看已撤销授权/}));
  await screen.findByText("已撤销");
  expect(
    screen
      .getAllByText("以此授权新建会话")
      .every((button) => (button as HTMLButtonElement).disabled),
  ).toBe(true);
});
it("creates all-operations grants by selecting projects and clicking the button",async()=>{
 vi.mocked(api.getProjectOverview).mockResolvedValue({observedAt:Date.now(),projects:[project,{...project,id:"p2",name:"Second project"}]});
 vi.mocked(api.createGrant).mockResolvedValue({grant});mount();await screen.findByLabelText("项目一");
 fireEvent.click(screen.getByLabelText("项目一"));fireEvent.click(screen.getByLabelText("Second project"));
 fireEvent.click(screen.getByRole("button",{name:"创建授权"}));
 await waitFor(()=>expect(api.createGrant).toHaveBeenCalledWith({name:"项目一、Second project授权",projectIds:["p1","p2"],allOperations:true,expiresAt:null,maxActions:null,maxConcurrency:1}));
 expect(await screen.findByRole("status")).toBeTruthy();
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
it('can opt back into finite grant limits',async()=>{
 vi.mocked(api.createGrant).mockResolvedValue({grant});mount();await screen.findByLabelText('项目一');
 fireEvent.change(screen.getByLabelText('授权名称（可选）'),{target:{value:'finite'}});
 fireEvent.click(screen.getByLabelText('项目一'));
 fireEvent.click(screen.getByLabelText('长期有效，直到撤销'));fireEvent.click(screen.getByLabelText('不限制累计操作次数'));
 fireEvent.submit(screen.getByLabelText('授权名称（可选）').closest('form')!);
 await waitFor(()=>expect(api.createGrant).toHaveBeenCalledWith(expect.objectContaining({maxActions:20,expiresAt:expect.any(Number)})));
});
it('shows perpetual grants as usable and retains revocation',async()=>{
 vi.mocked(api.listGrants).mockResolvedValue({grants:[{...grant,expiresAt:null,maxActions:null}],capabilities:[]});
 const start=mount();await screen.findAllByText(/长期有效，直至撤销/);
 fireEvent.click(screen.getByText('以此授权新建会话'));expect(start).toHaveBeenCalledWith('g1');
 expect(screen.getByText(/操作次数 2\/不限/)).toBeTruthy();
});
it('explains missing project selection next to the submit button',async()=>{
 mount();await screen.findByLabelText('项目一');fireEvent.click(screen.getByRole('button',{name:'创建授权'}));
 expect(await screen.findByRole('alert')).toHaveProperty('textContent','请至少选择一个项目。');expect(api.createGrant).not.toHaveBeenCalled();
});
it('shows API failure and allows a successful retry without clearing project selection',async()=>{
 vi.mocked(api.createGrant).mockRejectedValueOnce(new Error('服务不可用')).mockResolvedValueOnce({grant});mount();await screen.findByLabelText('项目一');fireEvent.click(screen.getByLabelText('项目一'));fireEvent.click(screen.getByRole('button',{name:'创建授权'}));
 expect(await screen.findByRole('alert')).toHaveProperty('textContent','服务不可用');fireEvent.click(screen.getByRole('button',{name:'创建授权'}));await screen.findByRole('status');expect(api.createGrant).toHaveBeenCalledTimes(2);
});
it('prevents repeated submissions while awaiting creation',async()=>{
 let finish!:(value:{grant:typeof grant})=>void;vi.mocked(api.createGrant).mockImplementation(()=>new Promise(r=>finish=r));mount();await screen.findByLabelText('项目一');fireEvent.click(screen.getByLabelText('项目一'));
 const form=screen.getByRole('button',{name:'创建授权'}).closest('form')!;fireEvent.submit(form);fireEvent.submit(form);expect(api.createGrant).toHaveBeenCalledTimes(1);finish({grant});await screen.findByRole('status');
});
it('explains missing custom creation root instead of silently relying on native required validation',async()=>{
 vi.mocked(api.listGrants).mockResolvedValue({grants:[],capabilities:[{id:'project.create',capability:'project.create',effect:'external'}]});mount();await screen.findByLabelText('项目一');fireEvent.click(screen.getByLabelText('项目一'));fireEvent.click(screen.getByLabelText('允许所有当前可授权操作'));fireEvent.click(screen.getByLabelText('创建项目'));fireEvent.click(screen.getByRole('button',{name:'创建授权'}));expect(await screen.findByRole('alert')).toHaveProperty('textContent','请填写允许创建项目的目录，或切换为默认的所有操作。');expect(api.createGrant).not.toHaveBeenCalled();
});

it("hides revoked grants and deletes them with retry feedback", async () => {
  vi.mocked(api.listGrants).mockResolvedValue({grants:[{...grant,status:"revoked"}],capabilities:[]});
  vi.mocked(api.deleteGrant).mockRejectedValueOnce(new Error("删除失败，请重试")).mockResolvedValue({deleted:true});
  mount();
  const toggle=await screen.findByRole("button",{name:/查看已撤销授权/});
  expect(screen.queryByRole("button",{name:"删除授权"})).toBeNull();
  fireEvent.click(toggle);fireEvent.click(screen.getByRole("button",{name:"删除授权"}));
  expect((await screen.findByRole("alert")).textContent).toContain("删除失败");
  vi.mocked(api.listGrants).mockResolvedValue({grants:[],capabilities:[]});
  fireEvent.click(screen.getByRole("button",{name:"删除授权"}));
  await waitFor(()=>expect(api.deleteGrant).toHaveBeenCalledTimes(2));
  await waitFor(()=>expect(screen.queryByRole("button",{name:"删除授权"})).toBeNull());
});
