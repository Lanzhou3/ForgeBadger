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

describe("provider-quota-panel applied provider", () => {
  it("shows the applied provider balance and skips the native account query", async () => {
    vi.mocked(getAppliedProviderForAdapter).mockResolvedValue({ appliedProvider: applied });
    vi.mocked(checkProviderBalance).mockResolvedValue(balance);
    renderPanel("claude");
    expect((await screen.findByRole("progressbar", { name: /Credits/ })).getAttribute("aria-valuenow")).toBe(
      "20"
    );
    expect(panelText()).toContain("OpenAI");
    expect(getCliAccount).not.toHaveBeenCalled();
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
