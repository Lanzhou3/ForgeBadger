// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SettingsPage from "./page";

const { discoverAdaptersMock, getDependenciesMock, listAuditLogsMock } = vi.hoisted(() => ({
  discoverAdaptersMock: vi.fn(),
  getDependenciesMock: vi.fn(),
  listAuditLogsMock: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    discoverAdapters: discoverAdaptersMock,
    getDependencies: getDependenciesMock,
    listAuditLogs: listAuditLogsMock,
  };
});

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({
    language: "en",
    setLanguage: vi.fn(),
    t: (key: string) => key,
  }),
}));

vi.mock("@/components/settings/AccountSecuritySettings", () => ({
  AccountSecuritySettings: () => null,
}));

vi.mock("@/components/settings/FeishuIntegrationSettings", () => ({
  FeishuIntegrationSettings: () => null,
}));

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderSettingsPage() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <SettingsPage />
    </QueryClientProvider>
  );
}

function terminalPersistenceRow() {
  const label = screen.getByText("settings.terminalPersistence");
  const row = label.parentElement;
  if (!row) throw new Error("terminal persistence row is missing");
  return row;
}

describe("SettingsPage terminal runtime", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    discoverAdaptersMock.mockResolvedValue({ adapters: [] });
    listAuditLogsMock.mockResolvedValue({ auditLogs: [] });
  });

  it("shows the psmux dependency and persistence for a native Windows runtime", async () => {
    getDependenciesMock.mockResolvedValue({
      dependencies: [
        { name: "tmux", available: false, error: "stale tmux dependency" },
        { name: "psmux", available: false, error: "psmux is not installed" },
      ],
      terminalRuntime: {
        persistence: "psmux",
        mode: "psmux_missing",
        supported: false,
        message: "psmux is not installed",
      },
    });

    renderSettingsPage();

    await waitFor(() => expect(screen.getByText("psmux is not installed")).toBeTruthy());
    expect(screen.queryByText("stale tmux dependency")).toBeNull();
    expect(
      screen.getByText("winget install --id marlocarlo.psmux --exact --source winget")
    ).toBeTruthy();
    expect(screen.queryByText("wsl --install")).toBeNull();
    expect(within(terminalPersistenceRow()).getByText("psmux")).toBeTruthy();
  });

  it("keeps tmux dependency and persistence messaging on macOS and Linux", async () => {
    getDependenciesMock.mockResolvedValue({
      dependencies: [{ name: "tmux", available: true, version: "tmux 3.5a" }],
      terminalRuntime: {
        persistence: "tmux",
        mode: "native_tmux",
        supported: true,
        message: "tmux 3.5a",
      },
    });

    renderSettingsPage();

    await waitFor(() => expect(screen.getByText("tmux 3.5a")).toBeTruthy());
    expect(within(terminalPersistenceRow()).getByText("tmux")).toBeTruthy();
    expect(screen.queryByText(/winget (?:install|upgrade)/)).toBeNull();
    expect(screen.queryByText("wsl --install")).toBeNull();
  });

  it("shows an undetected persistence value while terminal runtime discovery is pending", () => {
    getDependenciesMock.mockReturnValue(new Promise(() => undefined));

    renderSettingsPage();

    expect(within(terminalPersistenceRow()).getByText("settings.notDetected")).toBeTruthy();
    expect(within(terminalPersistenceRow()).queryByText("tmux")).toBeNull();
    expect(within(terminalPersistenceRow()).queryByText("psmux")).toBeNull();
  });

  it("does not invent a terminal persistence runtime when discovery fails", async () => {
    getDependenciesMock.mockRejectedValue(new Error("dependency discovery failed"));

    renderSettingsPage();

    await waitFor(() => expect(screen.getByText("settings.dependenciesLoadFailed")).toBeTruthy());
    expect(within(terminalPersistenceRow()).getByText("settings.notDetected")).toBeTruthy();
    expect(within(terminalPersistenceRow()).queryByText("tmux")).toBeNull();
    expect(within(terminalPersistenceRow()).queryByText("psmux")).toBeNull();
  });
});
