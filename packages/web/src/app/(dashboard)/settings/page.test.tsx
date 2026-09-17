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

  it.each([true, false])("shows built-in terminal persistence (ready=%s)", async (ready) => {
    getDependenciesMock.mockResolvedValue({
      dependencies: [{ name: "session-server", available: ready, ...(ready ? { version: "built-in" } : { error: "service unavailable" }) }],
      terminalRuntime: { persistence: "session-server", mode: ready ? "ready" : "unavailable", supported: ready, message: ready ? "built-in" : "service unavailable" },
    });
    renderSettingsPage();
    await waitFor(() => expect(within(terminalPersistenceRow()).getByText("session-server")).toBeTruthy());
    expect(screen.queryByText(/winget|apt-get|tmux|psmux/)).toBeNull();
    expect(screen.getByText(ready ? "runtimeSetup.readyDescription" : "runtimeSetup.unavailableDescription")).toBeTruthy();
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
