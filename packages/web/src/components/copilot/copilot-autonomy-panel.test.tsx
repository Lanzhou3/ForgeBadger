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
  }
);

const {
  roleRef,
  getRuntimeSettingsMock,
  updateRuntimeSettingsMock,
  discoverAdaptersMock
} = vi.hoisted(() => ({
  roleRef: { role: "admin" as "admin" | "user" },
  getRuntimeSettingsMock: vi.fn(),
  updateRuntimeSettingsMock: vi.fn(),
  discoverAdaptersMock: vi.fn()
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: roleRef.role === "admin" ? { role: "admin" } : { role: "user" } })
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getRuntimeSettings: getRuntimeSettingsMock,
    updateRuntimeSettings: updateRuntimeSettingsMock,
    discoverAdapters: discoverAdaptersMock
  };
});

function settingsState(overrides: Record<string, unknown> = {}) {
  return {
    readonly: false,
    settings: [
      { key: "registration", value: "open", source: "env", hot: true },
      { key: "mcp_enabled", value: false, source: "env", hot: false },
      { key: "session_prefix", value: "fb-", source: "env", hot: true },
      { key: "cli_autonomy_adapters", value: ["pi"], source: "settings", hot: true },
      { key: "pm_auto_dispatch", value: true, source: "settings", hot: true }
    ],
    ...overrides
  };
}

function renderPanel() {
  return render(
    <LanguageProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <CopilotAutonomyPanel />
      </QueryClientProvider>
    </LanguageProvider>
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
          { key: "cli_autonomy_adapters", value: patch.cli_autonomy_adapters ?? [], source: "settings", hot: true },
          { key: "pm_auto_dispatch", value: patch.pm_auto_dispatch ?? false, source: "settings", hot: true }
        ]
      })
    );
    discoverAdaptersMock.mockResolvedValue({
      adapters: [
        { id: "pi", label: "Pi", command: "pi", supportLevel: "supported", launchEnabled: true, configDir: "~/.pi", runtimeModes: ["terminal"], available: true, status: "available" },
        { id: "claude", label: "Claude Code", command: "claude", supportLevel: "supported", launchEnabled: true, configDir: "~/.claude", runtimeModes: ["terminal"], available: false, status: "missing" }
      ]
    });
  });

  it("renders the enabled adapters and marks detection status", async () => {
    renderPanel();
    const piBox = await screen.findByLabelText("pi");
    const claudeBox = screen.getByLabelText("claude");
    expect(screen.getByText("派发自主权")).toBeTruthy();
    expect((piBox as HTMLButtonElement).hasAttribute("data-state-checked") || (piBox as HTMLButtonElement).getAttribute("data-state") === "checked").toBe(true);
    expect((claudeBox as HTMLButtonElement).getAttribute("data-state") === "unchecked").toBe(true);
    expect(screen.getByText("本机已检测到")).toBeTruthy();
    expect(screen.getByText("未检测到 CLI")).toBeTruthy();
  });

  it("saves the adapter selection and auto-advance switch", async () => {
    renderPanel();
    await screen.findByLabelText("claude");
    fireEvent.click(screen.getByLabelText("claude"));
    const save = screen.getByRole("button", { name: "保存" });
    expect((save as HTMLButtonElement).disabled).toBe(false); // dirty after toggling an adapter
    fireEvent.click(save);
    await waitFor(() =>
      expect(updateRuntimeSettingsMock).toHaveBeenCalledWith({
        cli_autonomy_adapters: expect.arrayContaining(["pi", "claude"]),
        pm_auto_dispatch: true
      })
    );
  });

  it("warns and blocks auto-advance when no adapter is enabled", async () => {
    getRuntimeSettingsMock.mockResolvedValue(
      settingsState({
        settings: [
          { key: "cli_autonomy_adapters", value: [], source: "env", hot: true },
          { key: "pm_auto_dispatch", value: false, source: "env", hot: true }
        ]
      })
    );
    renderPanel();
    expect(await screen.findByText(/未启用任何适配器/)).toBeTruthy();
    const switchEl = screen.getByRole("switch");
    expect((switchEl as HTMLButtonElement).disabled).toBe(true);
  });

  it("is hidden for non-admin users", async () => {
    roleRef.role = "user";
    renderPanel();
    await waitFor(() => expect(getRuntimeSettingsMock).not.toHaveBeenCalled());
    expect(screen.queryByText("派发自主权")).toBeNull();
  });

  it("renders read-only when FORGEBADGER_RUNTIME_SETTINGS_READONLY is on", async () => {
    getRuntimeSettingsMock.mockResolvedValue(settingsState({ readonly: true }));
    renderPanel();
    expect(await screen.findByText(/FORGEBADGER_RUNTIME_SETTINGS_READONLY/)).toBeTruthy();
    const readonlyPi = await screen.findByLabelText("pi");
    expect((readonlyPi as HTMLButtonElement).disabled).toBe(true);
  });
});
