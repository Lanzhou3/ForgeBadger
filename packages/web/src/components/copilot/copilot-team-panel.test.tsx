// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LanguageProvider } from "@/hooks/use-language";
import { CopilotTeamPanel } from "@/components/copilot/copilot-team-panel";
import { runtimeSettingsQueryKey } from "@/components/settings/InstanceRuntimeSettings";
import type { CopilotTeamMember, CopilotTeamRoster } from "@/lib/api";

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

const { roleRef, getRuntimeSettingsMock, updateRuntimeSettingsMock } = vi.hoisted(() => ({
  roleRef: { role: "admin" as "admin" | "user" },
  getRuntimeSettingsMock: vi.fn(),
  updateRuntimeSettingsMock: vi.fn()
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { role: roleRef.role } })
}));

vi.mock("@/components/adapter-select", () => ({
  AdapterSelect: ({ value, ariaLabel }: { value: string; ariaLabel?: string }) => (
    <span aria-label={ariaLabel}>{value}</span>
  )
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, getRuntimeSettings: getRuntimeSettingsMock, updateRuntimeSettings: updateRuntimeSettingsMock };
});

const member = (over: Partial<CopilotTeamMember> = {}): CopilotTeamMember => ({
  id: "codex-ab12",
  name: "小码",
  title: "后端工程师",
  description: "负责网关服务",
  adapter: "codex",
  roles: ["writer"],
  enabled: true,
  ...over
});

function state(
  roster: CopilotTeamRoster = { maxParallelWriters: 3, members: [member()] },
  extra: { readonly?: boolean; programmaticDispatch?: Record<string, boolean> } = {}
) {
  return {
    readonly: extra.readonly ?? false,
    settings: [
      { key: "pm_auto_dispatch", value: false, source: "env", hot: true },
      { key: "copilot_team", value: roster, source: "settings", hot: true }
    ],
    capabilities: extra.programmaticDispatch ? { programmaticDispatch: extra.programmaticDispatch } : {}
  };
}

let queryClient: QueryClient;
function renderPanel() {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <CopilotTeamPanel />
      </QueryClientProvider>
    </LanguageProvider>
  );
}

const sentRoster = () =>
  (updateRuntimeSettingsMock.mock.calls[0]?.[0] as { copilot_team: CopilotTeamRoster }).copilot_team;
const saveButton = () => screen.getByRole("button", { name: "保存" }) as HTMLButtonElement;

describe("CopilotTeamPanel", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    roleRef.role = "admin";
    getRuntimeSettingsMock.mockResolvedValue(state());
    updateRuntimeSettingsMock.mockImplementation(async (patch: { copilot_team: CopilotTeamRoster }) =>
      state(patch.copilot_team)
    );
  });

  it("renders saved members", async () => {
    renderPanel();
    expect(await screen.findByText("小码")).toBeTruthy();
    expect(screen.getByText("后端工程师")).toBeTruthy();
    expect(screen.getByText("Codex")).toBeTruthy();
    expect(screen.getByText("负责网关服务")).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });

  it("shows an empty state without members", async () => {
    getRuntimeSettingsMock.mockResolvedValue(state({ maxParallelWriters: 3, members: [] }));
    renderPanel();
    expect(await screen.findByText(/无法把 Goal 任务派发给 CLI/)).toBeTruthy();
  });

  it("adds a member and saves the exact roster shape", async () => {
    renderPanel();
    await screen.findByText("小码");
    fireEvent.click(screen.getByRole("button", { name: "添加成员" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "审查员" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "可审查" }));
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());
    await waitFor(() => expect(updateRuntimeSettingsMock).toHaveBeenCalledTimes(1));
    const roster = sentRoster();
    expect(roster.maxParallelWriters).toBe(3);
    expect(roster.members).toHaveLength(2);
    expect(roster.members[0]).toEqual(member());
    expect(roster.members[1]).toEqual({
      id: expect.stringMatching(/^[a-z0-9][a-z0-9-]{0,31}$/),
      name: "审查员",
      title: "",
      description: "",
      adapter: "claude",
      roles: ["writer", "reviewer"],
      enabled: true
    });
    await waitFor(() => expect(saveButton().disabled).toBe(true));
  });

  it("keeps the id when editing a member", async () => {
    renderPanel();
    await screen.findByText("小码");
    fireEvent.click(screen.getByRole("button", { name: "编辑 小码" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "大码" } });
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(updateRuntimeSettingsMock).toHaveBeenCalled());
    expect(sentRoster().members).toEqual([
      member({ name: "大码" })
    ]);
  });

  it("removes a member", async () => {
    renderPanel();
    await screen.findByText("小码");
    fireEvent.click(screen.getByRole("button", { name: "移除 小码" }));
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(updateRuntimeSettingsMock).toHaveBeenCalledWith({
        copilot_team: { maxParallelWriters: 3, members: [] }
      })
    );
  });

  it("blocks a member with no role", async () => {
    renderPanel();
    await screen.findByText("小码");
    fireEvent.click(screen.getByRole("button", { name: "添加成员" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "无角色" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "可写代码" }));
    expect(screen.getByText("至少选择一个角色。")).toBeTruthy();
    expect((screen.getByRole("button", { name: "完成" }) as HTMLButtonElement).disabled).toBe(true);
    expect(saveButton().disabled).toBe(true);
  });

  it("marks dirty when toggling enabled", async () => {
    renderPanel();
    const toggle = await screen.findByRole("switch", { name: "启用 小码" });
    fireEvent.click(toggle);
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());
    await waitFor(() => expect(updateRuntimeSettingsMock).toHaveBeenCalled());
    expect(sentRoster().members[0]?.enabled).toBe(false);
  });

  it("notes adapters that can only be operated manually", async () => {
    getRuntimeSettingsMock.mockResolvedValue(
      state({ maxParallelWriters: 3, members: [member()] }, { programmaticDispatch: { codex: false } })
    );
    renderPanel();
    expect((await screen.findByRole("note")).textContent).toContain("只能手动操作");
  });

  it("is read-only when runtime settings are locked", async () => {
    getRuntimeSettingsMock.mockResolvedValue(state(undefined, { readonly: true }));
    renderPanel();
    const toggle = await screen.findByRole("switch", { name: "启用 小码" });
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "添加成员" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "编辑 小码" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("并行写代码人数") as HTMLInputElement).disabled).toBe(true);
  });

  it("is hidden for non-admin users", async () => {
    roleRef.role = "user";
    renderPanel();
    await waitFor(() => expect(getRuntimeSettingsMock).not.toHaveBeenCalled());
    expect(screen.queryByText("团队成员")).toBeNull();
  });

  it("keeps unsaved edits when another card updates the shared query data", async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole("switch", { name: "启用 小码" }));
    const other = state();
    other.settings[0] = { key: "pm_auto_dispatch", value: true, source: "settings", hot: true };
    queryClient.setQueryData(runtimeSettingsQueryKey, other);
    await waitFor(() =>
      expect((queryClient.getQueryData(runtimeSettingsQueryKey) as typeof other).settings[0]?.value).toBe(true)
    );
    expect(screen.getByRole("switch", { name: "启用 小码" }).getAttribute("data-state")).toBe("unchecked");
    expect(saveButton().disabled).toBe(false);
  });
});
