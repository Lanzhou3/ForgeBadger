// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/hooks/use-language";
import {
  teamsApi,
  accountsApi,
  type Team,
  type OffboardingImpact,
} from "@/lib/teams-api";
import { TeamInvitations } from "./TeamInvitations";
import { TeamMembers } from "./TeamMembers";
import { TeamOffboarding, PlanRecovery } from "./TeamOffboarding";
import { JoinTeam } from "./JoinTeam";
import { ResetAccountPassword } from "@/components/members/ResetAccountPassword";
const auth = vi.hoisted(() => ({
  user: null as null | { id: string; email: string },
  replace: vi.fn(),
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: auth.user, isLoading: false }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: auth.replace }),
}));
vi.mock("@/lib/teams-api", () => ({
  teamsApi: {
    invitations: vi.fn(),
    invite: vi.fn(),
    revoke: vi.fn(),
    member: vi.fn(),
    impact: vi.fn(),
    plan: vi.fn(),
    commit: vi.fn(),
    planStatus: vi.fn(),
    resume: vi.fn(),
    plans: vi.fn(),
    revisePlan: vi.fn(),
    inspect: vi.fn(),
    accept: vi.fn(),
    register: vi.fn(),
  },
  accountsApi: { reset: vi.fn() },
}));
const team: Team = {
  id: "t1",
  name: "Studio",
  role: "owner",
  ownerId: "u1",
  revision: 7,
  state: "active",
  capabilities: {
    manageMembers: true,
    manageAdmins: true,
    inviteMembers: true,
    inviteAdmins: true,
    transferOwner: true,
    close: true,
    enrollOwnProjects: true,
  },
};
const member = {
  userId: "m1",
  email: "dev@example.com",
  displayName: null,
  role: "member" as const,
  state: "active" as const,
  revision: 4,
};
function mount(node: React.ReactNode) {
  return render(
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
      <LanguageProvider>{node}</LanguageProvider>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  auth.user = null;
  history.replaceState(null, "", "/");
  vi.mocked(teamsApi.invitations).mockResolvedValue({ invitations: [] });
});
afterEach(cleanup);
describe("team invitations and role controls", () => {
  it("creates one-time fragment links and restricts admin invitations by capabilities", async () => {
    vi.mocked(teamsApi.invite).mockResolvedValue({
      token: "secret-once",
      invitation: {
        id: "i1",
        email: "new@example.com",
        role: "member",
        state: "pending",
        createdAt: 1,
        expiresAt: 2,
      },
    });
    mount(
      <TeamInvitations
        team={{
          ...team,
          role: "admin",
          capabilities: { ...team.capabilities, inviteAdmins: false },
        }}
      />,
    );
    expect(screen.queryByRole("option", { name: "团队管理员" })).toBeNull();
    fireEvent.change(screen.getByLabelText("邮箱"), {
      target: { value: "new@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建邀请" }));
    await waitFor(() =>
      expect(teamsApi.invite).toHaveBeenCalledWith(
        "t1",
        "new@example.com",
        "member",
        24,
      ),
    );
    const link = await screen.findByRole("textbox", { name: "复制链接" });
    expect((link as HTMLInputElement).value).toContain(
      "/join#token=secret-once",
    );
  });
  it("does not give a member admin actions from a role label alone", () => {
    mount(
      <TeamMembers
        actorId="m1"
        detail={{
          team: {
            ...team,
            capabilities: {
              ...team.capabilities,
              manageAdmins: false,
              manageMembers: false,
            },
          },
          members: [member, { ...member, userId: "admin", role: "admin" }],
          projects: [],
        }}
        onOffboard={vi.fn()}
      />,
    );
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("button", { name: "退出团队" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "离职与交接" })).toBeNull();
  });
});
describe("public join", () => {
  it("strips the secret from the URL and sends it only in inspect/accept bodies", async () => {
    history.replaceState(null, "", "/join#token=join-secret");
    auth.user = { id: "m1", email: "dev@example.com" };
    vi.mocked(teamsApi.inspect).mockResolvedValue({
      invitation: {
        teamName: "Studio",
        emailHint: "d***@example.com",
        role: "member",
        expiresAt: Date.now() + 60000,
        registrationAllowed: true,
      },
    });
    vi.mocked(teamsApi.accept).mockResolvedValue({ team, membership: member });
    mount(<JoinTeam />);
    expect(await screen.findByText("Studio")).toBeTruthy();
    expect(location.hash).toBe("");
    expect(teamsApi.inspect).toHaveBeenCalledWith(
      "join-secret",
      expect.anything(),
    );
    fireEvent.click(screen.getByRole("button", { name: "加入团队" }));
    await waitFor(() =>
      expect(teamsApi.accept).toHaveBeenCalledWith("join-secret"),
    );
    expect(auth.replace).toHaveBeenCalledWith("/members?team=t1");
    expect(sessionStorage.getItem("forgebadger.team-invitation")).toBeNull();
  });
  it("offers login while withholding invited registration when registration is off", async () => {
    history.replaceState(null, "", "/join#token=join-secret");
    vi.mocked(teamsApi.inspect).mockResolvedValue({
      invitation: {
        teamName: "Studio",
        emailHint: "d***@example.com",
        role: "member",
        expiresAt: Date.now() + 60000,
        registrationAllowed: false,
      },
    });
    mount(<JoinTeam />);
    expect(
      await screen.findByRole("link", { name: "登录后接受邀请" }),
    ).toHaveProperty("href", "http://localhost:3000/login?next=%2Fjoin");
    expect(screen.queryByRole("button", { name: "创建账户并加入" })).toBeNull();
  });
  it("displays expired invitations without rendering accepting controls", async () => {
    history.replaceState(null, "", "/join#token=expired");
    vi.mocked(teamsApi.inspect).mockRejectedValue(
      new Error("TEAM_INVITATION_INVALID"),
    );
    mount(<JoinTeam />);
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("已过期"),
    );
    expect(screen.queryByRole("button", { name: "加入团队" })).toBeNull();
  });
});
it("requires password confirmation and explicit reset acknowledgement, clears password after success", async () => {
  vi.mocked(accountsApi.reset).mockResolvedValue({ revokedSessions: 3 });
  mount(
    <ResetAccountPassword
      userId="m1"
      email="dev@example.com"
      isSelf={false}
      onSelfReset={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "重置账号密码" }));
  fireEvent.change(screen.getByLabelText("新密码"), {
    target: { value: "new-password" },
  });
  fireEvent.change(screen.getByLabelText("确认新密码"), {
    target: { value: "new-password" },
  });
  const submit = screen.getAllByRole("button", {
    name: "重置账号密码",
  })[1] as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "确认" }));
  fireEvent.click(submit);
  await waitFor(() =>
    expect(accountsApi.reset).toHaveBeenCalledWith("m1", "new-password"),
  );
  expect(await screen.findByRole("status")).toHaveProperty(
    "textContent",
    "密码已重置，账号登录已撤销。",
  );
  expect(screen.queryByLabelText("新密码")).toBeNull();
});
it("requires a reviewed offboarding plan and does not call stopping a completed handoff", async () => {
  const impact: OffboardingImpact = {
    impactDigest: "digest-reviewed",
    member,
    teamRevision: 7,
    projects: [
      {
        projectId: "p1",
        name: "App",
        logicalOwnerId: "m1",
        requiresOwnerTransfer: true,
        tasks: [
          {
            id: "task",
            title: "Delivery",
            revision: 1,
            assigneeId: "m1",
            reviewerId: null,
          },
        ],
        runs: [{ id: "r1", state: "ready" }],
        eligibleOwners: [{ userId: "u1", label: "Owner" }],
        eligibleAssignees: [],
        eligibleReviewers: [],
      },
    ],
    blockers: [],
  };
  vi.mocked(teamsApi.impact).mockResolvedValue({ impact });
  const plan = {
    id: "plan1",
    revision: 1,
    memberId: "m1",
    state: "planned" as const,
    expiresAt: Date.now() + 600000,
    createdAt: Date.now(),
    pendingStops: 1,
    error: null,
  };
  vi.mocked(teamsApi.plan).mockResolvedValue({
    plan,
    confirmationToken: "confirm-once",
  });
  vi.mocked(teamsApi.commit).mockResolvedValue({
    plan: { ...plan, state: "stopping" },
  });
  vi.mocked(teamsApi.planStatus).mockResolvedValue({
    plan: { ...plan, state: "stopping" },
  });
  mount(
    <TeamOffboarding
      teamId="t1"
      actorId="u1"
      canResume
      member={member}
      onClose={vi.fn()}
    />,
  );
  await screen.findByText("App");
  expect(
    (screen.getByRole("button", { name: "生成交接预览" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText("新所有者"), {
    target: { value: "u1" },
  });
  fireEvent.change(screen.getByLabelText("接任执行者"), {
    target: { value: "__clear__" },
  });
  fireEvent.change(screen.getByLabelText("接任审核者"), {
    target: { value: "__clear__" },
  });
  fireEvent.click(screen.getByRole("button", { name: "生成交接预览" }));
  await screen.findByRole("button", { name: "确认此交接计划" });
  expect(teamsApi.commit).not.toHaveBeenCalled();
  expect(teamsApi.plan).toHaveBeenCalledWith(
    "t1",
    "m1",
    4,
    [{ projectId: "p1", newOwnerId: "u1", assigneeId: null, reviewerId: null }],
    "digest-reviewed",
  );
  fireEvent.click(screen.getByRole("button", { name: "确认此交接计划" }));
  await waitFor(() =>
    expect(teamsApi.commit).toHaveBeenCalledWith("t1", "plan1", "confirm-once"),
  );
  expect(
    await screen.findByText("权限已撤销，执行停止与交接仍待完成。"),
  ).toBeTruthy();
  expect(screen.queryByText("交接已完成。")).toBeNull();
});
it("repairs a stopped handoff using a fresh impact after a stale revision, then resumes separately", async () => {
  const impact: OffboardingImpact = {
    impactDigest: "first-digest",
    member: { ...member, state: "leaving" },
    teamRevision: 8,
    projects: [
      {
        projectId: "p",
        name: "Stopped project",
        logicalOwnerId: "owner",
        requiresOwnerTransfer: false,
        tasks: [],
        runs: [{ id: "run", state: "revoking" }],
        eligibleOwners: [],
        eligibleAssignees: [],
        eligibleReviewers: [],
      },
    ],
    blockers: [],
  };
  const plan = {
    id: "pending-plan",
    memberId: member.userId,
    revision: 2,
    state: "stopping" as const,
    expiresAt: Date.now() + 600000,
    createdAt: Date.now(),
    pendingStops: 1,
    error: "TEAM_HANDOFF_TARGET_CHANGED",
  };
  vi.mocked(teamsApi.plans).mockResolvedValue({ plans: [plan] });
  vi.mocked(teamsApi.planStatus).mockResolvedValue({ plan, impact });
  vi.mocked(teamsApi.revisePlan)
    .mockRejectedValueOnce(new Error("TEAM_OFFBOARDING_PLAN_STALE"))
    .mockResolvedValueOnce({ plan: { ...plan, revision: 3, error: null } });
  vi.mocked(teamsApi.resume).mockResolvedValue({
    plan: {
      ...plan,
      revision: 3,
      state: "completed",
      pendingStops: 0,
      error: null,
    },
  });
  mount(<PlanRecovery teamId="t1" actorId="owner" canResume />);
  fireEvent.click(await screen.findByRole("button", { name: "pending-plan" }));
  fireEvent.click(await screen.findByRole("button", { name: "修订交接" }));
  fireEvent.change(screen.getByLabelText("接任执行者"), {
    target: { value: "__clear__" },
  });
  fireEvent.change(screen.getByLabelText("接任审核者"), {
    target: { value: "__clear__" },
  });
  fireEvent.click(screen.getByRole("button", { name: "生成交接预览" }));
  expect(teamsApi.revisePlan).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认修订交接" }));
  await screen.findByText("数据或交接预览已变化，请刷新并核对新的预览。");
  expect(teamsApi.resume).not.toHaveBeenCalled();
  vi.mocked(teamsApi.planStatus).mockResolvedValue({
    plan,
    impact: { ...impact, impactDigest: "fresh-digest" },
  });
  fireEvent.click(screen.getByRole("button", { name: "重新加载当前影响" }));
  await screen.findByLabelText("接任执行者");
  fireEvent.change(screen.getByLabelText("接任执行者"), {
    target: { value: "__clear__" },
  });
  fireEvent.change(screen.getByLabelText("接任审核者"), {
    target: { value: "__clear__" },
  });
  fireEvent.click(screen.getByRole("button", { name: "生成交接预览" }));
  fireEvent.click(screen.getByRole("button", { name: "确认修订交接" }));
  await waitFor(() =>
    expect(teamsApi.revisePlan).toHaveBeenLastCalledWith(
      "t1",
      "pending-plan",
      2,
      "fresh-digest",
      [{ projectId: "p", assigneeId: null, reviewerId: null }],
    ),
  );
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "确认修订交接" })).toBeNull(),
  );
  expect(teamsApi.resume).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "继续待完成的交接" }));
  await waitFor(() =>
    expect(teamsApi.resume).toHaveBeenCalledWith("t1", "pending-plan"),
  );
});
