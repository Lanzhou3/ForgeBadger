// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getTranslation } from "@/lib/i18n";
import { getProjectTaskContext } from "@/lib/project-task-api";
import { collaborationApi } from "@/lib/collaboration-api";
import Page from "./page";
const spies = vi.hoisted(() => ({ private: vi.fn(), panel: vi.fn(), projectId: "p" }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: spies.projectId }),
  useSearchParams: () =>
    new URLSearchParams("tab=project-manager&workItemId=t"),
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "reviewer" } }),
}));
vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({
    t: (key: Parameters<typeof getTranslation>[1]) => getTranslation("en", key),
  }),
}));
vi.mock("@/lib/project-task-api", () => ({ getProjectTaskContext: vi.fn() }));
vi.mock("@/components/projects/PrivateProjectPage", () => ({
  default: (props: unknown) => {
    spies.private(props);
    return <p>Private project</p>;
  },
}));
vi.mock("@/components/projects/ProjectManagerPanel", () => ({
  ProjectManagerPanel: (props: unknown) => {
    spies.panel(props);
    const [draft, setDraft] = useState("");
    return <><p>Unified tasks</p><input aria-label="PM draft" value={draft} onChange={event => setDraft(event.target.value)} /></>;
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  spies.projectId = "p";
  vi.spyOn(collaborationApi, "project").mockResolvedValue({
    project: {
      id: "p",
      name: "Shared",
      role: "reviewer",
      capabilities: ["read", "review"],
      memberCount: 2,
      revision: 0,
      verificationRevision: 0,
      executionEnabled: false,
      verification: null,
    },
    members: [],
    tasks: [],
    events: [],
  });
});
afterEach(cleanup);
function mount() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Page />
    </QueryClientProvider>,
  );
}
it("gates all private hooks behind safe context and renders shared reviewer capabilities", async () => {
  vi.mocked(getProjectTaskContext).mockResolvedValue({
    project: { id: "p", name: "Shared", description: null, status: "active" },
    access: {
      role: "reviewer",
      capabilities: ["read", "review"],
      teamId: "team",
      logicalOwnerId: "owner",
    },
    managedExecution: { supported: true, reason: null },
    shared: true,
    privateDetailAllowed: false,
    revisionRequired: true,
  });
  mount();
  await screen.findByText("Unified tasks");
  expect(spies.private).not.toHaveBeenCalled();
  expect(spies.panel).toHaveBeenCalledWith(
    expect.objectContaining({
      selectedWorkItemId: "t",
      authority: expect.objectContaining({
        canEdit: false,
        canManage: false,
        legacySessions: false,
      }),
    }),
  );
});
it("fails closed on a rejected context without fetching project detail", async () => {
  vi.mocked(getProjectTaskContext).mockRejectedValue(
    new Error("PROJECT_CAPABILITY_DENIED"),
  );
  mount();
  await screen.findByRole("alert");
  expect(spies.private).not.toHaveBeenCalled();
  expect(spies.panel).not.toHaveBeenCalled();
  expect(collaborationApi.project).not.toHaveBeenCalled();
});
it("does not mount private views while the context is unresolved", async () => {
  vi.mocked(getProjectTaskContext).mockReturnValue(new Promise(() => {}));
  mount();
  await screen.findByRole("status");
  await waitFor(() => expect(getProjectTaskContext).toHaveBeenCalled());
  expect(spies.private).not.toHaveBeenCalled();
  expect(collaborationApi.project).not.toHaveBeenCalled();
});

it("resets project drafts when navigating directly between cached project contexts", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  for (const id of ["p", "q"]) {
    client.setQueryData(["project-task-context", id, "reviewer"], {
      project: { id, name: id, description: null, status: "active" },
      access: { role: "reviewer", capabilities: ["read", "review"], teamId: "team", logicalOwnerId: "owner" },
      managedExecution: { supported: true, reason: null }, shared: true, privateDetailAllowed: false, revisionRequired: true,
    });
    client.setQueryData(["collaboration", id, "project", "reviewer"], {
      project: { id, name: id, role: "reviewer", capabilities: ["read", "review"], memberCount: 2, revision: 1, verificationRevision: 1, executionEnabled: false, verification: null },
      members: [], tasks: [], events: [],
    });
  }
  const view = () => <QueryClientProvider client={client}><Page /></QueryClientProvider>;
  const mounted = render(view());
  fireEvent.change(await screen.findByLabelText("PM draft"), { target: { value: "Project P draft" } });
  spies.projectId = "q";
  mounted.rerender(view());
  expect((await screen.findByLabelText("PM draft") as HTMLInputElement).value).toBe("");
});

for (const governed of [false,true]) it(`keeps original CLI task controls ${governed ? "disabled for governed owners" : "available for personal owners"}`,async()=>{
 vi.mocked(getProjectTaskContext).mockResolvedValue({project:{id:"p",name:"Private",description:null,status:"active"},access:{role:"owner",capabilities:["read","develop","manage"],teamId:governed?"team":null,logicalOwnerId:"reviewer"},managedExecution:{supported:false,reason:"SESSION_SERVER_UPGRADE_REQUIRED"},shared:false,privateDetailAllowed:true,revisionRequired:governed});
 mount();await screen.findByText("Private project");
 expect(spies.private).toHaveBeenCalledWith(expect.objectContaining({taskAuthority:expect.objectContaining({legacySessions:!governed})}));
 expect(spies.panel).not.toHaveBeenCalled();
});
