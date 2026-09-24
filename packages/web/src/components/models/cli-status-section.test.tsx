// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliStatusSection } from "./cli-status-section";
import { ADAPTER_DISCOVERY_QUERY_KEY } from "@/components/adapter-select";
import {
  discoverAdapters,
  getCliAccounts,
  getAppliedProviders,
  getClaudeRoute,
  refreshCliAccountQuota,
  type CliAccountOverview,
  type CliQuotaUnsupportedReason,
  type ProviderProfile,
} from "@/lib/api";
import { toast } from "@/lib/toast";

vi.mock("@/hooks/use-language", () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api", () => ({
  discoverAdapters: vi.fn(async () => ({ adapters: [] })),
  getAppliedProviders: vi.fn(async () => ({ adapters: [] })),
  getClaudeRoute: vi.fn(async () => ({ enabled: false })),
  getCliAccounts: vi.fn(),
  refreshCliAccountQuota: vi.fn(),
}));

const provider: ProviderProfile = {
  id: "provider-1", providerKey: "custom", name: "Custom", baseUrl: "https://example.com/v1",
  apiFormat: "openai", authType: "api_key", supportedAdapters: ["claude", "codex", "kimi"], status: "active",
};

const FETCHED_AT = "2026-09-22T12:00:00Z";

function claudeReadyWithQuota(): CliAccountOverview {
  return {
    login: { adapter: "claude", state: "ready", method: "claude.ai" },
    quota: {
      supported: true,
      planLabel: "Max",
      entries: [
        { label: "5h window", unit: "percent", usedPercent: 30, resetsAt: "2026-09-22T18:00:00Z" },
        { label: "Weekly window", unit: "percent", usedPercent: 85 },
        { label: "Requests", unit: "count", remaining: 800, limit: 1000 },
      ],
      fetchedAt: FETCHED_AT,
    },
  };
}

function unsupportedQuota(reason: CliQuotaUnsupportedReason): CliAccountOverview["quota"] {
  return { supported: false, unsupportedReason: reason, entries: [], fetchedAt: FETCHED_AT };
}

function setup(accounts: CliAccountOverview[] | Error = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(ADAPTER_DISCOVERY_QUERY_KEY, { adapters: [] });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  if (accounts instanceof Error) {
    vi.mocked(getCliAccounts).mockRejectedValue(accounts);
  } else {
    vi.mocked(getCliAccounts).mockResolvedValue({ accounts });
  }
  render(
    <QueryClientProvider client={client}>
      <CliStatusSection provider={provider} onApply={vi.fn()} onViewConfig={vi.fn()} />
    </QueryClientProvider>
  );
  return { invalidate };
}

function cardText(adapter: string): string {
  const card = screen.getByTestId(`cli-status-${adapter}`);
  return card.textContent ?? "";
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("cli-status-section login badges", () => {
  it("shows a logged-in badge with the method label for a ready adapter", async () => {
    setup([claudeReadyWithQuota()]);
    await waitFor(() => expect(cardText("claude")).toContain("models.cliAccountLoggedIn · claude.ai"));
    expect(cardText("claude")).not.toContain("models.cliAccountLoginHintClaude");
  });

  it("maps method values to display labels (chatgpt, api_key)", async () => {
    setup([
      { login: { adapter: "codex", state: "ready", method: "chatgpt" } },
      { login: { adapter: "kimi", state: "ready", method: "api_key" } },
    ]);
    await waitFor(() => expect(cardText("codex")).toContain("models.cliAccountLoggedIn · ChatGPT"));
    await waitFor(() => expect(cardText("kimi")).toContain("models.cliAccountLoggedIn · models.authTypeApiKey"));
  });

  it("shows a not-logged-in badge plus the per-CLI login hint and a refresh button", async () => {
    setup([
      { login: { adapter: "codex", state: "not_authenticated", method: "unknown" }, quota: unsupportedQuota("no_native_login") },
    ]);
    await waitFor(() => expect(cardText("codex")).toContain("models.cliAccountNotLoggedIn"));
    expect(cardText("codex")).toContain("models.cliAccountLoginHintCodex");
    expect(cardText("codex")).toContain("models.cliAccountQuotaNoNativeLogin");
    expect(screen.getByRole("button", { name: "models.cliAccountQuotaRefresh" })).toBeTruthy();
  });

  it("renders no login badge for cli_missing or for opencode/pi cards", async () => {
    setup([{ login: { adapter: "kimi", state: "cli_missing", method: "unknown" } }]);
    // Give the query a beat to settle so the absence assertions are stable.
    await waitFor(() => expect(getCliAccounts).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    const kimiText = cardText("kimi");
    expect(kimiText).not.toContain("models.cliAccountLoggedIn");
    expect(kimiText).not.toContain("models.cliAccountNotLoggedIn");
    expect(kimiText).not.toContain("models.cliAccountDetectFailed");
    for (const adapter of ["opencode", "pi"]) {
      expect(cardText(adapter)).not.toContain("models.cliAccount");
    }
  });

  it("shows a detection-failed badge for the unknown login state", async () => {
    setup([{ login: { adapter: "codex", state: "unknown" } }]);
    await waitFor(() => expect(cardText("codex")).toContain("models.cliAccountDetectFailed"));
  });

  it("shows a neutral custom-endpoint badge for a routed claude config instead of a login state", async () => {
    setup([{ login: { adapter: "claude", state: "custom_endpoint" } }]);
    await waitFor(() => expect(cardText("claude")).toContain("models.cliAccountCustomEndpoint"));
    const claudeText = cardText("claude");
    expect(claudeText).not.toContain("models.cliAccountLoggedIn");
    expect(claudeText).not.toContain("models.cliAccountNotLoggedIn");
    expect(claudeText).not.toContain("models.cliAccountLoginHintClaude");
  });
});

describe("cli-status-section quota summary", () => {
  it("renders progress bars, the derived count percentage, plan label and reset times", async () => {
    setup([claudeReadyWithQuota()]);
    expect((await screen.findByRole("progressbar", { name: /5h window/ })).getAttribute("aria-valuenow")).toBe("30");
    expect(screen.getByRole("progressbar", { name: /Weekly window/ }).getAttribute("aria-valuenow")).toBe("85");
    expect(screen.getByRole("progressbar", { name: /Requests/ }).getAttribute("aria-valuenow")).toBe("20");
    const claudeText = cardText("claude");
    expect(claudeText).toContain("Max");
    expect(claudeText).toContain("800 / 1000");
    expect(claudeText).toContain("models.cliAccountQuotaResets");
  });

  it.each([
    ["keychain", "models.cliAccountQuotaKeychain"],
    ["no_native_login", "models.cliAccountQuotaNoNativeLogin"],
    ["api_key_mode", "models.cliAccountQuotaApiKeyMode"],
    ["token_expired", "models.cliAccountQuotaTokenExpired"],
    ["upstream_error", "models.cliAccountQuotaUpstreamError"],
  ] as [CliQuotaUnsupportedReason, string][])(
    "shows the %s unsupported hint as %s",
    async (reason, key) => {
      setup([{ login: { adapter: "claude", state: "ready", method: "claude.ai" }, quota: unsupportedQuota(reason) }]);
      await waitFor(() => expect(cardText("claude")).toContain(key));
    }
  );

  it("refreshes the adapter quota and invalidates the cli-accounts query", async () => {
    const { invalidate } = setup([
      { login: { adapter: "codex", state: "not_authenticated" }, quota: unsupportedQuota("no_native_login") },
    ]);
    vi.mocked(refreshCliAccountQuota).mockResolvedValue({
      overview: { login: { adapter: "codex", state: "ready", method: "chatgpt" } },
    });
    const button = await screen.findByRole("button", { name: "models.cliAccountQuotaRefresh" });
    fireEvent.click(button);
    await waitFor(() => expect(refreshCliAccountQuota).toHaveBeenCalledWith("codex"));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["cli-accounts"] }));
  });
});

describe("cli-status-section failure degradation", () => {
  it("hides the login area silently when the cli-accounts query fails", async () => {
    setup(new Error("gateway down"));
    expect(await screen.findByTestId("cli-status-section")).toBeTruthy();
    await waitFor(() => expect(getCliAccounts).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Install badges still render from the other queries...
    expect(cardText("claude")).toContain("models.sdkMissing");
    // ...and no login state, hint, quota, or error text leaks through.
    expect(screen.queryAllByRole("progressbar")).toEqual([]);
    for (const key of [
      "models.cliAccountLoggedIn",
      "models.cliAccountNotLoggedIn",
      "models.cliAccountDetectFailed",
      "models.cliAccountLoginHintClaude",
      "models.cliAccountQuotaKeychain",
      "models.cliAccountQuotaRefreshFailed",
    ]) {
      expect(screen.queryByText(key)).toBeNull();
    }
  });

  it("toasts when a manual refresh fails", async () => {
    setup([{ login: { adapter: "kimi", state: "not_authenticated" }, quota: unsupportedQuota("token_expired") }]);
    vi.mocked(refreshCliAccountQuota).mockRejectedValue(new Error("busy"));
    const button = await screen.findByRole("button", { name: "models.cliAccountQuotaRefresh" });
    fireEvent.click(button);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("models.cliAccountQuotaRefreshFailed"));
  });
});
