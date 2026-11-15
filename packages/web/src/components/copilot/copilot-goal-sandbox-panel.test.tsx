// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LanguageProvider } from "@/hooks/use-language";
import { CopilotGoalSandboxPanel } from "@/components/copilot/copilot-goal-sandbox-panel";

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

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, getRuntimeSettings: getRuntimeSettingsMock, updateRuntimeSettings: updateRuntimeSettingsMock };
});

function state({ enabled = false, available = true, readonly = false } = {}) {
  return {
    readonly,
    settings: [
      { key: "pm_auto_dispatch", value: false, source: "env", hot: true },
      { key: "goal_check_sandbox", value: enabled, source: enabled ? "settings" : "env", hot: true }
    ],
    capabilities: {
      goalCheckSandbox: available
        ? { available: true, reason: null }
        : { available: false, reason: "OS isolation for goal checks is only implemented for macOS" }
    }
  };
}

function renderPanel() {
  return render(
    <LanguageProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <CopilotGoalSandboxPanel />
      </QueryClientProvider>
    </LanguageProvider>
  );
}

const switchName = "隔离运行 Goal 检查";

describe("CopilotGoalSandboxPanel", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    roleRef.role = "admin";
    getRuntimeSettingsMock.mockResolvedValue(state());
    updateRuntimeSettingsMock.mockImplementation(async (patch: { goal_check_sandbox: boolean }) =>
      state({ enabled: patch.goal_check_sandbox })
    );
  });

  it("saves the switch immediately and reflects the saved value", async () => {
    renderPanel();
    const switchEl = await screen.findByRole("switch", { name: switchName });
    expect(switchEl.getAttribute("data-state")).toBe("unchecked");
    fireEvent.click(switchEl);
    await waitFor(() => expect(updateRuntimeSettingsMock).toHaveBeenCalledWith({ goal_check_sandbox: true }));
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: switchName }).getAttribute("data-state")).toBe("checked")
    );
  });

  it("cannot be turned on where the host cannot isolate, but can still be turned off", async () => {
    getRuntimeSettingsMock.mockResolvedValue(state({ available: false }));
    renderPanel();
    const switchEl = await screen.findByRole("switch", { name: switchName });
    expect((switchEl as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("note").textContent).toContain("only implemented for macOS");

    cleanup();
    getRuntimeSettingsMock.mockResolvedValue(state({ available: false, enabled: true }));
    renderPanel();
    const enabledSwitch = await screen.findByRole("switch", { name: switchName });
    expect((enabledSwitch as HTMLButtonElement).disabled).toBe(false);
  });

  it("is read-only when runtime settings are locked", async () => {
    getRuntimeSettingsMock.mockResolvedValue(state({ readonly: true }));
    renderPanel();
    const switchEl = await screen.findByRole("switch", { name: switchName });
    expect((switchEl as HTMLButtonElement).disabled).toBe(true);
  });

  it("is hidden for non-admin users", async () => {
    roleRef.role = "user";
    renderPanel();
    await waitFor(() => expect(getRuntimeSettingsMock).not.toHaveBeenCalled());
    expect(screen.queryByRole("switch", { name: switchName })).toBeNull();
  });
});
