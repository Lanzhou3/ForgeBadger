// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderQuotaPanel } from "./provider-quota-panel";
import {
  checkProviderBalance,
  getCliAccount,
  getAppliedProviderForAdapter,
  type AppliedProviderInfo,
  type CliAccountOverview,
  type ProviderBalanceResult,
} from "@/lib/api";

vi.mock("@/hooks/use-language", () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api", () => ({
  getAppliedProviderForAdapter: vi.fn(),
  checkProviderBalance: vi.fn(),
  getCliAccount: vi.fn(),
  refreshCliAccountQuota: vi.fn(),
}));

const FETCHED_AT = "2026-09-22T12:00:00Z";

const applied: AppliedProviderInfo = {
  providerProfileId: "p1",
  providerName: "OpenAI",
  providerStatus: "active",
  modelProfileId: null,
  appliedAt: FETCHED_AT,
};

const balance: ProviderBalanceResult = {
  supported: true,
  balances: [{ label: "Credits", unit: "count", remaining: 800, limit: 1000 }],
  checkedAt: FETCHED_AT,
};

function readyWithQuota(): CliAccountOverview {
  return {
    login: { adapter: "claude", state: "ready", method: "claude.ai" },
    quota: {
      supported: true,
      planLabel: "Max",
      entries: [
        { label: "5h window", unit: "percent", usedPercent: 30, resetsAt: "2026-09-22T18:00:00Z" },
        { label: "Requests", unit: "count", remaining: 800, limit: 1000 },
      ],
      fetchedAt: FETCHED_AT,
    },
  };
}

function notAuthenticated(): CliAccountOverview {
  return { login: { adapter: "claude", state: "not_authenticated" } };
}

function renderPanel(aiTool: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProviderQuotaPanel aiTool={aiTool} />
    </QueryClientProvider>
  );
  return client;
}

function panelText(): string {
  return screen.getByTestId("provider-quota-panel").textContent ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAppliedProviderForAdapter).mockResolvedValue({ appliedProvider: null });
});
afterEach(cleanup);

describe("provider-quota-panel dual display (applied provider + native login)", () => {
  it("shows both the provider balance and the labeled native quota with independent refresh buttons", async () => {
    vi.mocked(getAppliedProviderForAdapter).mockResolvedValue({ appliedProvider: applied });
    vi.mocked(checkProviderBalance).mockResolvedValue(balance);
    vi.mocked(getCliAccount).mockResolvedValue({ overview: readyWithQuota() });
    renderPanel("claude");

    // Provider block: balance rows under the provider name label.
    expect((await screen.findByRole("progressbar", { name: /Credits/ })).getAttribute("aria-valuenow")).toBe(
      "20"
    );
    // Native block: CLI quota rows under the native login label.
    expect((await screen.findByRole("progressbar", { name: /5h window/ })).getAttribute("aria-valuenow")).toBe(
      "30"
    );
    // Each source label appears twice: once in the header badge, once as its block label.
    expect(panelText().split("OpenAI").length - 1).toBe(2);
    expect(panelText().split("sessions.providerQuotaNative · claude.ai").length - 1).toBe(2);
    expect(getCliAccount).toHaveBeenCalled();

    // One refresh button per source, with per-source labels.
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "sessions.providerQuotaRefreshProvider" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "sessions.providerQuotaRefreshNative" })).toBeTruthy();
  });

  it("shows only the provider block when the native CLI is not logged in", async () => {
    vi.mocked(getAppliedProviderForAdapter).mockResolvedValue({ appliedProvider: applied });
    vi.mocked(checkProviderBalance).mockResolvedValue(balance);
    vi.mocked(getCliAccount).mockResolvedValue({ overview: notAuthenticated() });
    renderPanel("claude");

    expect((await screen.findByRole("progressbar", { name: /Credits/ })).getAttribute("aria-valuenow")).toBe(
      "20"
    );
    await waitFor(() => expect(getCliAccount).toHaveBeenCalled());
    expect(screen.queryByRole("progressbar", { name: /5h window/ })).toBeNull();
    expect(panelText()).not.toContain("sessions.providerQuotaNative");

    // Single source: one neutral refresh button, no native one.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "sessions.providerQuotaRefresh" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "sessions.providerQuotaRefreshNative" })).toBeNull();
  });
});

describe("provider-quota-panel native login fallback", () => {
  it("falls back to the native login quota when no provider is applied", async () => {
    vi.mocked(getCliAccount).mockResolvedValue({ overview: readyWithQuota() });
    renderPanel("claude");
    await waitFor(() => expect(panelText()).toContain("sessions.providerQuotaNative"));
    expect((await screen.findByRole("progressbar", { name: /5h window/ })).getAttribute("aria-valuenow")).toBe(
      "30"
    );
    expect(screen.getByRole("button", { name: "sessions.providerQuotaRefresh" })).toBeTruthy();
  });

  it("shows the per-CLI login hint when the native CLI is not authenticated", async () => {
    vi.mocked(getCliAccount).mockResolvedValue({
      overview: { login: { adapter: "claude", state: "not_authenticated" } },
    });
    renderPanel("claude");
    await waitFor(() => expect(panelText()).toContain("models.cliAccountLoginHintClaude"));
  });

  it("collapses to the empty state without leaking gateway errors when the account query fails", async () => {
    vi.mocked(getCliAccount).mockRejectedValue(new Error("gateway down"));
    renderPanel("claude");
    await waitFor(() => expect(panelText()).toContain("sessions.providerQuotaEmpty"));
    expect(panelText()).not.toContain("gateway down");
  });
});

describe("provider-quota-panel CLIs without a native account endpoint", () => {
  it("keeps the plain empty state and never calls the account endpoint", async () => {
    renderPanel("pi");
    await waitFor(() => expect(panelText()).toContain("sessions.providerQuotaEmpty"));
    expect(getCliAccount).not.toHaveBeenCalled();
  });
});
