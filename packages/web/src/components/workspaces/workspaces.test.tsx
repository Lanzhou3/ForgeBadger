// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTranslation } from "@/lib/i18n";
import {
  collaborationApi,
  type RunDetail,
  type WorkspaceDetail,
} from "@/lib/collaboration-api";
import { TaskExecutionPanel } from "./TaskExecutionPanel";
import { ProjectMembers } from "@/components/members/ProjectMembers";
import { RunGitDelivery } from "./RunGitDelivery";
import { RunPanel } from "./RunPanel";
import { RunReview } from "./RunReview";
import { RunArtifacts } from "./RunArtifacts";
import { ArchiveProject } from "./ArchiveProject";
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: navigate }) }));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({
    language: "en",
    t: (key: Parameters<typeof getTranslation>[1]) => getTranslation("en", key),
  }),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: ReactNode }) => (
    <a {...props}>{children}</a>
  ),
}));
const project: WorkspaceDetail["project"] = {
  id: "project",
  name: "Project",
  memberCount: 2,
  role: "owner",
  revision: 7,
  verificationRevision: 3,
  executionEnabled: true,
  verification: {
    command: "pnpm",
    args: ["test", "--run"],
    timeoutSeconds: 90,
  },
};
const task = {
  id: "task",
  title: "Ship fix",
  description: "Fix the regression",
  status: "todo",
  acceptanceCriteria: ["Regression is fixed"],
  revision: 12,
  assigneeId: "dev",
  reviewerId: "owner",
};
const members: WorkspaceDetail["members"] = [
  {
    userId: "owner",
    email: "owner@example.com",
    role: "owner",
    state: "active",
    revision: 1,
  },
  {
    userId: "dev",
    email: "dev@example.com",
    role: "developer",
    state: "active",
    revision: 1,
  },
  {
    userId: "reviewer",
    email: "review@example.com",
    role: "reviewer",
    state: "active",
    revision: 1,
  },
  {
    userId: "viewer",
    email: "view@example.com",
    role: "viewer",
    state: "active",
    revision: 1,
  },
];
const workspace: WorkspaceDetail = {
  project,
  members,
  tasks: [task],
  events: [],
};
const run = {
  id: "run",
  taskId: "task",
  actorId: "dev",
  actorLabel: "Developer",
  state: "ready" as const,
  branch: "delivery/task",
  baseCommit: "base123",
  sessionId: null,
  previewUrl: null,
  prUrl: null,
  error: null,
  createdAt: 1,
};
const detail: RunDetail = {
  run,
  git: { commit: "commit456", dirty: false, files: [] },
  verifications: [
    {
      id: "receipt",
      taskRevision: 12,
      policyRevision: 3,
      current: true,
      commit: "commit456",
      status: "passed",
      command: "pnpm",
      args: ["test"],
      exitCode: 0,
      summary: "Tests passed",
      createdAt: 2,
      finishedAt: 3,
    },
  ],
  reviews: [],
};
function mount(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.restoreAllMocks();
  navigate.mockReset();
  vi.spyOn(collaborationApi, "task").mockResolvedValue({
    task,
    comments: [],
    runs: [],
  });
  vi.spyOn(collaborationApi, "run").mockResolvedValue(detail);
});
afterEach(cleanup);

describe("collaboration workspace behavior", () => {
  it("keeps discussion available without asking a new project to configure execution", async () => {
    mount(<TaskExecutionPanel detail={{...workspace,project:{...project,executionEnabled:false,verification:null}}} taskId="task" actorId="dev" />);
    await screen.findByRole("heading", {name:"Discussion"});
    expect(screen.queryByRole("heading",{name:"Development attempts"})).toBeNull();
    expect(screen.queryByRole("button",{name:"Prepare isolated attempt"})).toBeNull();
    expect(screen.queryByRole("link",{name:/settings|verification/i})).toBeNull();
    expect(screen.getByRole("button",{name:"Post comment"})).toBeTruthy();
  });
  it("retains historical attempts after managed execution is disabled", async () => {
    vi.mocked(collaborationApi.task).mockResolvedValue({task,comments:[],runs:[run]});
    mount(<TaskExecutionPanel detail={{...workspace,project:{...project,executionEnabled:false,verification:null}}} taskId="task" actorId="dev" />);
    await screen.findByRole("heading", {name:"Development attempts"});
    await screen.findByRole("heading", {name:"Verification receipts"});
    expect(screen.queryByRole("button",{name:"Run verification"})).toBeNull();
  });

  it("keeps viewer task and settings controls read-only", async () => {
    const readonly = {
      ...workspace,
      project: { ...project, role: "viewer" as const },
    };
    mount(
      <>
        <TaskExecutionPanel detail={readonly} taskId="task" actorId="viewer" />
        <ProjectMembers detail={readonly} />
      </>,
    );
    await screen.findByRole("heading", {name: "Development attempts"});
    expect(screen.queryByRole("button", { name: "Edit task" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Prepare isolated attempt" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Post comment" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Revoke access" })).toBeNull();
  });
  it("shows task fetch errors and lets the user retry", async () => {
    vi.mocked(collaborationApi.task).mockRejectedValueOnce(
      new Error("Membership revoked"),
    );
    mount(<TaskExecutionPanel detail={workspace} taskId="task" actorId="owner" />);
    await screen.findByText("Membership revoked");
    fireEvent.click(screen.getByRole("button", { name: "Refresh and retry" }));
    await screen.findByRole("heading", {name: "Development attempts"});
  });
  it("preserves an idempotency key after an uncertain prepare response", async () => {
    const prepare = vi
      .spyOn(collaborationApi, "prepare")
      .mockRejectedValue(new Error("Network interrupted"));
    mount(<TaskExecutionPanel detail={workspace} taskId="task" actorId="dev" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Prepare isolated attempt" }),
    );
    await screen.findByText("Network interrupted");
    fireEvent.click(
      screen.getByRole("button", { name: "Prepare isolated attempt" }),
    );
    await waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
    expect(prepare.mock.calls[0]![3]).toBe(prepare.mock.calls[1]![3]);
  });
  it("shows historical verification evidence without a command form or execution action", async () => {
    mount(
      <RunPanel
        project={project}
        runId="run"
        actorId="dev"
        team
        onRecovered={() => {}}
      />,
    );
    expect((await screen.findAllByText("commit456")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Run verification" })).toBeNull();
    expect(screen.queryByText('"pnpm" "test" "--run"')).toBeNull();

  });
  it("does not show review mutations to developers or team self-reviewers", () => {
    const { unmount } = mount(
      <RunReview
        project={{ ...project, role: "developer" }}
        detail={detail}
        actorId="other"
        team
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Accept this commit" }),
    ).toBeNull();
    unmount();
    mount(<RunReview project={project} detail={detail} actorId="dev" team />);
    expect(
      screen.queryByRole("button", { name: "Accept this commit" }),
    ).toBeNull();
  });
  it("allows personal self-acceptance and binds acceptance to receipt and commit", async () => {
    const review = vi.spyOn(collaborationApi, "review").mockResolvedValue({});
    mount(
      <RunReview
        project={project}
        detail={detail}
        actorId="dev"
        team={false}
      />,
    );
    fireEvent.change(screen.getByLabelText("Review note"), {
      target: { value: "Verified locally" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Accept this commit" }));
    await waitFor(() =>
      expect(review).toHaveBeenCalledWith("project", "run", {
        expectedCommit: "commit456",
        verificationId: "receipt",
        decision: "accepted",
        note: "Verified locally",
      }),
    );
  });
  it("returns a delivery with an explicit review note", async () => {
    const review = vi.spyOn(collaborationApi, "review").mockResolvedValue({});
    mount(<RunReview project={project} detail={detail} actorId="owner" team />);
    expect(
      (
        screen.getByRole("button", {
          name: "Request changes",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("Review note"), {
      target: { value: "Cover the empty state" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request changes" }));
    await waitFor(() =>
      expect(review).toHaveBeenCalledWith(
        "project",
        "run",
        expect.objectContaining({
          expectedCommit: "commit456",
          decision: "changes_requested",
          note: "Cover the empty state",
        }),
      ),
    );
  });
  it("does not accept a receipt for an older commit", () => {
    mount(
      <RunReview
        project={project}
        detail={{ ...detail, git: { ...detail.git, commit: "new-commit" } }}
        actorId="owner"
        team
      />,
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Accept this commit",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it("explains recovery and creates a new attempt only after explicit confirmation", async () => {
    const recover = vi
      .spyOn(collaborationApi, "recover")
      .mockResolvedValue({ run: { ...run, id: "recovered" } });
    const recovered = vi.fn();
    mount(
      <RunPanel
        project={project}
        runId="run"
        actorId="dev"
        team
        onRecovered={recovered}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Create recovery attempt" }),
    );
    await screen.findByText(/existing worktree and its changes are retained/);
    expect(recover).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(recover).toHaveBeenCalledWith(
        "project",
        "run",
        expect.any(String),
      ),
    );
    await waitFor(() => expect(recovered).toHaveBeenCalledWith("recovered"));
  });
  it("blocks unsafe links and opens saved operator links safely", () => {
    mount(
      <RunArtifacts
        projectId="project"
        detail={{
          ...detail,
          run: { ...run, previewUrl: "https://preview.example/test" },
        }}
        editable
      />,
    );
    const link = screen.getByRole("link", { name: "Preview URL ↗" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    fireEvent.change(screen.getByLabelText("Pull request URL"), {
      target: { value: "javascript:alert(1)" },
    });
    expect(
      (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
  it("marks a formerly passing receipt outdated after policy or task edits", async () => {
    vi.mocked(collaborationApi.run).mockResolvedValue({
      ...detail,
      verifications: [{ ...detail.verifications[0]!, current: false }],
    });
    mount(
      <RunPanel
        project={project}
        runId="run"
        actorId="owner"
        team
        onRecovered={() => {}}
      />,
    );
    await screen.findByText(
      "Outdated — this record no longer matches the current task or commit",
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Accept this commit",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Integrate accepted commit",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it("does not give an owner another executor's private mutations", async () => {
    mount(
      <RunPanel
        project={project}
        runId="run"
        actorId="owner"
        team
        onRecovered={() => {}}
      />,
    );
    await screen.findByText("Developer");
    expect(
      screen.queryByRole("button", { name: "Run verification" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Create recovery attempt" }),
    ).toBeNull();
    expect(
      screen.queryByRole("link", { name: "Open private terminal" }),
    ).toBeNull();
    expect(
      (screen.getByLabelText("Preview URL") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Close attempt safely" }),
    ).toBeTruthy();
  });
  it("disables verification for dirty code and explains unknown receipts without replay", async () => {
    vi.mocked(collaborationApi.run).mockResolvedValue({
      ...detail,
      git: { ...detail.git, dirty: true },
      verifications: [
        { ...detail.verifications[0]!, status: "unknown", current: false },
      ],
    });
    mount(
      <RunPanel
        project={project}
        runId="run"
        actorId="dev"
        team
        onRecovered={() => {}}
      />,
    );
    await screen.findByText(/Outcome unknown/);
    expect(screen.queryByRole("button", { name: "Run verification" })).toBeNull();
  });
  it("requires explicit revocation and shows pending stops for retry", async () => {
    const revoke = vi
      .spyOn(collaborationApi, "revoke")
      .mockResolvedValue({ revoked: true, pendingStops: 2 });
    mount(<ProjectMembers detail={workspace} />);
    fireEvent.click(
      screen.getAllByRole("button", { name: "Revoke access" })[0]!,
    );
    expect(revoke).not.toHaveBeenCalled();
    await screen.findByText(/Access is denied immediately/);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await screen.findByText("Access revoked. Pending process stops: 2");
    expect(revoke).toHaveBeenCalledWith("project", "dev");
  });
  it("archives only after confirmation and keeps failed stop operations retryable", async () => {
    const archive = vi
      .spyOn(collaborationApi, "archive")
      .mockRejectedValueOnce(new Error("EXECUTION_STOP_PENDING"))
      .mockResolvedValueOnce({ archived: true });
    mount(<ArchiveProject projectId="project" />);
    fireEvent.click(screen.getByRole("button", { name: "Archive project" }));
    expect(archive).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await screen.findByText(
      "Execution has not stopped yet. Wait, then retry the stop or archive action.",
    );
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/projects"));
    expect(archive).toHaveBeenCalledTimes(2);
  });
  it("integrates only the accepted current receipt with an explicit expected commit", async () => {
    const integrate = vi
      .spyOn(collaborationApi, "integrate")
      .mockResolvedValue({});
    vi.mocked(collaborationApi.run).mockResolvedValue({
      ...detail,
      reviews: [
        {
          id: "review",
          actorId: "owner",
          actorLabel: "Owner",
          commit: "commit456",
          verificationId: "receipt",
          decision: "accepted",
          note: "Checked",
          createdAt: 4,
        },
      ],
    });
    mount(
      <RunPanel
        project={project}
        runId="run"
        actorId="owner"
        team
        onRecovered={() => {}}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Integrate accepted commit" }),
    );
    await screen.findByText(/stop the private CLI first/);
    expect(integrate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(integrate).toHaveBeenCalledWith("project", "run", "commit456"),
    );
  });
  it("requires the assigned reviewer and a nonempty acceptance note", () => {
    const { unmount } = mount(
      <RunReview
        project={project}
        detail={detail}
        actorId="owner"
        reviewerId="reviewer"
        team
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Accept this commit" }),
    ).toBeNull();
    unmount();
    mount(
      <RunReview
        project={{ ...project, role: "reviewer" }}
        detail={detail}
        actorId="reviewer"
        reviewerId="reviewer"
        team
      />,
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Accept this commit",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("Review note"), {
      target: { value: "Reviewed all criteria" },
    });
    expect(
      (
        screen.getByRole("button", {
          name: "Accept this commit",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
  it("keeps recovery reachable when the worktree is missing", async () => {
    vi.mocked(collaborationApi.run).mockResolvedValue({
      ...detail,
      git: {
        commit: "",
        dirty: true,
        files: [],
        error: "WORKSPACE_UNAVAILABLE",
      },
      verifications: [{ ...detail.verifications[0]!, current: false }],
    });
    mount(
      <RunPanel
        project={project}
        runId="run"
        actorId="dev"
        team
        onRecovered={() => {}}
      />,
    );
    await screen.findByText(/The worktree is unavailable/);
    expect(screen.queryByRole("button", { name: "Run verification" })).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "Create recovery attempt",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(
      (
        screen.getByRole("button", {
          name: "Close attempt safely",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
  it("does not revive an older accepted review after a newer review decision", async () => {
    const oldReview = {
      id: "old",
      actorId: "owner",
      actorLabel: "Owner",
      commit: "commit456",
      verificationId: "receipt",
      decision: "accepted" as const,
      note: "Prior acceptance",
      createdAt: 1,
    };
    vi.mocked(collaborationApi.run).mockResolvedValue({
      ...detail,
      reviews: [
        {
          ...oldReview,
          id: "latest",
          commit: "another-commit",
          decision: "changes_requested",
          createdAt: 2,
        },
        oldReview,
      ],
    });
    mount(
      <RunPanel
        project={project}
        runId="run"
        actorId="owner"
        team
        onRecovered={() => {}}
      />,
    );
    const integrate = await screen.findByRole("button", {
      name: "Integrate accepted commit",
    });
    expect((integrate as HTMLButtonElement).disabled).toBe(true);
  });
  it("preserves the member draft when a new policy revision arrives", async () => {
    function Harness() {
      const [updated, setUpdated] = useState(false);
      return (
        <>
          <button onClick={() => setUpdated(true)}>Receive newer policy</button>
          <ProjectMembers
            detail={{
              ...workspace,
              project: updated
                ? {
                    ...project,
                    revision: 8,
                    verification: { ...project.verification!, command: "node" },
                  }
                : project,
            }}
          />
        </>
      );
    }
    mount(<Harness />);
    fireEvent.change(screen.getByLabelText("Registered account email"), {
      target: { value: "new-member@example.com" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Receive newer policy" }),
    );
    expect(
      (screen.getByLabelText("Registered account email") as HTMLInputElement)
        .value,
    ).toBe("new-member@example.com");
  });
  it("locks new delivery mutations during a pending operation while keeping safe recovery visible", async () => {
    vi.mocked(collaborationApi.run).mockResolvedValue({
      ...detail,
      run: {
        ...run,
        sessionId: "private",
        operation: { kind: "verify", phase: "interrupted" },
      },
    });
    mount(
      <RunPanel
        project={project}
        runId="run"
        actorId="dev"
        team={false}
        onRecovered={() => {}}
      />,
    );
    await screen.findByText(/previous delivery operation was interrupted/);
    expect(
      screen.queryByRole("link", { name: "Open private terminal" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Run verification" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Review note"), {
      target: { value: "Cannot accept an unresolved operation" },
    });
    expect(
      (
        screen.getByRole("button", {
          name: "Accept this commit",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Create recovery attempt",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
});

describe('team capabilities and Git delivery',()=>{
 it('does not let a management-only team admin prepare or verify execution',async()=>{
 const adminProject={...project,role:'admin' as const,teamId:'team',capabilities:['read','manage']};
 mount(<><TaskExecutionPanel detail={{...workspace,project:adminProject}} taskId="task" actorId="owner"/><RunPanel project={adminProject} actorId="owner" runId="run" team onRecovered={vi.fn()}/></>);
 await screen.findByRole('heading', {name: 'Development attempts'});
 expect(screen.queryByRole('button',{name:'Prepare isolated attempt'})).toBeNull();
 expect(screen.queryByRole('link',{name:'Open private terminal'})).toBeNull();
 expect(screen.queryByRole('button',{name:'Run verification'})).toBeNull();
 expect(screen.queryByRole('button',{name:'Accept delivery'})).toBeNull();
 });
 it('reconciles the selected commit under a stable request key while preserving dirty-workspace intent',async()=>{
 const reconcile=vi.spyOn(collaborationApi,'reconcile').mockResolvedValue({run:{...run,id:'new-run'}});const onReconciled=vi.fn();
 mount(<RunGitDelivery project={project} detail={{...detail,git:{...detail.git,dirty:true}}} executor onReconciled={onReconciled}/>);
 fireEvent.click(screen.getByRole('button',{name:'Reconcile with latest source'}));expect(reconcile).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Confirm'}));
 await waitFor(()=>expect(reconcile).toHaveBeenCalledWith('project',run.id,'commit456',expect.any(String)));
 expect(onReconciled).toHaveBeenCalledWith('new-run');
 });
 it('uses the exact current receipt for explicit draft PR and clears transient token on uncertain response',async()=>{
 const create=vi.spyOn(collaborationApi,'pullRequest').mockRejectedValue(new Error('GITHUB_RESPONSE_UNCERTAIN'));
 mount(<RunGitDelivery project={project} detail={detail} executor onReconciled={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'Create draft GitHub PR'}));
 fireEvent.change(screen.getByLabelText('GitHub repository (owner/repo)'),{target:{value:'studio/app'}});
 fireEvent.change(screen.getByLabelText('Remote base branch'),{target:{value:'main'}});
 fireEvent.change(screen.getByLabelText('PR title'),{target:{value:'Verified change'}});
 fireEvent.change(screen.getByLabelText('GitHub token (used only for this request)'),{target:{value:'one-request-secret'}});
 fireEvent.click(screen.getByRole('checkbox'));
 fireEvent.click(screen.getAllByRole('button',{name:'Create draft GitHub PR'})[1]!);
 await waitFor(()=>expect(create).toHaveBeenCalledWith('project',run.id,expect.objectContaining({expectedCommit:'commit456',verificationId:detail.verifications[0]!.id,token:'one-request-secret',repository:'studio/app',baseBranch:'main'})));
 await waitFor(()=>expect((screen.getByLabelText('GitHub token (used only for this request)') as HTMLInputElement).value).toBe(''));
 expect((screen.getByLabelText('GitHub repository (owner/repo)') as HTMLInputElement).value).toBe('studio/app');
 expect(await screen.findByText(/The remote response is uncertain/)).toBeTruthy();
 });
});

describe('managed execution runtime capability', () => {
  it('blocks preparing with a legacy daemon and explains a graceful upgrade', async () => {
    const prepare = vi.spyOn(collaborationApi, 'prepare');
    const legacy = {...project, managedExecution: {supported: false, reason: 'SESSION_SERVER_UPGRADE_REQUIRED'}};
    mount(<TaskExecutionPanel detail={{...workspace, project: legacy}} taskId="task" actorId="dev" />);
    const button = await screen.findByRole('button', {name: 'Prepare isolated attempt'});
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/After all existing CLI sessions have finished normally, upgrade Session Server/)).toBeTruthy();
    fireEvent.click(button);
    expect(prepare).not.toHaveBeenCalled();
  });
  it('blocks new recovery and reconciliation without hiding an existing private terminal', async () => {
    const legacy = {...project, managedExecution: {supported: false, reason: 'SESSION_SERVER_UPGRADE_REQUIRED'}};
    vi.mocked(collaborationApi.run).mockResolvedValue({...detail, run: {...run, sessionId: 'existing-session'}});
    mount(<RunPanel project={legacy} runId="run" actorId="dev" team onRecovered={vi.fn()} />);
    expect((await screen.findByRole('button', {name: 'Create recovery attempt'}) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', {name: 'Reconcile with latest source'}) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('link', {name: 'Open private terminal'}).getAttribute('href')).toBe('/sessions/existing-session');
  });
});

it('explains a server-side runtime downgrade after the last capability refresh', async () => {
  const prepare = vi.spyOn(collaborationApi, 'prepare').mockRejectedValue(new Error('SESSION_SERVER_UPGRADE_REQUIRED'));
  mount(<TaskExecutionPanel detail={{...workspace, project: {...project, managedExecution: {supported: true, reason: null}}}} taskId="task" actorId="dev" />);
  fireEvent.click(await screen.findByRole('button', {name: 'Prepare isolated attempt'}));
  await screen.findByRole('alert');
  expect(screen.getByText(/After all existing CLI sessions have finished normally, upgrade Session Server/)).toBeTruthy();
  expect(prepare).toHaveBeenCalledTimes(1);
});
