// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SettingsPage from "./page";

const {
  discoverAdaptersMock,
  checkAdapterUpdatesMock,
  updateAdapterMock,
  installAdapterMock,
  listAdapterOperationsMock,
  getDependenciesMock,
  listAuditLogsMock,
  searchParamsRef,
  authRoleRef,
} = vi.hoisted(() => ({
  discoverAdaptersMock: vi.fn(),
  checkAdapterUpdatesMock: vi.fn(),
  updateAdapterMock: vi.fn(),
  installAdapterMock: vi.fn(),
  listAdapterOperationsMock: vi.fn(),
  getDependenciesMock: vi.fn(),
  listAuditLogsMock: vi.fn(),
  searchParamsRef: { value: new URLSearchParams("section=adapters") },
  authRoleRef: { role: "admin" as "admin" | "user" },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsRef.value,
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: authRoleRef.role === "admin" ? { role: "admin" } : { role: "user" },
    isLoading: false,
  }),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    discoverAdapters: discoverAdaptersMock,
    checkAdapterUpdates: checkAdapterUpdatesMock,
    updateAdapter: updateAdapterMock,
    installAdapter: installAdapterMock,
    listAdapterOperations: listAdapterOperationsMock,
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
  useUiLocale: () => "en-US",
}));

vi.mock("@/components/settings/AccountSecuritySettings", () => ({
  AccountSecuritySettings: () => null,
}));

vi.mock("@/components/settings/InstanceRuntimeSettings", () => ({
  InstanceRuntimeSettings: () => null,
}));

vi.mock("@/components/settings/ClaudeRouteSettings", () => ({
  ClaudeRouteSettings: () => null,
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

function setSection(section: string | null) {
  searchParamsRef.value = section
    ? new URLSearchParams(`section=${section}`)
    : new URLSearchParams();
}

function terminalPersistenceRow() {
  const label = screen.getByText("settings.terminalPersistence");
  const row = label.parentElement;
  if (!row) throw new Error("terminal persistence row is missing");
  return row;
}

describe("SettingsPage navigation", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    authRoleRef.role = "admin";
    setSection("appearance");
    getDependenciesMock.mockResolvedValue({ dependencies: [] });
  });

  it("lists all five sections for an admin and marks the active one", () => {
    renderSettingsPage();
    const nav = screen.getByRole("navigation", { name: "settings.title" });
    const links = within(nav).getAllByRole("link");
    expect(links).toHaveLength(5);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/settings?section=appearance",
      "/settings?section=account",
      "/settings?section=adapters",
      "/settings?section=integrations",
      "/settings?section=instance",
    ]);
    expect(within(nav).getByRole("link", { name: "settings.section.appearance" }).getAttribute("aria-current")).toBe("page");
  });

  it("hides the instance section from non-admin users", () => {
    authRoleRef.role = "user";
    renderSettingsPage();
    const nav = screen.getByRole("navigation", { name: "settings.title" });
    expect(within(nav).getAllByRole("link")).toHaveLength(4);
    expect(within(nav).queryByRole("link", { name: "settings.section.instance" })).toBeNull();
  });

  it("falls back to the appearance section for an unknown section", () => {
    setSection("bogus");
    renderSettingsPage();
    expect(screen.getByRole("radiogroup", { name: "settings.pet" })).toBeTruthy();
  });

  it("shows audit history in the instance section for an admin", async () => {
    setSection("instance");
    listAuditLogsMock.mockResolvedValue({
      auditLogs: [
        {
          id: 1,
          action: "template.restore",
          resourceType: "template",
          details: {},
          createdAt: "2026-09-26T00:00:00.000Z",
        },
      ],
    });
    renderSettingsPage();
    await screen.findByText("settings.auditHistory");
    await screen.findByText("template.restore");
  });
});

describe("SettingsPage terminal runtime", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    authRoleRef.role = "admin";
    setSection("account");
    discoverAdaptersMock.mockResolvedValue({ adapters: [] });
    checkAdapterUpdatesMock.mockResolvedValue({ updates: [], canUpdate: false });
    listAdapterOperationsMock.mockResolvedValue({ operations: [] });
    listAuditLogsMock.mockResolvedValue({ auditLogs: [] });
  });

  it("defaults to the honey badger and persists switching between both pets", () => {
    setSection("appearance");
    window.localStorage.clear();
    getDependenciesMock.mockResolvedValue({ dependencies: [] });
    renderSettingsPage();
    const group = screen.getByRole("radiogroup", { name: "settings.pet" });
    const choices = within(group).getAllByRole("radio");
    expect(choices).toHaveLength(2);
    const badger = within(group).getByRole("radio", { name: "settings.petHoneyBadger" });
    expect(badger.getAttribute("aria-checked")).toBe("true");
    const robot = within(group).getByRole("radio", { name: "settings.petRobot" });
    expect(robot.getAttribute("aria-checked")).toBe("false");
    expect(within(group).getByText("settings.petRobot")).toBeTruthy();
    fireEvent.click(robot);
    expect(window.localStorage.getItem("forgebadger.pet")).toBe("robot");
    expect(robot.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(badger);
    expect(window.localStorage.getItem("forgebadger.pet")).toBe("honey-badger");
    expect(badger.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("settings.petSaved");
  });

  it.each([true, false])("shows built-in terminal persistence (ready=%s)", async (ready) => {
    getDependenciesMock.mockResolvedValue({
      dependencies: [{ name: "session-server", available: ready, ...(ready ? { version: "built-in" } : { error: "service unavailable" }) }],
      terminalRuntime: { persistence: "session-server", mode: ready ? "ready" : "unavailable", supported: ready, message: ready ? "built-in" : "service unavailable" },
    });
    renderSettingsPage();
    await waitFor(() => expect(within(terminalPersistenceRow()).getByText("session-server")).toBeTruthy());
    expect(within(terminalPersistenceRow()).queryByText("tmux")).toBeNull();
    expect(within(terminalPersistenceRow()).queryByText("psmux")).toBeNull();
  });

  it("shows terminal runtime readiness guidance in the adapters section", async () => {
    setSection("adapters");
    getDependenciesMock.mockResolvedValue({
      dependencies: [{ name: "session-server", available: true, version: "built-in" }],
      terminalRuntime: { persistence: "session-server", mode: "ready", supported: true, message: "built-in" },
    });
    renderSettingsPage();
    await waitFor(() => expect(screen.getByText("runtimeSetup.readyDescription")).toBeTruthy());
    expect(screen.getByText("settings.launchReady")).toBeTruthy();
    expect(screen.queryByText(/winget|apt-get|tmux|psmux/)).toBeNull();
  });

  it("shows a terminal runtime error in the adapters section when discovery fails", async () => {
    setSection("adapters");
    getDependenciesMock.mockRejectedValue(new Error("dependency discovery failed"));
    renderSettingsPage();
    await waitFor(() => expect(screen.getByText("settings.dependenciesLoadFailed")).toBeTruthy());
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

    await waitFor(() => expect(within(terminalPersistenceRow()).getByText("settings.notDetected")).toBeTruthy());
    expect(within(terminalPersistenceRow()).queryByText("tmux")).toBeNull();
    expect(within(terminalPersistenceRow()).queryByText("psmux")).toBeNull();
  });

  it("shows an available CLI update and runs it when an admin clicks", async () => {
    setSection("adapters");
    getDependenciesMock.mockResolvedValue({ dependencies: [] });
    discoverAdaptersMock.mockResolvedValue({ adapters: [{
      id: "codex", label: "Codex", command: "codex", supportLevel: "supported",
      launchEnabled: true, configDir: ".codex", runtimeModes: ["terminal"],
      available: true, status: "available", version: "codex-cli 1.0.0"
    }] });
    checkAdapterUpdatesMock.mockResolvedValue({
      canUpdate: true,
      updates: [{ id: "codex", state: "update_available", installedVersion: "1.0.0", latestVersion: "2.0.0", command: "codex update" }]
    });
    let operations: object[] = [];
    listAdapterOperationsMock.mockImplementation(async () => ({ operations }));
    updateAdapterMock.mockImplementation(async () => {
      const operation = { id: "operation-1", adapterId: "codex", kind: "update", state: "running", startedAt: "2026-01-01T00:00:00.000Z" };
      operations = [operation];
      return operation;
    });

    renderSettingsPage();

    const button = await screen.findByRole("button", { name: "settings.adapterUpdateNow" });
    expect(screen.getByText("codex update")).toBeTruthy();
    fireEvent.click(button);
    await screen.findByRole("button", { name: "settings.adapterUpdating" });
    expect(updateAdapterMock).toHaveBeenCalledWith("codex");
    operations = [{
      id: "operation-1", adapterId: "codex", kind: "update", state: "succeeded",
      startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:01.000Z",
      result: { id: "codex", previousVersion: "1.0.0", installedVersion: "2.0.0",
        latestVersion: "2.0.0", command: "codex update", versionStillBehind: false }
    }];
    await waitFor(() => expect(screen.getByText("settings.adapterUpdateDone")).toBeTruthy(), { timeout: 2000 });
    expect(discoverAdaptersMock).toHaveBeenCalledTimes(2);
  });

  it("restores a running CLI operation when the settings page is opened again", async () => {
    setSection("adapters");
    getDependenciesMock.mockResolvedValue({ dependencies: [] });
    discoverAdaptersMock.mockResolvedValue({ adapters: [{
      id: "codex", label: "Codex", command: "codex", supportLevel: "supported",
      launchEnabled: true, configDir: ".codex", runtimeModes: ["terminal"],
      available: true, status: "available", version: "codex-cli 1.0.0"
    }] });
    checkAdapterUpdatesMock.mockResolvedValue({
      canUpdate: true,
      updates: [{ id: "codex", state: "update_available", installedVersion: "1.0.0", latestVersion: "2.0.0", command: "codex update" }]
    });
    listAdapterOperationsMock.mockResolvedValue({ operations: [{
      id: "operation-1", adapterId: "codex", kind: "update", state: "running", startedAt: "2026-01-01T00:00:00.000Z"
    }] });

    renderSettingsPage();

    const button = await screen.findByRole("button", { name: "settings.adapterUpdating" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(updateAdapterMock).not.toHaveBeenCalled();
  });

  it("does not show the update action to a non-admin user", async () => {
    setSection("adapters");
    getDependenciesMock.mockResolvedValue({ dependencies: [] });
    discoverAdaptersMock.mockResolvedValue({ adapters: [{
      id: "pi", label: "PI", command: "pi", supportLevel: "supported",
      launchEnabled: true, configDir: ".pi", runtimeModes: ["terminal"],
      available: true, status: "available", version: "pi 1.0.0"
    }] });
    checkAdapterUpdatesMock.mockResolvedValue({
      canUpdate: false,
      updates: [{ id: "pi", state: "update_available", installedVersion: "1.0.0", latestVersion: "2.0.0", command: "pi update --self" }]
    });

    renderSettingsPage();

    await screen.findByText("settings.adapterUpdateAdminOnly");
    expect(screen.queryByRole("button", { name: "settings.adapterUpdateNow" })).toBeNull();
  });

  it.each([
    ["update", "update"], ["install", "install"],
    ["update", "install"], ["install", "update"],
  ] as const)("keeps other CLIs usable during concurrent %s/%s operations and an independent failure", async (firstAction, secondAction) => {
    setSection("adapters");
    getDependenciesMock.mockResolvedValue({ dependencies: [] });
    const actions = { claude: firstAction, codex: secondAction, grok: "update" };
    const ids = ["claude", "codex", "grok"] as const;
    discoverAdaptersMock.mockResolvedValue({ adapters: ids.map((id) => ({
      id, label: id, command: id, supportLevel: "supported", configDir: `.${id}`,
      runtimeModes: ["terminal"], launchEnabled: actions[id] === "update",
      available: actions[id] === "update", status: actions[id] === "update" ? "available" : "missing",
      version: actions[id] === "update" ? "1.0.0" : undefined,
    })) });
    const updates = {
      canUpdate: true, canInstall: true,
      updates: ids.map((id) => ({
        id, state: actions[id] === "update" ? "update_available" : "missing",
        installedVersion: "1.0.0", latestVersion: "2.0.0",
        command: `${id} update`, installCommand: `npm install -g ${id}`,
      })),
    };
    checkAdapterUpdatesMock.mockResolvedValue(updates);
    let operations: Array<{ id: string; adapterId: string; kind: string; state: string; startedAt: string; result?: object }> = [];
    listAdapterOperationsMock.mockImplementation(async () => ({ operations }));
    const startOperation = (kind: string) => async (id: string) => {
      const operation = { id: `operation-${id}`, adapterId: id, kind, state: "running", startedAt: `2026-01-01T00:00:0${id === "claude" ? "1" : "2"}.000Z` };
      operations = [...operations, operation];
      return operation;
    };
    updateAdapterMock.mockImplementation(startOperation("update"));
    installAdapterMock.mockImplementation(startOperation("install"));
    renderSettingsPage();

    const buttonName = (action: string) => `settings.adapter${action === "update" ? "Update" : "Install"}Now`;
    const rowFor = (id: string) => {
      const row = screen.getByText(`${id} --version`).closest<HTMLElement>("div.rounded-md");
      if (!row) throw new Error(`Missing CLI row: ${id}`);
      return within(row);
    };
    const buttonFor = (id: string, action: string) => rowFor(id)
      .getByRole("button", { name: buttonName(action) });
    await screen.findByText("claude --version");
    await waitFor(() => expect(buttonFor("claude", firstAction).hasAttribute("disabled")).toBe(false));
    fireEvent.click(buttonFor("claude", firstAction));
    const busyName = `settings.adapter${firstAction === "update" ? "Updating" : "Installing"}`;
    await waitFor(() => expect(rowFor("claude").getByRole("button", { name: busyName }).hasAttribute("disabled")).toBe(true));
    expect(buttonFor("codex", secondAction).hasAttribute("disabled")).toBe(false);
    fireEvent.click(buttonFor("codex", secondAction));
    await waitFor(() => expect(operations.map((operation) => operation.adapterId).sort()).toEqual(["claude", "codex"]));

    // A completion-triggered refresh must not block unrelated CLI actions.
    let finishRefresh!: () => void;
    checkAdapterUpdatesMock.mockImplementationOnce(() => new Promise((resolve) => {
      finishRefresh = () => resolve(updates);
    }));
    operations = operations.map((operation) => operation.adapterId === "claude"
      ? { ...operation, state: "succeeded", result: { commandAvailable: true, versionStillBehind: false } }
      : operation);
    await waitFor(() => expect(finishRefresh).toBeTypeOf("function"), { timeout: 2000 });
    expect(buttonFor("grok", "update").hasAttribute("disabled")).toBe(false);
    operations = operations.map((operation) => operation.adapterId === "codex"
      ? { ...operation, state: "failed" }
      : operation);
    await screen.findByText(`settings.adapter${secondAction === "update" ? "Update" : "Install"}Failed`);
    expect(buttonFor("codex", secondAction).hasAttribute("disabled")).toBe(false);
    finishRefresh();
    await screen.findByText(`settings.adapter${firstAction === "update" ? "Update" : "Install"}Done`);
    expect(rowFor("claude").queryByText("settings.adapterUpdateFailed")).toBeNull();
  });

  it("hides stale update actions if a forced update check fails", async () => {
    setSection("adapters");
    getDependenciesMock.mockResolvedValue({ dependencies: [] });
    discoverAdaptersMock.mockResolvedValue({ adapters: [{
      id: "codex", label: "Codex", command: "codex", supportLevel: "supported",
      launchEnabled: true, configDir: ".codex", runtimeModes: ["terminal"],
      available: true, status: "available", version: "codex-cli 1.0.0"
    }] });
    checkAdapterUpdatesMock.mockResolvedValue({
      canUpdate: true,
      updates: [{ id: "codex", state: "update_available", installedVersion: "1.0.0", latestVersion: "2.0.0", command: "codex update" }]
    });

    renderSettingsPage();
    await screen.findByRole("button", { name: "settings.adapterUpdateNow" });
    checkAdapterUpdatesMock.mockRejectedValueOnce(new Error("registry unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "settings.discoveryRefresh" }));

    await screen.findByText("settings.adapterUpdateCheckFailed");
    expect(screen.queryByRole("button", { name: "settings.adapterUpdateNow" })).toBeNull();
  });

  it("shows the Homebrew channel version without offering an npm-only update", async () => {
    setSection("adapters");
    getDependenciesMock.mockResolvedValue({ dependencies: [] });
    discoverAdaptersMock.mockResolvedValue({ adapters: [{
      id: "opencode", label: "OpenCode", command: "opencode", supportLevel: "supported",
      launchEnabled: true, configDir: ".opencode", runtimeModes: ["terminal"],
      available: true, status: "available", version: "1.18.31"
    }] });
    checkAdapterUpdatesMock.mockResolvedValue({
      canUpdate: true, canInstall: true,
      updates: [{ id: "opencode", state: "up_to_date", installedVersion: "1.18.31",
        latestVersion: "1.18.31", latestSource: "homebrew", command: "opencode upgrade",
        installCommand: "npm install -g @opencode/cli" }]
    });

    renderSettingsPage();

    await screen.findByText("settings.adapterUpToDateHomebrew: 1.18.31");
    expect(screen.queryByRole("button", { name: "settings.adapterUpdateNow" })).toBeNull();
  });

  it("shows the explicit Homebrew OpenCode upgrade command when its tap publishes a newer version", async () => {
    setSection("adapters");
    getDependenciesMock.mockResolvedValue({ dependencies: [] });
    discoverAdaptersMock.mockResolvedValue({ adapters: [{
      id: "opencode", label: "OpenCode", command: "opencode", supportLevel: "supported",
      launchEnabled: true, configDir: ".opencode", runtimeModes: ["terminal"],
      available: true, status: "available", version: "1.18.31"
    }] });
    checkAdapterUpdatesMock.mockResolvedValue({
      canUpdate: true, canInstall: true,
      updates: [{ id: "opencode", state: "update_available", installedVersion: "1.18.31",
        latestVersion: "1.18.32", latestSource: "homebrew",
        command: "opencode upgrade 1.18.32 --method brew", installCommand: "npm install -g @opencode/cli" }]
    });

    renderSettingsPage();

    await screen.findByText("settings.adapterUpdateAvailableHomebrew: 1.18.32");
    expect(screen.getByText("opencode upgrade 1.18.32 --method brew")).toBeTruthy();
    expect(screen.getByRole("button", { name: "settings.adapterUpdateNow" })).toBeTruthy();
  });

  it("shows the official install command and lets an admin install a missing CLI", async () => {
    setSection("adapters");
    getDependenciesMock.mockResolvedValue({ dependencies: [] });
    discoverAdaptersMock.mockResolvedValue({ adapters: [{
      id: "codex", label: "Codex", command: "codex", supportLevel: "supported",
      launchEnabled: false, configDir: ".codex", runtimeModes: ["terminal"],
      available: false, status: "missing"
    }] });
    checkAdapterUpdatesMock.mockResolvedValue({
      canUpdate: true, canInstall: true,
      updates: [{ id: "codex", state: "missing", command: "codex update", installCommand: "npm install -g @openai/codex" }]
    });
    let operations: object[] = [];
    listAdapterOperationsMock.mockImplementation(async () => ({ operations }));
    installAdapterMock.mockImplementation(async () => {
      const operation = { id: "operation-install", adapterId: "codex", kind: "install", state: "running", startedAt: "2026-01-01T00:00:00.000Z" };
      operations = [operation];
      return operation;
    });

    renderSettingsPage();

    const button = await screen.findByRole("button", { name: "settings.adapterInstallNow" });
    expect(screen.getByText("npm install -g @openai/codex")).toBeTruthy();
    fireEvent.click(button);
    await screen.findByRole("button", { name: "settings.adapterInstalling" });
    expect(installAdapterMock).toHaveBeenCalledWith("codex");
    operations = [{
      id: "operation-install", adapterId: "codex", kind: "install", state: "succeeded",
      startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:01.000Z",
      result: { id: "codex", command: "npm install -g @openai/codex", installedVersion: "1.2.3", commandAvailable: true }
    }];
    await waitFor(() => expect(screen.getByText("settings.adapterInstallDone")).toBeTruthy(), { timeout: 2000 });
    expect(discoverAdaptersMock).toHaveBeenCalledTimes(2);
  });

  it("shows Node requirements and disables install until they are met", async () => {
    setSection("adapters");
    getDependenciesMock.mockResolvedValue({ dependencies: [] });
    discoverAdaptersMock.mockResolvedValue({ adapters: [{
      id: "pi", label: "Pi", command: "pi", supportLevel: "supported",
      launchEnabled: false, configDir: ".pi", runtimeModes: ["terminal"],
      available: false, status: "missing"
    }] });
    checkAdapterUpdatesMock.mockResolvedValue({
      canUpdate: true, canInstall: true,
      updates: [{ id: "pi", state: "missing", command: "pi update --self",
        installCommand: "npm install -g --ignore-scripts @earendil-works/pi-coding-agent", installRequiresNode: "22.19.0" }]
    });

    renderSettingsPage();

    const button = await screen.findByRole("button", { name: "settings.adapterInstallNow" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("npm install -g --ignore-scripts @earendil-works/pi-coding-agent")).toBeTruthy();
    expect(screen.getByText("settings.adapterInstallRequiresNode 22.19.0+")).toBeTruthy();
    expect(installAdapterMock).not.toHaveBeenCalled();
  });
});
