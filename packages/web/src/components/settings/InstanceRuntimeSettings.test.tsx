// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LanguageProvider } from "@/hooks/use-language";
import { InstanceRuntimeSettings } from "@/components/settings/InstanceRuntimeSettings";

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
  updateRuntimeSettingsMock
} = vi.hoisted(() => ({
  roleRef: { role: "admin" as "admin" | "user" },
  getRuntimeSettingsMock: vi.fn(),
  updateRuntimeSettingsMock: vi.fn()
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: roleRef.role === "admin" ? { role: "admin" } : { role: "user" } })
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getRuntimeSettings: getRuntimeSettingsMock,
    updateRuntimeSettings: updateRuntimeSettingsMock
  };
});

const state = {
  readonly: false,
  settings: [
    { key: "registration", value: "open", source: "env", hot: true },
    { key: "mcp_enabled", value: false, source: "env", hot: false },
    { key: "session_prefix", value: "fb-", source: "env", hot: true },
    { key: "cli_autonomy_adapters", value: [], source: "env", hot: true },
    { key: "pm_auto_dispatch", value: false, source: "env", hot: true }
  ]
};

function renderCard() {
  return render(
    <LanguageProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <InstanceRuntimeSettings />
      </QueryClientProvider>
    </LanguageProvider>
  );
}

describe("InstanceRuntimeSettings", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    roleRef.role = "admin";
    getRuntimeSettingsMock.mockResolvedValue(state);
    updateRuntimeSettingsMock.mockResolvedValue(state);
  });

  it("is hidden for non-admin users", async () => {
    roleRef.role = "user";
    renderCard();
    await waitFor(() => expect(getRuntimeSettingsMock).not.toHaveBeenCalled());
    expect(screen.queryByText("实例设置")).toBeNull();
  });

  it("edits and saves registration mode and session prefix", async () => {
    renderCard();
    expect(await screen.findByText("实例设置")).toBeTruthy();
    expect((await screen.findAllByText(".env")).length).toBeGreaterThan(0); // provenance badges

    const prefix = await screen.findByRole("textbox", { name: "会话名前缀" });
    fireEvent.change(prefix, { target: { value: "fb-local" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(updateRuntimeSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({ session_prefix: "fb-local" })
      )
    );
  });

  it("shows the read-only notice when the escape hatch is set", async () => {
    getRuntimeSettingsMock.mockResolvedValue({ ...state, readonly: true });
    renderCard();
    expect(await screen.findByText(/FORGEBADGER_RUNTIME_SETTINGS_READONLY/)).toBeTruthy();
    const prefix = await screen.findByRole("textbox", { name: "会话名前缀" });
    expect((prefix as HTMLInputElement).disabled).toBe(true);
  });
});
