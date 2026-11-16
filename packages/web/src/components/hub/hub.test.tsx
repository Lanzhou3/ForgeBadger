// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTranslation } from "@/lib/i18n";
import type { WorkspaceDetail } from "@/lib/collaboration-api";
import { hubApi, type HubConfirmation, type HubTaskDetail } from "@/lib/hub-api";
import { HubProjectPanel } from "./HubProjectPanel";
import { TaskHubDelivery } from "./TaskHubDelivery";

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ language: "en", t: (key: Parameters<typeof getTranslation>[1]) => getTranslation("en", key) }),
  useUiLocale: () => "en-US",
}));

const COMMIT = "a".repeat(40);
const en = (key: Parameters<typeof getTranslation>[1]) => getTranslation("en", key);

function detail(capabilities: string[]): WorkspaceDetail {
  return {
    project: { id: "project", name: "Project", memberCount: 2, role: "developer", capabilities, revision: 1, verificationRevision: 0, executionEnabled: false, verification: null },
    members: [
      { userId: "dev", email: "dev@hub.test", role: "developer", state: "active", revision: 1 },
      { userId: "rev", email: "rev@hub.test", role: "reviewer", state: "active", revision: 1 },
    ],
    tasks: [],
    events: [],
  };
}

function taskDetail(overrides: Partial<HubTaskDetail["task"]> = {}, confirmations: HubConfirmation[] = [], withSubmission = false, prUrl: string | null = "https://github.com/acme/repo/pull/1"): HubTaskDetail {
  const submission = { id: "sub", taskId: "task", actorId: "dev", branch: "fb/1-module", commitSha: COMMIT, prUrl, checksStatus: "passed" as const, checksSummary: "42 passed", taskSemanticRevision: 2, createdAt: 1 };
  return {
    task: { id: "task", title: "Build", status: "in_progress", revision: 3, semanticRevision: 2, assigneeId: "dev", reviewerId: "rev", latestSubmission: null, ...overrides },
    submissions: withSubmission ? [{ ...submission, confirmations }] : [],
  };
}

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(cleanup);

describe("TaskHubDelivery", () => {
  it("lets a developer claim an unassigned task with the current revision", async () => {
    vi.spyOn(hubApi, "task").mockResolvedValue(taskDetail({ status: "todo", assigneeId: null }));
    const claim = vi.spyOn(hubApi, "claim").mockResolvedValue({ task: taskDetail().task });
    wrap(<TaskHubDelivery detail={detail(["read", "comment", "develop"])} taskId="task" actorId="dev" />);
    fireEvent.click(await screen.findByRole("button", { name: en("hub.claim") }));
    await waitFor(() => expect(claim).toHaveBeenCalledWith("project", "task", 3));
    expect(screen.queryByRole("button", { name: en("hub.submit") })).toBeNull();
  });

  it("hides claim from members who cannot develop", async () => {
    vi.spyOn(hubApi, "task").mockResolvedValue(taskDetail({ status: "todo", assigneeId: null }));
    wrap(<TaskHubDelivery detail={detail(["read", "comment", "review"])} taskId="task" actorId="rev" />);
    await screen.findByText(en("hub.noSubmission"));
    expect(screen.queryByRole("button", { name: en("hub.claim") })).toBeNull();
  });

  it("submits the assignee's trimmed branch, commit and checks", async () => {
    vi.spyOn(hubApi, "task").mockResolvedValue(taskDetail());
    const submit = vi.spyOn(hubApi, "submit").mockResolvedValue({ task: taskDetail().task, submission: taskDetail({}, [], true).submissions[0]! });
    wrap(<TaskHubDelivery detail={detail(["read", "comment", "develop"])} taskId="task" actorId="dev" />);
    fireEvent.change(await screen.findByLabelText(en("hub.branch")), { target: { value: " fb/1-module " } });
    fireEvent.change(screen.getByLabelText(en("hub.commit")), { target: { value: COMMIT } });
    fireEvent.change(screen.getByLabelText(en("hub.checks")), { target: { value: "not_run" } });
    fireEvent.click(screen.getByRole("button", { name: en("hub.submit") }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith("project", "task", {
      expectedRevision: 3, branch: "fb/1-module", commitSha: COMMIT, prUrl: null, checksStatus: "not_run", checksSummary: "",
    }));
  });

  it("does not offer the submit form to someone who is not the assignee", async () => {
    vi.spyOn(hubApi, "task").mockResolvedValue(taskDetail());
    wrap(<TaskHubDelivery detail={detail(["read", "comment", "develop"])} taskId="task" actorId="other" />);
    await screen.findByText(en("hub.noSubmission"));
    expect(screen.queryByRole("button", { name: en("hub.submit") })).toBeNull();
  });

  it("requires a note before the reviewer can confirm the latest submission", async () => {
    vi.spyOn(hubApi, "task").mockResolvedValue(taskDetail({ status: "ready_for_review" }, [], true));
    const confirm = vi.spyOn(hubApi, "confirm").mockResolvedValue({ task: taskDetail().task, confirmation: {} as HubConfirmation });
    wrap(<TaskHubDelivery detail={detail(["read", "comment", "review"])} taskId="task" actorId="rev" />);
    const accept = await screen.findByRole("button", { name: en("hub.accept") });
    expect(accept).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText(en("hub.confirmNote")), { target: { value: " looks good " } });
    fireEvent.click(accept);
    await waitFor(() => expect(confirm).toHaveBeenCalledWith("project", "task", { expectedRevision: 3, submissionId: "sub", decision: "accepted", note: "looks good" }));
    expect(screen.getByRole("link", { name: en("hub.openPr") }).getAttribute("href")).toBe("https://github.com/acme/repo/pull/1");
  });

  it("never offers confirmation of one's own or a stale submission", async () => {
    vi.spyOn(hubApi, "task").mockResolvedValue(taskDetail({ status: "ready_for_review" }, [], true));
    const own = wrap(<TaskHubDelivery detail={detail(["read", "comment", "develop", "review", "manage"])} taskId="task" actorId="dev" />);
    await screen.findByText(en("hub.ownSubmission"));
    expect(screen.queryByRole("button", { name: en("hub.accept") })).toBeNull();
    own.unmount();

    vi.spyOn(hubApi, "task").mockResolvedValue(taskDetail({ status: "ready_for_review", semanticRevision: 5 }, [], true));
    wrap(<TaskHubDelivery detail={detail(["read", "comment", "review"])} taskId="task" actorId="rev" />);
    await screen.findByText(en("hub.stale"));
    expect(screen.queryByRole("button", { name: en("hub.accept") })).toBeNull();
  });

  it("restricts confirmation to the assigned reviewer unless the actor manages the project", async () => {
    vi.spyOn(hubApi, "task").mockResolvedValue(taskDetail({ status: "ready_for_review" }, [], true));
    const other = wrap(<TaskHubDelivery detail={detail(["read", "comment", "review"])} taskId="task" actorId="other" />);
    await screen.findByText(en("hub.reviewerOnly"));
    other.unmount();
    wrap(<TaskHubDelivery detail={detail(["read", "comment", "review", "manage"])} taskId="task" actorId="owner" />);
    expect(await screen.findByRole("button", { name: en("hub.accept") })).toBeTruthy();
  });

  it("marks advisory records and refuses to link an unsafe pull request URL", async () => {
    const advisory: HubConfirmation = { id: "c1", submissionId: "sub", actorId: "rev", actorKind: "copilot", effect: "advisory", decision: "accepted", note: "suggest accept", commitSha: COMMIT, createdAt: 2 };
    vi.spyOn(hubApi, "task").mockResolvedValue(taskDetail({ status: "ready_for_review" }, [advisory], true, "javascript:alert(1)"));
    wrap(<TaskHubDelivery detail={detail(["read"])} taskId="task" actorId="viewer" />);
    await screen.findByText(en("hub.advisory"));
    expect(screen.getByText("suggest accept")).toBeTruthy();
    expect(screen.queryByRole("link", { name: en("hub.openPr") })).toBeNull();
  });
});

describe("HubProjectPanel", () => {
  const info = (remoteUrl: string | null) => ({
    project: { id: "project", name: "Project", role: "developer", capabilities: ["read"] },
    actorId: "dev",
    settings: { provider: remoteUrl ? "gitee" as const : null, remoteUrl, defaultBranch: remoteUrl ? "main" : null, confirmationPolicy: "human_only", revision: remoteUrl ? 1 : 0 },
  });
  const token = { id: "t1", projectId: "project", name: "laptop", createdAt: 1, expiresAt: Date.now() + 86_400_000, lastUsedAt: null, revokedAt: null };

  it("shows a new token once and lets the holder revoke only this project's tokens", async () => {
    vi.spyOn(hubApi, "project").mockResolvedValue(info("git@gitee.com:acme/repo.git"));
    vi.spyOn(hubApi, "tokens").mockResolvedValue({ tokens: [token, { ...token, id: "t2", projectId: "elsewhere", name: "other-project" }] });
    const create = vi.spyOn(hubApi, "createToken").mockResolvedValue({ token: "fbnode_secret", record: token });
    const revoke = vi.spyOn(hubApi, "revokeToken").mockResolvedValue({ revoked: true });
    wrap(<HubProjectPanel projectId="project" canManage={false} />);

    expect(await screen.findByText("laptop")).toBeTruthy();
    expect(screen.queryByText("other-project")).toBeNull();
    expect(screen.getByText("git@gitee.com:acme/repo.git")).toBeTruthy();
    expect(screen.queryByRole("button", { name: en("hub.save") })).toBeNull();

    fireEvent.change(screen.getByLabelText(en("hub.tokenName")), { target: { value: " desktop " } });
    fireEvent.click(screen.getByRole("button", { name: en("hub.createToken") }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ projectId: "project", name: "desktop", expiresInDays: 30 }));
    expect(await screen.findByText("fbnode_secret")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: en("hub.revoke") }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("t1"));
  });

  it("lets a manager save the repository with the settings revision", async () => {
    vi.spyOn(hubApi, "project").mockResolvedValue(info(null));
    vi.spyOn(hubApi, "tokens").mockResolvedValue({ tokens: [] });
    const save = vi.spyOn(hubApi, "putSettings").mockResolvedValue({ settings: info("https://github.com/acme/repo.git").settings });
    wrap(<HubProjectPanel projectId="project" canManage />);
    fireEvent.change(await screen.findByLabelText(en("hub.remoteUrl")), { target: { value: "https://github.com/acme/repo.git" } });
    fireEvent.click(screen.getByRole("button", { name: en("hub.save") }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("project", { expectedRevision: 0, provider: "github", remoteUrl: "https://github.com/acme/repo.git", defaultBranch: "main" }));
    expect(screen.getByText(en("hub.noTokens"))).toBeTruthy();
  });
});

describe("TeamHubLink", () => {
  const link = { id: "link", hubUrl: "https://forge.lan", hubProjectId: "hp", hubProjectName: "Shared", hubActorId: "dev", localProjectId: "local", lastSyncedAt: 1, lastError: null, createdAt: 1 };
  const settings = { provider: "github" as const, remoteUrl: "https://github.com/acme/repo.git", defaultBranch: "main", confirmationPolicy: "human_only", revision: 1 };
  const linkTask = (overrides: Record<string, unknown>) => ({
    ...taskDetail().task, description: null, acceptanceCriteria: [], mine: true, localWorkItemId: null, suggestedBranch: "fb/task-build", ...overrides,
  });
  const sync = (tasks: ReturnType<typeof linkTask>[]) => ({ link, settings, tasks });

  it("offers to connect an unlinked project and sends the token only in the request", async () => {
    const { hubLinkApi } = await import("@/lib/hub-link-api");
    vi.spyOn(hubLinkApi, "list").mockResolvedValue({ links: [{ ...link, localProjectId: "another" }] });
    const connect = vi.spyOn(hubLinkApi, "connect").mockResolvedValue({ link });
    const { TeamHubLink } = await import("./TeamHubLink");
    wrap(<TeamHubLink projectId="local" enabled />);
    fireEvent.change(await screen.findByLabelText(en("hubLink.hubUrl")), { target: { value: " https://forge.lan " } });
    const token = screen.getByLabelText(en("hubLink.token"));
    expect(token.getAttribute("type")).toBe("password");
    fireEvent.change(token, { target: { value: "fbnode_secret" } });
    fireEvent.click(screen.getByRole("button", { name: en("hubLink.connectAction") }));
    await waitFor(() => expect(connect).toHaveBeenCalledWith({ hubUrl: "https://forge.lan", token: "fbnode_secret", localProjectId: "local" }));
    await waitFor(() => expect((token as HTMLInputElement).value).toBe(""));
  });

  it("lists only actionable tasks and blocks submitting until the branch is clean and pushed", async () => {
    const { hubLinkApi } = await import("@/lib/hub-link-api");
    vi.spyOn(hubLinkApi, "list").mockResolvedValue({ links: [link] });
    vi.spyOn(hubLinkApi, "sync").mockResolvedValue(sync([
      linkTask({ id: "mine", title: "My task" }),
      linkTask({ id: "free", title: "Free task", mine: false, assigneeId: null, status: "todo" }),
      linkTask({ id: "theirs", title: "Their task", mine: false, assigneeId: "someone" }),
      linkTask({ id: "finished", title: "Done task", status: "done" }),
    ]));
    vi.spyOn(hubLinkApi, "git").mockResolvedValue({ git: { branch: "fb/task-build", commit: COMMIT, dirty: true, pushed: false } });
    const claim = vi.spyOn(hubLinkApi, "claim").mockResolvedValue({ task: linkTask({}) });
    const createLocal = vi.spyOn(hubLinkApi, "createLocalTask").mockResolvedValue({ workItemId: "w", suggestedBranch: "fb/task-build" });
    const { TeamHubLink } = await import("./TeamHubLink");
    wrap(<TeamHubLink projectId="local" enabled />);

    expect(await screen.findByText("My task")).toBeTruthy();
    expect(screen.getByText("Free task")).toBeTruthy();
    expect(screen.queryByText("Their task")).toBeNull();
    expect(screen.queryByText("Done task")).toBeNull();
    expect(screen.getByText(new RegExp(en("hubLink.gitDirty")))).toBeTruthy();
    expect(screen.getByRole("button", { name: en("hub.submit") })).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("button", { name: en("hub.claim") }));
    await waitFor(() => expect(claim).toHaveBeenCalledWith("link", "free"));
    fireEvent.click(screen.getByRole("button", { name: en("hubLink.createLocal") }));
    await waitFor(() => expect(createLocal).toHaveBeenCalledWith("link", "mine"));
  });

  it("submits the current branch with checks once Git is ready", async () => {
    const { hubLinkApi } = await import("@/lib/hub-link-api");
    vi.spyOn(hubLinkApi, "list").mockResolvedValue({ links: [link] });
    vi.spyOn(hubLinkApi, "sync").mockResolvedValue(sync([linkTask({ id: "mine", title: "My task" })]));
    vi.spyOn(hubLinkApi, "git").mockResolvedValue({ git: { branch: "fb/task-build", commit: COMMIT, dirty: false, pushed: true } });
    const submit = vi.spyOn(hubLinkApi, "submit").mockResolvedValue({ task: linkTask({}) });
    const { TeamHubLink } = await import("./TeamHubLink");
    wrap(<TeamHubLink projectId="local" enabled />);
    await screen.findByText(new RegExp(en("hubLink.gitReady")));
    fireEvent.change(screen.getByLabelText(en("hub.checksSummary")), { target: { value: " 12 passed " } });
    fireEvent.click(screen.getByRole("button", { name: en("hub.submit") }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith("link", "mine", { prUrl: null, checksStatus: "passed", checksSummary: "12 passed" }));
  });
});

describe("TeamHubLink access", () => {
  it("renders nothing for users who are not the instance admin, and a real error otherwise", async () => {
    const { hubLinkApi } = await import("@/lib/hub-link-api");
    const { TeamHubLink } = await import("./TeamHubLink");
    vi.spyOn(hubLinkApi, "list").mockRejectedValue(new Error("HUB_LINK_ADMIN_REQUIRED"));
    const denied = wrap(<TeamHubLink projectId="local" enabled />);
    await waitFor(() => expect(hubLinkApi.list).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(denied.container.textContent).toBe("");
    denied.unmount();

    vi.spyOn(hubLinkApi, "list").mockRejectedValue(new Error("Cannot reach the Gateway"));
    wrap(<TeamHubLink projectId="local" enabled />);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
