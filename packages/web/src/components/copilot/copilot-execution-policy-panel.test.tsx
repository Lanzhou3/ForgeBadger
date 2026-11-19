// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LanguageProvider } from "@/hooks/use-language";
import { CopilotExecutionPolicyPanel } from "@/components/copilot/copilot-execution-policy-panel";

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const { roleRef, getRuntimeSettingsMock, updateRuntimeSettingsMock } = vi.hoisted(() => ({
  roleRef: { role: "admin" as "admin" | "user" },
  getRuntimeSettingsMock: vi.fn(),
  updateRuntimeSettingsMock: vi.fn(),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { role: roleRef.role } }),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getRuntimeSettings: getRuntimeSettingsMock,
    updateRuntimeSettings: updateRuntimeSettingsMock,
  };
});

function state({ autoDispatch = false, sandbox = false, available = true, readonly = false } = {}) {
  return {
    readonly,
    settings: [
      { key: "pm_auto_dispatch", value: autoDispatch, source: autoDispatch ? "settings" : "env", hot: true },
      { key: "goal_check_sandbox", value: sandbox, source: sandbox ? "settings" : "env", hot: true },
    ],
    capabilities: {
      goalCheckSandbox: available
        ? { available: true, reason: null }
        : { available: false, reason: "OS isolation for goal checks is only implemented for macOS" },
    },
  };
}

function renderPanel() {
  return render(
    <LanguageProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <CopilotExecutionPolicyPanel />
      </QueryClientProvider>
    </LanguageProvider>,
  );
}

describe("CopilotExecutionPolicyPanel", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    roleRef.role = "admin";
    getRuntimeSettingsMock.mockResolvedValue(state());
    updateRuntimeSettingsMock.mockImplementation(async (patch: Record<string, boolean>) =>
      state({
        autoDispatch: patch.pm_auto_dispatch ?? false,
        sandbox: patch.goal_check_sandbox ?? false,
      }),
    );
  });

  it("renders both instant-save policy switches under Execution & safety policy", async () => {
    renderPanel();
    expect(await screen.findByText("执行与安全策略")).toBeTruthy();
    const autoDispatchSwitch = await screen.findByRole("switch", { name: "项目任务自动推进" });
    const sandboxSwitch = await screen.findByRole("switch", { name: "隔离运行目标检查" });
    expect(autoDispatchSwitch.getAttribute("data-state")).toBe("unchecked");
    expect(sandboxSwitch.getAttribute("data-state")).toBe("unchecked");
    expect(screen.queryByRole("button", { name: "保存" })).toBeNull();

    fireEvent.click(autoDispatchSwitch);
    await waitFor(() => expect(updateRuntimeSettingsMock).toHaveBeenCalledWith({ pm_auto_dispatch: true }));

    fireEvent.click(screen.getByRole("switch", { name: "隔离运行目标检查" }));
    await waitFor(() => expect(updateRuntimeSettingsMock).toHaveBeenCalledWith({ goal_check_sandbox: true }));
  });

  it("cannot turn sandbox on when unavailable, but can still turn it off", async () => {
    getRuntimeSettingsMock.mockResolvedValue(state({ available: false }));
    renderPanel();
    const sandboxSwitch = await screen.findByRole("switch", { name: "隔离运行目标检查" });
    expect((sandboxSwitch as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("note").textContent).toContain("only implemented for macOS");

    cleanup();
    getRuntimeSettingsMock.mockResolvedValue(state({ available: false, sandbox: true }));
    renderPanel();
    const enabledSwitch = await screen.findByRole("switch", { name: "隔离运行目标检查" });
    expect((enabledSwitch as HTMLButtonElement).disabled).toBe(false);
  });

  it("locks both switches when FORGEBADGER_RUNTIME_SETTINGS_READONLY is active", async () => {
    getRuntimeSettingsMock.mockResolvedValue(state({ readonly: true }));
    renderPanel();
    expect(await screen.findByText(/FORGEBADGER_RUNTIME_SETTINGS_READONLY/)).toBeTruthy();
    expect((screen.getByRole("switch", { name: "项目任务自动推进" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("switch", { name: "隔离运行目标检查" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("is hidden for non-admin users", async () => {
    roleRef.role = "user";
    renderPanel();
    await waitFor(() => expect(getRuntimeSettingsMock).not.toHaveBeenCalled());
    expect(screen.queryByText("执行与安全策略")).toBeNull();
  });
});
