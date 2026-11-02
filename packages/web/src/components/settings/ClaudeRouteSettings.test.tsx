// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClaudeRouteSettings } from "./ClaudeRouteSettings";
import {
  resetClaudeRouteState,
  setClaudeRouteAssignments,
  type ClaudeRouteState,
} from "@/lib/api";

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/api", () => {
  const entry = (
    providerProfileId: string,
    providerName: string,
    modelIds: string[],
  ) => ({
    position: 0,
    providerProfileId,
    providerName,
    providerStatus: "active",
    credentialId: `cred-${providerProfileId}`,
    modelIds,
    updatedAt: 1,
  });
  const initialState = (): ClaudeRouteState => ({
    enabled: true,
    hasToken: true,
    gatewayUrl: "http://127.0.0.1:18332",
    assignments: [
      entry("provider-1", "Primary", ["m-1"]),
      entry("provider-2", "Backup", ["m-1", "m-2"]),
    ].map((item, index) => ({ ...item, position: index + 1 })),
    assignment: null,
  });
  let state: ClaudeRouteState = initialState();
  const providers = [
    {
      id: "provider-1", providerKey: "p1", name: "Primary",
      baseUrl: "https://a.example.com/v1", authType: "api_key",
      apiFormat: "openai-compatible", supportedAdapters: ["claude"], status: "active",
    },
    {
      id: "provider-2", providerKey: "p2", name: "Backup",
      baseUrl: "https://b.example.com/v1", authType: "api_key",
      apiFormat: "openai-compatible", supportedAdapters: ["claude"], status: "active",
    },
    {
      id: "provider-3", providerKey: "p3", name: "Extra",
      baseUrl: "https://c.example.com/v1", authType: "api_key",
      apiFormat: "openai-compatible", supportedAdapters: ["claude"], status: "active",
    },
    {
      id: "provider-4", providerKey: "p4", name: "NoClaude",
      baseUrl: "https://d.example.com/v1", authType: "api_key",
      apiFormat: "openai-compatible", supportedAdapters: ["opencode"], status: "active",
    },
    {
      id: "provider-5", providerKey: "p5", name: "Inactive",
      baseUrl: "https://e.example.com/v1", authType: "api_key",
      apiFormat: "openai-compatible", supportedAdapters: ["claude"], status: "inactive",
    },
  ];
  return {
    getClaudeRoute: vi.fn(async () => state),
    setClaudeRoute: vi.fn(async () => state),
    resetClaudeRouteState: () => {
      state = initialState();
    },
    setClaudeRouteAssignments: vi.fn(async (assignments: Array<{ providerProfileId: string }>) => {
      state = {
        ...state,
        assignments: assignments.map((item, index) => {
          const previous = state.assignments.find(
            (existing) => existing.providerProfileId === item.providerProfileId,
          );
          return previous
            ? { ...previous, position: index + 1 }
            : entry(item.providerProfileId, item.providerProfileId, []);
        }).map((item, index) => ({ ...item, position: index + 1 })),
      };
      return state;
    }),
    listModelProviders: vi.fn(async () => ({ providers, models: [], credentials: [] })),
  };
});

function renderSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ClaudeRouteSettings />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetClaudeRouteState();
});
afterEach(cleanup);

describe("Claude route failover order", () => {
  it("renders the ordered candidates with the primary badge", async () => {
    renderSettings();
    expect(await screen.findByText("Primary")).toBeTruthy();
    expect(screen.getByText("Backup")).toBeTruthy();
    expect(screen.getByText("settings.claudeRouteFailoverPrimary")).toBeTruthy();
  });

  it("moves a candidate up and persists the new order", async () => {
    renderSettings();
    const upButtons = await screen.findAllByRole("button", {
      name: "settings.claudeRouteFailoverUp",
    });
    expect(upButtons[0]?.disabled).toBe(true, "the primary cannot move up");
    fireEvent.click(upButtons[1]!);
    await waitFor(() =>
      expect(setClaudeRouteAssignments).toHaveBeenCalledWith([
        { providerProfileId: "provider-2" },
        { providerProfileId: "provider-1" },
      ]),
    );
    await waitFor(() => expect(screen.getByText("Backup")).toBeTruthy());
  });

  it("removes a candidate and disables removal of the last one", async () => {
    renderSettings();
    const removeButtons = await screen.findAllByRole("button", {
      name: "settings.claudeRouteFailoverRemove",
    });
    fireEvent.click(removeButtons[0]!);
    await waitFor(() =>
      expect(setClaudeRouteAssignments).toHaveBeenCalledWith([
        { providerProfileId: "provider-2" },
      ]),
    );
    // The single remaining candidate cannot be removed.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "settings.claudeRouteFailoverRemove" }).disabled).toBe(true),
    );
  });

  it("offers only active claude-capable providers that are not already candidates", async () => {
    renderSettings();
    const select = (await screen.findByRole("combobox")) as HTMLSelectElement;
    const options = Array.from(select.options)
      .map((option) => option.value)
      .filter((value) => value !== "");
    expect(options).toEqual(["provider-3"], "inactive and non-claude providers are hidden");
  });

  it("adds the selected provider as the last candidate", async () => {
    renderSettings();
    const select = (await screen.findByRole("combobox")) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "provider-3" } });
    const addButton = screen.getByRole("button", {
      name: "settings.claudeRouteFailoverAdd",
    });
    expect(addButton.disabled).toBe(false);
    fireEvent.click(addButton);
    await waitFor(() =>
      expect(setClaudeRouteAssignments).toHaveBeenCalledWith([
        { providerProfileId: "provider-1" },
        { providerProfileId: "provider-2" },
        { providerProfileId: "provider-3" },
      ]),
    );
  });
});
