// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LanguageProvider } from "@/hooks/use-language";
import { CopilotAutonomyPanel } from "@/components/copilot/copilot-autonomy-panel";

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const {
  roleRef,
  getRuntimeSettingsMock,
  updateRuntimeSettingsMock,
} = vi.hoisted(() => ({
  roleRef: { role: "admin" as "admin" | "user" },
  getRuntimeSettingsMock: vi.fn(),
  updateRuntimeSettingsMock: vi.fn(),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: roleRef.role === "admin" ? { role: "admin" } : { role: "user" } }),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getRuntimeSettings: getRuntimeSettingsMock,
    updateRuntimeSettings: updateRuntimeSettingsMock,
  };
});

function settingsState(overrides: Record<string, unknown> = {}) {
  return {
    readonly: false,
    settings: [
      { key: "registration", value: "open", source: "env", hot: true },
      { key: "mcp_enabled", value: false, source: "env", hot: false },
      { key: "session_prefix", value: "fb-", source: "env", hot: true },
      { key: "pm_auto_dispatch", value: false, source: "env", hot: true },
    ],
    ...overrides,
  };
}

function renderPanel() {
  return render(
    <LanguageProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <CopilotAutonomyPanel />
      </QueryClientProvider>
    </LanguageProvider>,
  );
}

describe("CopilotAutonomyPanel", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    roleRef.role = "admin";
    getRuntimeSettingsMock.mockResolvedValue(settingsState());
    updateRuntimeSettingsMock.mockImplementation(async (patch: Record<string, unknown>) =>
      settingsState({
        settings: [
          { key: "registration", value: "open", source: "env", hot: true },
          { key: "mcp_enabled", value: false, source: "env", hot: false },
          { key: "session_prefix", value: "fb-", source: "env", hot: true },
          { key: "pm_auto_dispatch", value: patch.pm_auto_dispatch ?? false, source: "settings", hot: true },
        ],
      }),
    );
  });

  it("renders the auto-advance switch from runtime settings without any adapter list", async () => {
    renderPanel();
    const switchEl = await screen.findByRole("switch", { name: "项目任务自动推进" });
    expect((switchEl as HTMLButtonElement).getAttribute("data-state") === "unchecked").toBe(true);
    expect(screen.queryByLabelText("pi")).toBeNull();
    expect(screen.queryByLabelText("claude")).toBeNull();
    expect(screen.queryByText(/未启用任何适配器/)).toBeNull();
  });

  it("saves the auto-advance switch immediately without a sticky save bar", async () => {
    renderPanel();
    const switchEl = await screen.findByRole("switch", { name: "项目任务自动推进" });
    expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
    fireEvent.click(switchEl);
    await waitFor(() =>
      expect(updateRuntimeSettingsMock).toHaveBeenCalledWith({ pm_auto_dispatch: true }),
    );
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "项目任务自动推进" }).getAttribute("data-state")).toBe("checked"),
    );
  });

  it("is hidden for non-admin users", async () => {
    roleRef.role = "user";
    renderPanel();
    await waitFor(() => expect(getRuntimeSettingsMock).not.toHaveBeenCalled());
    expect(screen.queryByRole("switch", { name: "项目任务自动推进" })).toBeNull();
  });

  it("renders read-only when FORGEBADGER_RUNTIME_SETTINGS_READONLY is on", async () => {
    getRuntimeSettingsMock.mockResolvedValue(settingsState({ readonly: true }));
    renderPanel();
    expect(await screen.findByText(/FORGEBADGER_RUNTIME_SETTINGS_READONLY/)).toBeTruthy();
    const switchEl = await screen.findByRole("switch", { name: "项目任务自动推进" });
    expect((switchEl as HTMLButtonElement).disabled).toBe(true);
  });
});
